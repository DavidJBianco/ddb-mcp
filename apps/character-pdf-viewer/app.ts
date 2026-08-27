import { App } from "@modelcontextprotocol/ext-apps";
import * as pdfjs from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import { element, installHostTheming, toolResultError, ViewerShell } from "../viewer/shell.js";
import "../viewer/shell.css";
import "./styles.css";

type PdfMetadata = {
  url: string;
  title: string;
  filename: string;
  mimeType: "application/pdf";
  totalBytes: number;
  sha256: string;
  initialPage: 1;
};

type PdfRange = {
  url: string;
  bytes: string;
  offset: number;
  byteCount: number;
  totalBytes: number;
  hasMore: boolean;
};

type PdfRectangle = [number, number, number, number];
type SearchMatch = { page: number; occurrence: number; rect?: PdfRectangle };
type SearchableWidget = { text: string; rect: PdfRectangle };

type EmbeddedPdf = {
  encoding: "gzip+base64";
  data: string;
  originalBytes: number;
  compressedBytes: number;
  sha256: string;
};

const MAX_CONTEXT_CHARS = 15_000;
const PDF_CHUNK_BYTES = 512 * 1024;
const ZOOM_MIN = .5;
const ZOOM_MAX = 3;
const app = new App({ name: "Mysterium PDF Viewer", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
const shell = new ViewerShell(app, "Character Sheet");

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;
const standardFontDataUrl = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`;

const searchPanel = element("form", "pdf-search");
searchPanel.id = "pdf-search";
searchPanel.hidden = true;
const searchInput = element("input");
searchInput.id = "pdf-search-input";
searchInput.type = "search";
searchInput.placeholder = "Search this PDF";
searchInput.setAttribute("aria-label", "Search this PDF");
const searchCount = element("output", "pdf-search-count", "");
searchCount.id = "pdf-search-count";
searchCount.setAttribute("aria-live", "polite");
const searchPrevious = element("button", "", "Previous");
searchPrevious.type = "button";
searchPrevious.id = "pdf-search-previous";
const searchNext = element("button", "", "Next");
searchNext.type = "button";
searchNext.id = "pdf-search-next";
const searchClose = element("button", "", "Close");
searchClose.type = "button";
searchClose.id = "pdf-search-close";
searchPanel.append(searchInput, searchCount, searchPrevious, searchNext, searchClose);

const stage = element("div", "pdf-stage");
stage.id = "pdf-stage";
stage.hidden = true;
const pageContainer = element("div", "pdf-page-container");
const pageElement = element("div", "pdf-page");
pageElement.id = "pdf-page";
const canvas = element("canvas");
canvas.id = "pdf-canvas";
const textLayerElement = element("div", "textLayer pdf-text-layer");
textLayerElement.id = "pdf-text-layer";
const linkLayerElement = element("div", "pdf-link-layer");
linkLayerElement.id = "pdf-link-layer";
pageElement.append(canvas, textLayerElement, linkLayerElement);
pageContainer.append(pageElement);
stage.append(pageContainer);
shell.content.prepend(searchPanel);
shell.content.append(stage);

const pageInput = element("input", "pdf-page-input");
pageInput.id = "pdf-page-input";
pageInput.type = "number";
pageInput.min = "1";
pageInput.value = "1";
pageInput.setAttribute("aria-label", "Page number");
const pageTotal = element("span", "pdf-page-total", "of 0");
pageTotal.id = "pdf-page-total";
const pageControl = element("span", "pdf-toolbar-group");
pageControl.append(pageInput, pageTotal);
const zoomLevel = element("output", "pdf-zoom-level", "100%");
zoomLevel.id = "pdf-zoom-level";
zoomLevel.setAttribute("aria-live", "polite");

let metadata: PdfMetadata | null = null;
let pdfBytes: Uint8Array | null = null;
let documentProxy: pdfjs.PDFDocumentProxy | null = null;
let currentLoadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
let currentPage = 1;
let scale = 1;
let userHasZoomed = false;
let currentRenderTask: pdfjs.RenderTask | null = null;
let currentTextLayer: TextLayer | null = null;
let loadGeneration = 0;
let renderGeneration = 0;
let pageTextCache = new Map<number, string>();
let pageWidgetCache = new Map<number, SearchableWidget[]>();
let searchMatches: SearchMatch[] = [];
let searchMatchIndex = -1;
let searchQuery = "";
let resizeTimer: number | undefined;
let contextTimer: number | undefined;

function isPdfMetadata(value: unknown): value is PdfMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PdfMetadata>;
  return typeof item.url === "string" && typeof item.title === "string" &&
    typeof item.filename === "string" && item.mimeType === "application/pdf" &&
    Number.isSafeInteger(item.totalBytes) && (item.totalBytes ?? 0) > 0 &&
    typeof item.sha256 === "string" && /^[a-f0-9]{64}$/.test(item.sha256) && item.initialPage === 1;
}

function isPdfRange(value: unknown): value is PdfRange {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PdfRange>;
  return typeof item.url === "string" && typeof item.bytes === "string" &&
    Number.isSafeInteger(item.offset) && (item.offset ?? -1) >= 0 &&
    Number.isSafeInteger(item.byteCount) && (item.byteCount ?? -1) >= 0 &&
    Number.isSafeInteger(item.totalBytes) && (item.totalBytes ?? 0) > 0 && typeof item.hasMore === "boolean";
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function appPrivatePdf(value: unknown): EmbeddedPdf | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as { pdf?: unknown };
  if (meta.pdf === undefined) return null;
  if (!meta.pdf || typeof meta.pdf !== "object") throw new Error("The embedded PDF metadata is invalid.");
  const pdf = meta.pdf as Partial<EmbeddedPdf>;
  if (pdf.encoding !== "gzip+base64" || typeof pdf.data !== "string" ||
      !Number.isSafeInteger(pdf.originalBytes) || (pdf.originalBytes ?? 0) <= 0 ||
      !Number.isSafeInteger(pdf.compressedBytes) || (pdf.compressedBytes ?? 0) <= 0 ||
      typeof pdf.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(pdf.sha256)) {
    throw new Error("The embedded PDF metadata is invalid.");
  }
  return pdf as EmbeddedPdf;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

async function sha256(bytes: Uint8Array): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validatePdfBytes(bytes: Uint8Array, next: PdfMetadata): Promise<void> {
  if (bytes.length !== next.totalBytes) throw new Error("The loaded PDF length did not match its metadata.");
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The loaded file did not have a valid PDF signature.");
  const digest = await sha256(bytes);
  if (digest !== null && digest !== next.sha256) throw new Error("The loaded PDF did not match its expected SHA-256 digest.");
}

async function readEmbeddedPdf(embedded: EmbeddedPdf, next: PdfMetadata, generation: number): Promise<Uint8Array> {
  if (embedded.originalBytes !== next.totalBytes || embedded.sha256 !== next.sha256) {
    throw new Error("The embedded PDF metadata did not match the document.");
  }
  shell.setStatus(`Restoring ${next.filename}…`);
  let compressed: Uint8Array;
  try {
    compressed = decodeBase64(embedded.data);
  } catch {
    throw new Error("The embedded PDF data was not valid Base64.");
  }
  if (compressed.length !== embedded.compressedBytes) throw new Error("The embedded PDF compressed length did not match its metadata.");
  let bytes: Uint8Array;
  try {
    const stream = new Blob([Uint8Array.from(compressed).buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error("The embedded PDF could not be decompressed.");
  }
  if (generation !== loadGeneration) throw new Error("PDF load was superseded.");
  await validatePdfBytes(bytes, next);
  return bytes;
}

async function readPdfBytes(next: PdfMetadata, generation: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(next.totalBytes);
  let offset = 0;
  while (offset < next.totalBytes) {
    shell.setStatus(`Loading ${next.filename}… ${Math.floor(offset / next.totalBytes * 100)}%`);
    const result = await app.callServerTool({
      name: "read_pdf_bytes",
      arguments: { url: next.url, offset, byteCount: PDF_CHUNK_BYTES },
    });
    if (generation !== loadGeneration) throw new Error("PDF load was superseded.");
    if (result.isError) throw new Error(toolResultError(result, "The PDF byte reader returned an unspecified error."));
    if (!isPdfRange(result.structuredContent)) throw new Error("The PDF byte reader returned invalid structured data.");
    const range = result.structuredContent;
    if (range.url !== next.url || range.offset !== offset || range.totalBytes !== next.totalBytes) {
      throw new Error("The PDF byte reader returned an inconsistent range.");
    }
    const chunk = decodeBase64(range.bytes);
    if (chunk.length !== range.byteCount || chunk.length === 0 || offset + chunk.length > bytes.length) {
      throw new Error("The PDF byte reader returned an invalid chunk length.");
    }
    bytes.set(chunk, offset);
    offset += chunk.length;
    if (range.hasMore !== (offset < next.totalBytes)) throw new Error("The PDF byte reader returned inconsistent continuation metadata.");
  }
  await validatePdfBytes(bytes, next);
  return bytes;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function searchComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\u00ad\u200b-\u200d\u2060\ufeff]/gu, "");
}

async function renderLinks(page: pdfjs.PDFPageProxy, viewport: pdfjs.PageViewport): Promise<void> {
  linkLayerElement.replaceChildren();
  const annotations = await page.getAnnotations({ intent: "display" });
  for (const annotation of annotations) {
    const url = safeHttpUrl((annotation as { url?: unknown }).url);
    const rect = (annotation as { rect?: unknown }).rect;
    if (!url || !Array.isArray(rect) || rect.length !== 4 || !rect.every((value) => typeof value === "number")) continue;
    const first = viewport.convertToViewportPoint(rect[0], rect[1]);
    const second = viewport.convertToViewportPoint(rect[2], rect[3]);
    const left = Math.min(first[0], second[0]);
    const top = Math.min(first[1], second[1]);
    const anchor = element("a");
    anchor.href = url;
    anchor.title = url;
    anchor.setAttribute("aria-label", `Open link: ${url}`);
    anchor.style.left = `${left}px`;
    anchor.style.top = `${top}px`;
    anchor.style.width = `${Math.abs(second[0] - first[0])}px`;
    anchor.style.height = `${Math.abs(second[1] - first[1])}px`;
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      if (app.getHostCapabilities()?.openLinks) void app.openLink({ url });
      else window.open(url, "_blank", "noopener,noreferrer");
    });
    linkLayerElement.append(anchor);
  }
}

function highlightSearchMatches(viewport: pdfjs.PageViewport): void {
  const query = searchQuery.trim().toLocaleLowerCase();
  if (!query) return;
  const target = searchMatches[searchMatchIndex];
  if (target?.page === currentPage && target.rect) {
    const first = viewport.convertToViewportPoint(target.rect[0], target.rect[1]);
    const second = viewport.convertToViewportPoint(target.rect[2], target.rect[3]);
    const highlight = element("div", "pdf-form-search-hit");
    highlight.title = "Search match in form field";
    highlight.style.left = `${Math.min(first[0], second[0])}px`;
    highlight.style.top = `${Math.min(first[1], second[1])}px`;
    highlight.style.width = `${Math.abs(second[0] - first[0])}px`;
    highlight.style.height = `${Math.abs(second[1] - first[1])}px`;
    linkLayerElement.append(highlight);
    return;
  }
  for (const span of textLayerElement.querySelectorAll<HTMLSpanElement>("span")) {
    const text = span.textContent ?? "";
    const lower = text.toLocaleLowerCase();
    if (!lower.includes(query)) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (;;) {
      const match = lower.indexOf(query, offset);
      if (match < 0) break;
      fragment.append(document.createTextNode(text.slice(offset, match)));
      fragment.append(element("mark", "", text.slice(match, match + query.length)));
      offset = match + query.length;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    span.replaceChildren(fragment);
  }

  // PDF generators may split words into separate text-layer spans, including
  // one span per glyph. Highlight the active match across those boundaries.
  if (!target || target.page !== currentPage) return;
  const needle = searchComparable(query);
  if (!needle) return;
  const positions: Array<{ span: HTMLSpanElement; offset: number }> = [];
  let haystack = "";
  for (const span of textLayerElement.querySelectorAll<HTMLSpanElement>("span")) {
    const text = span.textContent ?? "";
    for (let offset = 0; offset < text.length; offset += 1) {
      const normalized = text[offset].normalize("NFKC").toLocaleLowerCase();
      if (searchComparable(normalized) === "") continue;
      for (const character of normalized) {
        haystack += character;
        positions.push({ span, offset });
      }
    }
  }
  let start = -1;
  let from = 0;
  for (let occurrence = 0; occurrence <= target.occurrence; occurrence += 1) {
    start = haystack.indexOf(needle, from);
    if (start < 0) return;
    from = start + Math.max(1, needle.length);
  }
  const ranges = new Map<HTMLSpanElement, { start: number; end: number }>();
  for (const position of positions.slice(start, start + needle.length)) {
    const range = ranges.get(position.span);
    if (range) {
      range.start = Math.min(range.start, position.offset);
      range.end = Math.max(range.end, position.offset + 1);
    } else ranges.set(position.span, { start: position.offset, end: position.offset + 1 });
  }
  for (const [span, range] of ranges) {
    if (span.querySelector("mark")) continue;
    const text = span.textContent ?? "";
    span.replaceChildren(
      document.createTextNode(text.slice(0, range.start)),
      element("mark", "", text.slice(range.start, range.end)),
      document.createTextNode(text.slice(range.end)),
    );
  }
}

async function pageText(pageNumber: number): Promise<string> {
  const cached = pageTextCache.get(pageNumber);
  if (cached !== undefined) return cached;
  if (!documentProxy) return "";
  const page = await documentProxy.getPage(pageNumber);
  const content = await page.getTextContent();
  let text = "";
  let previous: { x: number; y: number; width: number; height: number; hasEOL: boolean; text: string } | null = null;
  for (const value of content.items) {
    if (!("str" in value)) continue;
    const x = value.transform[4];
    const y = value.transform[5];
    const height = Math.max(1, Math.hypot(value.transform[2], value.transform[3]));
    if (previous && !/\s$/u.test(previous.text) && !/^\s/u.test(value.str)) {
      const lineChanged = previous.hasEOL || Math.abs(y - previous.y) > Math.max(height, previous.height) * .5;
      const horizontalGap = x - (previous.x + previous.width);
      if (lineChanged || horizontalGap > Math.max(height, previous.height) * .15) text += " ";
    }
    text += value.str;
    previous = { x, y, width: value.width, height, hasEOL: value.hasEOL, text: value.str };
  }
  text = text.normalize("NFKC").replace(/\u00ad/gu, "").replace(/\s+/gu, " ").trim();
  pageTextCache.set(pageNumber, text);
  return text;
}

async function pageWidgets(pageNumber: number): Promise<SearchableWidget[]> {
  const cached = pageWidgetCache.get(pageNumber);
  if (cached) return cached;
  if (!documentProxy) return [];
  const page = await documentProxy.getPage(pageNumber);
  const annotations = await page.getAnnotations({ intent: "display" });
  const widgets: SearchableWidget[] = [];
  for (const annotation of annotations) {
    const item = annotation as {
      subtype?: unknown;
      fieldName?: unknown;
      fieldValue?: unknown;
      alternativeText?: unknown;
      rect?: unknown;
    };
    if (item.subtype !== "Widget" || !Array.isArray(item.rect) || item.rect.length !== 4 ||
        !item.rect.every((value) => typeof value === "number")) continue;
    const values = Array.isArray(item.fieldValue) ? item.fieldValue : [item.fieldValue];
    const text = [item.alternativeText, item.fieldName, ...values]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .normalize("NFKC");
    if (text) widgets.push({ text, rect: item.rect as PdfRectangle });
  }
  pageWidgetCache.set(pageNumber, widgets);
  return widgets;
}

function updateControls(): void {
  const pageCount = documentProxy?.numPages ?? 0;
  pageInput.value = String(currentPage);
  pageInput.max = String(pageCount || 1);
  pageTotal.textContent = `of ${pageCount}`;
  zoomLevel.value = `${Math.round(scale * 100)}%`;
  shell.setActionEnabled("previous-page", currentPage > 1);
  shell.setActionEnabled("next-page", currentPage < pageCount);
  shell.setActionEnabled("zoom-out", scale > ZOOM_MIN);
  shell.setActionEnabled("zoom-in", scale < ZOOM_MAX);
}

async function updateModelContext(): Promise<void> {
  if (!metadata || !documentProxy || !app.getHostCapabilities()?.updateModelContext) return;
  const text = await pageText(currentPage);
  const selection = document.getSelection()?.toString().trim();
  const detail = selection ? `\n\nSelected text:\n${selection.slice(0, 4_000)}` : "";
  await app.updateModelContext({
    content: [{
      type: "text",
      text: `PDF viewer | ${metadata.title} | Page ${currentPage} of ${documentProxy.numPages}\n\n${text.slice(0, MAX_CONTEXT_CHARS - detail.length)}${detail}`,
    }],
  }).catch(() => undefined);
}

function scheduleContextUpdate(): void {
  window.clearTimeout(contextTimer);
  contextTimer = window.setTimeout(() => void updateModelContext(), 150);
}

async function renderCurrentPage(): Promise<void> {
  if (!documentProxy) return;
  const generation = ++renderGeneration;
  currentRenderTask?.cancel();
  currentRenderTask = null;
  currentTextLayer?.cancel();
  currentTextLayer = null;
  const page = await documentProxy.getPage(currentPage);
  if (generation !== renderGeneration) return;
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  pageElement.style.width = `${viewport.width}px`;
  pageElement.style.height = `${viewport.height}px`;
  textLayerElement.style.setProperty("--scale-factor", String(scale));
  textLayerElement.replaceChildren();
  linkLayerElement.replaceChildren();
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The PDF canvas could not be initialized.");
  const task = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  });
  currentRenderTask = task;
  try {
    await task.promise;
  } catch (error) {
    if (error instanceof Error && error.name === "RenderingCancelledException") return;
    throw error;
  } finally {
    if (currentRenderTask === task) currentRenderTask = null;
  }
  if (generation !== renderGeneration) return;
  const textLayer = new TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: true }),
    container: textLayerElement,
    viewport,
  });
  currentTextLayer = textLayer;
  await Promise.all([textLayer.render(), renderLinks(page, viewport)]);
  if (generation !== renderGeneration) return;
  highlightSearchMatches(viewport);
  updateControls();
  scheduleContextUpdate();
}

async function goToPage(pageNumber: number): Promise<void> {
  if (!documentProxy) return;
  const bounded = Math.max(1, Math.min(documentProxy.numPages, Math.trunc(pageNumber)));
  if (bounded === currentPage && !currentRenderTask) {
    updateControls();
    return;
  }
  currentPage = bounded;
  await renderCurrentPage();
}

async function setZoom(next: number, manual = true): Promise<void> {
  const bounded = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 100) / 100));
  if (Math.abs(bounded - scale) < .005) return;
  scale = bounded;
  if (manual) userHasZoomed = true;
  await renderCurrentPage();
}

async function fitPage(): Promise<void> {
  if (!documentProxy || userHasZoomed || pageContainer.clientWidth <= 0) return;
  const page = await documentProxy.getPage(currentPage);
  const natural = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(1, shell.content.clientWidth - 44);
  const fullscreen = shell.root.classList.contains("fullscreen");
  const availableHeight = Math.max(1, window.innerHeight - shell.toolbar.offsetHeight - 52);
  const fitted = fullscreen
    ? Math.min(ZOOM_MAX, availableWidth / natural.width, availableHeight / natural.height)
    : Math.min(1, availableWidth / natural.width);
  await setZoom(fitted, false);
}

async function runSearch(direction = 1): Promise<void> {
  if (!documentProxy) return;
  const query = searchInput.value.trim().toLocaleLowerCase();
  const comparableQuery = searchComparable(query);
  if (!comparableQuery) {
    searchQuery = "";
    searchMatches = [];
    searchMatchIndex = -1;
    searchCount.value = "";
    await renderCurrentPage();
    return;
  }
  if (query !== searchQuery) {
    searchQuery = query;
    searchMatches = [];
    searchCount.value = "Searching…";
    let searchableCharacters = 0;
    for (let page = 1; page <= documentProxy.numPages; page += 1) {
      const text = searchComparable(await pageText(page));
      searchableCharacters += text.length;
      let offset = 0;
      let occurrence = 0;
      while ((offset = text.indexOf(comparableQuery, offset)) >= 0) {
        searchMatches.push({ page, occurrence: occurrence++ });
        offset += Math.max(1, comparableQuery.length);
      }
      for (const widget of await pageWidgets(page)) {
        const widgetText = searchComparable(widget.text);
        searchableCharacters += widgetText.length;
        let widgetOffset = 0;
        let widgetOccurrence = 0;
        while ((widgetOffset = widgetText.indexOf(comparableQuery, widgetOffset)) >= 0) {
          searchMatches.push({ page, occurrence: widgetOccurrence++, rect: widget.rect });
          widgetOffset += Math.max(1, comparableQuery.length);
        }
      }
    }
    searchMatchIndex = direction < 0 ? searchMatches.length - 1 : 0;
    if (searchableCharacters === 0) {
      searchCount.value = "No searchable text";
      await renderCurrentPage();
      return;
    }
  } else if (searchMatches.length) {
    searchMatchIndex = (searchMatchIndex + direction + searchMatches.length) % searchMatches.length;
  }
  searchCount.value = searchMatches.length ? `${searchMatchIndex + 1} of ${searchMatches.length}` : "No matches";
  if (searchMatches.length) {
    const targetPage = searchMatches[searchMatchIndex].page;
    if (targetPage === currentPage) await renderCurrentPage();
    else await goToPage(targetPage);
  } else await renderCurrentPage();
}

async function downloadPdf(): Promise<void> {
  if (!metadata || !pdfBytes) return;
  if (app.getHostCapabilities()?.downloadFile) {
    const result = await app.downloadFile({ contents: [{
      type: "resource",
      resource: {
        uri: `file:///${encodeURIComponent(metadata.filename)}`,
        mimeType: "application/pdf",
        blob: encodeBase64(pdfBytes),
      },
    }] });
    shell.toast(result.isError ? "Download cancelled" : "Download ready");
    return;
  }
  const blob = new Blob([Uint8Array.from(pdfBytes).buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = element("a");
  anchor.href = url;
  anchor.download = metadata.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  shell.toast("Download ready");
}

async function loadPdf(next: PdfMetadata, embedded: EmbeddedPdf | null): Promise<void> {
  const generation = ++loadGeneration;
  renderGeneration += 1;
  stage.hidden = true;
  searchPanel.hidden = true;
  shell.setStatus(`Loading ${next.filename}…`);
  shell.setTitle(next.title);
  shell.setActionEnabled("download-pdf", false);
  currentRenderTask?.cancel();
  currentTextLayer?.cancel();
  await currentLoadingTask?.destroy();
  currentLoadingTask = null;
  documentProxy = null;
  pdfBytes = null;
  metadata = next;
  pageTextCache = new Map();
  pageWidgetCache = new Map();
  searchMatches = [];
  searchMatchIndex = -1;
  searchQuery = "";
  userHasZoomed = false;
  scale = 1;
  currentPage = next.initialPage;

  const bytes = embedded
    ? await readEmbeddedPdf(embedded, next, generation)
    : await readPdfBytes(next, generation);
  if (generation !== loadGeneration) return;
  // PDF.js transfers its input buffer to the worker. Keep a distinct copy for
  // the viewer's original-file download action.
  const downloadBytes = Uint8Array.from(bytes);
  const loadingTask = pdfjs.getDocument({ data: bytes, standardFontDataUrl });
  currentLoadingTask = loadingTask;
  const loaded = await loadingTask.promise;
  if (generation !== loadGeneration) {
    await loadingTask.destroy();
    return;
  }
  pdfBytes = downloadBytes;
  documentProxy = loaded;
  currentPage = Math.min(next.initialPage, loaded.numPages);
  stage.hidden = false;
  shell.clearStatus();
  shell.setActionEnabled("download-pdf", true);
  await fitPage();
  await renderCurrentPage();
}

shell.addAction({ id: "previous-page", label: "←", title: "Previous page", run: () => goToPage(currentPage - 1) });
shell.addControl(pageControl);
shell.addAction({ id: "next-page", label: "→", title: "Next page", run: () => goToPage(currentPage + 1) });
shell.addAction({ id: "zoom-out", label: "−", title: "Zoom out", run: () => setZoom(scale - .1) });
shell.addControl(zoomLevel);
shell.addAction({ id: "zoom-in", label: "+", title: "Zoom in", run: () => setZoom(scale + .1) });
shell.addAction({ id: "search-pdf", label: "Search", run: () => {
  searchPanel.hidden = !searchPanel.hidden;
  if (!searchPanel.hidden) searchInput.focus();
} });
shell.addAction({ id: "download-pdf", label: "Download PDF", run: downloadPdf });
for (const id of ["previous-page", "next-page", "zoom-out", "zoom-in", "download-pdf"]) shell.setActionEnabled(id, false);

pageInput.addEventListener("change", () => void goToPage(Number(pageInput.value)));
searchPanel.addEventListener("submit", (event) => { event.preventDefault(); void runSearch(1); });
searchPrevious.addEventListener("click", () => void runSearch(-1));
searchNext.addEventListener("click", () => void runSearch(1));
searchClose.addEventListener("click", () => { searchPanel.hidden = true; });
document.addEventListener("selectionchange", scheduleContextUpdate);
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "ArrowLeft" || event.key === "PageUp") void goToPage(currentPage - 1);
  else if (event.key === "ArrowRight" || event.key === "PageDown") void goToPage(currentPage + 1);
  else if ((event.ctrlKey || event.metaKey) && (event.key === "+" || event.key === "=")) {
    event.preventDefault();
    void setZoom(scale + .1);
  } else if ((event.ctrlKey || event.metaKey) && event.key === "-") {
    event.preventDefault();
    void setZoom(scale - .1);
  }
});

