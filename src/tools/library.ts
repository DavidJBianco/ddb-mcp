import { createHash } from "node:crypto";
import type { BrowserContext, Page } from "playwright";

import { getPage, isLoggedIn } from "../browser.js";
import { AuthenticationRequiredError, throwIfAuthenticationRedirect } from "../session-state.js";
import { openDomReadyPage, waitForRenderedContent } from "./page-readiness.js";

export const DEFAULT_MAX_CHARS = 10_000;
export const SERVER_MAX_CHARS = 25_000;

export type ReadBookMode = "outline" | "content";

export interface ReadBookRequest {
  bookSlug: string;
  chapterSlug?: string;
  mode?: ReadBookMode;
  section?: string;
  cursor?: string;
  maxChars?: number;
}

export interface ImageMetadata {
  id: string;
  alt: string;
  caption: string;
  url: string;
}

export interface OutlineEntry {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
  chapterSlug?: string;
  url?: string;
}

export interface ContentBlock {
  text: string;
  headingId?: string;
  headingLevel?: number;
  imageIds: string[];
}

export interface ExtractedBookPage {
  title: string;
  outline: OutlineEntry[];
  blocks: ContentBlock[];
  images: ImageMetadata[];
}

export type SourcebookAccess = "accessible" | "unavailable" | "unknown";

export interface LibraryBookCard {
  title: string;
  ownership: string;
  url: string;
  bookSlug: string | null;
  access: SourcebookAccess;
}

export interface LibraryBook {
  title: string;
  slug: string;
  ownership: string;
  url: string;
}

export interface LibraryEnvelope {
  count: number;
  books: LibraryBook[];
}

export interface ReadBookOutlineResult {
  kind: "outline";
  book: { slug: string; title?: string };
  scope: { bookSlug: string; title: string } | { chapterSlug: string; title: string };
  url: string;
  entries: OutlineEntry[];
  nextCursor: null;
  done: true;
}

export interface ReadBookContentResult {
  kind: "content";
  book: { slug: string };
  chapter: { slug: string; title: string; url: string };
  section?: OutlineEntry;
  text: string;
  images: ImageMetadata[];
  nextCursor: string | null;
  done: boolean;
  maxChars: number;
  serverMaxChars: number;
}

export type ReadBookResult = ReadBookOutlineResult | ReadBookContentResult;

interface CursorPayload {
  version: 1;
  bookSlug: string;
  chapterSlug: string;
  section: string | null;
  maxChars: number;
  blockIndex: number;
  offset: number;
  fingerprint: string;
}

interface CursorPosition {
  blockIndex: number;
  offset: number;
}

interface PageChunk {
  text: string;
  next: CursorPosition | null;
  imageIds: string[];
}

const SLUG_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9/_-]*$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function assertSlug(value: string, field: string): void {
  if (!SLUG_PATTERN.test(value)) {
    throw new Error(`${field} must be a relative D&D Beyond source path without queries, fragments, or traversal segments.`);
  }
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

function stableFingerprint(blocks: ContentBlock[], images: ImageMetadata[]): string {
  const stableImages = images.map(({ id, alt, caption }) => ({ id, alt, caption }));
  return createHash("sha256").update(JSON.stringify({ blocks, images: stableImages })).digest("hex");
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded || Buffer.from(decoded, "utf8").toString("base64url") !== cursor) {
      throw new Error("non-canonical encoding");
    }
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("Invalid cursor: expected an opaque cursor returned by mysterium_read_book.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid cursor: cursor payload must be an object.");
  }

  const value = parsed as Record<string, unknown>;
  if (value.version !== 1) throw new Error("Invalid cursor: unsupported cursor version; restart without a cursor.");
  if (typeof value.bookSlug !== "string") throw new Error("Invalid cursor: missing book binding.");
  if (typeof value.chapterSlug !== "string") throw new Error("Invalid cursor: missing chapter binding.");
  if (value.section !== null && typeof value.section !== "string") throw new Error("Invalid cursor: invalid section binding.");
  if (!Number.isInteger(value.maxChars) || (value.maxChars as number) < 1 || (value.maxChars as number) > SERVER_MAX_CHARS) {
    throw new Error("Invalid cursor: invalid character limit.");
  }
  if (!Number.isInteger(value.blockIndex) || (value.blockIndex as number) < 0) {
    throw new Error("Invalid cursor: invalid block position.");
  }
  if (!Number.isInteger(value.offset) || (value.offset as number) < 0) {
    throw new Error("Invalid cursor: invalid block offset.");
  }
  if (typeof value.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.fingerprint)) {
    throw new Error("Invalid cursor: invalid content fingerprint.");
  }

  assertSlug(value.bookSlug, "cursor book_slug");
  assertSlug(value.chapterSlug, "cursor chapter_slug");
  return value as unknown as CursorPayload;
}

