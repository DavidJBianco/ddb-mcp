import assert from "node:assert/strict";
import test from "node:test";

import {
  creatureIdFromUrl,
  extractStatBlock,
  getStatBlock,
  normalizeCreatureName,
  selectStatBlockCandidates,
  StatBlockInaccessibleError,
  validateStatBlockRequest,
} from "../dist/tools/stat-block.js";

function monsterResult({ id, name = "Synthetic Watcher", legacy = false, edition = null, source = "Synthetic Manual" }) {
  return {
    name,
    type: "7",
    url: `https://www.dndbeyond.com/monsters/${id}-synthetic-watcher`,
    sources: [],
    creatureId: String(id),
    monster: {
      source,
      edition,
      legacy,
      challengeRating: "7",
      type: "Aberration",
      tags: legacy ? ["NPC"] : [],
      access: "unknown",
    },
  };
}

test("stat-block input and monster URLs are validated before browser access", () => {
  assert.throws(() => validateStatBlockRequest({}), /exactly one/);
  assert.throws(() => validateStatBlockRequest({ query: "Guard", creatureId: "42" }), /exactly one/);
  assert.throws(() => validateStatBlockRequest({ creatureId: "4x" }), /only digits/);
  assert.deepEqual(validateStatBlockRequest({ query: "  Town   Guard " }), {
    query: "Town Guard",
    creatureId: undefined,
    legacy: "include",
  });
  assert.equal(creatureIdFromUrl("https://www.dndbeyond.com/monsters/16915-guard"), "16915");
  assert.equal(creatureIdFromUrl("https://marketplace.dndbeyond.com/monsters/16915-guard"), null);
  assert.equal(creatureIdFromUrl("https://www.dndbeyond.com/monsters/not-an-id"), null);
});

test("name normalization is conservative and deterministic", () => {
  assert.equal(normalizeCreatureName(" Strahd   von Zarovich "), "strahd von zarovich");
  assert.equal(normalizeCreatureName("Mage—Hunter’s Golem"), "mage-hunter's golem");
  assert.notEqual(normalizeCreatureName("Guard Captain"), normalizeCreatureName("Guard-Captain"));
});

test("candidate selection prefers one non-Legacy entry without treating all 5e content as Legacy", () => {
  const current5e = monsterResult({ id: 1, edition: "5e", legacy: false, source: "Compatible Expansion" });
  const current55 = monsterResult({ id: 2, edition: "5.5e", legacy: false });
  const legacy = monsterResult({ id: 3, edition: "5e", legacy: true });

  assert.deepEqual(selectStatBlockCandidates("Synthetic Watcher", [current5e, legacy], "include").eligible.map(({ id }) => id), ["1"]);
  assert.deepEqual(selectStatBlockCandidates("Synthetic Watcher", [current5e, current55, legacy], "include").eligible.map(({ id }) => id), ["1", "2"]);
  assert.deepEqual(selectStatBlockCandidates("Synthetic Watcher", [current5e, legacy], "only").eligible.map(({ id }) => id), ["3"]);
  assert.deepEqual(selectStatBlockCandidates("Synthetic Watcher", [current5e, legacy], "exclude").eligible.map(({ id }) => id), ["1"]);
});

function extractionContext(extracted, { redirect } = {}) {
  let currentUrl = "about:blank";
  const page = {
    goto: async (url) => {
      currentUrl = url === "https://www.dndbeyond.com" ? url : (redirect ?? "https://www.dndbeyond.com/monsters/42-synthetic-watcher");
    },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => currentUrl === "https://www.dndbeyond.com" ? true : extracted,
  };
  page.close = async () => {};
  return { newPage: async () => page };
}

test("extraction returns canonical structured data and faithful Markdown", async () => {
  const extracted = {
    name: "Synthetic Watcher",
    source: "Synthetic Manual",
    edition: "5.5e",
    legacy: false,
    size: "Large",
    type: "Aberration",
    alignment: "Neutral",
    tags: ["NPC"],
    challengeRating: "7 (2,900 XP)",
    attributes: [{ label: "Armor Class", value: "16" }],
    abilities: [{ name: "STR", score: 18, modifier: "+4", save: "+7" }],
    sections: [{ title: "Actions", kind: "actions", entries: [{ name: "Ray", text: "Ray. Synthetic ranged attack." }] }],
    markdown: "# Synthetic Watcher\n\n## Actions\n\n**Ray.** Synthetic ranged attack.",
  };
  const result = await extractStatBlock(extractionContext(extracted), "42", "https://www.dndbeyond.com/monsters/42-synthetic-watcher");
  assert.equal(result.kind, "stat_block");
  assert.equal(result.creature.name, "Synthetic Watcher");
  assert.equal(result.creature.edition, "5.5e");
  assert.deepEqual(result.creature.tags, ["NPC"]);
  assert.match(result.markdown, /Synthetic ranged attack/);
});

test("store redirects are reported as inaccessible instead of authentication failures", async () => {
  await assert.rejects(
    extractStatBlock(extractionContext(null, { redirect: "https://marketplace.dndbeyond.com/category/42" }), "42", "https://www.dndbeyond.com/monsters/42-synthetic-watcher"),
    (error) => error instanceof StatBlockInaccessibleError && /store|unavailable/.test(error.message)
  );
});

test("an inaccessible automatically preferred match returns its failure and alternatives", async () => {
  let currentUrl = "about:blank";
  const current = monsterResult({ id: 42, edition: "5.5e", legacy: false });
  const legacy = monsterResult({ id: 41, edition: "5e", legacy: true });
  const page = {
    goto: async (url) => { currentUrl = url; },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    evaluate: async (_extractor, category) => {
      if (category === "monsters") return [current, legacy];
      if (currentUrl === "https://www.dndbeyond.com") return true;
      return null;
    },
  };
  page.close = async () => {};
  const result = await getStatBlock({ newPage: async () => page }, { query: "Synthetic Watcher" });
  assert.equal(result.kind, "candidates");
  assert.deepEqual(result.candidates.map(({ id }) => id), ["42", "41"]);
  assert.equal(result.candidates[0].access, "unavailable");
  assert.match(result.candidates[0].accessFailure, /not accessible/);
});
