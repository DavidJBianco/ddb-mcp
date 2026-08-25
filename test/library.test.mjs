import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeCursor,
  encodeCursor,
  paginateBlocks,
  readBook,
  SERVER_MAX_CHARS,
  validateReadBookRequest,
} from "../dist/tools/library.js";

const fingerprint = "a".repeat(64);

function cursor(overrides = {}) {
  return encodeCursor({
    version: 1,
    bookSlug: "dnd/synthetic",
    chapterSlug: "chapter-one",
    section: null,
    maxChars: 10,
    blockIndex: 1,
    offset: 0,
    fingerprint,
    ...overrides,
  });
}

function contextFor(extracted) {
  let currentUrl = "about:blank";
  const page = {
    goto: async (url) => {
      currentUrl = url;
    },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    evaluate: async (_extractor, argument) => {
      if (currentUrl === "https://www.dndbeyond.com" && argument === undefined) return true;
      return typeof extracted === "function" ? extracted(argument, currentUrl) : extracted;
    },
  };
  return { pages: () => [page] };
}

const extractedChapter = {
  title: "Synthetic Chapter",
  outline: [
    { id: "section-intro-1", title: "Intro", level: 2, parentId: null },
    { id: "section-details-1", title: "Details", level: 3, parentId: "section-intro-1" },
    { id: "section-repeat-1", title: "Repeat", level: 2, parentId: null },
    { id: "section-repeat-2", title: "Repeat", level: 2, parentId: null },
  ],
  blocks: [
    { text: "## Intro", headingId: "section-intro-1", headingLevel: 2, imageIds: [] },
    { text: "Intro paragraph.", imageIds: [] },
    { text: "### Details", headingId: "section-details-1", headingLevel: 3, imageIds: [] },
    { text: "Detail paragraph with [Image image-1: diagram].", imageIds: ["image-1"] },
    { text: "## Repeat", headingId: "section-repeat-1", headingLevel: 2, imageIds: [] },
    { text: "First repeated section.", imageIds: [] },
    { text: "## Repeat", headingId: "section-repeat-2", headingLevel: 2, imageIds: [] },
    { text: "Second repeated section.", imageIds: [] },
  ],
  images: [{ id: "image-1", alt: "diagram", caption: "Synthetic figure", url: "https://media.example.test/diagram.png" }],
};

test("cursor encoding is opaque, versioned, and fully validated", () => {
  const encoded = cursor();
  assert.deepEqual(decodeCursor(encoded), {
    version: 1,
    bookSlug: "dnd/synthetic",
    chapterSlug: "chapter-one",
    section: null,
    maxChars: 10,
    blockIndex: 1,
    offset: 0,
    fingerprint,
  });
  assert.throws(() => decodeCursor("not-a-cursor"), /Invalid cursor/);
  assert.throws(() => decodeCursor(cursor({ version: 2 })), /unsupported cursor version/);
  assert.throws(() => decodeCursor(cursor({ blockIndex: -1 })), /block position/);
  assert.throws(() => decodeCursor(cursor({ fingerprint: "short" })), /fingerprint/);
});

test("read request validation applies defaults and binds continuation inputs", () => {
  assert.equal(validateReadBookRequest({ bookSlug: "dnd/synthetic" }).mode, "outline");
  const content = validateReadBookRequest({ bookSlug: "dnd/synthetic", chapterSlug: "chapter-one" });
  assert.equal(content.mode, "content");
  assert.equal(content.maxChars, 10_000);
  assert.equal(validateReadBookRequest({
    bookSlug: "dnd/synthetic",
    chapterSlug: "chapter-one",
    cursor: cursor(),
  }).maxChars, 10);

  assert.throws(() => validateReadBookRequest({ bookSlug: "../private" }), /book_slug/);
  assert.throws(() => validateReadBookRequest({ bookSlug: "dnd/synthetic", mode: "content" }), /chapter_slug/);
  assert.throws(() => validateReadBookRequest({ bookSlug: "dnd/synthetic", maxChars: 5 }), /only valid when reading content/);
  assert.throws(() => validateReadBookRequest({
    bookSlug: "dnd/other",
    chapterSlug: "chapter-one",
    cursor: cursor(),
  }), /does not match/);
  assert.throws(() => validateReadBookRequest({
    bookSlug: "dnd/synthetic",
    chapterSlug: "chapter-one",
    cursor: cursor(),
    maxChars: 11,
  }), /does not match max_chars/);
  assert.throws(() => validateReadBookRequest({
    bookSlug: "dnd/synthetic",
    chapterSlug: "chapter-one",
    maxChars: SERVER_MAX_CHARS + 1,
  }), /no greater than/);
});