export function validateReadBookRequest(request: ReadBookRequest): Required<Pick<ReadBookRequest, "bookSlug" | "mode" | "maxChars">> & ReadBookRequest {
  assertSlug(request.bookSlug, "book_slug");
  if (request.chapterSlug !== undefined) assertSlug(request.chapterSlug, "chapter_slug");

  const mode = request.mode ?? (request.chapterSlug ? "content" : "outline");
  const cursorPayload = request.cursor ? decodeCursor(request.cursor) : undefined;
  const maxChars = request.maxChars ?? cursorPayload?.maxChars ?? DEFAULT_MAX_CHARS;

  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > SERVER_MAX_CHARS) {
    throw new Error(`max_chars must be a positive integer no greater than ${SERVER_MAX_CHARS}.`);
  }
  if (mode === "content" && !request.chapterSlug) {
    throw new Error("chapter_slug is required when mode is 'content'.");
  }
  if (mode === "outline" && (request.section || request.cursor || request.maxChars !== undefined)) {
    throw new Error("section, cursor, and max_chars are only valid when reading content.");
  }
  if (request.section && !request.chapterSlug) {
    throw new Error("section requires chapter_slug.");
  }

  if (cursorPayload) {
    if (mode !== "content") throw new Error("A cursor can only continue a content request.");
    if (
      cursorPayload.bookSlug !== request.bookSlug ||
      cursorPayload.chapterSlug !== request.chapterSlug ||
      cursorPayload.section !== (request.section ?? null)
    ) {
      throw new Error("Cursor does not match book_slug, chapter_slug, and section; restart without a cursor.");
    }
    if (request.maxChars !== undefined && request.maxChars !== cursorPayload.maxChars) {
      throw new Error("Cursor does not match max_chars; reuse the original limit or omit max_chars.");
    }
  }

  return { ...request, mode, maxChars };
}

export function paginateBlocks(
  blocks: ContentBlock[],
  maxChars: number,
  start: CursorPosition = { blockIndex: 0, offset: 0 }
): PageChunk {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > SERVER_MAX_CHARS) {
    throw new Error(`max_chars must be between 1 and ${SERVER_MAX_CHARS}.`);
  }
  if (!Number.isInteger(start.blockIndex) || !Number.isInteger(start.offset) || start.blockIndex < 0 || start.offset < 0) {
    throw new Error("Invalid cursor: invalid pagination position.");
  }
  if (start.blockIndex > blocks.length || (start.blockIndex === blocks.length && start.offset !== 0)) {
    throw new Error("Invalid cursor: pagination position is outside the selected content.");
  }
  if (blocks.length === 0 || start.blockIndex === blocks.length) {
    return { text: "", next: null, imageIds: [] };
  }

  const segments = blocks.map((block, index) => `${block.text}${index < blocks.length - 1 ? "\n\n" : ""}`);
  const selectedImages = new Set<string>();
  let remaining = maxChars;
  let blockIndex = start.blockIndex;
  let offset = start.offset;
  let text = "";

  while (blockIndex < segments.length && remaining > 0) {
    const segmentPoints = codePoints(segments[blockIndex]);
    if (offset > segmentPoints.length) {
      throw new Error("Invalid cursor: block offset is outside the selected content.");
    }
    const available = segmentPoints.length - offset;
    if (available === 0) {
      blockIndex += 1;
      offset = 0;
      continue;
    }

    if (available <= remaining) {
      text += segmentPoints.slice(offset).join("");
      remaining -= available;
      blocks[blockIndex].imageIds.forEach((id) => selectedImages.add(id));
      blockIndex += 1;
      offset = 0;
      continue;
    }

    if (text.length === 0) {
      text = segmentPoints.slice(offset, offset + remaining).join("");
      blocks[blockIndex].imageIds.forEach((id) => selectedImages.add(id));
      offset += remaining;
    }
    break;
  }

  const next = blockIndex >= segments.length ? null : { blockIndex, offset };
  return { text, next, imageIds: [...selectedImages] };
}

