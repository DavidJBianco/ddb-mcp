import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { getCampaign, listMyCampaigns } from "../dist/tools/campaign.js";
import { installSyntheticRoutes } from "./support/synthetic-routes.mjs";

test("campaign tools combine rendered visibility with page-issued read-only responses", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const state = await installSyntheticRoutes(context);

  const listing = await listMyCampaigns(context, {
    names: ["synthetic"],
    campaignIds: ["7"],
    roles: ["dungeon_master"],
    createdOnOrAfter: "2025-01-02",
    minPlayers: 1,
    contentSharingEnabled: true,
  });
  assert.equal(listing.count, 1);
  assert.equal(listing.campaigns[0].createdOn, "2025-01-02");

  const detail = await getCampaign(context, "7", {
    includeInviteLink: true,
    includeAdministrationLinks: true,
  });
  assert.equal(detail.partial, false);
  assert.equal(detail.campaign.viewerRole, "dungeon_master");
  assert.equal(detail.campaign.notes.private.value, "Synthetic private note.");
  assert.equal(detail.campaign.characters.value[0].id, "4242");
  assert.match(detail.campaign.links.invite.value.url, /\/campaigns\/join\//);
  assert.deepEqual(detail.campaign.links.administration.value, [
    { kind: "edit", url: "https://www.dndbeyond.com/campaigns/7/edit" },
  ]);
  assert.ok(state.requests.some(({ url }) => url.includes("/campaigns/v1/details/7")));
  assert.deepEqual(state.unmatched, []);
});
