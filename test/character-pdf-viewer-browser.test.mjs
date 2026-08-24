import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { chromium } from "playwright";

const viewer = await readFile(new URL("../dist/apps/character-pdf-viewer.html", import.meta.url), "utf8");
const pdf = await readFile(new URL("fixtures/synthetic-character-sheet.pdf", import.meta.url));
const multiPagePdf = await readFile(new URL("fixtures/synthetic-multipage-search.pdf", import.meta.url));
const metadata = {
  url: "mysterium://character-pdf/browser/synthetic-character-sheet.pdf",
  title: "Synthetic Character Sheet",
  filename: "synthetic-character-sheet.pdf",
  mimeType: "application/pdf",
  totalBytes: pdf.length,
  sha256: createHash("sha256").update(pdf).digest("hex"),
  initialPage: 1,
};
const compressedPdf = gzipSync(pdf, { level: 9 });
const embeddedPdf = embeddedFor(pdf, metadata, compressedPdf);

function metadataFor(bytes, filename, title = filename) {
  return {
    url: `mysterium://character-pdf/browser/${filename}`,
    title,
    filename,
    mimeType: "application/pdf",
    totalBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    initialPage: 1,
  };
}

function embeddedFor(bytes, documentMetadata, compressed = gzipSync(bytes, { level: 9 })) {
  return {
    encoding: "gzip+base64",
    data: compressed.toString("base64"),
    originalBytes: bytes.length,
    compressedBytes: compressed.length,
    sha256: documentMetadata.sha256,
  };
}

async function openViewer(page, {
  byteError,
  delayFirstRange = false,
  embedded = null,
  documentBytes = pdf,
  documentMetadata = metadata,
  hostCapabilities = { openLinks: {}, downloadFile: {}, serverTools: {}, sandbox: { permissions: { clipboardWrite: {} } } },
  hostContext = { theme: "light", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] },
} = {}) {
  await page.setContent('<!doctype html><iframe id="viewer" style="width:100%;height:900px;border:0"></iframe>');
  await page.evaluate(({ metadata, pdfBase64, byteError, delayFirstRange, embedded, hostCapabilities, hostContext }) => {
    window.hostMessages = [];
    window.rangeCalls = 0;
    const bytes = Uint8Array.from(atob(pdfBase64), (value) => value.charCodeAt(0));
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      window.hostMessages.push(message);
      const reply = (result) => event.source.postMessage({ jsonrpc: "2.0", id: message.id, result }, "*");
      if (message.method === "ui/initialize") {
        reply({
          protocolVersion: "2026-01-26",
          hostInfo: { name: "Synthetic MCP App Host", version: "1.0.0" },
          hostCapabilities,
          hostContext,
        });
      } else if (message.method === "ui/notifications/initialized") {
        event.source.postMessage({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            content: [{ type: "text", text: "Ready" }],
            structuredContent: metadata,
            ...(embedded ? { _meta: { pdf: embedded } } : {}),
          },
        }, "*");
      } else if (message.method === "tools/call") {
        window.rangeCalls += 1;
        if (byteError) {
          reply({ content: [{ type: "text", text: byteError }], isError: true });
          return;
        }
        const offset = message.params.arguments.offset;
        const byteCount = message.params.arguments.byteCount;
        const chunk = bytes.slice(offset, Math.min(offset + byteCount, bytes.length));
        let binary = "";
        for (const value of chunk) binary += String.fromCharCode(value);
        const result = {
          content: [{ type: "text", text: "Synthetic PDF bytes" }],
          structuredContent: {
            url: metadata.url,
            bytes: btoa(binary),
            offset,
            byteCount: chunk.length,
            totalBytes: bytes.length,
            hasMore: offset + chunk.length < bytes.length,
          },
        };
        if (delayFirstRange && window.rangeCalls === 1) setTimeout(() => reply(result), 120);
        else reply(result);
      } else if (message.method === "ui/request-display-mode") {
        reply({ mode: message.params.mode });
      } else if (message.method === "ui/download-file" || message.method === "ui/open-link") {
        reply({});
      }
    });
  }, {
    metadata: documentMetadata,
    pdfBase64: documentBytes.toString("base64"),
    byteError,
    delayFirstRange,
    embedded,
    hostCapabilities,
    hostContext,
  });
  await page.locator("#viewer").evaluate((iframe, source) => { iframe.srcdoc = source; }, viewer);
  return page.frameLocator("#viewer");
}

