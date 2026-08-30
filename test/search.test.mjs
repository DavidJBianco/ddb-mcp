import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeSearchCursor,
  normalizeSourceAttribution,
  normalizeSourceAttributions,
  resolveBookLocation,
  resolveLibraryBookSlug,
  search,
  validateSearchRequest,
} from "../dist/tools/search.js";

function searchHarness(results) {
  const visits = [];
  let currentUrl = "about:blank";
  const page = {
    goto: async (url, options) => {
      currentUrl = url;
      visits.push({ url, options });
    },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    evaluate: async (_extractor, category) => {
      assert.equal(category, "spells");
      return results;
    },
  };

  return {
    context: { pages: () => [page] },
    visits,
  };
}

test("search builds a category URL and returns structured results", async () => {
  const expectedResults = [
    {
      name: "Synthetic Fire Spell",
      type: "3rd Level | Evocation",
      url: "https://www.dndbeyond.com/spells/synthetic-fire-spell",
      legacy: false,
      snippets: [],
      sources: [
        {
          title: "Synthetic Handbook",
          url: "https://www.dndbeyond.com/sources/dnd/synthetic-handbook",
          bookSlug: "dnd/synthetic-handbook",
          chapterSlug: null,
        },
      ],
      bookLocation: null,
    },
  ];
  const harness = searchHarness(expectedResults);

  const parsed = await search(harness.context, "fire bolt", "spells");

  assert.equal(
    harness.visits[0].url,
    "https://www.dndbeyond.com/spells?filter-search=fire%20bolt"
  );
  assert.equal(harness.visits[0].options.waitUntil, "domcontentloaded");
  assert.equal(parsed.query, "fire bolt");
  assert.equal(parsed.category, "spells");
  assert.deepEqual(parsed.filters, { sourceScope: null, bookSlug: null, legacy: "include" });
  assert.equal(parsed.count, 1);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.done, true);
  assert.deepEqual(parsed.results, expectedResults);
});

test("search reports an empty synthetic result set", async () => {
  const harness = searchHarness([]);

  const parsed = await search(harness.context, "missing spell", "spells");
  assert.equal(parsed.count, 0);
  assert.deepEqual(parsed.results, []);
  assert.match(parsed.url, /filter-search=missing%20spell/);
});

test("source attribution normalization preserves safe pivots and rejects guesses", () => {
  assert.deepEqual(
    normalizeSourceAttribution({
      title: "  Synthetic   Handbook ",
      url: "/sources/dnd/synthetic-handbook",
    }),
    {
      title: "Synthetic Handbook",
      url: "https://www.dndbeyond.com/sources/dnd/synthetic-handbook",
      bookSlug: "dnd/synthetic-handbook",
      chapterSlug: null,
    }
  );
  assert.deepEqual(
    normalizeSourceAttribution({
      title: "Chapter relationship",
      url: "https://www.dndbeyond.com/sources/dnd/synthetic-handbook/chapter-one",
      bookSlug: "dnd/synthetic-handbook",
      chapterSlug: "chapter-one",
    }),
    {
      title: "Chapter relationship",
      url: "https://www.dndbeyond.com/sources/dnd/synthetic-handbook/chapter-one",
      bookSlug: "dnd/synthetic-handbook",
      chapterSlug: "chapter-one",
    }
  );
  assert.deepEqual(
    normalizeSourceAttribution({ title: "External", url: "https://example.com/sources/not-safe" }),
    { title: "External", url: null, bookSlug: null, chapterSlug: null }
  );
  assert.deepEqual(
    normalizeSourceAttribution({ title: "Malformed", url: "https://[invalid" }),
    { title: "Malformed", url: null, bookSlug: null, chapterSlug: null }
  );
});