function selectSection(extracted: ExtractedBookPage, selector?: string): {
  blocks: ContentBlock[];
  section?: OutlineEntry;
} {
  if (!selector) return { blocks: extracted.blocks };

  let matches = extracted.outline.filter((entry) => entry.id === selector);
  if (matches.length === 0) matches = extracted.outline.filter((entry) => entry.title === selector);
  if (matches.length === 0) throw new Error(`Section '${selector}' was not found in the chapter outline.`);
  if (matches.length > 1) {
    throw new Error(`Section heading '${selector}' is ambiguous; use one of these section IDs: ${matches.map(({ id }) => id).join(", ")}.`);
  }

  const section = matches[0];
  const start = extracted.blocks.findIndex((block) => block.headingId === section.id);
  if (start < 0) throw new Error(`Section '${selector}' has no readable content.`);
  let end = extracted.blocks.length;
  for (let index = start + 1; index < extracted.blocks.length; index += 1) {
    const level = extracted.blocks[index].headingLevel;
    if (level !== undefined && level <= section.level) {
      end = index;
      break;
    }
  }
  return { blocks: extracted.blocks.slice(start, end), section };
}

export async function listLibrary(context: BrowserContext): Promise<LibraryEnvelope> {
  const page = await getPage(context);

  if (!(await isLoggedIn(page))) {
    throw new AuthenticationRequiredError();
  }

  await openDomReadyPage(
    page,
    "https://www.dndbeyond.com/en/library?type=sourcebooks&ownership=owned-shared",
    30_000
  );
  throwIfAuthenticationRedirect(page);
  await waitForRenderedContent(
    page,
    "div[data-testid='sourceCard'], input[placeholder*='Filter by title' i], main",
    15_000
  );
  await page.waitForTimeout(2000);

  const cards = await extractLibraryBookCards(page);
  const books = cards.map(({ title, bookSlug, ownership, url }) => ({
    title,
    slug: bookSlug ?? "",
    ownership,
    url,
  }));

  return { count: books.length, books };
}

