import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getUiCapability,
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { BrowserContext } from "playwright";
import { z } from "zod";

import { closeBrowser, getAuthenticatedContext } from "./browser.js";
import { getCharacter, scrapeCharacterSheet, listCharacters } from "./tools/character.js";
import {
  acquireCharacterPdf,
  CharacterPdfStore,
  PDF_CHUNK_BYTES,
  type CharacterPdfDependencies,
} from "./tools/character-pdf.js";
import { getCampaign, listMyCampaigns } from "./tools/campaign.js";
import { navigate, interact, getCurrentPageContent } from "./tools/navigate.js";
import { search, validateSearchRequest } from "./tools/search.js";
import { listLibrary, readBook, SERVER_MAX_CHARS, validateReadBookRequest } from "./tools/library.js";
import { PACKAGE_VERSION } from "./version.js";

// Lazy-initialized shared browser context
async function getSharedContext() {
  return getAuthenticatedContext();
}

export type BrowserContextProvider = () => Promise<BrowserContext>;

export interface ServerOptions {
  characterPdfDependencies?: CharacterPdfDependencies;
}

const CHARACTER_PDF_RESOURCE_URI = "ui://mysterium/character-pdf-viewer.html";
const viewerPath = new URL("../dist/apps/character-pdf-viewer.html", import.meta.url);

