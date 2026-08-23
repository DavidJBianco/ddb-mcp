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
  const toolNames = listed.tools.map(({ name }) => name);
  assert.ok(toolNames.includes("ddb_current_page"));
  assert.ok(toolNames.includes("ddb_search"));
  assert.ok(toolNames.includes("ddb_read_book"));
  const searchTool = listed.tools.find(({ name }) => name === "ddb_search");
  assert.deepEqual(searchTool.inputSchema.required, ["query"]);
  assert.deepEqual(searchTool.inputSchema.properties.category.enum, [
    "spells",
    "monsters",
    "items",
    "races",
    "classes",
    "feats",
    "all",
  ]);

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