const resizeObserver = new ResizeObserver(() => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => void fitPage(), 80);
});
resizeObserver.observe(shell.content);

app.ontoolresult = (result) => {
  if (result.isError) {
    shell.setStatus(toolResultError(result, "The PDF viewer could not be opened."), true);
    return;
  }
  if (!isPdfMetadata(result.structuredContent)) {
    shell.setStatus("The PDF viewer received invalid document metadata.", true);
    return;
  }
  let embedded: EmbeddedPdf | null;
  try {
    embedded = appPrivatePdf(result._meta);
  } catch (error) {
    shell.setStatus(error instanceof Error ? error.message : "The embedded PDF metadata is invalid.", true);
    return;
  }
  void loadPdf(result.structuredContent, embedded).catch((error) => {
    if (error instanceof Error && error.message === "PDF load was superseded.") return;
    shell.setStatus(error instanceof Error ? error.message : "The PDF could not be loaded.", true);
  });
};

installHostTheming(app, shell);
app.onteardown = async () => {
  loadGeneration += 1;
  renderGeneration += 1;
  resizeObserver.disconnect();
  currentRenderTask?.cancel();
  currentTextLayer?.cancel();
  await currentLoadingTask?.destroy();
  currentLoadingTask = null;
  documentProxy = null;
  return {};
};

void app.connect().then(() => shell.applyHostContext(app.getHostContext())).catch((error) => {
  shell.setStatus(error instanceof Error ? error.message : "The PDF viewer could not connect to its host.", true);
});