test("the PDF viewer restores app-private gzip bytes without calling the byte reader", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const frame = await openViewer(page, { embedded: embeddedPdf, byteError: "The byte reader must not be called." });

  await frame.locator("#pdf-canvas").evaluate((canvas) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const poll = () => canvas.width > 0 ? resolve() : Date.now() > deadline ? reject(new Error("Embedded PDF did not render")) : setTimeout(poll, 25);
    poll();
  }));
  assert.equal(await page.evaluate(() => window.rangeCalls), 0);
  await frame.locator("#pdf-text-layer", { hasText: "MYSTERIUM CHARACTER PDF TEST" }).waitFor();
});

test("the PDF viewer rejects corrupt app-private gzip bytes without exposing a stale document", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const corrupt = { ...embeddedPdf, data: Buffer.from("not gzip").toString("base64"), compressedBytes: 8 };
  const frame = await openViewer(page, { embedded: corrupt });

  await frame.locator("#status.error").waitFor();
  assert.equal(await frame.locator("#status").textContent(), "The embedded PDF could not be decompressed.");
  assert.equal(await page.evaluate(() => window.rangeCalls), 0);
  assert.equal(await frame.locator("#download-pdf").isDisabled(), true);
});

test("the PDF viewer searches fragmented text and navigates a multi-page document", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 980, height: 940 } });
  const documentMetadata = metadataFor(multiPagePdf, "synthetic-multipage-search.pdf", "Multi-page Search Fixture");
  const frame = await openViewer(page, { documentBytes: multiPagePdf, documentMetadata });

  await frame.locator("#pdf-page-total", { hasText: "of 3" }).waitFor();
  assert.equal(await frame.locator("#previous-page").isDisabled(), true);
  assert.equal(await frame.locator("#next-page").isDisabled(), false);
  await frame.locator("#next-page").click();
  await frame.locator("#pdf-page-input").waitFor();
  assert.equal(await frame.locator("#pdf-page-input").inputValue(), "2");
  assert.equal(await frame.locator("#previous-page").isDisabled(), false);
  await frame.locator("#pdf-page-input").fill("3");
  await frame.locator("#pdf-page-input").blur();
  await frame.locator("#pdf-text-layer", { hasText: "THIRD PAGE FINAL TARGET" }).waitFor();
  assert.equal(await frame.locator("#next-page").isDisabled(), true);
  await frame.locator("body").press("ArrowLeft");
  await frame.locator("#pdf-text-layer", { hasText: "SECOND PAGE ARCANE SEARCH TARGET" }).waitFor();

  await frame.locator("#search-pdf").click();
  await frame.locator("#pdf-search-input").fill("Arcane Recovery");
  await frame.locator("#pdf-search-input").press("Enter");
  await frame.locator("#pdf-search-count", { hasText: "1 of 2" }).waitFor();
  assert.equal(await frame.locator("#pdf-page-input").inputValue(), "2");
  assert.ok(await frame.locator("#pdf-text-layer mark").count() > 1, "fragmented active match is highlighted across spans");
  await frame.locator("#pdf-search-next").click();
  await frame.locator("#pdf-search-count", { hasText: "2 of 2" }).waitFor();

  await frame.locator("#pdf-search-input").fill("A r c a n e R e c o v e r y");
  await frame.locator("#pdf-search-input").press("Enter");
  await frame.locator("#pdf-search-count", { hasText: "1 of 2" }).waitFor();
  assert.ok(await frame.locator("#pdf-text-layer mark").count() > 1);

  await frame.locator("#pdf-search-input").fill("FINAL TARGET");
  await frame.locator("#pdf-search-input").press("Enter");
  await frame.locator("#pdf-search-count", { hasText: "1 of 1" }).waitFor();
  await frame.locator("#pdf-text-layer", { hasText: "THIRD PAGE FINAL TARGET" }).waitFor();
  assert.equal(await frame.locator("#pdf-page-input").inputValue(), "3");

  await frame.locator("#pdf-search-input").fill("Elara Moonfall");
  await frame.locator("#pdf-search-input").press("Enter");
  await frame.locator("#pdf-search-count", { hasText: "1 of 1" }).waitFor();
  assert.equal(await frame.locator("#pdf-page-input").inputValue(), "1");
  await frame.locator(".pdf-form-search-hit").waitFor();
  assert.equal(await frame.locator(".pdf-form-search-hit").getAttribute("title"), "Search match in form field");
});

