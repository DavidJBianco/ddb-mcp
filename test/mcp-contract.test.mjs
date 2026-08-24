import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/index.js";
import { EXPECTED_TOOLS } from "./support/tool-manifest.mjs";

async function connect(t, contextProvider, { supportsApps = true, serverOptions } = {}) {
  const server = createServer(contextProvider, serverOptions);
  const client = new Client({ name: "mysterium-contract-test", version: "1.0.0" });
  if (supportsApps) {
    client.registerCapabilities({
      extensions: {
        "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
      },
    });
  }
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
    ["mysterium_list_characters", {}],
    ["mysterium_get_character", { character_id: "4242" }],
    ["mysterium_export_character_pdf", { character_id: "4242" }],
    ["mysterium_get_campaign", { campaign_id: "7" }],
    ["mysterium_list_campaigns", {}],
    ["mysterium_navigate", { url: "https://www.dndbeyond.com/synthetic-page" }],
    ["mysterium_interact", { action: "click", selector: "#synthetic" }],
    ["mysterium_current_page", {}],
    ["mysterium_search", { query: "shield", category: "spells" }],
    ["mysterium_list_library", {}],
    ["mysterium_read_book", { book_slug: "synthetic-handbook" }],
  ];

  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} must return isError`);
    assert.match(result.content[0].text, /synthetic browser dependency failure/);
  }
  const byteResult = await client.callTool({
    name: "read_pdf_bytes",
    arguments: { url: "mysterium://character-pdf/missing/file.pdf" },
  });
  assert.equal(byteResult.isError, true);
  assert.match(byteResult.content[0].text, /unavailable or expired/);
  assert.deepEqual([...cases.map(([name]) => name), "read_pdf_bytes"].sort(), EXPECTED_TOOLS);
});

test("argument-bearing tools reject invalid MCP input before browser access", async (t) => {
  let contextRequested = false;
  const client = await connect(t, async () => {
    contextRequested = true;
    throw new Error("browser must not be requested for invalid input");
  });
  const cases = [
    ["mysterium_get_character", {}],
    ["mysterium_export_character_pdf", {}],
    ["mysterium_export_character_pdf", { character_id: "not-a-number" }],
    ["read_pdf_bytes", { url: "mysterium://character-pdf/missing/file.pdf", offset: -1 }],
    ["mysterium_get_campaign", {}],
    ["mysterium_navigate", {}],
    ["mysterium_interact", { action: "destroy", selector: "body" }],
    ["mysterium_search", { query: "shield", category: "invalid" }],
    ["mysterium_read_book", {}],
    ["mysterium_read_book", { book_slug: "../private" }],
    ["mysterium_read_book", { book_slug: "synthetic-handbook", max_chars: 25001 }],
  ];

  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} must reject invalid input`);
    assert.match(result.content[0].text, /Invalid arguments/);
  }
  assert.equal(contextRequested, false);
});

test("character PDF export rejects a client without MCP Apps before browser access", async (t) => {
  let contextRequested = false;
  const client = await connect(t, async () => {
    contextRequested = true;
    throw new Error("browser must not be requested");
  }, { supportsApps: false });

  const result = await client.callTool({
    name: "mysterium_export_character_pdf",
    arguments: { character_id: "4242" },
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /does not advertise MCP Apps/);
  assert.equal(contextRequested, false);
});

test("character PDF tools and UI resource expose the intended MCP Apps contract", async (t) => {
  const client = await connect(t, async () => {
    throw new Error("contract inspection must not request a browser");
  });
  const listed = await client.listTools();
  const exportTool = listed.tools.find(({ name }) => name === "mysterium_export_character_pdf");
  assert.deepEqual(exportTool.inputSchema.required, ["character_id"]);
  assert.match(exportTool.inputSchema.properties.character_id.pattern, /\\d/);
  assert.equal(exportTool.outputSchema.properties.mimeType.const, "application/pdf");
  assert.equal(exportTool.annotations.readOnlyHint, true);
  assert.equal(exportTool._meta.ui.resourceUri, "ui://mysterium/character-pdf-viewer.html");

  const byteTool = listed.tools.find(({ name }) => name === "read_pdf_bytes");
  assert.deepEqual(byteTool._meta.ui.visibility, ["app"]);
  assert.equal(byteTool.inputSchema.properties.byteCount.maximum, 512 * 1024);
  assert.equal(byteTool.annotations.idempotentHint, true);

  const resources = await client.listResources();
  const viewer = resources.resources.find(({ uri }) => uri === "ui://mysterium/character-pdf-viewer.html");
  assert.equal(viewer.mimeType, "text/html;profile=mcp-app");

  const resource = await client.readResource({ uri: viewer.uri });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok(resource.contents[0].text.length > 4_000_000);
  assert.deepEqual(resource.contents[0]._meta.ui.permissions, { clipboardWrite: {} });
  assert.deepEqual(resource.contents[0]._meta.ui.csp, {
    connectDomains: ["https://unpkg.com"],
    resourceDomains: ["https://unpkg.com"],
  });
});

test("mysterium_read_book rejects invalid field combinations and malformed cursors before browser access", async (t) => {
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
    const result = await client.callTool({ name: "mysterium_read_book", arguments: args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Failed to read book/);
  }
  assert.equal(contextRequested, false);
});
