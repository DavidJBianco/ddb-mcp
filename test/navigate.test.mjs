import assert from "node:assert/strict";
import test from "node:test";

import {
  capturePageScreenshot,
  decodePageCursor,
  encodePageCursor,
  isAllowedDdbUrl,
  readPage,
  normalizePageText,
  paginatePageText,
  validatePageContentRequest,
  validatePageScreenshotRequest,
} from "../dist/tools/navigate.js";

function contextWith(page) {
  return { pages: () => [page] };
}

function pageCursor(overrides = {}) {
  return encodePageCursor({
    version: 1,
    url: "https://www.dndbeyond.com/synthetic-page",
    maxChars: 20,
    segmentIndex: 1,
    offset: 10,
    fingerprint: "a".repeat(64),
    ...overrides,
  });
}

function png(width, height, extraBytes = 0) {
  const bytes = Buffer.alloc(24 + extraBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function readablePage({ url = "https://www.dndbeyond.com/synthetic-page", text, title = "Synthetic Page" } = {}) {
  let currentUrl = url;
  let currentText = text ?? "First paragraph.\n\nSecond paragraph with 😀 Unicode.\n\nThird paragraph.";
  const page = {
    goto: async (nextUrl) => { currentUrl = nextUrl; },
    url: () => currentUrl,
    waitForSelector: async () => {},
    evaluate: async (callback) => String(callback).includes("sign in")
      ? true
      : { title, text: currentText },
  };
  return {
    page,
    setUrl: (value) => { currentUrl = value; },
    setText: (value) => { currentText = value; },
  };
}

test("D&D Beyond URL validation rejects lookalike and unsafe origins", () => {
  assert.equal(isAllowedDdbUrl("https://www.dndbeyond.com/characters"), true);
  assert.equal(isAllowedDdbUrl("https://dndbeyond.com/spells"), true);
  assert.equal(isAllowedDdbUrl("https://www.dndbeyond.com.evil.example/"), false);
  assert.equal(isAllowedDdbUrl("https://dndbeyond.com@evil.example/"), false);
  assert.equal(isAllowedDdbUrl("http://www.dndbeyond.com/"), false);
  assert.equal(isAllowedDdbUrl("https://www.dndbeyond.com:8443/"), false);
  assert.equal(isAllowedDdbUrl("not a URL"), false);
});

test("page cursors are opaque, canonical, versioned, and bound to the character limit", () => {
  const encoded = pageCursor();
  assert.doesNotMatch(encoded, /synthetic-page/);
  assert.deepEqual(decodePageCursor(encoded), {
    version: 1,
    url: "https://www.dndbeyond.com/synthetic-page",
    maxChars: 20,
    segmentIndex: 1,
    offset: 10,
    fingerprint: "a".repeat(64),
  });
  assert.throws(() => decodePageCursor("not-a-cursor"), /Invalid page cursor/);
  assert.throws(() => decodePageCursor(pageCursor({ version: 2 })), /unsupported cursor version/);
  assert.throws(() => decodePageCursor(pageCursor({ url: "https://evil.example/" })), /page binding/);
  assert.throws(() => decodePageCursor(pageCursor({ offset: -1 })), /text position/);
  assert.throws(() => decodePageCursor(pageCursor({ fingerprint: "short" })), /fingerprint/);
  assert.throws(() => validatePageContentRequest({ cursor: encoded, maxChars: 21 }), /does not match max_chars/);
});

test("page text normalization and pagination preserve deterministic Unicode content", () => {
  const normalized = normalizePageText("  Alpha\r\n\r\n  Beta\u00a0😀  \n\n\nGamma  ");
  assert.equal(normalized, "Alpha\n\nBeta 😀\n\nGamma");
  const pages = [];
  let position;
  do {
    const page = paginatePageText(normalized, 8, position);
    pages.push(page.text);
    position = page.next ?? undefined;
  } while (position);
  assert.equal(pages.join(""), normalized);
  assert.ok(pages.every((value) => Array.from(value).length <= 8));
});

test("read-page validates the requested origin before browser access", async () => {
  const context = { pages: () => assert.fail("browser page must not be requested") };
  await assert.rejects(readPage(context, { url: "https://example.com/not-ddb" }), /Only canonical HTTPS D&D Beyond URLs/);
});

test("read-page blocks a redirect outside D&D Beyond", async () => {
  const page = { goto: async () => {}, url: () => "https://evil.example/redirected" };
  await assert.rejects(readPage(contextWith(page), { url: "https://www.dndbeyond.com/redirect" }), /redirected outside D&D Beyond/);
});

test("read-page navigation and continuation produce stable chunks and reject changed state", async () => {
  const harness = readablePage();
  const first = await readPage(contextWith(harness.page), { url: "https://www.dndbeyond.com/synthetic-page", maxChars: 20 });
  assert.equal(first.operation, "navigate");
  assert.equal(first.requestedUrl, "https://www.dndbeyond.com/synthetic-page");
  assert.ok(first.nextCursor);

  const second = await readPage(contextWith(harness.page), { cursor: first.nextCursor });
  assert.equal(second.operation, "current_page");
  assert.equal(second.requestedUrl, null);
  assert.ok((first.text + second.text).length > 0);

  harness.setText("Changed page content");
  await assert.rejects(
    readPage(contextWith(harness.page), { cursor: first.nextCursor }),
    /Page content changed/
  );
  harness.setText("First paragraph.\n\nSecond paragraph with 😀 Unicode.\n\nThird paragraph.");
  harness.setUrl("https://www.dndbeyond.com/characters");
  await assert.rejects(
    readPage(contextWith(harness.page), { cursor: first.nextCursor }),
    /does not match the current page URL/
  );
});

test("screenshot request validation enforces scope and selector combinations", () => {
  assert.deepEqual(validatePageScreenshotRequest({}), { scope: "viewport" });
  assert.deepEqual(validatePageScreenshotRequest({ scope: "element", selector: "  main  " }), {
    scope: "element",
    selector: "main",
  });
  assert.throws(() => validatePageScreenshotRequest({ selector: "main" }), /only valid/);
  assert.throws(() => validatePageScreenshotRequest({ scope: "element" }), /selector is required/);
});

test("viewport and element screenshots remain in memory and return validated PNG metadata", async () => {
  const viewportBytes = png(1280, 800);
  const elementBytes = png(320, 200);
  const locator = {
    count: async () => 1,
    isVisible: async () => true,
    boundingBox: async () => ({ x: 0, y: 0, width: 320, height: 200 }),
    screenshot: async () => elementBytes,
  };
  const page = {
    url: () => "https://www.dndbeyond.com/synthetic-page",
    evaluate: async () => true,
    title: async () => "Synthetic Page",
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: async (options) => {
      assert.deepEqual(options, { type: "png", fullPage: false });
      return viewportBytes;
    },
    locator: (selector) => {
      assert.equal(selector, "main");
      return locator;
    },
  };

  const viewport = await capturePageScreenshot(contextWith(page));
  assert.equal(viewport.bytes, viewportBytes);
  assert.deepEqual(viewport.metadata, {
    source: "dndbeyond-page-screenshot",
    schemaVersion: "v1",
    url: "https://www.dndbeyond.com/synthetic-page",
    title: "Synthetic Page",
    scope: "viewport",
    selector: null,
    width: 1280,
    height: 800,
    mimeType: "image/png",
    byteCount: viewportBytes.length,
  });

  const element = await capturePageScreenshot(contextWith(page), { scope: "element", selector: "main" });
  assert.equal(element.bytes, elementBytes);
  assert.equal(element.metadata.scope, "element");
  assert.equal(element.metadata.selector, "main");
});

test("element screenshots reject ambiguous, hidden, and oversized targets", async () => {
  const base = {
    url: () => "https://www.dndbeyond.com/synthetic-page",
    evaluate: async () => true,
  };
  const request = { scope: "element", selector: "main" };
  await assert.rejects(capturePageScreenshot(contextWith({
    ...base,
    locator: () => ({ count: async () => 2 }),
  }), request), /exactly one element/);
  await assert.rejects(capturePageScreenshot(contextWith({
    ...base,
    locator: () => ({ count: async () => 1, isVisible: async () => false }),
  }), request), /not visible/);
  await assert.rejects(capturePageScreenshot(contextWith({
    ...base,
    locator: () => ({
      count: async () => 1,
      isVisible: async () => true,
      boundingBox: async () => ({ width: 5000, height: 10 }),
    }),
  }), request), /dimensions/);
});

test("viewport screenshots reject oversized and malformed PNG responses", async () => {
  const base = {
    url: () => "https://www.dndbeyond.com/synthetic-page",
    evaluate: async () => true,
    viewportSize: () => ({ width: 1280, height: 800 }),
  };
  await assert.rejects(capturePageScreenshot(contextWith({
    ...base,
    screenshot: async () => Buffer.alloc(5 * 1024 * 1024 + 1),
  })), /byte limit/);
  await assert.rejects(capturePageScreenshot(contextWith({
    ...base,
    screenshot: async () => Buffer.from("not a PNG"),
  })), /valid PNG signature/);
});
