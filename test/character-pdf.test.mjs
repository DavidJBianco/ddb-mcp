import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  acquireCharacterPdf,
  CharacterPdfStore,
  PDF_CACHE_MAX_TOTAL_BYTES,
  PDF_CACHE_TTL_MS,
  PDF_CHUNK_BYTES,
  PDF_MAX_BYTES,
} from "../dist/tools/character-pdf.js";

const syntheticPdf = await readFile(new URL("fixtures/synthetic-character-sheet.pdf", import.meta.url));
const syntheticSha256 = createHash("sha256").update(syntheticPdf).digest("hex");

function response({
  status = 200,
  url = "https://www.dndbeyond.com/sheet-pdfs/synthetic.pdf",
  headers = { "content-type": "application/pdf", "content-length": String(syntheticPdf.length) },
  body = syntheticPdf,
} = {}) {
  return {
    status: () => status,
    url: () => url,
    headers: () => headers,
    body: async () => body,
  };
}

function contextFor({
  loggedIn = true,
  manageError,
  exportError,
  linkError,
  href = "/sheet-pdfs/synthetic.pdf",
} = {}) {
  let currentUrl = "about:blank";
  const page = {
    goto: async (url) => {
      currentUrl = url;
    },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    evaluate: async () => loggedIn,
    getByRole: () => ({
      click: async () => {
        if (manageError) throw manageError;
      },
    }),
    getByText: () => ({
      click: async () => {
        if (exportError) throw exportError;
      },
    }),
    locator: () => ({
      first: () => ({
        waitFor: async () => {
          if (linkError) throw linkError;
        },
        getAttribute: async () => href,
      }),
    }),
  };
  return { pages: () => [page] };
}

async function acquire(overrides = {}) {
  const { context = contextFor(), fetched = response(), ...dependencies } = overrides;
  return acquireCharacterPdf(context, "4242", {
    fetchPdf: async () => fetched,
    ...dependencies,
  });
}

test("acquires and validates a synthetic character PDF without writing it", async () => {
  const pdf = await acquire();
  assert.equal(pdf.filename, "dnd-beyond-character-4242.pdf");
  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(pdf.totalBytes, syntheticPdf.length);
  assert.equal(pdf.sha256, syntheticSha256);
  assert.deepEqual(pdf.bytes, syntheticPdf);
});

test("character PDF acquisition rejects authentication and rendered control failures", async () => {
  await assert.rejects(acquire({ context: contextFor({ loggedIn: false }) }), /mysterium-auth login/);
  await assert.rejects(acquire({ context: contextFor({ manageError: new Error("private") }) }), /Manage control/);
  await assert.rejects(acquire({ context: contextFor({ exportError: new Error("private") }) }), /Export to PDF control/);
  await assert.rejects(acquire({ context: contextFor({ linkError: new Error("private") }) }), /before the timeout/);
  await assert.rejects(acquire({ context: contextFor({ href: "" }) }), /empty PDF download link/);
});

test("character PDF acquisition enforces one overall deadline", async () => {
  let calls = 0;
  await assert.rejects(
    acquire({ now: () => (calls++ === 0 ? 0 : 90_001) }),
    /Character PDF export timed out/
  );
});

test("character PDF acquisition validates generated and final URLs", async () => {
  for (const href of [
    "https://evil.example/sheet-pdfs/a.pdf",
    "https://www.dndbeyond.com/other/a.pdf",
    "https://user:pass@www.dndbeyond.com/sheet-pdfs/a.pdf",
  ]) {
    await assert.rejects(acquire({ context: contextFor({ href }) }), /unsafe PDF download link/);
  }
  await assert.rejects(
    acquire({ fetched: response({ url: "https://evil.example/sheet-pdfs/a.pdf" }) }),
    /unsafe PDF download link/
  );
});