test("source attribution normalization preserves multiple sources and removes exact duplicates", () => {
  const sources = normalizeSourceAttributions([
    { title: "First", url: "/sources/first" },
    { title: "First", url: "/sources/first" },
    { title: "Second", url: null },
    { title: " ", url: null },
  ]);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].bookSlug, "first");
  assert.deepEqual(sources[1], { title: "Second", url: null, bookSlug: null, chapterSlug: null });
});

test("source locations resolve scoped chapters and decoded section fragments without guessing foreign URLs", () => {
  assert.deepEqual(resolveBookLocation(
    "https://www.dndbeyond.com/sources/dnd/synthetic-handbook/chapter-one#Opportunity%20Attacks",
    "Opportunity Attacks",
    [],
    "dnd/synthetic-handbook"
  ), {
    bookSlug: "dnd/synthetic-handbook",
    chapterSlug: "chapter-one",
    sectionFragment: "Opportunity Attacks",
    sectionTitleHint: "Opportunity Attacks",
  });
  assert.equal(resolveBookLocation("https://example.com/sources/dnd/book/chapter", "Unsafe", [], "dnd/book"), null);
});

test("ordinary search results cover absent, multiple, and incomplete attribution", async () => {
  const harness = searchHarness([
    {
      name: "No Attribution",
      type: "1st Level",
      url: "https://www.dndbeyond.com/spells/no-attribution",
    },
    {
      name: "Several Sources",
      type: "2nd Level",
      url: "https://www.dndbeyond.com/spells/several-sources",
      sources: [
        { title: "First", url: "/sources/first" },
        { title: "First", url: "/sources/first" },
        { title: "Printed Reference", url: null },
      ],
    },
  ]);

  const parsed = await search(harness.context, "sources", "spells");
  assert.deepEqual(parsed.results[0].sources, []);
  assert.deepEqual(parsed.results[1].sources, [
    {
      title: "First",
      url: "https://www.dndbeyond.com/sources/first",
      bookSlug: "first",
      chapterSlug: null,
    },
    { title: "Printed Reference", url: null, bookSlug: null, chapterSlug: null },
  ]);
});

test("monster search preserves rendered Legacy and edition metadata without inferring it from source age", async () => {
  let currentUrl = "about:blank";
  let navigationOptions;
  let waitedForSelector;
  const page = {
    goto: async (url, options) => { currentUrl = url; navigationOptions = options; },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    waitForSelector: async (selector) => { waitedForSelector = selector; },
    evaluate: async (_extractor, category) => {
      assert.equal(category, "monsters");
      return [
        {
          name: "Synthetic Watcher",
          type: "7",
          url: "https://www.dndbeyond.com/monsters/42-synthetic-watcher",
          sources: [{ title: "Older Compatible Expansion", url: null }],
          monster: {
            source: "Older Compatible Expansion",
            edition: "5e",
            legacy: false,
            challengeRating: "7",
            type: "Aberration",
            tags: ["NPC"],
            access: "unknown",
          },
        },
      ];
    },
  };
  const parsed = await search({ pages: () => [page] }, "Synthetic Watcher", "monsters");
  assert.equal(navigationOptions.waitUntil, "domcontentloaded");
  assert.match(waitedForSelector, /listing-body/);
  assert.equal(parsed.results[0].creatureId, "42");
  assert.equal(parsed.results[0].monster.legacy, false);
  assert.equal(parsed.results[0].monster.edition, "5e");
  assert.deepEqual(parsed.results[0].monster.tags, ["NPC"]);
});

function sourcebookHarness(cards, options = {}) {
  const visits = [];
  const fills = [];
  let currentUrl = "about:blank";
  const filter = {
    first: () => filter,
    count: async () => options.filterCount ?? 1,
    fill: async (query) => fills.push(query),
  };
  const page = {
    goto: async (url, options) => {
      currentUrl = url;
      visits.push({ url, options });
    },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    locator: () => filter,
    evaluate: async () => currentUrl === "https://www.dndbeyond.com" ? (options.authenticated ?? true) : cards,
  };
  return { context: { pages: () => [page] }, visits, fills };
}

