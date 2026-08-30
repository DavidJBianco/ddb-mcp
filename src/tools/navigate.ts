import { createHash } from "node:crypto";
import type { BrowserContext, Page } from "playwright";

import { getPage } from "../browser.js";
import { AuthenticationRequiredError, isLoggedInOnCurrentPage } from "../session-state.js";
import { openDomReadyPage, waitForRenderedContent } from "./page-readiness.js";
import {
  codePointLength,
  decodeOpaqueCursorObject,
  encodeOpaqueCursor,
  paginateSegments,
  splitTextAtNewlines,
  type SegmentPosition,
} from "./pagination.js";

export const DEFAULT_PAGE_MAX_CHARS = 8_000;
export const SERVER_PAGE_MAX_CHARS = 25_000;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_SCREENSHOT_DIMENSION = 4_096;
export const MAX_SCREENSHOT_PIXELS = 16_777_216;
export const MAX_SCREENSHOT_SELECTOR_CHARS = 500;

export type PageOperation = "navigate" | "current_page";
export type ScreenshotScope = "viewport" | "element";

export interface PageContentRequest {
  url?: string;
  cursor?: string;
  maxChars?: number;
}

export interface PageContentEnvelope {
  source: "dndbeyond-rendered-page";
  schemaVersion: "v1";
  operation: PageOperation;
  requestedUrl: string | null;
  page: { url: string; title: string };
  text: string;
  totalCharacters: number;
  maxChars: number;
  nextCursor: string | null;
  done: boolean;
}

export interface PageScreenshotRequest {
  scope?: ScreenshotScope;
  selector?: string;
}

export interface PageScreenshotMetadata {
  source: "dndbeyond-page-screenshot";
  schemaVersion: "v1";
  url: string;
  title: string;
  scope: ScreenshotScope;
  selector: string | null;
  width: number;
  height: number;
  mimeType: "image/png";
  byteCount: number;
}

export interface PageScreenshotResult {
  metadata: PageScreenshotMetadata;
  bytes: Buffer;
}

interface PageCursorPayload {
  version: 1;
  url: string;
  maxChars: number;
  segmentIndex: number;
  offset: number;
  fingerprint: string;
}

interface ExtractedPage {
  url: string;
  title: string;
  text: string;
}

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export function isAllowedDdbUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.port === "" &&
      (parsed.hostname === "www.dndbeyond.com" || parsed.hostname === "dndbeyond.com");
  } catch {
    return false;
  }
}

function assertMaxChars(maxChars: number): void {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > SERVER_PAGE_MAX_CHARS) {
    throw new Error(`max_chars must be a positive integer no greater than ${SERVER_PAGE_MAX_CHARS}.`);
  }
}

export function encodePageCursor(payload: PageCursorPayload): string {
  return encodeOpaqueCursor(payload);
}

export function decodePageCursor(cursor: string): PageCursorPayload {
  const value = decodeOpaqueCursorObject(
    cursor,
    "Invalid page cursor: expected an opaque cursor returned by mysterium_read_page.",
    "Invalid page cursor: cursor payload must be an object."
  );
  if (value.version !== 1) throw new Error("Invalid page cursor: unsupported cursor version; restart without a cursor.");
  if (typeof value.url !== "string" || !isAllowedDdbUrl(value.url)) throw new Error("Invalid page cursor: invalid page binding.");
  if (!Number.isInteger(value.maxChars)) throw new Error("Invalid page cursor: invalid character limit.");
  assertMaxChars(value.maxChars as number);
  if (!Number.isInteger(value.segmentIndex) || (value.segmentIndex as number) < 0 ||
      !Number.isInteger(value.offset) || (value.offset as number) < 0) {
    throw new Error("Invalid page cursor: invalid text position.");
  }
  if (typeof value.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.fingerprint)) {
    throw new Error("Invalid page cursor: invalid content fingerprint.");
  }
  return value as unknown as PageCursorPayload;
}