export async function extractLibraryBookCards(page: Page): Promise<LibraryBookCard[]> {
  return page.evaluate(() => {
    type BrowserCard = {
      title: string;
      ownership: string;
      url: string;
      bookSlug: string | null;
      access: "accessible" | "unavailable" | "unknown";
    };

    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const cards: BrowserCard[] = [];

    document.querySelectorAll("div[data-testid='sourceCard']").forEach((card) => {
      const links = Array.from(card.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      const titleLink = card.querySelector("a[class*='SourceCard_sourceTitle']") as HTMLAnchorElement | null;
      const readableLink = links.find((link) => {
        try {
          return new URL(link.href, document.baseURI).pathname.startsWith("/sources/");
        } catch {
          return false;
        }
      });
      const storeLink = links.find((link) => {
        try {
          const target = new URL(link.href, document.baseURI);
          return target.hostname === "marketplace.dndbeyond.com" || /view in store|buy/i.test(normalize(link.textContent));
        } catch {
          return false;
        }
      });
      const primaryLink = readableLink ?? storeLink ?? titleLink ?? links[0];
      const title = normalize(titleLink?.textContent) || normalize(card.querySelector("h2, h3, [class*='sourceTitle']")?.textContent);
      const ownership = normalize(card.querySelector("p[class*='SourceCard_sourceSubtitle'], [class*='sourceSubtitle']")?.textContent);
      const url = primaryLink?.href ?? "";
      let bookSlug: string | null = null;

      if (readableLink) {
        try {
          const match = new URL(readableLink.href, document.baseURI).pathname.match(/^\/sources\/(.+?)\/?$/);
          bookSlug = match?.[1] ?? null;
        } catch {
          bookSlug = null;
        }
      }

      const access = readableLink ? "accessible" : storeLink ? "unavailable" : "unknown";
      if (title) cards.push({ title, ownership, url, bookSlug, access });
    });

    return cards;
  });
}

async function extractBookPage(context: BrowserContext, request: ReturnType<typeof validateReadBookRequest>): Promise<{
  extracted: ExtractedBookPage;
  url: string;
}> {
  const page = await getPage(context);
  if (!(await isLoggedIn(page))) throw new AuthenticationRequiredError();

  const url = `https://www.dndbeyond.com/sources/${request.bookSlug}${request.chapterSlug ? `/${request.chapterSlug}` : ""}`;
  await openDomReadyPage(page, url, 45_000);
  throwIfAuthenticationRedirect(page);
  await waitForRenderedContent(
    page,
    "article, .content-container, .p-content, [class*='TableOfContents']",
    15_000
  );

  const extracted = await page.evaluate(({ bookSlug, isBookOutline }) => {
    type BrowserOutlineEntry = {
      id: string;
      title: string;
      level: number;
      parentId: string | null;
      chapterSlug?: string;
      url?: string;
    };
    type BrowserImage = { id: string; alt: string; caption: string; url: string };
    type BrowserBlock = { text: string; headingId?: string; headingLevel?: number; imageIds: string[] };

    const liveRoot =
      document.querySelector("article") ??
      document.querySelector(".content-container") ??
      document.querySelector(".p-content") ??
      document.querySelector("main [class*='content']") ??
      (isBookOutline ? document.querySelector("main") : null);
    if (!liveRoot) return null;

    const root = liveRoot.cloneNode(true) as Element;
    root.querySelectorAll("script, style, nav, header, footer, aside, .ad-container, .sidebar, .breadcrumb").forEach((el) => el.remove());

    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const slugify = (value: string) => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    const uniqueId = (prefix: string, entryTitle: string, counts: Map<string, number>) => {
      const base = `${prefix}-${slugify(entryTitle)}`;
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      return `${base}-${count}`;
    };
    const parentFor = (level: number, stack: BrowserOutlineEntry[]) => {
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      return stack.at(-1)?.id ?? null;
    };

    const title = normalize(root.querySelector("h1")?.textContent) || normalize(document.title) || bookSlug;
    const outline: BrowserOutlineEntry[] = [];

    if (isBookOutline) {
      const counts = new Map<string, number>();
      const seen = new Set<string>();
      const stack: BrowserOutlineEntry[] = [];
      const outlineRoot =
        root.querySelector("[data-testid*='toc' i], .toc, .compendium-toc, [class*='TableOfContents'], [aria-label*='contents' i]") ?? root;
      outlineRoot.querySelectorAll("a[href]").forEach((node) => {
        const anchor = node as HTMLAnchorElement;
        let parsed: URL;
        try {
          parsed = new URL(anchor.getAttribute("href") ?? "", document.baseURI);
        } catch {
          return;
        }
        const prefix = `/sources/${bookSlug}/`;
        if (parsed.origin !== location.origin || !parsed.pathname.startsWith(prefix)) return;
        const chapterSlug = decodeURIComponent(parsed.pathname.slice(prefix.length).replace(/\/$/, ""));
        const identity = `${chapterSlug}${parsed.hash}`;
        if (!chapterSlug || seen.has(identity)) return;
        seen.add(identity);
        const entryTitle = normalize(anchor.textContent);
        if (!entryTitle) return;
        let level = 0;
        let current: Element | null = anchor;
        while ((current = current.parentElement) && current !== outlineRoot) {
          if (current.tagName.toLowerCase() === "li") level += 1;
        }
        level = Math.max(1, level);
        const entry: BrowserOutlineEntry = {
          id: uniqueId("toc", entryTitle, counts),
          title: entryTitle,
          level,
          parentId: parentFor(level, stack),
          chapterSlug,
          url: parsed.href,
        };
        outline.push(entry);
        stack.push(entry);
      });
      return { title, outline, blocks: [], images: [] };
    }

    const images: BrowserImage[] = [];
    const imageByElement = new Map<Element, BrowserImage>();
    const registerImage = (image: HTMLImageElement): BrowserImage | null => {
      const existing = imageByElement.get(image);
      if (existing) return existing;
      const rawUrl = image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src") || "";
      let parsed: URL;
      try {
        parsed = new URL(rawUrl, document.baseURI);
      } catch {
        return null;
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
      const metadata: BrowserImage = {
        id: `image-${images.length + 1}`,
        alt: normalize(image.getAttribute("alt")),
        caption: normalize(image.closest("figure")?.querySelector("figcaption")?.textContent),
        url: parsed.href,
      };
      images.push(metadata);
      imageByElement.set(image, metadata);
      return metadata;
    };

    const imageIdsFor = (element: Element) => Array.from(element.querySelectorAll("img"))
      .map((image) => registerImage(image as HTMLImageElement)?.id)
      .filter((id): id is string => Boolean(id));
    const renderInline = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      if (["script", "style", "button", "svg"].includes(tag)) return "";
      if (tag === "img") {
        const image = registerImage(element as HTMLImageElement);
        return image ? `[Image ${image.id}${image.alt ? `: ${image.alt}` : ""}]` : "";
      }
      const children = Array.from(element.childNodes).map(renderInline).join("");
      if (["strong", "b"].includes(tag)) return `**${children.trim()}**`;
      if (["em", "i"].includes(tag)) return `_${children.trim()}_`;
      if (tag === "code") return `\`${children.trim()}\``;
      if (tag === "br") return "\n";
      return children;
    };
    const renderList = (list: Element, depth = 0): string => {
      const ordered = list.tagName.toLowerCase() === "ol";
      const lines: string[] = [];
      Array.from(list.children).filter((child) => child.tagName.toLowerCase() === "li").forEach((item, index) => {
        const direct = Array.from(item.childNodes).filter((node) => !(node.nodeType === Node.ELEMENT_NODE && ["ul", "ol"].includes((node as Element).tagName.toLowerCase())));
        lines.push(`${"  ".repeat(depth)}${ordered ? `${index + 1}.` : "-"} ${normalize(direct.map(renderInline).join(""))}`);
        Array.from(item.children).filter((child) => ["ul", "ol"].includes(child.tagName.toLowerCase())).forEach((child) => {
          lines.push(renderList(child, depth + 1));
        });
      });
      return lines.join("\n");
    };
    const renderTable = (table: Element): string => {
      const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => normalize(renderInline(cell)).replace(/\|/g, "\\|"))
      ).filter((row) => row.length > 0);
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const padded = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
      const header = padded[0];
      return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n");
    };

    const headingCounts = new Map<string, number>();
    const headingStack: BrowserOutlineEntry[] = [];
    const headingByElement = new Map<Element, BrowserOutlineEntry>();
    root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      const headingTitle = normalize(heading.textContent);
      if (!headingTitle) return;
      const level = Number(heading.tagName.slice(1));
      const entry: BrowserOutlineEntry = {
        id: uniqueId("section", headingTitle, headingCounts),
        title: headingTitle,
        level,
        parentId: parentFor(level, headingStack),
      };
      outline.push(entry);
      headingStack.push(entry);
      headingByElement.set(heading, entry);
    });

    const blockSelector = "h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, table, pre, hr, figure, img";
    const candidates = Array.from(root.querySelectorAll(blockSelector)).filter((element) => {
      let parent = element.parentElement;
      while (parent && parent !== root) {
        if (parent.matches("p, ul, ol, blockquote, table, pre, figure")) return false;
        parent = parent.parentElement;
      }
      return true;
    });
    const blocks: BrowserBlock[] = [];
    candidates.forEach((element) => {
      const tag = element.tagName.toLowerCase();
      const heading = headingByElement.get(element);
      let text = "";
      if (heading) text = `${"#".repeat(heading.level)} ${heading.title}`;
      else if (tag === "p") text = normalize(renderInline(element));
      else if (tag === "ul" || tag === "ol") text = renderList(element);
      else if (tag === "blockquote") text = normalize(renderInline(element)).split("\n").map((line) => `> ${line}`).join("\n");
      else if (tag === "table") text = renderTable(element);
      else if (tag === "pre") text = `\`\`\`\n${element.textContent?.trim() ?? ""}\n\`\`\``;
      else if (tag === "hr") text = "---";
      else if (tag === "figure") {
        const image = element.querySelector("img");
        const metadata = image ? registerImage(image as HTMLImageElement) : null;
        text = metadata ? `[Image ${metadata.id}${metadata.alt ? `: ${metadata.alt}` : ""}]${metadata.caption ? `\n\n${metadata.caption}` : ""}` : "";
      } else if (tag === "img") {
        const metadata = registerImage(element as HTMLImageElement);
        text = metadata ? `[Image ${metadata.id}${metadata.alt ? `: ${metadata.alt}` : ""}]` : "";
      }
      text = text.trim();
      if (!text) return;
      const directImage = tag === "img" ? registerImage(element as HTMLImageElement) : null;
      blocks.push({
        text,
        ...(heading ? { headingId: heading.id, headingLevel: heading.level } : {}),
        imageIds: directImage ? [directImage.id] : imageIdsFor(element),
      });
    });
    return { title, outline, blocks, images };
  }, { bookSlug: request.bookSlug, isBookOutline: request.mode === "outline" && !request.chapterSlug });

  if (!extracted) {
    throw new Error("Sourcebook content layout was not recognized. D&D Beyond may have changed its rendered page structure.");
  }
  if (request.mode === "outline" && extracted.outline.length === 0) {
    throw new Error("No table of contents or headings were found. D&D Beyond may have changed its rendered page structure.");
  }
  if (request.mode === "content" && extracted.blocks.length === 0) {
    throw new Error("No readable chapter content was found. D&D Beyond may have changed its rendered page structure.");
  }
  return { extracted, url };
}