test("sourcebook search defaults to accessible books", async () => {
  const harness = sourcebookHarness([
    {
      title: "Synthetic Handbook",
      ownership: "Owned",
      url: "https://www.dndbeyond.com/sources/dnd/synthetic-handbook",
      bookSlug: "dnd/synthetic-handbook",
      access: "accessible",
    },
    {
      title: "Store Handbook",
      ownership: "",
      url: "https://marketplace.dndbeyond.com/store-handbook",
      bookSlug: null,
      access: "unavailable",
    },
  ]);

  const parsed = await search(harness.context, "handbook", "sourcebooks");
  assert.equal(harness.visits[1].url, "https://www.dndbeyond.com/en/library?type=sourcebooks&ownership=owned-shared");
  assert.deepEqual(harness.fills, ["handbook"]);
  assert.equal(parsed.count, 1);
  assert.deepEqual(parsed.results[0], {
    name: "Synthetic Handbook",
    type: "sourcebook",
    url: "https://www.dndbeyond.com/sources/dnd/synthetic-handbook",
    bookSlug: "dnd/synthetic-handbook",
    access: "accessible",
    sources: [],
  });
});

test("all-sourcebook scope preserves unavailable and unknown catalog entries", async () => {
  const cards = [
    { title: "Store Book", ownership: "", url: "https://marketplace.dndbeyond.com/store-book", bookSlug: null, access: "unavailable" },
    { title: "Unclear Book", ownership: "", url: "https://www.dndbeyond.com/library/unclear", bookSlug: null, access: "unknown" },
  ];
  const harness = sourcebookHarness(cards);
  const parsed = await search(harness.context, "book", "sourcebooks", "all");

  assert.equal(harness.visits[1].url, "https://www.dndbeyond.com/en/library?type=sourcebooks");
  assert.deepEqual(parsed.results.map(({ access }) => access), ["unavailable", "unknown"]);
  assert.ok(parsed.results.every(({ bookSlug }) => bookSlug === null));
});

test("sourcebook search returns a JSON envelope for no matches", async () => {
  const parsed = await search(sourcebookHarness([]).context, "missing", "sourcebooks");
  assert.equal(parsed.count, 0);
  assert.deepEqual(parsed.results, []);
});

test("sourcebook search fails clearly when the title filter is missing", async () => {
  const harness = sourcebookHarness([], { filterCount: 0 });
  await assert.rejects(search(harness.context, "handbook", "sourcebooks"), /title filter was not found/);
});

test("sourcebook search rejects a logged-out session without opening the library", async () => {
  const harness = sourcebookHarness([], { authenticated: false });
  await assert.rejects(search(harness.context, "handbook", "sourcebooks"), /mysterium-auth login/);
  assert.equal(harness.visits.length, 1);
});

test("source_scope validation rejects non-sourcebook searches", () => {
  assert.throws(() => validateSearchRequest("spells", "all"), /only valid/);
  assert.deepEqual(validateSearchRequest("sourcebooks"), {
    sourceScope: "accessible", bookSlug: null, legacy: null, limit: 20, cursor: null, refresh: false,
  });
  assert.throws(() => validateSearchRequest("sourcebooks", undefined, { legacy: "only" }), /not valid/);
  assert.throws(() => validateSearchRequest("spells", undefined, { bookSlug: "dnd/book" }), /only valid/);
  assert.throws(() => validateSearchRequest("all", undefined, { bookSlug: "../private" }), /safe relative/);
  assert.throws(() => validateSearchRequest("all", undefined, { refresh: true }), /only valid.*book_slug/);
});

