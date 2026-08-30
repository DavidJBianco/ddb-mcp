import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { getCharacter, listCharacters } from "../dist/tools/character.js";
import { installSyntheticRoutes } from "./support/synthetic-routes.mjs";

test("character tools consume synthetic service responses without DOM-card extraction", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const state = await installSyntheticRoutes(context);

  const listing = await listCharacters(context, {
    names: ["hero"],
    classes: ["wizard"],
    species: ["construct"],
    campaignIds: ["7"],
    minLevel: 3,
  });
  assert.equal(listing.count, 1);
  assert.equal(listing.characters[0].id, "4242");
  assert.equal(listing.characters[0].campaign.name, "Synthetic Campaign");
  assert.ok(state.requests.some(({ url }) => url.includes("/character/v5/characters/list?userId=123")));

  const cached = await listCharacters(context, { names: ["synthetic"] });
  assert.equal(cached.count, 1);
  assert.equal(state.requests.filter(({ url }) => url.includes("/character/v5/characters/list?userId=123")).length, 1);
  await listCharacters(context, { refresh: true });
  assert.equal(state.requests.filter(({ url }) => url.includes("/character/v5/characters/list?userId=123")).length, 2);

  const detail = await getCharacter(context, "4242");
  assert.equal(detail.character.name, "Synthetic Hero");
  assert.match(detail.portraitUrl, /synthetic-hero\.jpeg/);
  assert.deepEqual(state.unmatched, []);
});
