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

function syntheticPng(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
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
    ["mysterium_get_character_portrait", { character_id: "4242" }],
    ["mysterium_export_character_pdf", { character_id: "4242" }],
    ["mysterium_get_stat_block", { query: "Synthetic Watcher" }],
    ["mysterium_view_stat_block", { query: "Synthetic Watcher" }],
    ["read_stat_block_for_app", { creature_id: "42" }],
    ["mysterium_get_campaign", { campaign_id: "7" }],
    ["mysterium_list_campaigns", {}],
    ["mysterium_read_page", { url: "https://www.dndbeyond.com/synthetic-page" }],
    ["mysterium_capture_page", {}],
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
    ["mysterium_get_character", { character_id: "not-a-number" }],
    ["mysterium_get_character_portrait", {}],
    ["mysterium_get_character_portrait", { character_id: "not-a-number" }],
    ["mysterium_export_character_pdf", {}],
    ["mysterium_export_character_pdf", { character_id: "not-a-number" }],
    ["mysterium_get_stat_block", { creature_id: "not-a-number" }],
    ["mysterium_view_stat_block", { creature_id: "not-a-number" }],
    ["read_stat_block_for_app", { creature_id: "not-a-number" }],
    ["read_pdf_bytes", { url: "mysterium://character-pdf/missing/file.pdf", offset: -1 }],
    ["mysterium_get_campaign", {}],
    ["mysterium_get_campaign", { campaign_id: "not-a-number" }],
    ["mysterium_read_page", { url: "not-a-url" }],
    ["mysterium_capture_page", { scope: "unsupported" }],
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

test("character-list cross-field validation rejects before browser access", async (t) => {
  let contextRequested = false;
  const client = await connect(t, async () => {
    contextRequested = true;
    throw new Error("browser must not be requested");
  });
  for (const arguments_ of [
    { level: 3, min_level: 2 },
    { min_level: 8, max_level: 2 },
  ]) {
    const result = await client.callTool({ name: "mysterium_list_characters", arguments: arguments_ });
    assert.equal(result.isError, true);
  }
  assert.equal(contextRequested, false);
});

test("campaign-list cross-field validation rejects before browser access", async (t) => {
  let contextRequested = false;
  const client = await connect(t, async () => {
    contextRequested = true;
    throw new Error("browser must not be requested");
  });
  for (const arguments_ of [
    { created_on_or_after: "2025-03-01", created_on_or_before: "2025-02-01" },
    { min_players: 4, max_players: 2 },
    { created_on_or_after: "2025-02-30" },
  ]) {
    const result = await client.callTool({ name: "mysterium_list_campaigns", arguments: arguments_ });
    assert.equal(result.isError, true);
  }
  assert.equal(contextRequested, false);
});

test("character tools publish exact stable contracts", async (t) => {
  const client = await connect(t, async () => {
    throw new Error("contract inspection must not request a browser");
  });
  const listed = await client.listTools();
  const listTool = listed.tools.find(({ name }) => name === "mysterium_list_characters");
  assert.deepEqual(listTool.inputSchema.properties.sort_by.enum, ["created", "name", "level", "modified"]);
  assert.equal(listTool.inputSchema.properties.refresh.type, "boolean");
  assert.equal(listTool.outputSchema.additionalProperties, false);
  assert.deepEqual(listTool.outputSchema.required.sort(), ["characters", "count", "filters", "sort", "total"].sort());

  const detailTool = listed.tools.find(({ name }) => name === "mysterium_get_character");
  assert.deepEqual(detailTool.inputSchema.required, ["character_id"]);
  assert.equal(detailTool.inputSchema.properties.fallback_scrape, undefined);
  assert.equal(detailTool.outputSchema.properties.source.const, "dndbeyond-character-service");

  const portraitTool = listed.tools.find(({ name }) => name === "mysterium_get_character_portrait");
  assert.deepEqual(portraitTool.inputSchema.required, ["character_id"]);
  assert.equal(portraitTool.outputSchema.additionalProperties, false);
  assert.equal(portraitTool.annotations.readOnlyHint, true);
});

test("campaign tools publish exact stable contracts", async (t) => {
  const client = await connect(t, async () => {
    throw new Error("contract inspection must not request a browser");
  });
  const listed = await client.listTools();
  const listTool = listed.tools.find(({ name }) => name === "mysterium_list_campaigns");
  assert.deepEqual(listTool.inputSchema.properties.sort_by.enum, ["name", "role", "created", "players", "content_sharing"]);
  assert.equal(listTool.inputSchema.properties.refresh.type, "boolean");
  assert.equal(listTool.outputSchema.additionalProperties, false);
  assert.deepEqual(listTool.outputSchema.required.sort(), ["campaigns", "count", "filters", "sort", "total"].sort());
  assert.equal(listTool.annotations.readOnlyHint, true);

  const detailTool = listed.tools.find(({ name }) => name === "mysterium_get_campaign");
  assert.deepEqual(detailTool.inputSchema.required, ["campaign_id"]);
  assert.equal(detailTool.inputSchema.properties.include_private_notes.type, "boolean");
  assert.equal(detailTool.outputSchema.properties.schemaVersion.const, "v1");
  assert.equal(detailTool.outputSchema.additionalProperties, false);
  assert.equal(detailTool.annotations.readOnlyHint, true);
});

test("campaign tools return schema-validated structured and JSON-text parity", async (t) => {
  let currentUrl = "about:blank";
  const responses = [
    {
      url: () => "https://api.dndbeyond.com/campaigns/v1/details/7",
      status: () => 200,
      ok: () => true,
      json: async () => ({ data: {
        id: 7, name: "Synthetic Campaign", status: 1, dateCreated: "2025-01-02T03:04:05Z",
        dmId: 10, dmDisplayName: "Synthetic DM", contentSharingEnabled: true, itemSharingEnabled: false,
        activePlayers: [], activeCharacters: [],
      } }),
    },
    {
      url: () => "https://www.dndbeyond.com/api/campaign/stt/active-short-characters/7",
      status: () => 200,
      ok: () => true,
      json: async () => ({ status: "success", data: [] }),
    },
  ];
  const page = {
    goto: async (url) => { currentUrl = url; },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    waitForResponse: async (predicate) => responses.find(predicate) ?? Promise.reject(new Error("missing response")),
    evaluate: async (_callback, argument) => {
      if (currentUrl === "https://www.dndbeyond.com" && argument === undefined) return true;
      if (currentUrl.endsWith("/my-campaigns")) return {
        recognized: true,
        items: [{ id: "7", name: "Synthetic Campaign", roleText: "Role: Dungeon Master", createdText: "1/2/2025", playerCountText: "0 Players", sharingText: "Sharing Enabled" }],
      };
      return {
        name: "Synthetic Campaign", currentUserId: "10", dmControlsVisible: true,
        description: { present: false, text: "" }, publicNotes: { present: true, text: "" }, privateNotes: { present: true, text: "" },
        characterSectionPresent: true, characters: [], inviteUrl: null, administrationLinks: [],
      };
    },
  };
  const client = await connect(t, async () => ({ pages: () => [page] }));

  const listing = await client.callTool({ name: "mysterium_list_campaigns", arguments: {} });
  assert.equal(listing.isError, undefined);
  assert.deepEqual(JSON.parse(listing.content[0].text), listing.structuredContent);
  assert.equal(listing.structuredContent.campaigns[0].id, "7");

  const detail = await client.callTool({ name: "mysterium_get_campaign", arguments: { campaign_id: "7" } });
  assert.equal(detail.isError, undefined);
  assert.deepEqual(JSON.parse(detail.content[0].text), detail.structuredContent);
  assert.equal(detail.structuredContent.campaign.notes.private.state, "empty");
});

test("a character without a portrait returns metadata without image content", async (t) => {
  const page = {
    goto: async () => {},
    waitForTimeout: async () => {},
    url: () => "https://www.dndbeyond.com",
    evaluate: async (_callback, argument) => argument === undefined
      ? true
      : {
          kind: "success",
          body: {
            success: true,
            data: { id: Number(new URL(argument.url).pathname.split("/").at(-1)), decorations: null },
          },
        },
  };
  const client = await connect(t, async () => ({ pages: () => [page] }));
  const result = await client.callTool({
    name: "mysterium_get_character_portrait",
    arguments: { character_id: "4242" },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.available, false);
  assert.equal(result.content.some(({ type }) => type === "image"), false);
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

test("stat-block tools enforce XOR input and viewer capability before browser access", async (t) => {
  let contextRequested = false;
  const provider = async () => {
    contextRequested = true;
    throw new Error("browser must not be requested");
  };
  const client = await connect(t, provider, { supportsApps: false });

  for (const arguments_ of [{}, { query: "Guard", creature_id: "16915" }]) {
    const result = await client.callTool({ name: "mysterium_get_stat_block", arguments: arguments_ });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /exactly one/);
  }
  const viewer = await client.callTool({ name: "mysterium_view_stat_block", arguments: { query: "Guard" } });
  assert.equal(viewer.isError, true);
  assert.match(viewer.content[0].text, /does not advertise MCP Apps/);
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
  assert.deepEqual(byteTool.outputSchema.required.sort(), ["byteCount", "bytes", "hasMore", "offset", "totalBytes", "url"].sort());
  assert.equal(byteTool.outputSchema.additionalProperties, false);
  assert.equal(byteTool.annotations.idempotentHint, true);

  const resources = await client.listResources();
  const viewer = resources.resources.find(({ uri }) => uri === "ui://mysterium/character-pdf-viewer.html");
  assert.equal(viewer.mimeType, "text/html;profile=mcp-app");

  const resource = await client.readResource({ uri: viewer.uri });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok(resource.contents[0].text.length > 1_000_000);
  assert.match(resource.contents[0].text, /Mysterium PDF Viewer/);
  assert.match(resource.contents[0].text, /Download PDF/);
  assert.doesNotMatch(resource.contents[0].text, /<script[^>]+src=|<link[^>]+href=/i);
  assert.deepEqual(resource.contents[0]._meta.ui.permissions, { clipboardWrite: {} });
  assert.deepEqual(resource.contents[0]._meta.ui.csp, {
    connectDomains: ["https://unpkg.com"],
    resourceDomains: ["https://unpkg.com"],
  });
});

test("stat-block tools and viewer resource expose separate model and app data paths", async (t) => {
  const client = await connect(t, async () => {
    throw new Error("contract inspection must not request a browser");
  });
  const listed = await client.listTools();
  const getTool = listed.tools.find(({ name }) => name === "mysterium_get_stat_block");
  assert.deepEqual(getTool.inputSchema.properties.legacy.enum, ["include", "exclude", "only"]);
  assert.equal(getTool.inputSchema.required, undefined);
  assert.deepEqual(getTool.outputSchema.properties.kind.enum, ["stat_block", "candidates", "not_found"]);
  assert.equal(getTool.outputSchema.additionalProperties, false);

  const viewTool = listed.tools.find(({ name }) => name === "mysterium_view_stat_block");
  assert.equal(viewTool._meta.ui.resourceUri, "ui://mysterium/stat-block-viewer.html");
  assert.equal(viewTool.annotations.readOnlyHint, true);
  assert.deepEqual(viewTool.outputSchema.properties.kind.enum, ["resolved", "candidates", "not_found"]);

  const appReader = listed.tools.find(({ name }) => name === "read_stat_block_for_app");
  assert.deepEqual(appReader._meta.ui.visibility, ["app"]);
  assert.match(appReader.inputSchema.properties.creature_id.pattern, /\\d/);
  assert.equal(appReader.inputSchema.properties.creature_url.format, "uri");
  assert.equal(appReader.outputSchema.properties.kind.const, "stat_block");
  assert.equal(appReader.outputSchema.additionalProperties, false);

  const resources = await client.listResources();
  const viewer = resources.resources.find(({ uri }) => uri === "ui://mysterium/stat-block-viewer.html");
  assert.equal(viewer.mimeType, "text/html;profile=mcp-app");
  const resource = await client.readResource({ uri: viewer.uri });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok(resource.contents[0].text.length > 100_000);
  assert.match(resource.contents[0].text, /Download PNG/);
  assert.doesNotMatch(resource.contents[0].text, /https:\/\/(?:unpkg|cdn)\./);
  assert.deepEqual(resource.contents[0]._meta.ui.permissions, { clipboardWrite: {} });
  assert.equal(resource.contents[0]._meta.ui.csp, undefined);
});

test("mature model-facing tools publish exact output schemas", async (t) => {
  const client = await connect(t, async () => {
    throw new Error("contract inspection must not request a browser");
  });
  const tools = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));

  const library = tools.get("mysterium_list_library").outputSchema;
  assert.deepEqual(library.required.sort(), ["books", "count"]);
  assert.equal(library.properties.count.minimum, 0);
  assert.equal(library.additionalProperties, false);

  const search = tools.get("mysterium_search").outputSchema;
  assert.deepEqual(search.required.sort(), ["category", "count", "done", "filters", "nextCursor", "partial", "query", "reportedCount", "results", "total", "url"].sort());
  assert.deepEqual(search.properties.category.enum, ["spells", "monsters", "items", "races", "classes", "feats", "sourcebooks", "all"]);
  assert.equal(search.additionalProperties, false);

  const readBook = tools.get("mysterium_read_book").outputSchema;
  assert.deepEqual(readBook.properties.kind.enum, ["outline", "content"]);
  assert.deepEqual(readBook.required.sort(), ["book", "done", "kind", "nextCursor"]);
  assert.equal(readBook.additionalProperties, false);

  const pageTool = tools.get("mysterium_read_page");
  assert.deepEqual(pageTool.outputSchema.required.sort(), [
    "done", "maxChars", "nextCursor", "operation", "page", "requestedUrl", "schemaVersion", "source", "text", "totalCharacters",
  ].sort());
  assert.equal(pageTool.outputSchema.properties.source.const, "dndbeyond-rendered-page");
  assert.equal(pageTool.outputSchema.additionalProperties, false);
  assert.equal(pageTool.annotations.readOnlyHint, true);
  assert.equal(pageTool.annotations.destructiveHint, false);

  const screenshot = tools.get("mysterium_capture_page");
  assert.equal(screenshot.outputSchema.properties.mimeType.const, "image/png");
  assert.equal(screenshot.outputSchema.additionalProperties, false);
  assert.equal(screenshot.annotations.readOnlyHint, true);
  assert.equal(screenshot.annotations.destructiveHint, false);
});

test("generic page tools reject cursor and screenshot cross-field errors before browser access", async (t) => {
  let contextRequested = false;
  const client = await connect(t, async () => {
    contextRequested = true;
    throw new Error("browser must not be requested");
  });
  const cases = [
    ["mysterium_read_page", { cursor: "not-a-cursor" }],
    ["mysterium_read_page", { url: "https://www.dndbeyond.com/characters", cursor: "not-a-cursor" }],
    ["mysterium_capture_page", { scope: "element" }],
    ["mysterium_capture_page", { scope: "viewport", selector: "main" }],
  ];
  for (const [name, args] of cases) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal(contextRequested, false);
});

test("generic page tools return structured JSON parity and MCP image content", async (t) => {
  let url = "https://www.dndbeyond.com/synthetic-page";
  const screenshotBytes = syntheticPng(1280, 800);
  const page = {
    goto: async (value) => { url = value; },
    url: () => url,
    waitForSelector: async () => {},
    evaluate: async (callback) => String(callback).includes("sign in")
      ? true
      : { title: "Synthetic Page", text: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph." },
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: async () => screenshotBytes,
    title: async () => "Synthetic Page",
  };
  const client = await connect(t, async () => ({ pages: () => [page] }));

  const navigated = await client.callTool({
    name: "mysterium_read_page",
    arguments: { url, max_chars: 20 },
  });
  assert.equal(navigated.isError, undefined);
  assert.deepEqual(JSON.parse(navigated.content[0].text), navigated.structuredContent);
  assert.equal(navigated.structuredContent.operation, "navigate");
  assert.ok(navigated.structuredContent.nextCursor);

  const continued = await client.callTool({
    name: "mysterium_read_page",
    arguments: { cursor: navigated.structuredContent.nextCursor },
  });
  assert.equal(continued.isError, undefined);
  assert.deepEqual(JSON.parse(continued.content[0].text), continued.structuredContent);
  assert.equal(continued.structuredContent.operation, "current_page");

  const screenshot = await client.callTool({ name: "mysterium_capture_page", arguments: {} });
  assert.equal(screenshot.isError, undefined);
  assert.deepEqual(JSON.parse(screenshot.content[0].text), screenshot.structuredContent);
  assert.equal(screenshot.content[1].type, "image");
  assert.equal(screenshot.content[1].mimeType, "image/png");
  assert.equal(Buffer.from(screenshot.content[1].data, "base64").equals(screenshotBytes), true);
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
