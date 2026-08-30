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
import { gzipSync } from "node:zlib";
import type { BrowserContext } from "playwright";
import { z } from "zod";

import { closeBrowser, getAuthenticatedContext } from "./browser.js";
import {
  getCharacter,
  getCharacterPortrait,
  listCharacters,
  type CharacterPortraitDependencies,
  validateCharacterListRequest,
} from "./tools/character.js";
import {
  acquireCharacterPdf,
  CharacterPdfStore,
  PDF_CHUNK_BYTES,
  type CharacterPdfDependencies,
} from "./tools/character-pdf.js";
import { getCampaign, listMyCampaigns, validateCampaignListRequest } from "./tools/campaign.js";
import {
  capturePageScreenshot,
  MAX_SCREENSHOT_SELECTOR_CHARS,
  readPage,
  SERVER_PAGE_MAX_CHARS,
  validatePageContentRequest,
  validatePageScreenshotRequest,
} from "./tools/navigate.js";
import { search, validateSearchContinuation } from "./tools/search.js";
import { listLibrary, readBook, SERVER_MAX_CHARS, validateReadBookRequest } from "./tools/library.js";
import {
  extractStatBlock,
  getStatBlock,
  resolveStatBlock,
  validateStatBlockRequest,
  type StatBlockRequest,
} from "./tools/stat-block.js";
import {
  characterDetailSchema,
  characterListEnvelopeSchema,
  characterPortraitMetadataSchema,
  campaignDetailEnvelopeSchema,
  campaignListEnvelopeSchema,
  libraryEnvelopeSchema,
  pageContentEnvelopeSchema,
  pageScreenshotMetadataSchema,
  readBookResultSchema,
  searchEnvelopeSchema,
  statBlockResolutionSchema,
  statBlockResultSchema,
  statBlockSchema,
} from "./tool-contracts.js";
import { jsonToolResult } from "./tool-result.js";
import { PACKAGE_VERSION } from "./version.js";

// Lazy-initialized shared browser context
async function getSharedContext() {
  return getAuthenticatedContext();
}

export type BrowserContextProvider = () => Promise<BrowserContext>;

export interface ServerOptions {
  characterPdfDependencies?: CharacterPdfDependencies;
  characterPortraitDependencies?: CharacterPortraitDependencies;
}

const CHARACTER_PDF_RESOURCE_URI = "ui://mysterium/character-pdf-viewer.html";
const characterPdfViewerPath = new URL("../dist/apps/character-pdf-viewer.html", import.meta.url);
const STAT_BLOCK_RESOURCE_URI = "ui://mysterium/stat-block-viewer.html";
const statBlockViewerPath = new URL("../dist/apps/stat-block-viewer.html", import.meta.url);

const statBlockInputSchema = {
  query: z.string().min(1).optional().describe("Creature name to resolve through D&D Beyond's monster catalog."),
  creature_id: z.string().regex(/^\d+$/).optional().describe("Exact numeric creature ID returned by a previous candidate result."),
  legacy: z.enum(["include", "exclude", "only"]).optional().describe("How to treat D&D Beyond's per-entry Legacy badge. Defaults to include while preferring a sole non-Legacy exact match."),
};

function statBlockRequest(query?: string, creatureId?: string, legacy?: "include" | "exclude" | "only"): StatBlockRequest {
  return { query, creatureId, legacy };
}