test("the PDF viewer exposes only safe embedded links through the host", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const documentMetadata = metadataFor(multiPagePdf, "synthetic-multipage-search.pdf");
  const frame = await openViewer(page, { documentBytes: multiPagePdf, documentMetadata });

  await frame.locator("#pdf-link-layer a").waitFor();
  assert.equal(await frame.locator("#pdf-link-layer a").count(), 1);
  assert.equal(await frame.locator("#pdf-link-layer a").getAttribute("href"), "https://www.dndbeyond.com/characters/123");
  await frame.locator("#pdf-link-layer a").click();
  await page.waitForFunction(() => window.hostMessages.some(({ method }) => method === "ui/open-link"));
  const messages = await page.evaluate(() => window.hostMessages);
  assert.ok(messages.some(({ method, params }) =>
    method === "ui/open-link" && params.url === "https://www.dndbeyond.com/characters/123"));
  assert.equal(messages.some(({ method, params }) => method === "ui/open-link" && params.url.startsWith("javascript:")), false);
});

test("the PDF viewer falls back to an exact Blob download when the host lacks downloads", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const frame = await openViewer(page, {
    hostCapabilities: { openLinks: {}, serverTools: {} },
  });
  await frame.locator("#pdf-text-layer", { hasText: "MYSTERIUM CHARACTER PDF TEST" }).waitFor();

  const downloadPromise = page.waitForEvent("download");
  await frame.locator("#download-pdf").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), metadata.filename);
  assert.deepEqual(await readFile(await download.path()), pdf);
  assert.equal((await page.evaluate(() => window.hostMessages)).some(({ method }) => method === "ui/download-file"), false);
});

test("the shared PDF shell follows dark, responsive, and host-driven fullscreen transitions", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 520, height: 760 } });
  const frame = await openViewer(page);
  await frame.locator("#pdf-canvas").waitFor();
  assert.equal(await frame.locator("#toolbar-title").isHidden(), true);

  await page.evaluate(() => document.querySelector("#viewer").contentWindow.postMessage({
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { theme: "dark", displayMode: "fullscreen" },
  }, "*"));
  await frame.locator("html[data-theme='dark']").waitFor();
  assert.equal(await frame.locator("#app-shell").getAttribute("class"), "viewer-shell fullscreen");

  await page.evaluate(() => document.querySelector("#viewer").contentWindow.postMessage({
    jsonrpc: "2.0",
    method: "ui/notifications/host-context-changed",
    params: { theme: "light", displayMode: "inline" },
  }, "*"));
  await frame.locator("html[data-theme='light']").waitFor();
  assert.equal((await frame.locator("#app-shell").getAttribute("class")).includes("fullscreen"), false);
});

