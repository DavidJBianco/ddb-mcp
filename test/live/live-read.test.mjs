import { strict as assert } from "node:assert";
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
      if (!results.startsWith("No results found")) {
        const parsed = parseJson(results, "ddb_search");
        requireStructure(Array.isArray(parsed.results), "search results shape changed");
      }
    });

    let books = [];
    await t.test("lists the owned library without exposing titles", async () => {
      const library = parseJson(await callText(client, diagnostics, "ddb_list_library"), "ddb_list_library");
      requireStructure(Array.isArray(library?.books), "library response shape changed");
      books = library.books;
    });

    await t.test(
      "reads one sourcebook when available",
      { skip: books.length === 0 ? "account has no sourcebook available" : false },
      async () => {
        const slug = books[0]?.slug;
        requireStructure(typeof slug === "string" && slug.length > 0, "library listing omitted a book slug");
        const content = await callText(client, diagnostics, "ddb_read_book", { book_slug: slug });
        requireStructure(content.startsWith("# ") && content.length > 10, "sourcebook response shape changed");
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