export async function readBook(context: BrowserContext, input: ReadBookRequest): Promise<ReadBookResult> {
  const request = validateReadBookRequest(input);
  const { extracted, url } = await extractBookPage(context, request);

  if (request.mode === "outline") {
    return {
      kind: "outline",
      book: request.chapterSlug ? { slug: request.bookSlug } : { slug: request.bookSlug, title: extracted.title },
      scope: request.chapterSlug
        ? { chapterSlug: request.chapterSlug, title: extracted.title }
        : { bookSlug: request.bookSlug, title: extracted.title },
      url,
      entries: extracted.outline,
      nextCursor: null,
      done: true,
    };
  }

  const selected = selectSection(extracted, request.section);
  const selectedImageIds = new Set(selected.blocks.flatMap(({ imageIds }) => imageIds));
  const selectedImages = extracted.images.filter(({ id }) => selectedImageIds.has(id));
  const fingerprint = stableFingerprint(selected.blocks, selectedImages);
  const cursorPayload = request.cursor ? decodeCursor(request.cursor) : undefined;
  if (cursorPayload && cursorPayload.fingerprint !== fingerprint) {
    throw new Error("Sourcebook content changed since this cursor was issued; restart without a cursor.");
  }

  const chunk = paginateBlocks(
    selected.blocks,
    request.maxChars,
    cursorPayload ? { blockIndex: cursorPayload.blockIndex, offset: cursorPayload.offset } : undefined
  );
  const chunkImageIds = new Set(chunk.imageIds);
  const images = selectedImages.filter(({ id }) => chunkImageIds.has(id));
  const nextCursor = chunk.next ? encodeCursor({
    version: 1,
    bookSlug: request.bookSlug,
    chapterSlug: request.chapterSlug!,
    section: request.section ?? null,
    maxChars: request.maxChars,
    blockIndex: chunk.next.blockIndex,
    offset: chunk.next.offset,
    fingerprint,
  }) : null;

  return {
    kind: "content",
    book: { slug: request.bookSlug },
    chapter: { slug: request.chapterSlug!, title: extracted.title, url },
    ...(selected.section ? { section: selected.section } : {}),
    text: chunk.text,
    images,
    nextCursor,
    done: nextCursor === null,
    maxChars: request.maxChars,
    serverMaxChars: SERVER_MAX_CHARS,
  };
}
