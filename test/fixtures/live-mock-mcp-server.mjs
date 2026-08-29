import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mysterium-live-mock", version: "1.0.0" });
const text = (value) => ({ content: [{ type: "text", text: value }] });
const sensitive = "SYNTHETIC_PRIVATE_MARKER";
const syntheticPdf = await readFile(new URL("synthetic-character-sheet.pdf", import.meta.url));
const syntheticPdfUrl = "mysterium://character-pdf/live-mock/dnd-beyond-character-4242.pdf";

server.tool("mysterium_list_characters", "mock", {}, async () => {
  if (process.env.MYSTERIUM_LIVE_MOCK_FAIL_TOOL === "mysterium_list_characters") {
    process.stderr.write(`HTTP 403 while reading ${process.env.MYSTERIUM_SESSION_PATH} for ${sensitive}\n`);
    return {
      isError: true,
      content: [{
        type: "text",
        text: `Unauthorized HTTP 403 at https://www.dndbeyond.com/characters/4242 for ${sensitive}`,
      }],
    };
  }
  return text(JSON.stringify({
    count: 1,
    total: 1,
    filters: { names: [], classes: [], species: [], campaignIds: [], level: null, minLevel: null, maxLevel: null },
    sort: { field: "name", direction: "asc" },
    characters: [{ id: "4242", name: sensitive }],
  }));
});
server.tool(
  "mysterium_get_character",
  "mock",
  { character_id: z.string() },
  async ({ character_id }) => text(JSON.stringify({
    source: "dndbeyond-character-service",
    schemaVersion: "v5",
    portraitUrl: "https://www.dndbeyond.com/avatars/synthetic.jpeg",
    character: { id: character_id, name: sensitive },
  }))
);
server.tool(
  "mysterium_get_character_portrait",
  "mock",
  { character_id: z.string() },
  async ({ character_id }) => {
    const metadata = {
      characterId: character_id,
      available: true,
      portraitUrl: "https://www.dndbeyond.com/avatars/synthetic.jpeg",
      mimeType: "image/jpeg",
      byteCount: 4,
    };
    return {
      content: [
        { type: "text", text: JSON.stringify(metadata) },
        { type: "image", data: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64"), mimeType: "image/jpeg" },
      ],
      structuredContent: metadata,
    };
  }
);
server.registerTool(
  "mysterium_export_character_pdf",
  {
    description: "mock",
    inputSchema: { character_id: z.string() },
    _meta: { ui: { resourceUri: "ui://mysterium/character-pdf-viewer.html" } },
  },
  async () => ({
    content: [{ type: "text", text: "synthetic PDF ready" }],
    structuredContent: {
      url: syntheticPdfUrl,
      title: "dnd-beyond-character-4242.pdf",
      filename: "dnd-beyond-character-4242.pdf",
      mimeType: "application/pdf",
      totalBytes: syntheticPdf.length,
      sha256: createHash("sha256").update(syntheticPdf).digest("hex"),
      initialPage: 1,
    },
    _meta: { interactEnabled: false, writable: false },
  })
);
server.registerTool(
  "read_pdf_bytes",
  {
    description: "mock",
    inputSchema: {
      url: z.string(),
      offset: z.number().default(0),
      byteCount: z.number().default(512 * 1024),
    },
    _meta: { ui: { visibility: ["app"] } },
  },
  async ({ url, offset, byteCount }) => {
    if (url !== syntheticPdfUrl) return { ...text("expired"), isError: true };
    const bytes = syntheticPdf.subarray(offset, Math.min(offset + byteCount, syntheticPdf.length));
    return {
      content: [{ type: "text", text: "synthetic PDF bytes" }],
      structuredContent: {
        url,
        bytes: bytes.toString("base64"),
        offset,
        byteCount: bytes.length,
        totalBytes: syntheticPdf.length,
        hasMore: offset + bytes.length < syntheticPdf.length,
      },
    };
  }
);
server.tool("mysterium_list_campaigns", "mock", {}, async () =>
  text(JSON.stringify({
    count: 1,
    total: 1,
    filters: { names: [], campaignIds: [], roles: [], createdOnOrAfter: null, createdOnOrBefore: null, minPlayers: null, maxPlayers: null, contentSharingEnabled: null },
    sort: { field: "name", direction: "asc" },
    campaigns: [{ id: "7", name: sensitive, role: "dungeon_master", createdOn: "2025-01-02", playerCount: 1, contentSharingEnabled: true, url: "https://www.dndbeyond.com/campaigns/7" }],
  }))
);
server.tool("mysterium_get_campaign", "mock", { campaign_id: z.string() }, async ({ campaign_id }) => {
  const unavailable = { state: "unavailable", value: null, provenance: null };
  return text(JSON.stringify({
    source: "dndbeyond-campaign",
    schemaVersion: "v1",
    partial: true,
    campaign: {
      id: campaign_id, name: sensitive, url: `https://www.dndbeyond.com/campaigns/${campaign_id}`,
      viewerRole: "unknown", identityProvenance: "rendered-dom",
      status: unavailable, createdAt: unavailable, dungeonMaster: unavailable, sharing: unavailable,
      players: unavailable, characters: { state: "empty", value: [], provenance: "rendered-dom" },
      description: unavailable, notes: { public: unavailable, private: unavailable },
      links: { canonical: `https://www.dndbeyond.com/campaigns/${campaign_id}`, invite: unavailable, administration: unavailable },
    },
  }));
});
function mockPageEnvelope(operation, requestedUrl, url) {
  return {
    source: "dndbeyond-rendered-page",
    schemaVersion: "v1",
    operation,
    requestedUrl,
    page: { url, title: "Synthetic Page" },
    text: sensitive,
    totalCharacters: sensitive.length,
    maxChars: 8000,
    nextCursor: null,
    done: true,
  };
}
server.tool("mysterium_read_page", "mock", { url: z.string().optional(), cursor: z.string().optional() }, async ({ url }) =>
  text(JSON.stringify(mockPageEnvelope(url ? "navigate" : "current_page", url ?? null, url ?? "https://www.dndbeyond.com/characters")))
);
server.tool("mysterium_capture_page", "mock", {}, async () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  const metadata = {
    source: "dndbeyond-page-screenshot",
    schemaVersion: "v1",
    url: "https://www.dndbeyond.com/characters",
    title: "Synthetic Page",
    scope: "viewport",
    selector: null,
    width: 1,
    height: 1,
    mimeType: "image/png",
    byteCount: bytes.length,
  };
  return {
    content: [
      { type: "text", text: JSON.stringify(metadata) },
      { type: "image", data: bytes.toString("base64"), mimeType: "image/png" },
    ],
    structuredContent: metadata,
  };
});
server.tool(
  "mysterium_search",
  "mock",
  { query: z.string(), category: z.string().optional(), source_scope: z.enum(["accessible", "all"]).optional() },
  async ({ query, category, source_scope }) => {
    const sourcebook = category === "sourcebooks";
    const monster = category === "monsters";
    const results = sourcebook
      ? [{
          name: sensitive,
          type: "sourcebook",
          url: source_scope === "all" ? "https://marketplace.dndbeyond.com/synthetic" : "https://www.dndbeyond.com/sources/synthetic-book",
          bookSlug: source_scope === "all" ? null : "synthetic-book",
          access: source_scope === "all" ? "unavailable" : "accessible",
          sources: [],
        }]
      : monster
        ? [{
            name: "Guard",
            type: "1/8",
            url: "https://www.dndbeyond.com/monsters/16915-guard",
            creatureId: "16915",
            sources: [],
            monster: { source: "Basic Rules", edition: "5e", legacy: true, challengeRating: "1/8", type: "Humanoid", tags: ["NPC"], access: "unknown" },
          }]
        : [{ name: sensitive, type: "1st Level", url: "https://www.dndbeyond.com/spells/synthetic", sources: [] }];
    return text(JSON.stringify({ query, category: category ?? "all", count: results.length, results }));
  }
);
const syntheticStatBlock = {
  kind: "stat_block",
  creature: {
    id: "16915", name: "Guard", url: "https://www.dndbeyond.com/monsters/16915-guard",
    source: "Basic Rules", edition: "5e", legacy: true, size: "Medium", type: "Humanoid",
    alignment: "Any Alignment", tags: ["NPC"], challengeRating: "1/8",
  },
  attributes: [{ label: "Armor Class", value: "16" }, { label: "Hit Points", value: "11" }],
  abilities: [
    { name: "STR", score: 13, modifier: "+1", save: "+1" },
    { name: "DEX", score: 12, modifier: "+1", save: "+1" },
    { name: "CON", score: 12, modifier: "+1", save: "+1" },
    { name: "INT", score: 10, modifier: "+0", save: "+0" },
    { name: "WIS", score: 11, modifier: "+0", save: "+0" },
    { name: "CHA", score: 10, modifier: "+0", save: "+0" },
  ],
  sections: [{ title: "Actions", kind: "actions", entries: [{ name: "Spear", text: "Spear. Synthetic action text." }] }],
  markdown: "# Guard\n\n## Actions\n\nSynthetic action text.",
};
server.tool(
  "mysterium_get_stat_block",
  "mock",
  { query: z.string().optional(), creature_id: z.string().optional(), legacy: z.enum(["include", "exclude", "only"]).optional() },
  async () => text(JSON.stringify(syntheticStatBlock))
);
server.registerTool(
  "mysterium_view_stat_block",
  {
    description: "mock",
    inputSchema: { query: z.string().optional(), creature_id: z.string().optional(), legacy: z.enum(["include", "exclude", "only"]).optional() },
    _meta: { ui: { resourceUri: "ui://mysterium/stat-block-viewer.html" } },
  },
  async () => ({
    content: [{ type: "text", text: "Ready to display Guard." }],
    structuredContent: { kind: "resolved", query: "Guard", normalizedQuery: "guard", legacy: "include", candidate: { id: "16915", name: "Guard" } },
  })
);
server.registerTool(
  "read_stat_block_for_app",
  {
    description: "mock",
    inputSchema: { creature_id: z.string(), creature_url: z.string().url().optional() },
    _meta: { ui: { visibility: ["app"] } },
  },
  async () => ({ content: [{ type: "text", text: "Loaded Guard." }], structuredContent: syntheticStatBlock })
);
server.tool("mysterium_list_library", "mock", {}, async () =>
  text(JSON.stringify({ books: [{ slug: "synthetic-book", title: sensitive }] }))
);
server.tool(
  "mysterium_read_book",
  "mock",
  {
    book_slug: z.string(),
    chapter_slug: z.string().optional(),
    mode: z.enum(["outline", "content"]).optional(),
    section: z.string().optional(),
    cursor: z.string().optional(),
    max_chars: z.number().optional(),
  },
  async ({ book_slug, chapter_slug, mode, section, cursor, max_chars }) => {
    if (!chapter_slug) {
      return text(JSON.stringify({
        kind: "outline",
        book: { slug: book_slug, title: sensitive },
        entries: [{ id: "toc-synthetic-1", title: sensitive, level: 1, parentId: null, chapterSlug: "synthetic" }],
        nextCursor: null,
        done: true,
      }));
    }
    if (mode === "outline") {
      return text(JSON.stringify({
        kind: "outline",
        book: { slug: book_slug },
        scope: { chapterSlug: chapter_slug, title: sensitive },
        entries: [{ id: "section-synthetic-1", title: sensitive, level: 1, parentId: null }],
        nextCursor: null,
        done: true,
      }));
    }

    const limit = max_chars ?? 10_000;
    const offset = cursor ? 1 : 0;
    const content = sensitive.slice(offset, offset + limit);
    const hasMore = offset + limit < sensitive.length;
    return text(JSON.stringify({
      kind: "content",
      book: { slug: book_slug },
      chapter: { slug: chapter_slug, title: sensitive, url: `https://www.dndbeyond.com/sources/${book_slug}/${chapter_slug}` },
      ...(section ? { section: { id: "section-synthetic-1", title: sensitive, level: 1, parentId: null } } : {}),
      text: content,
      images: [{ id: "image-1", alt: sensitive, caption: sensitive, url: "https://www.dndbeyond.com/synthetic.png" }],
      nextCursor: hasMore ? "mock-cursor-1" : null,
      done: !hasMore,
      maxChars: limit,
      serverMaxChars: 25_000,
    }));
  }
);

await server.connect(new StdioServerTransport());