export function createServer(
  getContextForTool: BrowserContextProvider = getSharedContext,
  options: ServerOptions = {}
) {
  const server = new McpServer({
    name: "mysterium",
    version: PACKAGE_VERSION,
  }, {
    instructions: "Authentication is managed on the Docker host with mysterium-auth login; authenticated tool errors explain when the user must run it. Use mysterium_search for corpus results and sourcebook discovery. Search results include a sources array when D&D Beyond exposes attribution. A sourcebook result is safe to pass to mysterium_read_book only when access is 'accessible' and bookSlug is non-null; unavailable results may link to the store. Use mysterium_list_library to list accessible sourcebooks. Use mysterium_read_book in outline mode to retrieve a book's table of contents or a chapter's heading index, then use content mode for bounded chapter or section text. Continue content using nextCursor until done is true. Sourcebook responses include image metadata, not image bytes.",
  });
  const characterPdfStore = new CharacterPdfStore(options.characterPdfDependencies);

// ─── mysterium_list_characters ──────────────────────────────────────────────────────
server.tool(
  "mysterium_list_characters",
  "List all characters in your D&D Beyond account, including their ID, level, race, and class.",
  {},
  async () => {
    try {
      const context = await getContextForTool();
      const result = await listCharacters(context);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list characters: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_get_character ────────────────────────────────────────────────────────
server.tool(
  "mysterium_get_character",
  "Fetch full character data JSON from the D&D Beyond character service API. Requires character ID (the number in the character URL).",
  {
    character_id: z.string().describe("The D&D Beyond character ID (e.g. '12345678')"),
    fallback_scrape: z
      .boolean()
      .optional()
      .describe("If true, fall back to scraping the rendered character sheet HTML if the API fails"),
  },
  async ({ character_id, fallback_scrape }) => {
    try {
      const context = await getContextForTool();
      const data = await getCharacter(context, character_id);
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      if (fallback_scrape) {
        try {
          const context = await getContextForTool();
          const scraped = await scrapeCharacterSheet(context, character_id);
          return { content: [{ type: "text", text: scraped }] };
        } catch (scrapeErr) {
          const msg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
          return { content: [{ type: "text", text: `API and scrape both failed: ${msg}` }], isError: true };
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get character: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_export_character_pdf ─────────────────────────────────────────────────
registerAppTool(
  server,
  "mysterium_export_character_pdf",
  {
    title: "Export Character Sheet PDF",
    description: "Export an owned D&D Beyond character sheet through the rendered Manage → Export to PDF workflow and display it in a read-only PDF viewer.",
    inputSchema: {
      character_id: z.string().regex(/^\d+$/).describe("The D&D Beyond character ID"),
    },
    outputSchema: z.object({
      url: z.string(),
      title: z.string(),
      filename: z.string(),
      mimeType: z.literal("application/pdf"),
      totalBytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      initialPage: z.literal(1),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: { ui: { resourceUri: CHARACTER_PDF_RESOURCE_URI } },
  },
  async ({ character_id }) => {
    const uiCapability = getUiCapability(server.server.getClientCapabilities());
    if (!uiCapability?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
      return {
        content: [{ type: "text", text: "This client does not advertise MCP Apps PDF viewing support; no D&D Beyond request was made." }],
        isError: true,
      };
    }
    try {
      const context = await getContextForTool();
      const pdf = await acquireCharacterPdf(context, character_id, options.characterPdfDependencies);
      const metadata = characterPdfStore.put(pdf);
      return {
        content: [{
          type: "text",
          text: `Character sheet PDF ready for inline viewing and download: ${metadata.filename} (${metadata.totalBytes} bytes, SHA-256 ${metadata.sha256}).`,
        }],
        structuredContent: metadata,
        _meta: { interactEnabled: false, writable: false },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Character PDF export failed.";
      return { content: [{ type: "text", text: `Failed to export character PDF: ${msg}` }], isError: true };
    }
  }
);

registerAppTool(
  server,
  "read_pdf_bytes",
  {
    title: "Read Character PDF Bytes",
    description: "Read a bounded byte range for the character PDF viewer. The model should not call this tool directly.",
    inputSchema: {
      url: z.string(),
      offset: z.number().int().min(0).default(0),
      byteCount: z.number().int().min(1).max(PDF_CHUNK_BYTES).default(PDF_CHUNK_BYTES),
    },
    outputSchema: z.object({
      url: z.string(),
      bytes: z.string(),
      offset: z.number().int().min(0),
      byteCount: z.number().int().min(0),
      totalBytes: z.number().int().positive(),
      hasMore: z.boolean(),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { ui: { visibility: ["app"] } },
  },
  async ({ url, offset, byteCount }) => {
    try {
      const range = characterPdfStore.read(url, offset, byteCount);
      return {
        content: [{ type: "text", text: `${range.byteCount} PDF bytes at offset ${range.offset}.` }],
        structuredContent: range,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to read character PDF bytes.";
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  }
);

registerAppResource(
  server,
  CHARACTER_PDF_RESOURCE_URI,
  CHARACTER_PDF_RESOURCE_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{
      uri: CHARACTER_PDF_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(viewerPath, "utf8"),
      _meta: {
        ui: {
          permissions: { clipboardWrite: {} },
          csp: {
            connectDomains: ["https://unpkg.com"],
            resourceDomains: ["https://unpkg.com"],
          },
        },
      },
    }],
  })
);

// ─── mysterium_get_campaign ─────────────────────────────────────────────────────────
server.tool(
  "mysterium_get_campaign",
  "Fetch campaign information including player characters, notes, and description from a D&D Beyond campaign page.",
  {
    campaign_id: z.string().describe("The D&D Beyond campaign ID (found in the campaign URL)"),
  },
  async ({ campaign_id }) => {
    try {
      const context = await getContextForTool();
      const data = await getCampaign(context, campaign_id);
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get campaign: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_list_campaigns ───────────────────────────────────────────────────────
server.tool(
  "mysterium_list_campaigns",
  "List all D&D Beyond campaigns you are part of (as DM or player).",
  {},
  async () => {
    try {
      const context = await getContextForTool();
      const data = await listMyCampaigns(context);
      return { content: [{ type: "text", text: data }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list campaigns: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_navigate ─────────────────────────────────────────────────────────────
server.tool(
  "mysterium_navigate",
  "Navigate to any D&D Beyond URL and return the page's text content. Only dndbeyond.com URLs are allowed.",
  {
    url: z
      .string()
      .describe("Full D&D Beyond URL to navigate to (must start with https://www.dndbeyond.com/)"),
  },
  async ({ url }) => {
    try {
      const context = await getContextForTool();
      const content = await navigate(context, url);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Navigation failed: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_interact ─────────────────────────────────────────────────────────────
server.tool(
  "mysterium_interact",
  "Interact with the currently loaded D&D Beyond page by clicking, filling a form field, or taking a screenshot.",
  {
    action: z
      .enum(["click", "fill", "screenshot"])
      .describe("The action to perform: click an element, fill a text field, or take a screenshot"),
    selector: z.string().describe("CSS selector or text selector for the target element"),
    value: z
      .string()
      .optional()
      .describe("Value to type into the field (required for 'fill' action)"),
  },
  async ({ action, selector, value }) => {
    try {
      const context = await getContextForTool();
      const result = await interact(context, action, selector, value);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Interaction failed: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_current_page ─────────────────────────────────────────────────────────
server.tool(
  "mysterium_current_page",
  "Return the text content of the currently loaded page in the browser.",
  {},
  async () => {
    try {
      const context = await getContextForTool();
      const content = await getCurrentPageContent(context);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get page content: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_search ───────────────────────────────────────────────────────────────
server.tool(
  "mysterium_search",
  "Search D&D Beyond indexes for spells, monsters, magic items, races, classes, feats, sourcebooks, or general results. Results include normalized source attribution when D&D Beyond exposes it. Sourcebook searches default to accessible books.",
  {
    query: z.string().describe("The search query (e.g. 'Fireball', 'Beholder', 'Vorpal Sword')"),
    category: z
      .enum(["spells", "monsters", "items", "races", "classes", "feats", "sourcebooks", "all"])
      .optional()
      .describe("Category to search within (defaults to 'all'). Use 'sourcebooks' to search the rendered D&D Beyond library by title."),
    source_scope: z
      .enum(["accessible", "all"])
      .optional()
      .describe("Sourcebook availability scope. Defaults to 'accessible'; 'all' also returns unavailable catalog/store results. Valid only with category 'sourcebooks'."),
  },
  async ({ query, category, source_scope }) => {
    try {
      validateSearchRequest(category ?? "all", source_scope);
      const context = await getContextForTool();
      const results = await search(context, query, category ?? "all", source_scope);
      return { content: [{ type: "text", text: results }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Search failed: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_list_library ─────────────────────────────────────────────────────────
server.tool(
  "mysterium_list_library",
  "List sourcebooks you own or can access through sharing in your D&D Beyond library, including slugs for use with mysterium_read_book.",
  {},
  async () => {
    try {
      const context = await getContextForTool();
      const books = await listLibrary(context);
      return { content: [{ type: "text", text: books }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list library: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_read_book ────────────────────────────────────────────────────────────
server.tool(
  "mysterium_read_book",
  "Discover an accessible D&D Beyond sourcebook's table of contents or chapter headings, or read bounded chapter or section Markdown with cursor pagination. Returns a JSON envelope with nextCursor and done.",
  {
    book_slug: z
      .string()
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9/_-]*$/)
      .describe("Required sourcebook path after /sources/ (for example, 'dnd/phb-2024')."),
    chapter_slug: z
      .string()
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9/_-]*$/)
      .optional()
      .describe("Optional chapter path returned by a book outline. With no mode it selects content; omit it to retrieve the book outline."),
    mode: z
      .enum(["outline", "content"])
      .optional()
      .describe("Optional operation. Defaults to 'outline' without chapter_slug and 'content' with chapter_slug."),
    section: z
      .string()
      .min(1)
      .optional()
      .describe("Optional stable section ID from a chapter outline, or an exact unique heading. Valid only for chapter content."),
    cursor: z
      .string()
      .min(1)
      .optional()
      .describe("Opaque nextCursor from the preceding content response. Reuse the same book_slug, chapter_slug, section, and character limit."),
    max_chars: z
      .number()
      .int()
      .positive()
      .max(SERVER_MAX_CHARS)
      .optional()
      .describe(`Maximum Markdown characters in a content chunk. Defaults to 10000 and cannot exceed ${SERVER_MAX_CHARS}.`),
  },
  async ({ book_slug, chapter_slug, mode, section, cursor, max_chars }) => {
    try {
      const request = {
        bookSlug: book_slug,
        chapterSlug: chapter_slug,
        mode,
        section,
        cursor,
        maxChars: max_chars,
      };
      validateReadBookRequest(request);
      const context = await getContextForTool();
      const content = await readBook(context, request);
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to read book: ${msg}` }], isError: true };
    }
  }
);

  return server;
}

// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  let closing: Promise<void> | undefined;
  const cleanup = () => (closing ??= closeBrowser());
  const serverOnClose = transport.onclose;
  transport.onclose = () => {
    serverOnClose?.();
    void cleanup();
  };
  const terminate = () => {
    void cleanup().finally(() => process.exit(0));
  };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  process.stdin.once("end", () => void cleanup());
  process.stderr.write("Mysterium server running on stdio\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
  });
}