export function createServer(
  getContextForTool: BrowserContextProvider = getSharedContext,
  options: ServerOptions = {}
) {
  const server = new McpServer({
    name: "mysterium",
    version: PACKAGE_VERSION,
  }, {
    instructions: "Authentication is managed on the Docker host with mysterium-auth login; authenticated tool errors explain when the user must run it. Use mysterium_search for corpus results and sourcebook discovery. Global search results include bounded snippets, rendered Legacy status, source attribution, and direct sourcebook locations when D&D Beyond exposes them; use book_slug to restrict global results to one accessible book, legacy to select current or Legacy content, and nextCursor to continue bounded results. A unique final slug segment resolves to its canonical accessible book slug. Library, character-summary, and campaign-summary discovery use short-lived in-memory metadata caches; pass refresh: true when current account changes must be fetched. Use mysterium_get_stat_block for model-facing JSON and Markdown for a cataloged monster or NPC; use mysterium_view_stat_block only when an MCP App presentation is useful. Legacy filtering follows D&D Beyond's rendered badge and is separate from edition labels. Use mysterium_list_campaigns to filter normalized campaign summaries before mysterium_get_campaign; private notes default to requested but remain permission-gated, while sensitive invite and administration links require explicit opt-ins. A sourcebook result is safe to pass to mysterium_read_book only when access is 'accessible' and bookSlug is non-null; unavailable results may link to the store. Use mysterium_list_library to list accessible sourcebooks. Use mysterium_read_book in outline mode to retrieve a book's table of contents or a chapter's heading index, then use content mode for bounded chapter or section text. Continue sourcebook content using nextCursor until done is true. Use mysterium_read_page with url to navigate and read generic bounded page text, then continue its nextCursor with the same tool while the shared page remains unchanged. Use mysterium_capture_page only for an explicit visual inspection request because authenticated screenshots may contain private or copyrighted content. Sourcebook responses include image metadata, not image bytes.",
  });
  const characterPdfStore = new CharacterPdfStore(options.characterPdfDependencies);

// ─── mysterium_list_characters ──────────────────────────────────────────────────────
server.registerTool(
  "mysterium_list_characters",
  {
    description: "List cached, normalized D&D Beyond character summaries with composable filters, deterministic sorting, and optional refresh.",
    inputSchema: {
      names: z.array(z.string().min(1).max(100)).max(25).optional().describe("Character-name substrings. Values use OR and matching is case-insensitive."),
      classes: z.array(z.string().min(1).max(100)).max(25).optional().describe("Exact normalized class components. Values use OR and multiclass descriptions are split into components."),
      species: z.array(z.string().min(1).max(100)).max(25).optional().describe("Exact normalized species or race names. Values use OR."),
      campaign_ids: z.array(z.string().regex(/^\d+$/)).max(25).optional().describe("Exact numeric campaign IDs. Values use OR."),
      level: z.number().int().min(0).max(20).optional().describe("Exact character level. Cannot be combined with minimum or maximum level."),
      min_level: z.number().int().min(0).max(20).optional().describe("Inclusive minimum character level."),
      max_level: z.number().int().min(0).max(20).optional().describe("Inclusive maximum character level."),
      sort_by: z.enum(["created", "name", "level", "modified"]).optional().describe("Sort field. Defaults to name."),
      sort_direction: z.enum(["asc", "desc"]).optional().describe("Sort direction. Defaults to ascending."),
      refresh: z.boolean().optional().describe("Fetch current character summaries and replace the five-minute in-memory metadata cache before filtering."),
    },
    outputSchema: characterListEnvelopeSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ names, classes, species, campaign_ids, level, min_level, max_level, sort_by, sort_direction, refresh }) => {
    try {
      const request = {
        names,
        classes,
        species,
        campaignIds: campaign_ids,
        level,
        minLevel: min_level,
        maxLevel: max_level,
        sortBy: sort_by,
        sortDirection: sort_direction,
        refresh,
      };
      validateCharacterListRequest(request);
      const context = await getContextForTool();
      return jsonToolResult(await listCharacters(context, request));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list characters: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_get_character ────────────────────────────────────────────────────────
server.registerTool(
  "mysterium_get_character",
  {
    description: "Fetch complete character data from D&D Beyond in a stable envelope with a normalized nullable portrait URL.",
    inputSchema: {
      character_id: z.string().regex(/^\d+$/).describe("The numeric D&D Beyond character ID from the character URL."),
    },
    outputSchema: characterDetailSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ character_id }) => {
    try {
      const context = await getContextForTool();
      return jsonToolResult(await getCharacter(context, character_id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get character: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_get_character_portrait ───────────────────────────────────────────────
server.registerTool(
  "mysterium_get_character_portrait",
  {
    description: "Fetch an owned D&D Beyond character's configured portrait as validated, display-ready MCP image content.",
    inputSchema: {
      character_id: z.string().regex(/^\d+$/).describe("The numeric D&D Beyond character ID from the character URL."),
    },
    outputSchema: characterPortraitMetadataSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ character_id }) => {
    try {
      const context = await getContextForTool();
      const portrait = await getCharacterPortrait(context, character_id, options.characterPortraitDependencies);
      const text = JSON.stringify(portrait.metadata, null, 2);
      if (portrait.bytes === null || portrait.metadata.mimeType === null) {
        return { content: [{ type: "text" as const, text }], structuredContent: portrait.metadata };
      }
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: portrait.bytes.toString("base64"), mimeType: portrait.metadata.mimeType },
        ],
        structuredContent: portrait.metadata,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get character portrait: ${msg}` }], isError: true };
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
      const compressedPdf = gzipSync(pdf.bytes, { level: 9 });
      return {
        content: [{
          type: "text",
          text: `Character sheet PDF ready for inline viewing and download: ${metadata.filename} (${metadata.totalBytes} bytes, SHA-256 ${metadata.sha256}).`,
        }],
        structuredContent: metadata,
        _meta: {
          interactEnabled: false,
          writable: false,
          pdf: {
            encoding: "gzip+base64",
            data: compressedPdf.toString("base64"),
            originalBytes: pdf.totalBytes,
            compressedBytes: compressedPdf.length,
            sha256: pdf.sha256,
          },
        },
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
      text: await readFile(characterPdfViewerPath, "utf8"),
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

// ─── Stat block lookup and viewer ───────────────────────────────────────────────────
server.registerTool(
  "mysterium_get_stat_block",
  {
    description: "Resolve and retrieve a rendered D&D Beyond stat block as normalized JSON and faithful Markdown. Covers cataloged monsters and NPCs; ambiguous exact names return candidates.",
    inputSchema: statBlockInputSchema,
    outputSchema: statBlockResultSchema,
  },
  async ({ query, creature_id, legacy }) => {
    try {
      const request = statBlockRequest(query, creature_id, legacy);
      validateStatBlockRequest(request);
      const context = await getContextForTool();
      const result = await getStatBlock(context, request);
      return jsonToolResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stat block lookup failed.";
      return { content: [{ type: "text", text: `Failed to get stat block: ${msg}` }], isError: true };
    }
  }
);

registerAppTool(
  server,
  "mysterium_view_stat_block",
  {
    title: "View D&D Beyond Stat Block",
    description: "Resolve a cataloged monster or NPC and display its authenticated D&D Beyond stat block in a read-only viewer with PNG export.",
    inputSchema: statBlockInputSchema,
    outputSchema: statBlockResolutionSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: { ui: { resourceUri: STAT_BLOCK_RESOURCE_URI } },
  },
  async ({ query, creature_id, legacy }) => {
    const request = statBlockRequest(query, creature_id, legacy);
    try {
      validateStatBlockRequest(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid stat block request.";
      return { content: [{ type: "text", text: `Failed to view stat block: ${msg}` }], isError: true };
    }
    const uiCapability = getUiCapability(server.server.getClientCapabilities());
    if (!uiCapability?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
      return {
        content: [{ type: "text", text: "This client does not advertise MCP Apps stat-block viewing support; no D&D Beyond request was made. Use mysterium_get_stat_block for JSON instead." }],
        isError: true,
      };
    }
    try {
      const context = await getContextForTool();
      const resolution = await resolveStatBlock(context, request);
      const statBlock = resolution.kind === "resolved"
        ? await extractStatBlock(context, resolution.candidate.id, resolution.candidate.url)
        : undefined;
      const summary = resolution.kind === "resolved"
        ? `Ready to display ${resolution.candidate.name}.`
        : resolution.kind === "candidates"
          ? `Choose one of ${resolution.candidates.length} exact stat-block matches in the viewer.`
          : `No exact stat block was found for ${resolution.query}.`;
      return {
        content: [{ type: "text", text: summary }],
        structuredContent: resolution,
        _meta: {
          interactEnabled: true,
          writable: false,
          ...(statBlock ? { statBlock } : {}),
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stat block viewer failed.";
      return { content: [{ type: "text", text: `Failed to view stat block: ${msg}` }], isError: true };
    }
  }
);

registerAppTool(
  server,
  "read_stat_block_for_app",
  {
    title: "Read Stat Block for Viewer",
    description: "Retrieve one rendered stat block for the Mysterium viewer. The model should not call this tool directly.",
    inputSchema: {
      creature_id: z.string().regex(/^\d+$/),
      creature_url: z.string().url().optional(),
    },
    outputSchema: statBlockSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    _meta: { ui: { visibility: ["app"] } },
  },
  async ({ creature_id, creature_url }) => {
    try {
      const context = await getContextForTool();
      const result = await extractStatBlock(context, creature_id, creature_url);
      return {
        content: [{ type: "text", text: `Loaded ${result.creature.name} for the stat-block viewer.` }],
        structuredContent: result,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load the stat block.";
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  }
);

registerAppResource(
  server,
  STAT_BLOCK_RESOURCE_URI,
  STAT_BLOCK_RESOURCE_URI,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{
      uri: STAT_BLOCK_RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await readFile(statBlockViewerPath, "utf8"),
      _meta: { ui: { permissions: { clipboardWrite: {} } } },
    }],
  })
);

// ─── mysterium_get_campaign ─────────────────────────────────────────────────────────
server.registerTool(
  "mysterium_get_campaign",
  {
    description: "Retrieve normalized, permission-aware D&D Beyond campaign metadata, participants, notes, and explicitly requested safe links.",
    inputSchema: {
      campaign_id: z.string().regex(/^\d+$/).describe("The numeric D&D Beyond campaign ID."),
      include_private_notes: z.boolean().optional().describe("Include visible private DM notes. Defaults to true; unavailable notes never reveal whether hidden content exists."),
      include_invite_link: z.boolean().optional().describe("Include a visible, validated campaign invite link. Defaults to false because the URL is sensitive."),
      include_administration_links: z.boolean().optional().describe("Include visible, validated navigation-only campaign administration links. Defaults to false; destructive actions are always excluded."),
    },
    outputSchema: campaignDetailEnvelopeSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ campaign_id, include_private_notes, include_invite_link, include_administration_links }) => {
    try {
      const context = await getContextForTool();
      return jsonToolResult(await getCampaign(context, campaign_id, {
        includePrivateNotes: include_private_notes,
        includeInviteLink: include_invite_link,
        includeAdministrationLinks: include_administration_links,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to get campaign: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_list_campaigns ───────────────────────────────────────────────────────
server.registerTool(
  "mysterium_list_campaigns",
  {
    description: "List cached, normalized D&D Beyond campaign summaries with composable filters, deterministic sorting, and optional refresh.",
    inputSchema: {
      names: z.array(z.string().min(1).max(100)).max(25).optional().describe("Campaign-name substrings. Values use OR and matching is case-insensitive."),
      campaign_ids: z.array(z.string().regex(/^\d+$/)).max(25).optional().describe("Exact numeric campaign IDs. Values use OR."),
      roles: z.array(z.enum(["dungeon_master", "player", "unknown"])).max(3).optional().describe("Exact normalized viewer roles. Values use OR."),
      created_on_or_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive campaign creation date in YYYY-MM-DD format."),
      created_on_or_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive campaign creation date in YYYY-MM-DD format."),
      min_players: z.number().int().nonnegative().optional().describe("Inclusive minimum player count."),
      max_players: z.number().int().nonnegative().optional().describe("Inclusive maximum player count."),
      content_sharing_enabled: z.boolean().optional().describe("Exact content-sharing state."),
      sort_by: z.enum(["name", "role", "created", "players", "content_sharing"]).optional().describe("Sort field. Defaults to name."),
      sort_direction: z.enum(["asc", "desc"]).optional().describe("Sort direction. Defaults to ascending."),
      refresh: z.boolean().optional().describe("Fetch current campaign summaries and replace the five-minute in-memory metadata cache before filtering."),
    },
    outputSchema: campaignListEnvelopeSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ names, campaign_ids, roles, created_on_or_after, created_on_or_before, min_players, max_players, content_sharing_enabled, sort_by, sort_direction, refresh }) => {
    try {
      const request = {
        names,
        campaignIds: campaign_ids,
        roles,
        createdOnOrAfter: created_on_or_after,
        createdOnOrBefore: created_on_or_before,
        minPlayers: min_players,
        maxPlayers: max_players,
        contentSharingEnabled: content_sharing_enabled,
        sortBy: sort_by,
        sortDirection: sort_direction,
        refresh,
      };
      validateCampaignListRequest(request);
      const context = await getContextForTool();
      return jsonToolResult(await listMyCampaigns(context, request));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list campaigns: ${msg}` }], isError: true };
    }
  }
);

// ─── Generic read-only page tools ───────────────────────────────────────────────────
server.registerTool(
  "mysterium_read_page",
  {
    description: "Navigate to and read a canonical D&D Beyond page, read the current shared page, or continue bounded rendered text with an opaque cursor.",
    inputSchema: {
      url: z.url().optional().describe("Optional canonical HTTPS D&D Beyond URL. Omit it to read or continue the unchanged current page."),
      cursor: z.string().min(1).optional()
        .describe("Opaque nextCursor returned by mysterium_read_page. Cannot be combined with url and remains valid only while the shared page is unchanged."),
      max_chars: z.number().int().positive().max(SERVER_PAGE_MAX_CHARS).optional()
        .describe(`Maximum Unicode characters in the returned text chunk. Defaults to 8000 and cannot exceed ${SERVER_PAGE_MAX_CHARS}.`),
    },
    outputSchema: pageContentEnvelopeSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ url, cursor, max_chars }) => {
    try {
      const request = { url, cursor, maxChars: max_chars };
      validatePageContentRequest(request);
      const context = await getContextForTool();
      return jsonToolResult(await readPage(context, request));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to read page: ${msg}` }], isError: true };
    }
  }
);

server.registerTool(
  "mysterium_capture_page",
  {
    description: "Capture the current authenticated D&D Beyond viewport or one uniquely matched visible element as bounded MCP PNG image content. Screenshots may contain private account content.",
    inputSchema: {
      scope: z.enum(["viewport", "element"]).optional().describe("Capture the visible viewport by default, or one visible element."),
      selector: z.string().min(1).max(MAX_SCREENSHOT_SELECTOR_CHARS).optional()
        .describe("CSS selector required for element capture and invalid for viewport capture; it must match exactly one visible element."),
    },
    outputSchema: pageScreenshotMetadataSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ scope, selector }) => {
    try {
      const request = { scope, selector };
      validatePageScreenshotRequest(request);
      const context = await getContextForTool();
      const screenshot = await capturePageScreenshot(context, request);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(screenshot.metadata, null, 2) },
          { type: "image" as const, data: screenshot.bytes.toString("base64"), mimeType: "image/png" },
        ],
        structuredContent: screenshot.metadata as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to capture page: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_search ───────────────────────────────────────────────────────────────
server.registerTool(
  "mysterium_search",
  {
    description: "Search D&D Beyond indexes and global rendered results with normalized snippets, sourcebook locations, source attribution, Legacy filtering, and bounded cursor pagination. An optional exact or uniquely matching final slug segment filters global results to one accessible sourcebook.",
    inputSchema: {
      query: z.string().min(1).max(200).describe("The D&D Beyond search query (for example, 'opportunity attack')."),
      category: z
        .enum(["spells", "monsters", "items", "races", "classes", "feats", "sourcebooks", "all"])
        .optional()
        .describe("Category to search within (defaults to 'all'). Use 'sourcebooks' to search the rendered D&D Beyond library by title."),
      source_scope: z
        .enum(["accessible", "all"])
        .optional()
        .describe("Sourcebook availability scope. Defaults to 'accessible'; 'all' also returns unavailable catalog/store results. Valid only with category 'sourcebooks'."),
      book_slug: z
        .string()
        .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9/_-]*$/)
        .optional()
        .describe("Optional accessible sourcebook slug. Valid only with category 'all' or an omitted category; filters D&D Beyond global results by direct source path or rendered source attribution."),
      legacy: z
        .enum(["include", "exclude", "only"])
        .optional()
        .describe("How to filter D&D Beyond's rendered per-entry Legacy badge: include both (default), exclude Legacy, or return only Legacy. Invalid with category 'sourcebooks'."),
      limit: z.number().int().positive().max(50).optional().describe("Maximum results per response. Defaults to 20 and cannot exceed 50."),
      cursor: z.string().min(1).optional().describe("Opaque nextCursor from the preceding identical search. Reuse the same query, category, source_scope, book_slug, legacy, and limit."),
      refresh: z.boolean().optional().describe("With book_slug, refresh the one-hour accessible-library metadata cache before resolving the book. Search results are never cached."),
    },
    outputSchema: searchEnvelopeSchema,
  },
  async ({ query, category, source_scope, book_slug, legacy, limit, cursor, refresh }) => {
    try {
      const options = { bookSlug: book_slug, legacy, limit, cursor, refresh };
      validateSearchContinuation(query, category ?? "all", source_scope, options);
      const context = await getContextForTool();
      const results = await search(context, query, category ?? "all", source_scope, options);
      return jsonToolResult(results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Search failed: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_list_library ─────────────────────────────────────────────────────────
server.registerTool(
  "mysterium_list_library",
  {
    description: "List cached sourcebooks you own or can access through sharing in your D&D Beyond library, including canonical slugs and optional refresh.",
    inputSchema: {
      refresh: z.boolean().optional().describe("Fetch the current accessible library and replace the one-hour in-memory metadata cache."),
    },
    outputSchema: libraryEnvelopeSchema,
  },
  async ({ refresh }) => {
    try {
      const context = await getContextForTool();
      const books = await listLibrary(context, { refresh });
      return jsonToolResult(books);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Failed to list library: ${msg}` }], isError: true };
    }
  }
);

// ─── mysterium_read_book ────────────────────────────────────────────────────────────
server.registerTool(
  "mysterium_read_book",
  {
    description: "Discover an accessible D&D Beyond sourcebook's table of contents or chapter headings, or read bounded chapter or section Markdown with cursor pagination. Returns a JSON envelope with nextCursor and done.",
    inputSchema: {
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
    outputSchema: readBookResultSchema,
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
      return jsonToolResult(content);
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