export function validatePageContentRequest(request: PageContentRequest): Required<Pick<PageContentRequest, "maxChars">> & PageContentRequest {
  if (request.url !== undefined && !isAllowedDdbUrl(request.url)) {
    throw new Error("Only canonical HTTPS D&D Beyond URLs are supported.");
  }
  if (request.url !== undefined && request.cursor !== undefined) {
    throw new Error("url and cursor cannot be combined; omit url when continuing the unchanged current page.");
  }
  const cursorPayload = request.cursor ? decodePageCursor(request.cursor) : undefined;
  const maxChars = request.maxChars ?? cursorPayload?.maxChars ?? DEFAULT_PAGE_MAX_CHARS;
  assertMaxChars(maxChars);
  if (request.maxChars !== undefined && cursorPayload && request.maxChars !== cursorPayload.maxChars) {
    throw new Error("Page cursor does not match max_chars; reuse the original limit or omit max_chars.");
  }
  return { ...request, maxChars };
}

export function validatePageScreenshotRequest(request: PageScreenshotRequest): Required<Pick<PageScreenshotRequest, "scope">> & PageScreenshotRequest {
  const scope = request.scope ?? "viewport";
  const selector = request.selector?.trim();
  if (scope === "viewport" && selector !== undefined) throw new Error("selector is only valid when screenshot scope is 'element'.");
  if (scope === "element" && !selector) throw new Error("selector is required when screenshot scope is 'element'.");
  if (selector && Array.from(selector).length > MAX_SCREENSHOT_SELECTOR_CHARS) {
    throw new Error(`selector cannot exceed ${MAX_SCREENSHOT_SELECTOR_CHARS} characters.`);
  }
  return { scope, ...(selector ? { selector } : {}) };
}

export function normalizePageText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function paginatePageText(
  text: string,
  maxChars: number,
  start: SegmentPosition = { segmentIndex: 0, offset: 0 }
): { text: string; next: SegmentPosition | null } {
  const page = paginateSegments(splitTextAtNewlines(text), maxChars, SERVER_PAGE_MAX_CHARS, start, {
    limit: `max_chars must be a positive integer no greater than ${SERVER_PAGE_MAX_CHARS}.`,
    position: "Invalid page cursor: invalid text position.",
    outside: "Invalid page cursor: text position is outside the current page content.",
    offset: "Invalid page cursor: text offset is outside the current page content.",
  });
  return { text: page.text, next: page.next };
}

async function extractPage(page: Page): Promise<ExtractedPage> {
  const extracted = await page.evaluate(() => {
    const root = document.querySelector("main, article, .main-content, .page-content, #content") ?? document.body;
    if (!root) return { title: document.title, text: "" };

    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(
      "script, style, nav, footer, noscript, template, .ad-container, .advertisement, [hidden], [aria-hidden='true']"
    ).forEach((element) => element.remove());
    clone.querySelectorAll("br").forEach((element) => element.replaceWith("\n"));
    clone.querySelectorAll("address, article, aside, blockquote, div, dl, fieldset, figure, figcaption, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, ol, p, pre, section, table, tr, ul")
      .forEach((element) => element.append("\n"));
    return { title: document.title, text: clone.textContent ?? "" };
  });
  return { url: page.url(), title: normalizePageText(extracted.title), text: normalizePageText(extracted.text) };
}

async function assertReadablePage(page: Page): Promise<void> {
  if (!isAllowedDdbUrl(page.url())) throw new Error("The current page is outside D&D Beyond and cannot be read.");
  if (!(await isLoggedInOnCurrentPage(page))) throw new AuthenticationRequiredError();
}

