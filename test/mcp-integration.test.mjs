import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/index.js";
import { captureStderr, withFailureDiagnostics } from "./support/failure-diagnostics.mjs";

async function connectClient(t, contextProvider) {
  const server = createServer(contextProvider);
  const client = new Client({ name: "ddb-mcp-offline-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  t.after(async () => {
    await client.close();
    await server.close();
  });

  return client;
}

test("an MCP client can discover and call tools through the real server", async (t) => {
  const visits = [];
  let contextRequests = 0;
  const syntheticResults = [
    {
      name: "Synthetic Shield",
      type: "1st Level | Abjuration",
      url: "https://www.dndbeyond.com/spells/synthetic-shield",
      sources: [],
    },
  ];
  const page = {
    url: () => "https://www.dndbeyond.com/synthetic-current-page",
    goto: async (url, options) => visits.push({ url, options }),
    waitForTimeout: async () => {},
    evaluate: async (_extractor, argument) =>
      argument === "spells" ? syntheticResults : "Synthetic current page content",
  };
  const context = { pages: () => [page] };
  const client = await connectClient(t, async () => {
    contextRequests += 1;
    return context;
  });

  const listed = await client.listTools();
  assert.equal(
    client.getInstructions(),
    "Use ddb_search for corpus results and sourcebook discovery. Search results include a sources array when D&D Beyond exposes attribution. A sourcebook result is safe to pass to ddb_read_book only when access is 'accessible' and bookSlug is non-null; unavailable results may link to the store. Use ddb_list_library to list accessible sourcebooks. Use ddb_read_book in outline mode to retrieve a book's table of contents or a chapter's heading index, then use content mode for bounded chapter or section text. Continue content using nextCursor until done is true. Sourcebook responses include image metadata, not image bytes."
  );
  const toolNames = listed.tools.map(({ name }) => name);
  assert.ok(toolNames.includes("ddb_current_page"));
  assert.ok(toolNames.includes("ddb_search"));
  assert.ok(toolNames.includes("ddb_read_book"));
  const searchTool = listed.tools.find(({ name }) => name === "ddb_search");
  assert.equal(
    searchTool.description,
    "Search D&D Beyond indexes for spells, monsters, magic items, races, classes, feats, sourcebooks, or general results. Results include normalized source attribution when D&D Beyond exposes it. Sourcebook searches default to accessible books."
  );
  assert.deepEqual(searchTool.inputSchema.required, ["query"]);
  assert.deepEqual(searchTool.inputSchema.properties.category.enum, [
    "spells",
    "monsters",
    "items",
    "races",
    "classes",
    "feats",
    "sourcebooks",
    "all",
  ]);
  assert.deepEqual(searchTool.inputSchema.properties.source_scope.enum, ["accessible", "all"]);
  assert.match(searchTool.inputSchema.properties.source_scope.description, /unavailable catalog\/store/);
  const libraryTool = listed.tools.find(({ name }) => name === "ddb_list_library");
  assert.equal(
    libraryTool.description,
    "List sourcebooks you own or can access through sharing in your D&D Beyond library, including slugs for use with ddb_read_book."
  );
  const readTool = listed.tools.find(({ name }) => name === "ddb_read_book");
  assert.equal(
    readTool.description,
    "Discover an accessible D&D Beyond sourcebook's table of contents or chapter headings, or read bounded chapter or section Markdown with cursor pagination. Returns a JSON envelope with nextCursor and done."
  );
  assert.deepEqual(readTool.inputSchema.required, ["book_slug"]);
  assert.deepEqual(readTool.inputSchema.properties.mode.enum, ["outline", "content"]);
  assert.equal(readTool.inputSchema.properties.max_chars.maximum, 25_000);
  assert.match(readTool.inputSchema.properties.book_slug.description, /dnd\/phb-2024/);
  assert.match(readTool.inputSchema.properties.chapter_slug.description, /book outline/);
  assert.match(readTool.inputSchema.properties.section.description, /stable section ID/);
  assert.match(readTool.inputSchema.properties.cursor.description, /same book_slug/);
  assert.match(readTool.inputSchema.properties.max_chars.description, /25000/);

  const pageResult = await client.callTool({ name: "ddb_current_page", arguments: {} });
  assert.equal(pageResult.isError, undefined);
  assert.equal(
    pageResult.content[0].text,
    "Current URL: https://www.dndbeyond.com/synthetic-current-page\n\nSynthetic current page content"
  );

  const searchResult = await client.callTool({
    name: "ddb_search",
    arguments: { query: "shield", category: "spells" },
  });
  assert.equal(searchResult.isError, undefined);
  assert.deepEqual(JSON.parse(searchResult.content[0].text).results, syntheticResults);
  assert.equal(visits[0].url, "https://www.dndbeyond.com/spells?filter-search=shield");
  assert.equal(contextRequests, 2);
});

test("MCP input validation rejects invalid arguments before browser access", async (t) => {
  let contextRequested = false;
  const client = await connectClient(t, async () => {
    contextRequested = true;
    throw new Error("browser context should not be requested");
  });

  const result = await client.callTool({
    name: "ddb_search",
    arguments: { query: "shield", category: "not-a-category" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Invalid arguments/);
  assert.equal(contextRequested, false);
});

test("ddb_search rejects source_scope for other categories before browser access", async (t) => {
  let contextRequested = false;
  const client = await connectClient(t, async () => {
    contextRequested = true;
    throw new Error("browser context should not be requested");
  });

  const result = await client.callTool({
    name: "ddb_search",
    arguments: { query: "shield", category: "spells", source_scope: "all" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /source_scope is only valid/);
  assert.equal(contextRequested, false);
});

test("MCP tool failures are returned as tool errors", async (t) => {
  const client = await connectClient(t, async () => {
    throw new Error("synthetic browser failure");
  });

  const result = await client.callTool({ name: "ddb_current_page", arguments: {} });

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Failed to get page content: synthetic browser failure");
});

test("a separate process serves MCP tools over stdio", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("fixtures/mock-mcp-server.mjs", import.meta.url))],
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stderr: "pipe",
  });
  const diagnostics = captureStderr(transport);
  const client = new Client({ name: "ddb-mcp-stdio-test", version: "1.0.0" });

  t.after(async () => {
    await client.close();
  });
  await withFailureDiagnostics("synthetic MCP subprocess", diagnostics, async () => {
    await client.connect(transport);

    const listed = await client.listTools();
    assert.ok(listed.tools.some(({ name }) => name === "ddb_current_page"));

    const result = await client.callTool({ name: "ddb_current_page", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(
      result.content[0].text,
      "Current URL: https://www.dndbeyond.com/synthetic-stdio-page\n\nSynthetic stdio page content"
    );
  });
});

test("the production entrypoint negotiates MCP without initializing a browser", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stderr: "pipe",
  });
  const diagnostics = captureStderr(transport);
  const client = new Client({ name: "ddb-mcp-entrypoint-test", version: "1.0.0" });

  t.after(async () => {
    await client.close();
  });
  await withFailureDiagnostics("production MCP subprocess", diagnostics, async () => {
    await client.connect(transport);

    const listed = await client.listTools();
    assert.ok(listed.tools.some(({ name }) => name === "ddb_login"));
    assert.ok(listed.tools.some(({ name }) => name === "ddb_read_book"));
  });
});
