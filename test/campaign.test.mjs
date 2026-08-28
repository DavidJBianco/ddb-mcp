import assert from "node:assert/strict";
import test from "node:test";

import {
  getCampaign,
  normalizeCampaignList,
  validateCampaignListRequest,
} from "../dist/tools/campaign.js";

function item(overrides = {}) {
  return {
    id: "7",
    name: "Synthetic Campaign",
    roleText: "Role: Dungeon Master",
    createdText: "Created: 1/2/2025",
    playerCountText: "3 Players",
    sharingText: "Content Sharing Enabled",
    ...overrides,
  };
}

test("campaign list normalization publishes deterministic defaults and canonical URLs", () => {
  const result = normalizeCampaignList({ recognized: true, items: [
    item({ id: "12", name: "zeta", roleText: "Role: Player", playerCountText: "1 Player" }),
    item({ id: "7", name: "Alpha" }),
  ] });
  assert.deepEqual(result.campaigns.map(({ id }) => id), ["7", "12"]);
  assert.equal(result.campaigns[0].url, "https://www.dndbeyond.com/campaigns/7");
  assert.equal(result.campaigns[0].createdOn, "2025-01-02");
  assert.equal(result.campaigns[0].role, "dungeon_master");
  assert.deepEqual(result.filters, {
    names: [], campaignIds: [], roles: [], createdOnOrAfter: null, createdOnOrBefore: null,
    minPlayers: null, maxPlayers: null, contentSharingEnabled: null,
  });
  assert.deepEqual(result.sort, { field: "name", direction: "asc" });
});

test("campaign list filters compose with inclusive boundaries", () => {
  const result = normalizeCampaignList({ recognized: true, items: [
    item(),
    item({ id: "8", name: "Other Table", roleText: "Role: Player", createdText: "2024-01-01", playerCountText: "6", sharingText: "Content Sharing Disabled" }),
  ] }, {
    names: ["synthetic", "missing"],
    campaignIds: ["7", "99"],
    roles: ["dungeon_master"],
    createdOnOrAfter: "2025-01-02",
    createdOnOrBefore: "2025-01-02",
    minPlayers: 3,
    maxPlayers: 3,
    contentSharingEnabled: true,
  });
  assert.equal(result.total, 2);
  assert.equal(result.count, 1);
  assert.equal(result.campaigns[0].id, "7");
});

test("campaign list supports every public sort field with stable ties", () => {
  const items = [
    item({ id: "10", name: "Same", roleText: "Role: Player", createdText: "2025-03-01", playerCountText: "5", sharingText: "Disabled" }),
    item({ id: "2", name: "Same", roleText: "Role: Dungeon Master", createdText: "2025-01-01", playerCountText: "1", sharingText: "Enabled" }),
  ];
  for (const field of ["name", "role", "created", "players", "content_sharing"]) {
    const result = normalizeCampaignList({ recognized: true, items }, { sortBy: field, sortDirection: "desc" });
    assert.equal(result.campaigns.length, 2);
    assert.equal(result.sort.field, field);
  }
  assert.deepEqual(
    normalizeCampaignList({ recognized: true, items }, { sortBy: "name" }).campaigns.map(({ id }) => id),
    ["2", "10"]
  );
});

test("campaign list validates input and changed upstream structure", () => {
  for (const request of [
    { campaignIds: ["bad"] },
    { createdOnOrAfter: "2025-02-30" },
    { createdOnOrAfter: "2025-02-02", createdOnOrBefore: "2025-02-01" },
    { minPlayers: 3, maxPlayers: 2 },
  ]) assert.throws(() => validateCampaignListRequest(request));
  assert.throws(() => normalizeCampaignList({ recognized: false, items: [] }), /not recognized/);
  assert.throws(() => normalizeCampaignList({ recognized: true, items: [item(), item()] }), /duplicate/);
  assert.throws(() => normalizeCampaignList({ recognized: true, items: [item({ sharingText: "mystery" })] }), /sharing state/);
  assert.deepEqual(normalizeCampaignList({ recognized: true, items: [] }).campaigns, []);
});

function response(url, body) {
  return { url: () => url, status: () => 200, ok: () => true, json: async () => body };
}

function campaignContext({ details = null, short = null, dom }) {
  let currentUrl = "about:blank";
  const responses = [
    details && response("https://api.dndbeyond.com/campaigns/v1/details/7", details),
    short && response("https://www.dndbeyond.com/api/campaign/stt/active-short-characters/7", short),
  ].filter(Boolean);
  const page = {
    goto: async (url) => { currentUrl = url; },
    url: () => currentUrl,
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    waitForResponse: async (predicate) => {
      const found = responses.find(predicate);
      if (!found) throw new Error("synthetic response unavailable");
      return found;
    },
    evaluate: async (_callback, argument) => {
      if (currentUrl === "https://www.dndbeyond.com" && argument === undefined) return true;
      return dom;
    },
  };
  return { pages: () => [page] };
}