test("pagination prefers complete blocks and hard-splits oversized Unicode blocks without loss", () => {
  const blocks = [
    { text: "alpha", imageIds: [] },
    { text: "bravo", imageIds: ["image-1"] },
    { text: "🙂charlie", imageIds: [] },
  ];
  const expected = blocks.map(({ text }) => text).join("\n\n");
  const pieces = [];
  let position;
  do {
    const page = paginateBlocks(blocks, 7, position);
    pieces.push(page.text);
    position = page.next ?? undefined;
    if (page.text.includes("bravo")) assert.deepEqual(page.imageIds, ["image-1"]);
  } while (position);
  assert.equal(pieces.join(""), expected);
  assert.ok(pieces.every((piece) => Array.from(piece).length <= 7));

  const exact = paginateBlocks([{ text: "12345", imageIds: [] }], 5);
  assert.equal(exact.text, "12345");
  assert.equal(exact.next, null);
  assert.deepEqual(paginateBlocks([], 5), { text: "", next: null, imageIds: [] });
  assert.throws(() => paginateBlocks(blocks, 5, { blockIndex: 99, offset: 0 }), /outside/);
});

test("book and chapter outlines return structured discovery responses", async () => {
  const bookOutline = {
    title: "Synthetic Handbook",
    outline: [{
      id: "toc-safe-examples-1",
      title: "Safe Examples",
      level: 1,
      parentId: null,
      chapterSlug: "safe-examples",
      url: "https://www.dndbeyond.com/sources/synthetic-handbook/safe-examples",
    }],
    blocks: [],
    images: [],
  };
  const book = await readBook(contextFor(bookOutline), { bookSlug: "synthetic-handbook" });
  assert.equal(book.kind, "outline");
  assert.equal(book.entries[0].chapterSlug, "safe-examples");
  assert.equal(book.done, true);

  const chapter = await readBook(contextFor(extractedChapter), {
    bookSlug: "synthetic-handbook",
    chapterSlug: "safe-examples",
    mode: "outline",
  });
  assert.equal(chapter.entries[1].parentId, "section-intro-1");
});

test("section reads resolve stable IDs, report ambiguity, paginate, and carry image metadata", async () => {
  const first = await readBook(contextFor(extractedChapter), {
    bookSlug: "synthetic-handbook",
    chapterSlug: "safe-examples",
    section: "section-intro-1",
    maxChars: 35,
  });
  assert.equal(first.kind, "content");
  assert.equal(first.done, false);
  assert.ok(first.nextCursor);

  const pages = [first];
  while (!pages.at(-1).done) {
    pages.push(await readBook(contextFor(extractedChapter), {
      bookSlug: "synthetic-handbook",
      chapterSlug: "safe-examples",
      section: "section-intro-1",
      cursor: pages.at(-1).nextCursor,
    }));
  }
  assert.match(pages.map(({ text }) => text).join(""), /Detail paragraph/);
  assert.deepEqual([...new Set(pages.flatMap(({ images }) => images).map(({ id }) => id))], ["image-1"]);

  await assert.rejects(readBook(contextFor(extractedChapter), {
    bookSlug: "synthetic-handbook",
    chapterSlug: "safe-examples",
    section: "Repeat",
  }), /ambiguous.*section-repeat-1.*section-repeat-2/);
});

test("stable retries reproduce chunks and changed extracted content invalidates a cursor", async () => {
  const request = {
    bookSlug: "synthetic-handbook",
    chapterSlug: "safe-examples",
    maxChars: 20,
  };
  const first = await readBook(contextFor(extractedChapter), request);
  const retryA = await readBook(contextFor(extractedChapter), { ...request, cursor: first.nextCursor });
  const retryB = await readBook(contextFor(extractedChapter), { ...request, cursor: first.nextCursor });
  assert.deepEqual(retryA, retryB);

  const changed = structuredClone(extractedChapter);
  changed.blocks[0].text = "## Changed";
  await assert.rejects(readBook(contextFor(changed), { ...request, cursor: first.nextCursor }), /content changed/);
});

test("missing and empty rendered layouts fail explicitly", async () => {
  await assert.rejects(readBook(contextFor(null), { bookSlug: "synthetic-handbook" }), /layout was not recognized/);
  await assert.rejects(readBook(contextFor({ title: "Empty", outline: [], blocks: [], images: [] }), {
    bookSlug: "synthetic-handbook",
  }), /No table of contents/);
  await assert.rejects(readBook(contextFor({ title: "Empty", outline: [], blocks: [], images: [] }), {
    bookSlug: "synthetic-handbook",
    chapterSlug: "empty",
  }), /No readable chapter content/);
});