test("the PDF viewer rejects inconsistent embedded payload metadata and non-PDF content", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const cases = [
    {
      embedded: { ...embeddedPdf, data: "%%%", compressedBytes: 1 },
      error: "The embedded PDF data was not valid Base64.",
      documentBytes: pdf,
      documentMetadata: metadata,
    },
    {
      embedded: { ...embeddedPdf, originalBytes: pdf.length + 1 },
      error: "The embedded PDF metadata did not match the document.",
      documentBytes: pdf,
      documentMetadata: metadata,
    },
    {
      embedded: { ...embeddedPdf, compressedBytes: embeddedPdf.compressedBytes + 1 },
      error: "The embedded PDF compressed length did not match its metadata.",
      documentBytes: pdf,
      documentMetadata: metadata,
    },
  ];
  const nonPdf = Buffer.from("plain text is not a PDF");
  const nonPdfMetadata = metadataFor(nonPdf, "not-a-pdf.pdf");
  cases.push({
    embedded: embeddedFor(nonPdf, nonPdfMetadata),
    error: "The loaded file did not have a valid PDF signature.",
    documentBytes: nonPdf,
    documentMetadata: nonPdfMetadata,
  });
  for (const item of cases) {
    const page = await browser.newPage();
    const frame = await openViewer(page, { ...item, byteError: "The byte reader must not be called." });
    await frame.locator("#status.error").waitFor();
    assert.equal(await frame.locator("#status").textContent(), item.error);
    assert.equal(await page.evaluate(() => window.rangeCalls), 0);
    await page.close();
  }
});

test("fresh viewer instances replay distinct embedded PDFs without crossing documents", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const documents = [
    { bytes: pdf, metadata, expected: "MYSTERIUM CHARACTER PDF TEST" },
    {
      bytes: multiPagePdf,
      metadata: metadataFor(multiPagePdf, "synthetic-multipage-search.pdf", "Distinct Multi-page PDF"),
      expected: "FRAGMENTED CHARACTER SEARCH",
    },
  ];

  for (const document of documents) {
    const page = await browser.newPage();
    const frame = await openViewer(page, {
      documentBytes: document.bytes,
      documentMetadata: document.metadata,
      embedded: embeddedFor(document.bytes, document.metadata),
      byteError: "The byte reader must not be called.",
    });
    await frame.locator("#pdf-text-layer", { hasText: document.expected }).waitFor();
    assert.equal(await frame.locator("#toolbar-title").textContent(), document.metadata.title);
    assert.equal(await page.evaluate(() => window.rangeCalls), 0);
    await page.close();
  }
});

