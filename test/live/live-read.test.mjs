import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, open, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXPECTED_TOOLS } from "../support/tool-manifest.mjs";
import { captureStderr, summarizeLiveFailure } from "../support/failure-diagnostics.mjs";
import {
  DEFAULT_LIVE_SESSION_VOLUME,
  dockerLiveArguments,
  validateLiveSessionVolumeName,
} from "../support/live-docker.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

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

async function callResult(client, diagnostics, name, args = {}) {
  let result;
  try {
    result = await client.callTool({ name, arguments: args });
  } catch (error) {
    throw new Error(
      `${name} transport failed; ${summarizeLiveFailure(error, { stderr: await settledDiagnostics(diagnostics) })}`
    );
  }

  if (result.isError) {
    const responseText = result.content?.map((block) => (block.type === "text" ? block.text : "")).join("\n") ?? "";
    throw new Error(
      `${name} returned a tool error; ${summarizeLiveFailure(responseText, { stderr: await settledDiagnostics(diagnostics) })}`
    );
  }
  return result;
}

async function settledDiagnostics(diagnostics) {
  // MCP stdout and the sibling stderr pipe are independent streams. Give a
  // failure-only diagnostic write one bounded turn to reach the parent before
  // sampling it, so Linux scheduling cannot drop the safe stderr-line count.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return diagnostics();
}

async function callText(client, diagnostics, name, args = {}) {
  const result = await callResult(client, diagnostics, name, args);
  const block = result.content?.[0];
  requireStructure(block?.type === "text" && typeof block.text === "string", `${name} returned no text block`);
  return block.text;
}

function liveTransport(sessionPath, outputDirectory) {
  if (process.env.MYSTERIUM_LIVE_TRANSPORT === "mock") {
    const mockEnv = {};
    for (const name of ["MYSTERIUM_LIVE_MOCK_FAIL_TOOL", "MYSTERIUM_SESSION_PATH", "TMPDIR", "TMP", "TEMP"]) {
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

  if (process.env.MYSTERIUM_LIVE_TRANSPORT === "docker") {
    const image = process.env.MYSTERIUM_LIVE_IMAGE ?? "mysterium:live";
    const containerName = process.env.MYSTERIUM_LIVE_CONTAINER_NAME ?? `mysterium-live-test-${process.pid}`;
    const sessionVolume = validateLiveSessionVolumeName(
      process.env.MYSTERIUM_SESSION_VOLUME ?? DEFAULT_LIVE_SESSION_VOLUME
    );
    return new StdioClientTransport({
      command: "docker",
      args: dockerLiveArguments({ image, containerName, sessionVolume, outputDirectory }),
      cwd: repositoryRoot,
      stderr: "pipe",
    });
  }

  return new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: repositoryRoot,
    env: { ...process.env, MYSTERIUM_SESSION_PATH: sessionPath },
    stderr: "pipe",
  });
}

