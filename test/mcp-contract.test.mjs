import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/index.js";
import { EXPECTED_TOOLS } from "./support/tool-manifest.mjs";

async function connect(t, contextProvider) {
  const server = createServer(contextProvider);
  const client = new Client({ name: "ddb-mcp-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

test("the MCP tool manifest is exact", async (t) => {
  const client = await connect(t, async () => {
    throw new Error("tool discovery must not request a browser");
  });
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(({ name }) => name).sort(), EXPECTED_TOOLS);
});

test("every tool converts a browser dependency failure into an MCP tool error", async (t) => {
  const client = await connect(t, async () => {
    throw new Error("synthetic browser dependency failure");
  });
  const cases = [
    ["ddb_login", {}],
    ["ddb_list_characters", {}],
    ["ddb_get_character", { character_id: "4242" }],
    ["ddb_download_character", { character_id: "4242", output_path: "/tmp/unused.json" }],
    ["ddb_get_campaign", { campaign_id: "7" }],
    ["ddb_list_campaigns", {}],
    ["ddb_navigate", { url: "https://www.dndbeyond.com/synthetic-page" }],
    ["ddb_interact", { action: "click", selector: "#synthetic" }],
    ["ddb_current_page", {}],
    ["ddb_search", { query: "shield", category: "spells" }],
    ["ddb_list_library", {}],
    ["ddb_read_book", { book_slug: "synthetic-handbook" }],
  ];

  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} must return isError`);
    assert.match(result.content[0].text, /synthetic browser dependency failure/);
  }
  assert.deepEqual(cases.map(([name]) => name).sort(), EXPECTED_TOOLS);
});

test("argument-bearing tools reject invalid MCP input before browser access", async (t) => {
  let contextRequested = false;
  const client = await connect(t, async () => {
    contextRequested = true;
    throw new Error("browser must not be requested for invalid input");
  });
  const cases = [
    ["ddb_get_character", {}],
    ["ddb_download_character", {}],
    ["ddb_get_campaign", {}],
    ["ddb_navigate", {}],
    ["ddb_interact", { action: "destroy", selector: "body" }],
    ["ddb_search", { query: "shield", category: "invalid" }],
    ["ddb_read_book", {}],
    ["ddb_read_book", { book_slug: "../private" }],
    ["ddb_read_book", { book_slug: "synthetic-handbook", max_chars: 25001 }],
  ];

  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} must reject invalid input`);
    assert.match(result.content[0].text, /Invalid arguments/);
  }
  assert.equal(contextRequested, false);
});

test("ddb_read_book rejects invalid field combinations and malformed cursors before browser access", async (t) => {
  let contextRequested = false;
  const client = await connect(t, async () => {
    contextRequested = true;
    throw new Error("browser must not be requested for invalid sourcebook input");
  });
  const cases = [
    { book_slug: "synthetic-handbook", mode: "content" },
    { book_slug: "synthetic-handbook", mode: "outline", max_chars: 100 },
    { book_slug: "synthetic-handbook", chapter_slug: "safe-examples", cursor: "not-a-cursor" },
  ];

  for (const args of cases) {
    const result = await client.callTool({ name: "ddb_read_book", arguments: args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Failed to read book/);
  }
  assert.equal(contextRequested, false);
});
