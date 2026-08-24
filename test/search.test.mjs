import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSourceAttribution,
  normalizeSourceAttributions,
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
      sources: [
        {
          title: "Synthetic Handbook",
          url: "https://www.dndbeyond.com/sources/dnd/synthetic-handbook",
          bookSlug: "dnd/synthetic-handbook",
          chapterSlug: null,
        },
      ],
    },
  ];
  const harness = searchHarness(expectedResults);

  const output = await search(harness.context, "fire bolt", "spells");
  const parsed = JSON.parse(output);

  assert.equal(
    harness.visits[0].url,
    "https://www.dndbeyond.com/spells?filter-search=fire%20bolt"
  );
  assert.equal(harness.visits[0].options.waitUntil, "networkidle");
  assert.equal(parsed.query, "fire bolt");
  assert.equal(parsed.category, "spells");
  assert.equal(parsed.count, 1);
  assert.deepEqual(parsed.results, expectedResults);
});

test("search reports an empty synthetic result set", async () => {
  const harness = searchHarness([]);

  const output = await search(harness.context, "missing spell", "spells");

  const parsed = JSON.parse(output);
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

  const parsed = JSON.parse(await search(harness.context, "sources", "spells"));
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
  const parsed = JSON.parse(await search({ pages: () => [page] }, "Synthetic Watcher", "monsters"));
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

  const parsed = JSON.parse(await search(harness.context, "handbook", "sourcebooks"));
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
  const parsed = JSON.parse(await search(harness.context, "book", "sourcebooks", "all"));

  assert.equal(harness.visits[1].url, "https://www.dndbeyond.com/en/library?type=sourcebooks");
  assert.deepEqual(parsed.results.map(({ access }) => access), ["unavailable", "unknown"]);
  assert.ok(parsed.results.every(({ bookSlug }) => bookSlug === null));
});

test("sourcebook search returns a JSON envelope for no matches", async () => {
  const parsed = JSON.parse(await search(sourcebookHarness([]).context, "missing", "sourcebooks"));
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
  assert.equal(validateSearchRequest("sourcebooks"), "accessible");
});
