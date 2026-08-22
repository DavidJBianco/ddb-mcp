import assert from "node:assert/strict";
import test from "node:test";

import { search } from "../dist/tools/search.js";

function searchHarness(results) {
  const visits = [];
  const page = {
    goto: async (url, options) => visits.push({ url, options }),
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

  assert.match(output, /No results found for "missing spell"/);
  assert.match(output, /filter-search=missing%20spell/);
});