const details = {
  data: {
    id: 7, name: "Synthetic Campaign", status: 1, dateCreated: "2025-01-02T03:04:05Z",
    dmId: 10, dmDisplayName: "Synthetic DM", contentSharingEnabled: true, itemSharingEnabled: false,
    activePlayers: [{ id: 20, displayName: "Synthetic Player" }],
    activeCharacters: [{ id: 42, name: "Synthetic Hero", userId: 20, isPrivate: false }],
  },
};
const short = {
  status: "success",
  data: [{ id: 42, name: "Synthetic Hero", userId: 20, userName: "Synthetic Player", characterStatus: 1, isAssigned: true }],
};
const dom = {
  name: "Synthetic Campaign", currentUserId: "10", dmControlsVisible: true,
  description: { present: true, text: "Synthetic description" },
  publicNotes: { present: true, text: "Public note" }, privateNotes: { present: true, text: "Private note" },
  characterSectionPresent: true, characters: [{ id: "42", name: "Synthetic Hero" }],
  inviteUrl: "https://www.dndbeyond.com/campaigns/join/synthetic-secret",
  administrationLinks: [
    { marker: "campaign edit", url: "https://www.dndbeyond.com/campaigns/7/edit" },
    { marker: "campaign delete", url: "https://www.dndbeyond.com/campaigns/7/delete" },
    { marker: "campaign manage", url: "https://evil.example/campaigns/7/manage" },
  ],
};

test("campaign detail combines structured metadata with rendered visibility", async () => {
  const result = await getCampaign(campaignContext({ details, short, dom }), "7");
  assert.equal(result.partial, false);
  assert.equal(result.campaign.viewerRole, "dungeon_master");
  assert.equal(result.campaign.notes.private.value, "Private note");
  assert.equal(result.campaign.characters.value[0].status, 1);
  assert.equal(result.campaign.links.invite.state, "unavailable");
  assert.equal(result.campaign.links.administration.state, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
});

test("campaign detail gates sensitive links and excludes destructive or foreign targets", async () => {
  const result = await getCampaign(campaignContext({ details, short, dom }), "7", {
    includePrivateNotes: false,
    includeInviteLink: true,
    includeAdministrationLinks: true,
  });
  assert.equal(result.campaign.notes.private.state, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /Private note/);
  assert.equal(result.campaign.links.invite.value.url, "https://www.dndbeyond.com/campaigns/join/synthetic-secret");
  assert.deepEqual(result.campaign.links.administration.value, [
    { kind: "edit", url: "https://www.dndbeyond.com/campaigns/7/edit" },
  ]);
});

test("campaign detail returns a stable partial DOM fallback", async () => {
  const fallbackDom = { ...dom, currentUserId: null, characters: [], privateNotes: { present: false, text: "" } };
  const result = await getCampaign(campaignContext({ dom: fallbackDom }), "7");
  assert.equal(result.partial, true);
  assert.equal(result.campaign.identityProvenance, "rendered-dom");
  assert.equal(result.campaign.status.state, "unavailable");
  assert.equal(result.campaign.characters.state, "empty");
});

test("campaign detail preserves player permissions, private-character flags, and empty sections", async () => {
  const playerDetails = { data: {
    ...details.data,
    activePlayers: [{ id: 20, displayName: "Synthetic Player" }],
    activeCharacters: [{ id: 42, name: "Private Hero", userId: 20, isPrivate: true }],
  } };
  const playerDom = {
    ...dom,
    currentUserId: "20",
    dmControlsVisible: false,
    publicNotes: { present: true, text: "" },
    privateNotes: { present: false, text: "" },
    characters: [{ id: "42", name: "Private Hero" }],
  };
  const result = await getCampaign(campaignContext({ details: playerDetails, short, dom: playerDom }), "7");
  assert.equal(result.campaign.viewerRole, "player");
  assert.equal(result.campaign.notes.public.state, "empty");
  assert.equal(result.campaign.notes.private.state, "unavailable");
  assert.equal(result.campaign.characters.value[0].isPrivate, true);
});

test("campaign detail rejects missing or mismatched identity", async () => {
  await assert.rejects(getCampaign(campaignContext({ dom: { ...dom, name: "" } }), "7"), /campaign name/);
  await assert.rejects(getCampaign(campaignContext({ details, short, dom: { ...dom, name: "Different" } }), "7"), /did not match/);
});