test("accessible library slugs resolve exactly or by one unique final segment", () => {
  const library = { count: 3, books: [
    { title: "Basic Rules", slug: "dnd/basic-rules-2014", ownership: "owned", url: "https://www.dndbeyond.com/sources/dnd/basic-rules-2014" },
    { title: "Other Basic Rules", slug: "partner/basic-rules-2014", ownership: "shared", url: "https://www.dndbeyond.com/sources/partner/basic-rules-2014" },
    { title: "Handbook", slug: "dnd/legacy/handbook", ownership: "owned", url: "https://www.dndbeyond.com/sources/dnd/legacy/handbook" },
  ] };
  assert.deepEqual(resolveLibraryBookSlug(library, "dnd/basic-rules-2014"), {
    slug: "dnd/basic-rules-2014", title: "Basic Rules",
  });
  assert.deepEqual(resolveLibraryBookSlug(library, "handbook"), {
    slug: "dnd/legacy/handbook", title: "Handbook",
  });
  assert.throws(() => resolveLibraryBookSlug(library, "basic-rules-2014"), /ambiguous.*dnd\/basic-rules-2014, partner\/basic-rules-2014/);
  assert.equal(resolveLibraryBookSlug(library, "wrong/handbook"), null, "incorrect namespaces are not silently discarded");
  assert.equal(resolveLibraryBookSlug(library, "missing"), null);
});

test("search filters Legacy results, paginates deterministically, and binds cursors", async () => {
  const raw = [
    { name: "Current One", type: "Spells", url: "/spells/current-one", legacy: false, snippets: ["Current One current snippet."], sources: [] },
    { name: "Legacy One", type: "Spells", url: "/spells/legacy-one", legacy: true, snippets: ["Legacy One old snippet."], sources: [] },
    { name: "Current Two", type: "Spells", url: "/spells/current-two", legacy: false, snippets: [], sources: [] },
  ];
  const visits = [];
  const page = {
    goto: async (url) => visits.push(url), url: () => visits.at(-1) ?? "about:blank", waitForTimeout: async () => {},
    evaluate: async () => ({ results: raw, reportedCount: 4 }),
  };
  const context = { pages: () => [page] };

  const current = await search(context, "rule", "all", undefined, { legacy: "exclude", limit: 1 });
  assert.deepEqual(current.results.map(({ name }) => name), ["Current One"]);
  assert.equal(current.total, 2);
  assert.equal(current.partial, true);
  assert.ok(current.nextCursor);
  assert.equal(decodeSearchCursor(current.nextCursor).offset, 1);

  const continued = await search(context, "rule", "all", undefined, { legacy: "exclude", cursor: current.nextCursor });
  assert.deepEqual(continued.results.map(({ name }) => name), ["Current Two"]);
  assert.equal(continued.done, true);
  await assert.rejects(search(context, "different", "all", undefined, { legacy: "exclude", cursor: current.nextCursor }), /does not match/);

  const legacy = await search(context, "rule", "all", undefined, { legacy: "only" });
  assert.deepEqual(legacy.results.map(({ name }) => name), ["Legacy One"]);
});

test("global search coalesces duplicate destinations and bounds snippets", async () => {
  const long = `Duplicate ${"x".repeat(700)}`;
  const page = {
    goto: async () => {}, url: () => "https://www.dndbeyond.com/search?q=duplicate", waitForTimeout: async () => {},
    evaluate: async () => ({ results: [
      { name: "Duplicate", type: "Compendium", url: "/sources/dnd/book/chapter#heading", legacy: false, snippets: [long], sources: [] },
      { name: "Duplicate", type: "Compendium", url: "/sources/dnd/book/chapter#heading", legacy: false, snippets: ["Distinct snippet"], sources: [] },
    ], reportedCount: 2 }),
  };
  const parsed = await search({ pages: () => [page] }, "duplicate", "all");
  assert.equal(parsed.total, 1);
  assert.equal(parsed.results[0].snippets.length, 2);
  assert.ok(Array.from(parsed.results[0].snippets[0]).length <= 500);
  assert.equal(parsed.results[0].bookLocation.bookSlug, "dnd/book");
});