function pageEnvelope(
  operation: PageOperation,
  requestedUrl: string | null,
  extracted: ExtractedPage,
  request: Required<Pick<PageContentRequest, "maxChars">> & PageContentRequest
): PageContentEnvelope {
  const cursorPayload = request.cursor ? decodePageCursor(request.cursor) : undefined;
  const contentFingerprint = fingerprint(extracted.text);
  if (cursorPayload) {
    if (cursorPayload.url !== extracted.url) throw new Error("Page cursor does not match the current page URL; restart without a cursor.");
    if (cursorPayload.fingerprint !== contentFingerprint) {
      throw new Error("Page content changed since this cursor was issued; restart without a cursor.");
    }
  }

  const chunk = paginatePageText(extracted.text, request.maxChars, cursorPayload
    ? { segmentIndex: cursorPayload.segmentIndex, offset: cursorPayload.offset }
    : undefined);
  const nextCursor = chunk.next === null ? null : encodePageCursor({
    version: 1,
    url: extracted.url,
    maxChars: request.maxChars,
    segmentIndex: chunk.next.segmentIndex,
    offset: chunk.next.offset,
    fingerprint: contentFingerprint,
  });
  return {
    source: "dndbeyond-rendered-page",
    schemaVersion: "v1",
    operation,
    requestedUrl,
    page: { url: extracted.url, title: extracted.title },
    text: chunk.text,
    totalCharacters: codePointLength(extracted.text),
    maxChars: request.maxChars,
    nextCursor,
    done: nextCursor === null,
  };
}

export async function readPage(context: BrowserContext, input: PageContentRequest = {}): Promise<PageContentEnvelope> {
  const request = validatePageContentRequest(input);
  const page = await getPage(context);
  if (request.url !== undefined) {
    await openDomReadyPage(page, request.url, 30_000);
    if (!isAllowedDdbUrl(page.url())) throw new Error("Navigation redirected outside D&D Beyond and was blocked.");
    await assertReadablePage(page);
    await waitForRenderedContent(page, "main, article, .main-content, .page-content, #content, body", 10_000);
  }
  await assertReadablePage(page);
  return pageEnvelope(
    request.url === undefined ? "current_page" : "navigate",
    request.url ?? null,
    await extractPage(page),
    request
  );
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("Playwright returned screenshot bytes without a valid PNG signature.");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function assertScreenshotBounds(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
      width > MAX_SCREENSHOT_DIMENSION || height > MAX_SCREENSHOT_DIMENSION || width * height > MAX_SCREENSHOT_PIXELS) {
    throw new Error(
      `Screenshot dimensions must not exceed ${MAX_SCREENSHOT_DIMENSION}x${MAX_SCREENSHOT_DIMENSION} or ${MAX_SCREENSHOT_PIXELS} total pixels.`
    );
  }
}

export async function capturePageScreenshot(
  context: BrowserContext,
  request: PageScreenshotRequest = {}
): Promise<PageScreenshotResult> {
  const validated = validatePageScreenshotRequest(request);
  const page = await getPage(context);
  await assertReadablePage(page);

  let bytes: Buffer;
  if (validated.scope === "element") {
    const locator = page.locator(validated.selector!);
    const count = await locator.count();
    if (count !== 1) throw new Error(`Element screenshot selector must match exactly one element; matched ${count}.`);
    if (!(await locator.isVisible())) throw new Error("Element screenshot target is not visible.");
    const box = await locator.boundingBox();
    if (!box) throw new Error("Element screenshot target has no visible bounding box.");
    assertScreenshotBounds(Math.ceil(box.width), Math.ceil(box.height));
    bytes = await locator.screenshot({ type: "png" });
  } else {
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assertScreenshotBounds(viewport.width, viewport.height);
    bytes = await page.screenshot({ type: "png", fullPage: false });
  }

  if (bytes.length > MAX_SCREENSHOT_BYTES) throw new Error(`Screenshot exceeds the ${MAX_SCREENSHOT_BYTES} byte limit.`);
  const { width, height } = pngDimensions(bytes);
  assertScreenshotBounds(width, height);
  return {
    metadata: {
      source: "dndbeyond-page-screenshot",
      schemaVersion: "v1",
      url: page.url(),
      title: normalizePageText(await page.title()),
      scope: validated.scope,
      selector: validated.selector ?? null,
      width,
      height,
      mimeType: "image/png",
      byteCount: bytes.length,
    },
    bytes,
  };
}