test(
  "explicit live read-only MCP suite",
  { timeout: 600_000 },
  async (t) => {
    let sessionPath = process.env.MYSTERIUM_SESSION_PATH;
    if (process.env.MYSTERIUM_LIVE_TRANSPORT !== "docker") {
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
    }

    const outputDirectory = await mkdtemp(join(tmpdir(), "mysterium-live-output-"));
    t.after(async () => rm(outputDirectory, { recursive: true, force: true }));
    if (process.env.MYSTERIUM_LIVE_TRANSPORT === "docker") {
      await chmod(outputDirectory, 0o730);
    }

    const transport = liveTransport(sessionPath, outputDirectory);
    const diagnostics = captureStderr(transport);
    const client = new Client({ name: "mysterium-live-read-test", version: "1.0.0" });
    client.registerCapabilities({
      extensions: {
        "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
      },
    });
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
    let characterListingSucceeded = false;
    await t.test("restores the external session and lists characters", async () => {
      const listing = parseJson(await callText(client, diagnostics, "mysterium_list_characters"), "mysterium_list_characters");
      requireStructure(listing && typeof listing === "object", "character listing must be an object");
      requireStructure(Array.isArray(listing.characters), "character listing omitted its characters array");
      requireStructure(listing.count === listing.characters.length, "character listing count changed");
      characters = listing.characters;
      characterListingSucceeded = true;
    });

    const characterPrerequisiteSkip = () => {
      if (!characterListingSucceeded) return "character list prerequisite failed";
      return characters.length === 0 ? "account has no character available" : false;
    };

    await t.test(
      "retrieves a character through the authenticated API",
      { skip: characterPrerequisiteSkip() },
      async () => {
        const character = characters[0];
        requireStructure(typeof character?.id === "string" && character.id.length > 0, "character listing omitted an ID");
        const result = parseJson(
          await callText(client, diagnostics, "mysterium_get_character", { character_id: character.id }),
          "mysterium_get_character"
        );
        requireStructure(result && typeof result === "object" && result.character && typeof result.character === "object", "character API shape changed");
        requireStructure(result.source === "dndbeyond-character-service" && result.schemaVersion === "v5", "character provenance changed");
        requireStructure(result.portraitUrl === null || typeof result.portraitUrl === "string", "character portrait URL shape changed");
      }
    );

    await t.test(
      "retrieves a configured character portrait as bounded image content",
      { skip: characterPrerequisiteSkip() },
      async () => {
        const characterId = characters[0]?.id;
        const result = await callResult(client, diagnostics, "mysterium_get_character_portrait", { character_id: characterId });
        const metadata = result.structuredContent;
        requireStructure(metadata?.available === true || metadata?.available === false, "character portrait availability changed");
        if (metadata.available) {
          requireStructure(Number.isInteger(metadata.byteCount) && metadata.byteCount > 0 && metadata.byteCount <= 5 * 1024 * 1024, "character portrait size changed");
          const image = result.content.find(({ type }) => type === "image");
          requireStructure(image && image.mimeType === metadata.mimeType, "character portrait image content changed");
          requireStructure(Buffer.from(image.data, "base64").length === metadata.byteCount, "character portrait byte count changed");
        } else {
          requireStructure(!result.content.some(({ type }) => type === "image"), "missing portrait unexpectedly returned image content");
        }
      }
    );

    await t.test(
      "exports and validates a character PDF only in the external temporary directory",
      { skip: characterPrerequisiteSkip() },
      async () => {
        const characterId = characters[0]?.id;
        requireStructure(typeof characterId === "string" && characterId.length > 0, "character listing omitted an ID");
        const exported = await callResult(client, diagnostics, "mysterium_export_character_pdf", {
          character_id: characterId,
        });
        const metadata = exported.structuredContent;
        requireStructure(metadata?.mimeType === "application/pdf", "character PDF MIME metadata changed");
        requireStructure(Number.isInteger(metadata?.totalBytes) && metadata.totalBytes > 0, "character PDF size metadata changed");
        requireStructure(metadata.totalBytes <= 25 * 1024 * 1024, "character PDF exceeded the 25 MiB limit");
        requireStructure(typeof metadata?.sha256 === "string" && /^[a-f0-9]{64}$/.test(metadata.sha256), "character PDF hash metadata changed");
        requireStructure(typeof metadata?.url === "string" && metadata.url.startsWith("mysterium://character-pdf/"), "character PDF handle shape changed");

        const chunks = [];
        let offset = 0;
        while (offset < metadata.totalBytes) {
          const result = await callResult(client, diagnostics, "read_pdf_bytes", {
            url: metadata.url,
            offset,
          });
          const range = result.structuredContent;
          requireStructure(range?.offset === offset, "character PDF chunk offset changed");
          requireStructure(Number.isInteger(range?.byteCount) && range.byteCount > 0, "character PDF chunk length changed");
          requireStructure(range.byteCount <= 512 * 1024, "character PDF chunk exceeded the range limit");
          chunks.push(Buffer.from(range.bytes, "base64"));
          offset += range.byteCount;
          if (!range.hasMore) break;
        }

        const pdf = Buffer.concat(chunks);
        requireStructure(pdf.length === metadata.totalBytes, "character PDF reconstructed length changed");
        requireStructure(pdf.subarray(0, 5).toString("ascii") === "%PDF-", "character export did not reconstruct a PDF");
        requireStructure(createHash("sha256").update(pdf).digest("hex") === metadata.sha256, "character PDF reconstructed hash changed");

        const onHost = join(outputDirectory, "character-sheet.pdf");
        try {
          await writeFile(onHost, pdf, { mode: 0o600 });
          // The real live gate requires Poppler's independent page inspection.
          // The offline mock remains portable and validates its committed PDF
          // through the reconstructed length, signature, and checksum above.
          if (process.env.MYSTERIUM_LIVE_TRANSPORT !== "mock") {
            const inspected = spawnSync("pdfinfo", [onHost], { encoding: "utf8", timeout: 15_000 });
            requireStructure(inspected.status === 0, "pdfinfo could not inspect the character PDF");
            const pages = inspected.stdout.match(/^Pages:\s+(\d+)$/m);
            requireStructure(pages && Number(pages[1]) >= 1, "character PDF contained no pages");
          }
        } finally {
          await rm(onHost, { force: true });
        }
      }
    );

    let campaigns = [];
    await t.test("lists campaigns without exposing campaign data", async () => {
      const listing = parseJson(await callText(client, diagnostics, "mysterium_list_campaigns"), "mysterium_list_campaigns");
      requireStructure(Array.isArray(listing?.campaigns), "campaign listing omitted its campaigns array");
      requireStructure(listing.count === listing.campaigns.length, "campaign listing count changed");
      campaigns = listing.campaigns;
    });

    await t.test(
      "retrieves one campaign when available",
      { skip: campaigns.length === 0 ? "account has no campaign available" : false },
      async () => {
        const campaignId = campaigns[0]?.id;
        requireStructure(typeof campaignId === "string" && campaignId.length > 0, "campaign listing omitted an ID");
        const campaign = parseJson(
          await callText(client, diagnostics, "mysterium_get_campaign", { campaign_id: campaignId }),
          "mysterium_get_campaign"
        );
        requireStructure(campaign?.source === "dndbeyond-campaign" && campaign?.schemaVersion === "v1", "campaign detail provenance changed");
        requireStructure(campaign?.campaign?.id === campaignId, "campaign detail identity changed");
        requireStructure(typeof campaign?.partial === "boolean", "campaign detail partial state changed");
        requireStructure(["available", "empty", "unavailable"].includes(campaign?.campaign?.notes?.private?.state), "campaign private-note availability changed");
      }
    );

    await t.test("navigates safely and reads the current page", async () => {
      const requestedUrl = "https://www.dndbeyond.com/characters";
      const navigated = parseJson(
        await callText(client, diagnostics, "mysterium_read_page", { url: requestedUrl }),
        "mysterium_read_page"
      );
      requireStructure(navigated.source === "dndbeyond-rendered-page" && navigated.schemaVersion === "v1", "navigation provenance changed");
      requireStructure(navigated.operation === "navigate" && navigated.requestedUrl === requestedUrl, "navigation response shape changed");
      requireStructure(navigated.page?.url === requestedUrl, "navigation final URL changed");
      const current = parseJson(await callText(client, diagnostics, "mysterium_read_page"), "mysterium_read_page");
      requireStructure(current.operation === "current_page" && current.requestedUrl === null, "current-page response shape changed");
      requireStructure(current.page?.url === requestedUrl, "current-page URL changed");
    });

    await t.test("performs a read-only search", async () => {
      const results = await callText(client, diagnostics, "mysterium_search", { query: "shield", category: "spells" });
      requireStructure(results.length > 0, "search returned an empty response");
      const parsed = parseJson(results, "mysterium_search");
      requireStructure(Array.isArray(parsed.results), "search results shape changed");
      requireStructure(parsed.results.every((result) => Array.isArray(result.sources)), "search source attribution shape changed");
      for (const result of parsed.results) {
        for (const source of result.sources) {
          requireStructure(source && typeof source === "object", "search source attribution item changed");
          requireStructure(source.title === null || typeof source.title === "string", "search source title shape changed");
          requireStructure(source.url === null || typeof source.url === "string", "search source URL shape changed");
          requireStructure(source.bookSlug === null || typeof source.bookSlug === "string", "search source book slug shape changed");
          requireStructure(source.chapterSlug === null || typeof source.chapterSlug === "string", "search source chapter slug shape changed");
        }
      }
    });

    await t.test("resolves and reads a representative public stat block", async (statBlockTest) => {
      const catalog = parseJson(
        await callText(client, diagnostics, "mysterium_search", { query: "Guard", category: "monsters" }),
        "mysterium_search monsters"
      );
      requireStructure(Array.isArray(catalog.results), "monster search results shape changed");
      const guard = catalog.results.find(
        (result) => result?.name?.trim().toLocaleLowerCase("en-US") === "guard" && /^\d+$/.test(result.creatureId ?? "")
      );
      if (!guard) {
        statBlockTest.skip("the monster catalog returned no exact public Guard entry");
        return;
      }

      const block = parseJson(
        await callText(client, diagnostics, "mysterium_get_stat_block", { creature_id: guard.creatureId }),
        "mysterium_get_stat_block"
      );
      requireStructure(block.kind === "stat_block", "stat-block result kind changed");
      requireStructure(block.creature?.id === guard.creatureId, "stat-block creature ID changed");
      requireStructure(typeof block.creature?.name === "string" && block.creature.name.length > 0, "stat-block name is missing");
      requireStructure(Array.isArray(block.attributes) && block.attributes.length > 0, "stat-block attributes are missing");
      const attributeLabels = block.attributes.map((attribute) => attribute?.label?.trim().toLocaleLowerCase("en-US"));
      requireStructure(attributeLabels.some((label) => label === "armor class" || label === "ac"), "stat-block Armor Class/AC is missing");
      requireStructure(attributeLabels.some((label) => label === "hit points" || label === "hp"), "stat-block Hit Points/HP is missing");
      requireStructure(Array.isArray(block.abilities) && block.abilities.length === 6, "stat-block abilities are incomplete");
      requireStructure(Array.isArray(block.sections) && block.sections.length > 0, "stat-block sections are missing");
      requireStructure(typeof block.markdown === "string" && block.markdown.length > 0, "stat-block Markdown is missing");
      requireStructure(
        typeof block.creature?.url === "string" && /^https:\/\/www\.dndbeyond\.com\/monsters\/\d+(?:-[a-z0-9-]+)?$/i.test(block.creature.url),
        "stat-block URL is unsafe or changed"
      );
      requireStructure([null, "5e", "5.5e"].includes(block.creature?.edition), "stat-block edition shape changed");
      requireStructure(typeof block.creature?.legacy === "boolean", "stat-block Legacy status shape changed");
    });

    await t.test("searches accessible and catalog sourcebooks without reading them", async () => {
      for (const sourceScope of [undefined, "all"]) {
        const parsed = parseJson(
          await callText(client, diagnostics, "mysterium_search", {
            query: "handbook",
            category: "sourcebooks",
            ...(sourceScope ? { source_scope: sourceScope } : {}),
          }),
          "mysterium_search sourcebooks"
        );
        requireStructure(Array.isArray(parsed.results), "sourcebook search results shape changed");
        requireStructure(typeof parsed.count === "number", "sourcebook search count shape changed");
        requireStructure(parsed.count === parsed.results.length, "sourcebook search count no longer matches results");
        for (const result of parsed.results) {
          requireStructure(["accessible", "unavailable", "unknown"].includes(result.access), "sourcebook access shape changed");
          requireStructure(Array.isArray(result.sources), "sourcebook sources shape changed");
          requireStructure(result.sources.length === 0, "sourcebook result unexpectedly attributed itself");
          requireStructure(result.bookSlug === null || typeof result.bookSlug === "string", "sourcebook slug shape changed");
          requireStructure(typeof result.url === "string", "sourcebook URL shape changed");
          if (!sourceScope) {
            requireStructure(result.access === "accessible", "default sourcebook search returned an inaccessible result");
            requireStructure(typeof result.bookSlug === "string" && result.bookSlug.length > 0, "accessible sourcebook omitted its slug");
            requireStructure(result.url.startsWith("https://www.dndbeyond.com/sources/"), "accessible sourcebook URL is not readable");
          } else if (result.access !== "accessible") {
            requireStructure(result.bookSlug === null, "non-accessible sourcebook exposed a readable slug");
          }
        }
      }
    });

    let books = [];
    await t.test("lists the owned library without exposing titles", async () => {
      const library = parseJson(await callText(client, diagnostics, "mysterium_list_library"), "mysterium_list_library");
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
          await callText(client, diagnostics, "mysterium_read_book", { book_slug: slug }),
          "mysterium_read_book"
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
          await callText(client, diagnostics, "mysterium_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            mode: "outline",
          }),
          "mysterium_read_book chapter outline"
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
          await callText(client, diagnostics, "mysterium_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            max_chars: 512,
          }),
          "mysterium_read_book bounded content"
        );
        validateSourcebookContent(bounded, 512);

        const firstPage = parseJson(
          await callText(client, diagnostics, "mysterium_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            max_chars: 1,
          }),
          "mysterium_read_book first cursor page"
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
        const continuationTextA = await callText(client, diagnostics, "mysterium_read_book", continuationArguments);
        const continuationTextB = await callText(client, diagnostics, "mysterium_read_book", continuationArguments);
        const continuation = parseJson(continuationTextA, "mysterium_read_book cursor continuation");
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
          await callText(client, diagnostics, "mysterium_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            section: selectedSection.id,
            max_chars: 1,
          }),
          "mysterium_read_book section content"
        );
        validateSourcebookContent(firstSectionPage, 1);
        requireStructure(firstSectionPage.section?.id === selectedSection.id, "sourcebook section binding changed");
        requireStructure(typeof firstSectionPage.nextCursor === "string", "live section did not produce a continuation cursor");

        const continuation = parseJson(
          await callText(client, diagnostics, "mysterium_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            section: selectedSection.id,
            max_chars: 1,
            cursor: firstSectionPage.nextCursor,
          }),
          "mysterium_read_book section cursor continuation"
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
          await callText(client, diagnostics, "mysterium_read_book", {
            book_slug: selectedBookSlug,
            chapter_slug: selectedChapterSlug,
            section: uniqueHeading.title,
            max_chars: 512,
          }),
          "mysterium_read_book named section content"
        );
        validateSourcebookContent(section, 512);
        requireStructure(section.section?.id === uniqueHeading.id, "named sourcebook section resolved incorrectly");
      }
    );

    await t.test("captures the current viewport as MCP image content", async () => {
      const result = await callResult(client, diagnostics, "mysterium_capture_page");
      const metadata = result.structuredContent;
      requireStructure(metadata?.source === "dndbeyond-page-screenshot" && metadata?.schemaVersion === "v1", "screenshot provenance changed");
      requireStructure(metadata?.scope === "viewport" && metadata?.selector === null, "screenshot scope changed");
      requireStructure(metadata?.mimeType === "image/png", "screenshot MIME type changed");
      requireStructure(Number.isInteger(metadata?.byteCount) && metadata.byteCount > 0 && metadata.byteCount <= 5 * 1024 * 1024, "screenshot byte bound changed");
      const image = result.content?.find((block) => block.type === "image");
      requireStructure(image?.mimeType === "image/png" && typeof image.data === "string", "screenshot image content changed");
      requireStructure(Buffer.from(image.data, "base64").length === metadata.byteCount, "screenshot metadata byte count changed");
    });
  }
);
