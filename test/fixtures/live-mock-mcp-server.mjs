import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  return text(JSON.stringify([{ id: "4242", name: sensitive }]));
});
server.tool(
  "mysterium_get_character",
  "mock",
  { character_id: z.string(), fallback_scrape: z.boolean().optional() },
  async ({ character_id, fallback_scrape }) =>
    text(JSON.stringify(fallback_scrape ? { Name: sensitive } : { data: { id: character_id, name: sensitive } }))
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
  text(JSON.stringify([{ id: "7", name: sensitive }]))
);
server.tool("mysterium_get_campaign", "mock", { campaign_id: z.string() }, async () =>
  text(JSON.stringify({ name: sensitive }))
);
server.tool("mysterium_navigate", "mock", { url: z.string() }, async ({ url }) => text(`URL: ${url}\n\n${sensitive}`));
server.tool(
  "mysterium_interact",
  "mock",
  { action: z.enum(["click", "fill", "screenshot"]), selector: z.string(), value: z.string().optional() },
  async () => {
    const path = join(tmpdir(), "mysterium-screenshot-live-mock.png");
    writeFileSync(path, "synthetic screenshot");
    return text(`Screenshot saved to: ${path}`);
  }
);
server.tool("mysterium_current_page", "mock", {}, async () =>
  text(`Current URL: https://www.dndbeyond.com/characters\n\n${sensitive}`)
);
server.tool(
  "mysterium_search",
  "mock",
  { query: z.string(), category: z.string().optional(), source_scope: z.enum(["accessible", "all"]).optional() },
  async ({ query, category, source_scope }) => {
    const sourcebook = category === "sourcebooks";
    const results = sourcebook
      ? [{
          name: sensitive,
          type: "sourcebook",
          url: source_scope === "all" ? "https://marketplace.dndbeyond.com/synthetic" : "https://www.dndbeyond.com/sources/synthetic-book",
          bookSlug: source_scope === "all" ? null : "synthetic-book",
          access: source_scope === "all" ? "unavailable" : "accessible",
          sources: [],
        }]
      : [{ name: sensitive, type: "1st Level", url: "https://www.dndbeyond.com/spells/synthetic", sources: [] }];
    return text(JSON.stringify({ query, category: category ?? "all", count: results.length, results }));
  }
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
