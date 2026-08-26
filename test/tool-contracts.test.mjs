import assert from "node:assert/strict";
import test from "node:test";

import {
  libraryEnvelopeSchema,
  readBookResultSchema,
  searchEnvelopeSchema,
  statBlockResolutionSchema,
  statBlockResultSchema,
  statBlockSchema,
} from "../dist/tool-contracts.js";

const candidate = {
  id: "42",
  name: "Synthetic Watcher",
  url: "https://www.dndbeyond.com/monsters/42-synthetic-watcher",
  source: "Synthetic Manual",
  edition: "5.5e",
  legacy: false,
  challengeRating: "7",
  type: "Aberration",
  tags: [],
  access: "accessible",
};

const statBlock = {
  kind: "stat_block",
  creature: {
    id: "42",
    name: "Synthetic Watcher",
    url: candidate.url,
    source: "Synthetic Manual",
    edition: "5.5e",
    legacy: false,
    size: "Large",
    type: "Aberration",
    alignment: "Neutral",
    tags: [],
    challengeRating: "7",
  },
  attributes: [{ label: "AC", value: "16" }],
  abilities: [{ name: "STR", score: 18, modifier: "+4", save: null }],
  sections: [{ title: "Actions", kind: "actions", entries: [{ name: "Ray", text: "Synthetic attack." }] }],
  markdown: "# Synthetic Watcher",
};

test("mature output schemas accept each stable result family", () => {
  assert.equal(libraryEnvelopeSchema.safeParse({ count: 0, books: [] }).success, true);
  assert.equal(searchEnvelopeSchema.safeParse({
    query: "missing",
    category: "spells",
    url: "https://www.dndbeyond.com/spells?filter-search=missing",
    count: 0,
    results: [],
  }).success, true);
  assert.equal(readBookResultSchema.safeParse({
    kind: "outline",
    book: { slug: "synthetic-handbook", title: "Synthetic Handbook" },
    scope: { bookSlug: "synthetic-handbook", title: "Synthetic Handbook" },
    url: "https://www.dndbeyond.com/sources/synthetic-handbook",
    entries: [],
    nextCursor: null,
    done: true,
  }).success, true);
  assert.equal(statBlockSchema.safeParse(statBlock).success, true);
  assert.equal(statBlockResultSchema.safeParse(statBlock).success, true);
  assert.equal(statBlockResultSchema.safeParse({
    kind: "candidates",
    query: "Watcher",
    normalizedQuery: "watcher",
    legacy: "include",
    candidates: [{ ...candidate, accessFailure: "Synthetic access failure." }],
  }).success, true);
  assert.equal(statBlockResultSchema.safeParse({
    kind: "not_found",
    query: "Missing",
    normalizedQuery: "missing",
    legacy: "exclude",
    candidates: [],
  }).success, true);
  assert.equal(statBlockResolutionSchema.safeParse({
    kind: "resolved",
    query: null,
    normalizedQuery: null,
    legacy: "include",
    candidate,
  }).success, true);
});

test("mature output schemas reject undocumented and incomplete shapes", () => {
  assert.equal(libraryEnvelopeSchema.safeParse({ count: 0, books: [], undocumented: true }).success, false);
  assert.equal(searchEnvelopeSchema.safeParse({ query: "x", category: "spells", url: "x", results: [] }).success, false);
  assert.equal(readBookResultSchema.safeParse({
    kind: "content",
    book: { slug: "synthetic-handbook" },
    nextCursor: null,
    done: true,
  }).success, false);
  assert.equal(statBlockResultSchema.safeParse({ kind: "stat_block", ...statBlock, markdown: undefined }).success, false);
  assert.equal(statBlockResolutionSchema.safeParse({
    kind: "resolved",
    query: "Watcher",
    normalizedQuery: "watcher",
    legacy: "include",
  }).success, false);
  assert.equal(statBlockSchema.safeParse({ ...statBlock, rendererOnly: true }).success, false);
});