test("character PDF acquisition validates status, MIME type, length, size, and signature", async () => {
  await assert.rejects(acquire({ fetched: response({ status: 503 }) }), /HTTP 503/);
  await assert.rejects(
    acquire({ fetched: response({ headers: { "content-type": "text/html" } }) }),
    /non-PDF response/
  );
  await assert.rejects(
    acquire({ fetched: response({ headers: { "content-type": "application/pdf", "content-length": "invalid" } }) }),
    /invalid PDF content length/
  );
  await assert.rejects(
    acquire({ fetched: response({ headers: { "content-type": "application/pdf", "content-length": String(PDF_MAX_BYTES + 1) } }) }),
    /exceeds the 25 MiB limit/
  );
  await assert.rejects(
    acquire({ fetched: response({ headers: { "content-type": "application/pdf" }, body: Buffer.alloc(PDF_MAX_BYTES + 1) }) }),
    /exceeds the 25 MiB limit/
  );
  await assert.rejects(
    acquire({ fetched: response({ headers: { "content-type": "application/pdf", "content-length": "3" }, body: Buffer.from("bad") }) }),
    /valid PDF signature/
  );
  await assert.rejects(
    acquire({ fetched: response({ headers: { "content-type": "application/pdf", "content-length": "1" } }) }),
    /length did not match/
  );
});

function storedPdf(bytes, id = "1") {
  return {
    bytes,
    filename: `dnd-beyond-character-${id}.pdf`,
    title: `dnd-beyond-character-${id}.pdf`,
    mimeType: "application/pdf",
    totalBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

test("in-memory PDF store serves bounded, retryable chunks", () => {
  const store = new CharacterPdfStore({ createHandle: () => "synthetic-handle" });
  const bytes = Buffer.alloc(PDF_CHUNK_BYTES + 7, 42);
  const metadata = store.put(storedPdf(bytes));
  assert.equal(metadata.initialPage, 1);
  assert.match(metadata.url, /^mysterium:\/\/character-pdf\/synthetic-handle\//);

  const first = store.read(metadata.url, 0, PDF_CHUNK_BYTES);
  assert.equal(first.byteCount, PDF_CHUNK_BYTES);
  assert.equal(first.hasMore, true);
  assert.deepEqual(Buffer.from(first.bytes, "base64"), bytes.subarray(0, PDF_CHUNK_BYTES));
  assert.deepEqual(store.read(metadata.url, 0, PDF_CHUNK_BYTES), first);

  const final = store.read(metadata.url, PDF_CHUNK_BYTES, PDF_CHUNK_BYTES);
  assert.equal(final.byteCount, 7);
  assert.equal(final.hasMore, false);
  assert.deepEqual(Buffer.from(final.bytes, "base64"), bytes.subarray(PDF_CHUNK_BYTES));
});

test("in-memory PDF store expires entries and evicts the least recently used entry", () => {
  assert.equal(PDF_CACHE_TTL_MS, 60 * 60 * 1000);
  let now = 1_000;
  let handle = 0;
  const store = new CharacterPdfStore({ now: () => now, createHandle: () => String(++handle) });
  const first = store.put(storedPdf(Buffer.from("%PDF-first"), "1"));
  const second = store.put(storedPdf(Buffer.from("%PDF-second"), "2"));
  store.read(first.url, 0, 1);
  const third = store.put(storedPdf(Buffer.from("%PDF-third"), "3"));
  assert.throws(() => store.read(second.url, 0, 1), /unavailable or expired/);
  assert.equal(store.read(first.url, 0, 1).byteCount, 1);
  assert.equal(store.read(third.url, 0, 1).byteCount, 1);

  now += PDF_CACHE_TTL_MS + 1;
  assert.throws(() => store.read(first.url, 0, 1), /unavailable or expired/);
});

test("in-memory PDF store enforces range and total-capacity limits", () => {
  const store = new CharacterPdfStore({ createHandle: () => "too-large" });
  assert.throws(() => store.read("mysterium://missing", -1, 1), /non-negative integer/);
  assert.throws(() => store.read("mysterium://missing", 0, 0), /between 1/);
  assert.throws(() => store.read("mysterium://missing", 0, PDF_CHUNK_BYTES + 1), /between 1/);
  assert.throws(
    () => store.put(storedPdf(Buffer.alloc(PDF_CACHE_MAX_TOTAL_BYTES + 1))),
    /cannot fit in the in-memory cache/
  );
});
