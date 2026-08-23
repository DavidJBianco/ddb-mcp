import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXPECTED_TOOLS } from "../support/tool-manifest.mjs";
import { captureStderr, summarizeLiveFailure } from "../support/failure-diagnostics.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const enabled = process.env.DDB_MCP_LIVE_TESTS === "1";

function requireStructure(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned malformed JSON; ${summarizeLiveFailure("malformed JSON response")}`);
  }
}

function responseDigest(text) {
  return createHash("sha256").update(text).digest("hex");
}

function validateSourcebookContent(response, expectedMaxChars) {
  requireStructure(response?.kind === "content", "sourcebook content response kind changed");
  requireStructure(typeof response?.text === "string" && response.text.length > 0, "sourcebook content text shape changed");
  requireStructure(Array.from(response.text).length <= expectedMaxChars, "sourcebook content exceeded max_chars");
  requireStructure(Array.isArray(response.images), "sourcebook image metadata shape changed");
  requireStructure(typeof response.done === "boolean", "sourcebook done shape changed");
  requireStructure(
    response.nextCursor === null || (typeof response.nextCursor === "string" && response.nextCursor.length > 0),
    "sourcebook cursor shape changed"
  );
  requireStructure(response.maxChars === expectedMaxChars, "sourcebook max_chars binding changed");
  requireStructure(
    Number.isInteger(response.serverMaxChars) && response.serverMaxChars >= expectedMaxChars,
    "sourcebook server limit shape changed"
  );
  for (const image of response.images) {
    requireStructure(
      typeof image?.id === "string" && typeof image?.alt === "string" && typeof image?.caption === "string",
      "sourcebook image fields changed"
    );
    let imageUrl;
    try {
      imageUrl = new URL(image.url);
    } catch {
      throw new Error("sourcebook image URL shape changed");
    }
    requireStructure(
      imageUrl.protocol === "https:" && imageUrl.username === "" && imageUrl.password === "",
      "sourcebook image URL is not safe HTTPS"
    );
  }
}

async function callText(client, diagnostics, name, args = {}) {
  let result;
  try {
    result = await client.callTool({ name, arguments: args });
  } catch (error) {
    throw new Error(`${name} transport failed; ${summarizeLiveFailure(error, { stderr: diagnostics() })}`);
  }

  if (result.isError) {
    const responseText = result.content?.map((block) => (block.type === "text" ? block.text : "")).join("\n") ?? "";
    throw new Error(
      `${name} returned a tool error; ${summarizeLiveFailure(responseText, { stderr: diagnostics() })}`
    );
  }
  const block = result.content?.[0];
  requireStructure(block?.type === "text" && typeof block.text === "string", `${name} returned no text block`);
  return block.text;
}

function liveTransport(sessionPath, outputDirectory) {
  if (process.env.DDB_MCP_LIVE_TRANSPORT === "mock") {
    const mockEnv = {};
    for (const name of ["DDB_MCP_LIVE_MOCK_FAIL_TOOL", "DDB_MCP_SESSION_PATH", "TMPDIR", "TMP", "TEMP"]) {
      if (process.env[name]) mockEnv[name] = process.env[name];
    }
    return new StdioClientTransport({
      command: process.execPath,
      args: ["test/fixtures/live-mock-mcp-server.mjs"],
      cwd: repositoryRoot,
      env: mockEnv,
      stderr: "pipe",
    });
  }

  if (process.env.DDB_MCP_LIVE_TRANSPORT === "docker") {
    const image = process.env.DDB_MCP_LIVE_IMAGE ?? "ddb-mcp:live";
    const containerName = process.env.DDB_MCP_LIVE_CONTAINER_NAME ?? `ddb-mcp-live-test-${process.pid}`;
    return new StdioClientTransport({
      command: "docker",
      args: [
        "run",
        "--rm",
        "--name",
        containerName,
        "--label",
        "org.ddb-mcp.test-suite=live",
        "--interactive",
        "--group-add",
        String(process.getgid?.() ?? 0),
        "--mount",
        `type=bind,src=${sessionPath},dst=/home/mcp/.config/ddb-mcp/session.json,readonly`,
        "--mount",
        `type=bind,src=${outputDirectory},dst=/tmp/ddb-live-output`,
        image,
      ],
      cwd: repositoryRoot,
      stderr: "pipe",
    });
  }

  return new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: repositoryRoot,
    env: { ...process.env, DDB_MCP_SESSION_PATH: sessionPath },
    stderr: "pipe",
  });
}

test(
  "explicit live read-only MCP suite",
  { skip: enabled ? false : "set DDB_MCP_LIVE_TESTS=1 to opt in", timeout: 600_000 },
  async (t) => {
    let sessionPath = process.env.DDB_MCP_SESSION_PATH;
    requireStructure(typeof sessionPath === "string" && isAbsolute(sessionPath), "an explicit absolute session path is required");
    try {
      const sessionStat = await stat(sessionPath);
      requireStructure(sessionStat.isFile(), "the external session path must identify a file");
      const sessionHandle = await open(sessionPath, "r");
      await sessionHandle.close();
      sessionPath = await realpath(sessionPath);
    } catch {
      throw new Error("the external session file is missing or unreadable; path suppressed");
    }
    const repositoryRelativePath = relative(repositoryRoot, sessionPath);
    requireStructure(
      repositoryRelativePath === ".." || repositoryRelativePath.startsWith(`..${sep}`),
      "the session file must remain outside the repository"
    );

    const outputDirectory = await mkdtemp(join(tmpdir(), "ddb-mcp-live-output-"));
    t.after(async () => rm(outputDirectory, { recursive: true, force: true }));
    if (process.env.DDB_MCP_LIVE_TRANSPORT === "docker") {
      await chmod(outputDirectory, 0o730);
    }

    const transport = liveTransport(sessionPath, outputDirectory);
    const diagnostics = captureStderr(transport);
    const client = new Client({ name: "ddb-mcp-live-read-test", version: "1.0.0" });
    t.after(async () => client.close());
    try {
      await client.connect(transport);
    } catch (error) {
      throw new Error(`live MCP initialization failed; ${summarizeLiveFailure(error, { stderr: diagnostics() })}`);
    }

    await t.test("initializes and lists the exact MCP tool manifest", async () => {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map(({ name }) => name).sort(),
        EXPECTED_TOOLS
      );
    });

    let characters = [];
    await t.test("restores the external session and lists characters", async () => {
      characters = parseJson(await callText(client, diagnostics, "ddb_list_characters"), "ddb_list_characters");
      requireStructure(Array.isArray(characters), "character listing must be an array");
    });

    await t.test(
      "retrieves a character through the authenticated API",
      { skip: characters.length === 0 ? "account has no character available" : false },
      async () => {
        const character = characters[0];
        requireStructure(typeof character?.id === "string" && character.id.length > 0, "character listing omitted an ID");
        const result = parseJson(
          await callText(client, diagnostics, "ddb_get_character", { character_id: character.id }),
          "ddb_get_character"
        );
        requireStructure(result && typeof result === "object" && result.data && typeof result.data === "object", "character API shape changed");
      }
    );

    await t.test(
      "downloads character JSON only to the external temporary directory",
      { skip: characters.length === 0 ? "account has no character available" : false },
      async () => {
        const characterId = characters[0]?.id;
        requireStructure(typeof characterId === "string" && characterId.length > 0, "character listing omitted an ID");
        const inContainer = "/tmp/ddb-live-output/character.json";
        const onHost = join(outputDirectory, "character.json");
        const outputPath = process.env.DDB_MCP_LIVE_TRANSPORT === "docker" ? inContainer : onHost;
        await callText(client, diagnostics, "ddb_download_character", {
          character_id: characterId,
          output_path: outputPath,
        });
        const downloaded = parseJson(await readFile(onHost, "utf8"), "downloaded character file");
        requireStructure(downloaded && typeof downloaded === "object" && downloaded.data, "downloaded character shape changed");
        await rm(onHost, { force: true });
      }
    );

    await t.test("exercises rendered character fallback with a nonexistent ID", async () => {
      const fallback = parseJson(
        await callText(client, diagnostics, "ddb_get_character", {
          character_id: "999999999999999999",
          fallback_scrape: true,
        }),
        "ddb_get_character fallback"
      );
      requireStructure(fallback && typeof fallback === "object", "character fallback did not return an object");
    });

    let campaigns = [];
    await t.test("lists campaigns without exposing campaign data", async () => {
      campaigns = parseJson(await callText(client, diagnostics, "ddb_list_campaigns"), "ddb_list_campaigns");
      requireStructure(Array.isArray(campaigns), "campaign listing must be an array");
    });

    await t.test(
      "retrieves one campaign when available",
      { skip: campaigns.length === 0 ? "account has no campaign available" : false },
      async () => {
        const campaignId = campaigns[0]?.id;
        requireStructure(typeof campaignId === "string" && campaignId.length > 0, "campaign listing omitted an ID");
        const campaign = parseJson(
          await callText(client, diagnostics, "ddb_get_campaign", { campaign_id: campaignId }),
          "ddb_get_campaign"
        );
        requireStructure(campaign && typeof campaign === "object", "campaign detail must be an object");
      }
    );

    await t.test("navigates safely and reads the current page", async () => {
      const navigated = await callText(client, diagnostics, "ddb_navigate", {
        url: "https://www.dndbeyond.com/characters",
      });
      requireStructure(navigated.startsWith("URL: https://www.dndbeyond.com/characters"), "navigation response shape changed");
      const current = await callText(client, diagnostics, "ddb_current_page");
      requireStructure(current.startsWith("Current URL: https://www.dndbeyond.com/characters"), "current-page response shape changed");
    });

    await t.test("performs a read-only search", async () => {
      const results = await callText(client, diagnostics, "ddb_search", { query: "shield", category: "spells" });
      requireStructure(results.length > 0, "search returned an empty response");
      const parsed = parseJson(results, "ddb_search");
      requireStructure(Array.isArray(parsed.results), "search results shape changed");
      requireStructure(parsed.results.every((result) => Array.isArray(result.sources)), "search source attribution shape changed");
    });

    await t.test("searches accessible and catalog sourcebooks without reading them", async () => {
      for (const sourceScope of [undefined, "all"]) {
        const parsed = parseJson(
          await callText(client, diagnostics, "ddb_search", {
            query: "handbook",
            category: "sourcebooks",
            ...(sourceScope ? { source_scope: sourceScope } : {}),
          }),
          "ddb_search sourcebooks"
        );
        requireStructure(Array.isArray(parsed.results), "sourcebook search results shape changed");
        requireStructure(typeof parsed.count === "number", "sourcebook search count shape changed");
        for (const result of parsed.results) {
          requireStructure(["accessible", "unavailable", "unknown"].includes(result.access), "sourcebook access shape changed");
          requireStructure(Array.isArray(result.sources), "sourcebook sources shape changed");
          requireStructure(result.bookSlug === null || typeof result.bookSlug === "string", "sourcebook slug shape changed");
        }
      }
    });

    let books = [];
    await t.test("lists the owned library without exposing titles", async () => {
      const library = parseJson(await callText(client, diagnostics, "ddb_list_library"), "ddb_list_library");
      requireStructure(Array.isArray(library?.books), "library response shape changed");
      books = library.books;
    });

    let selectedBookSlug;
    let selectedChapterSlug;
    let chapterEntries = [];
    await t.test(
      "discovers one sourcebook outline when available",
      { skip: books.length === 0 ? "account has no sourcebook available" : false },
      async () => {
        const slug = books[0]?.slug;
        requireStructure(typeof slug === "string" && slug.length > 0, "library listing omitted a book slug");
        const outline = parseJson(
          await callText(client, diagnostics, "ddb_read_book", { book_slug: slug }),
          "ddb_read_book"
        );
        requireStructure(outline?.kind === "outline", "sourcebook response kind changed");
        requireStructure(Array.isArray(outline.entries), "sourcebook outline entries shape changed");
        requireStructure(outline.done === true && outline.nextCursor === null, "sourcebook outline completion shape changed");
        const chapter = outline.entries.find(
          (entry) => typeof entry?.chapterSlug === "string" && entry.chapterSlug.length > 0
        );
        requireStructure(chapter, "sourcebook outline contained no readable chapter path");
        selectedBookSlug = slug;
        selectedChapterSlug = chapter.chapterSlug;
      }
    );

    await t.test(
      "discovers the selected live chapter heading outline",
      { skip: !selectedChapterSlug ? "sourcebook outline contained no chapter" : false },
      async () => {
        const outline = parseJson(
          await callText(client, diagnostics, "ddb_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            mode: "outline",
          }),
          "ddb_read_book chapter outline"
        );
        requireStructure(outline?.kind === "outline", "chapter outline response kind changed");
        requireStructure(Array.isArray(outline.entries) && outline.entries.length > 0, "chapter heading outline was empty");
        requireStructure(outline.done === true && outline.nextCursor === null, "chapter outline completion shape changed");
        for (const entry of outline.entries) {
          requireStructure(
            typeof entry?.id === "string" && entry.id.length > 0 &&
              typeof entry?.title === "string" && entry.title.length > 0 &&
              Number.isInteger(entry?.level) && entry.level >= 1 && entry.level <= 6 &&
              (entry.parentId === null || typeof entry.parentId === "string"),
            "chapter heading entry shape changed"
          );
        }
        chapterEntries = outline.entries;
      }
    );

    await t.test(
      "reads bounded live chapter content and follows a stable cursor",
      { skip: !selectedChapterSlug ? "sourcebook outline contained no chapter" : false },
      async () => {
        const bounded = parseJson(
          await callText(client, diagnostics, "ddb_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            max_chars: 512,
          }),
          "ddb_read_book bounded content"
        );
        validateSourcebookContent(bounded, 512);

        const firstPage = parseJson(
          await callText(client, diagnostics, "ddb_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            max_chars: 1,
          }),
          "ddb_read_book first cursor page"
        );
        validateSourcebookContent(firstPage, 1);
        requireStructure(typeof firstPage.nextCursor === "string", "live chapter did not produce a continuation cursor");
        requireStructure(firstPage.done === false, "live chapter unexpectedly completed in one character");

        const continuationArguments = {
          book_slug: selectedBookSlug,
          chapter_slug: selectedChapterSlug,
          max_chars: 1,
          cursor: firstPage.nextCursor,
        };
        const continuationTextA = await callText(client, diagnostics, "ddb_read_book", continuationArguments);
        const continuationTextB = await callText(client, diagnostics, "ddb_read_book", continuationArguments);
        const continuation = parseJson(continuationTextA, "ddb_read_book cursor continuation");
        validateSourcebookContent(continuation, 1);
        requireStructure(
          responseDigest(continuationTextA) === responseDigest(continuationTextB),
          "retrying an unchanged sourcebook cursor was not deterministic"
        );
      }
    );

    await t.test(
      "reads a live section by stable heading ID",
      { skip: chapterEntries.length === 0 ? "chapter heading outline was empty" : false },
      async () => {
        const selectedSection = chapterEntries[0];
        const firstSectionPage = parseJson(
          await callText(client, diagnostics, "ddb_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            section: selectedSection.id,
            max_chars: 1,
          }),
          "ddb_read_book section content"
        );
        validateSourcebookContent(firstSectionPage, 1);
        requireStructure(firstSectionPage.section?.id === selectedSection.id, "sourcebook section binding changed");
        requireStructure(typeof firstSectionPage.nextCursor === "string", "live section did not produce a continuation cursor");

        const continuation = parseJson(
          await callText(client, diagnostics, "ddb_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            section: selectedSection.id,
            max_chars: 1,
            cursor: firstSectionPage.nextCursor,
          }),
          "ddb_read_book section cursor continuation"
        );
        validateSourcebookContent(continuation, 1);
        requireStructure(continuation.section?.id === selectedSection.id, "section cursor lost its section binding");
      }
    );

    const uniqueHeading = chapterEntries.find(
      (candidate) => chapterEntries.filter(({ title }) => title === candidate.title).length === 1
    );
    await t.test(
      "reads a live section by exact unique heading",
      { skip: !uniqueHeading ? "chapter has no unique heading" : false },
      async () => {
        const section = parseJson(
          await callText(client, diagnostics, "ddb_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            section: uniqueHeading.title,
            max_chars: 512,
          }),
          "ddb_read_book named section content"
        );
        validateSourcebookContent(section, 512);
        requireStructure(section.section?.id === uniqueHeading.id, "named sourcebook section resolved incorrectly");
      }
    );

    await t.test("uses generic interaction only for a screenshot", async () => {
      const response = await callText(client, diagnostics, "ddb_interact", { action: "screenshot", selector: "body" });
      requireStructure(response.startsWith("Screenshot saved to: "), "screenshot response shape changed");
      if (process.env.DDB_MCP_LIVE_TRANSPORT !== "docker") {
        const screenshotPath = response.slice("Screenshot saved to: ".length);
        requireStructure(screenshotPath.startsWith(`${tmpdir()}/ddb-screenshot-`), "unexpected screenshot location");
        await rm(screenshotPath, { force: true });
      }
    });
  }
);