test("the PDF viewer renders, searches, navigates, zooms, downloads, and exposes only supported actions", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 980, height: 940 } });
  const frame = await openViewer(page);

  await frame.locator("#pdf-canvas").evaluate((canvas) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const poll = () => canvas.width > 0 ? resolve() : Date.now() > deadline ? reject(new Error("PDF canvas did not render")) : setTimeout(poll, 25);
    poll();
  }));
  await page.waitForTimeout(500);
  const renderedText = await frame.locator("#pdf-text-layer").textContent();
  const renderedStatus = await frame.locator("#status").textContent();
  assert.match(renderedText ?? "", /MYSTERIUM CHARACTER PDF TEST/, `viewer status: ${renderedStatus}`);
  assert.equal(await frame.locator("#toolbar-title").textContent(), "Synthetic Character Sheet");
  assert.equal(await frame.locator("#pdf-page-total").textContent(), "of 1");
  const pageTotalBox = await frame.locator("#pdf-page-total").boundingBox();
  const nextPageBox = await frame.locator("#next-page").boundingBox();
  assert.ok(pageTotalBox && nextPageBox);
  assert.ok(nextPageBox.x - (pageTotalBox.x + pageTotalBox.width) <= 8, "Next page stays adjacent to the page count");
  const zoomOutBox = await frame.locator("#zoom-out").boundingBox();
  const zoomLevelBox = await frame.locator("#pdf-zoom-level").boundingBox();
  const zoomInBox = await frame.locator("#zoom-in").boundingBox();
  assert.ok(zoomOutBox && zoomLevelBox && zoomInBox);
  assert.ok(zoomLevelBox.x - (zoomOutBox.x + zoomOutBox.width) <= 8, "Zoom level stays adjacent to Zoom out");
  assert.ok(zoomInBox.x - (zoomLevelBox.x + zoomLevelBox.width) <= 8, "Zoom in stays adjacent to the zoom level");
  assert.equal(await frame.locator("#previous-page").isDisabled(), true);
  assert.equal(await frame.locator("#next-page").isDisabled(), true);
  assert.equal(await frame.locator("html").getAttribute("data-theme"), "light");
  assert.equal(await frame.locator("#copy-text").count(), 0);
  assert.equal(await frame.locator("#copy-json").count(), 0);
  assert.equal(await frame.locator("#copy-image").count(), 0);
  assert.equal(await frame.locator("#download-png").count(), 0);

  await frame.locator("#pdf-page-input").fill("99");
  await frame.locator("#pdf-page-input").blur();
  assert.equal(await frame.locator("#pdf-page-input").inputValue(), "1");
  const selected = await frame.locator("#pdf-text-layer span").first().evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  assert.ok(selected.length > 0);

  await frame.locator("#zoom-in").click();
  assert.match(await frame.locator("#pdf-zoom-level").textContent(), /110%/);
  await frame.locator("#search-pdf").click();
  await frame.locator("#pdf-search-input").fill("MYSTERIUM");
  await frame.locator("#pdf-search-input").press("Enter");
  await frame.locator("#pdf-search-count", { hasText: "1 of 1" }).waitFor();
  assert.ok(await frame.locator("#pdf-text-layer mark").count() >= 1);

  await frame.locator("#fullscreen").click();
  await frame.locator("#download-pdf").click();
  await frame.locator(".toast", { hasText: "Download ready" }).waitFor();
  const messages = await page.evaluate(() => window.hostMessages);
  assert.ok(messages.some(({ method, params }) => method === "ui/request-display-mode" && params.mode === "fullscreen"));
  const download = messages.find(({ method }) => method === "ui/download-file");
  assert.equal(download.params.contents[0].resource.mimeType, "application/pdf");
  assert.deepEqual(Buffer.from(download.params.contents[0].resource.blob, "base64"), pdf);
});

test("the PDF viewer reports app-only byte reader failures", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const frame = await openViewer(page, { byteError: "The character PDF is unavailable or expired." });

  await frame.locator("#status.error").waitFor();
  assert.equal(await frame.locator("#status").textContent(), "The character PDF is unavailable or expired.");
  assert.equal(await frame.locator("#download-pdf").isDisabled(), true);
});

test("a repeated PDF result supersedes an older in-flight load", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const frame = await openViewer(page, { delayFirstRange: true });
  await page.waitForFunction(() => window.hostMessages.some(({ method }) => method === "tools/call"));
  await page.evaluate((metadata) => {
    document.querySelector("#viewer").contentWindow.postMessage({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        content: [{ type: "text", text: "Newer result" }],
        structuredContent: { ...metadata, title: "Replacement Character Sheet" },
      },
    }, "*");
  }, metadata);

  await frame.locator("#toolbar-title", { hasText: "Replacement Character Sheet" }).waitFor();
  await frame.locator("#pdf-canvas").evaluate((canvas) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const poll = () => canvas.width > 0 ? resolve() : Date.now() > deadline ? reject(new Error("Replacement PDF did not render")) : setTimeout(poll, 25);
    poll();
  }));
  assert.equal(await frame.locator("#status").isHidden(), true);
  assert.ok(await page.evaluate(() => window.rangeCalls) >= 2);
});
