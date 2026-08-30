import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { search } from "../dist/tools/search.js";
import { installSyntheticRoutes } from "./support/synthetic-routes.mjs";

test("global search extracts, filters, deduplicates, and paginates rendered cards", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const state = await installSyntheticRoutes(context);

  const global = await search(context, "synthetic rule", "all");
  assert.equal(global.reportedCount, 5);
  assert.equal(global.total, 3, "duplicate and unsafe cards are removed");
  assert.equal(global.partial, false);
  assert.deepEqual(global.results.map(({ legacy }) => legacy), [false, true, false]);
  assert.equal(global.results[0].snippets[0], "Synthetic current sourcebook snippet.");
  assert.equal(global.results[0].bookLocation, null, "unscoped ambiguous source paths are not guessed");

  const legacy = await search(context, "synthetic rule", "all", undefined, { legacy: "only" });
  assert.deepEqual(legacy.results.map(({ name }) => name), ["Synthetic Legacy Feat"]);

  const scoped = await search(context, "synthetic rule", "all", undefined, {
    bookSlug: "synthetic-handbook",
    legacy: "include",
    limit: 1,
  });
  assert.equal(scoped.total, 2);
  assert.deepEqual(scoped.results.map(({ name }) => name), ["Safe Details"]);
  assert.deepEqual(scoped.results[0].bookLocation, {
    bookSlug: "synthetic-handbook",
    chapterSlug: "safe-examples",
    sectionFragment: "Details",
    sectionTitleHint: "Safe Details",
  });
  assert.ok(scoped.nextCursor);

  const continuation = await search(context, "synthetic rule", "all", undefined, {
    bookSlug: "synthetic-handbook",
    legacy: "include",
    cursor: scoped.nextCursor,
  });
  assert.deepEqual(continuation.results.map(({ name }) => name), ["Synthetic Legacy Feat"]);
  assert.equal(continuation.results[0].bookLocation, null);
  assert.equal(continuation.results[0].sources[0].bookSlug, "synthetic-handbook");
  assert.deepEqual(continuation.results[0].sources[1], {
    title: "Chapter attribution",
    url: "https://www.dndbeyond.com/sources/synthetic-handbook/safe-examples",
    bookSlug: "synthetic-handbook",
    chapterSlug: "safe-examples",
  });
  assert.equal(continuation.done, true);
  assert.equal(state.requests.filter(({ url }) => new URL(url).pathname === "/en/library").length, 1, "cursor continuation reuses cached library metadata");

  const alias = await search(context, "synthetic rule", "all", undefined, {
    bookSlug: "other-handbook",
  });
  assert.equal(alias.filters.bookSlug, "dnd/other-handbook");
  assert.equal(alias.total, 1, "the canonicalized title attribution is used for scoped filtering");

  const refreshed = await search(context, "synthetic rule", "all", undefined, {
    bookSlug: "synthetic-handbook",
    refresh: true,
  });
  assert.equal(refreshed.filters.bookSlug, "synthetic-handbook");
  assert.equal(state.requests.filter(({ url }) => new URL(url).pathname === "/en/library").length, 2);
  await assert.rejects(
    search(context, "synthetic rule", "all", undefined, { bookSlug: "newly-added-book" }),
    /not accessible/
  );
  assert.equal(state.requests.filter(({ url }) => new URL(url).pathname === "/en/library").length, 3, "a cached miss refreshes once before failing");
  assert.deepEqual(state.unmatched, []);
});
