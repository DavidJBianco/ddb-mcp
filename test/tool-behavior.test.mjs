import assert from "node:assert/strict";
import test from "node:test";

import { getCampaign, listMyCampaigns } from "../dist/tools/campaign.js";
import { getCharacter, listCharacters } from "../dist/tools/character.js";
import { listLibrary, readBook } from "../dist/tools/library.js";
import { getCurrentPageContent, interact } from "../dist/tools/navigate.js";

function contextFor(finalValue) {
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
      return typeof finalValue === "function" ? finalValue(argument, currentUrl) : finalValue;
    },
  };
  return { pages: () => [page] };
}

test("character detail handles synthetic API data", async () => {
  const characterContext = contextFor(() => ({
    kind: "success",
    body: { success: true, data: { id: 4242, name: "Synthetic Hero", decorations: null } },
  }));
  assert.equal((await getCharacter(characterContext, "4242")).character.id, 4242);
});

test("campaign tools return deterministic empty and detail shapes", async () => {
  const listing = await listMyCampaigns(contextFor({ recognized: true, items: [] }));
  assert.deepEqual(listing, {
    count: 0,
    total: 0,
    filters: { names: [], campaignIds: [], roles: [], createdOnOrAfter: null, createdOnOrBefore: null, minPlayers: null, maxPlayers: null, contentSharingEnabled: null },
    sort: { field: "name", direction: "asc" },
    campaigns: [],
  });
  const campaign = await getCampaign(contextFor({
    name: "Synthetic Campaign",
    currentUserId: null,
    dmControlsVisible: false,
    description: { present: false, text: "" },
    publicNotes: { present: false, text: "" },
    privateNotes: { present: false, text: "" },
    characterSectionPresent: true,
    characters: [],
    inviteUrl: null,
    administrationLinks: [],
  }), "7");
  assert.equal(campaign.partial, true);
  assert.equal(campaign.campaign.name, "Synthetic Campaign");
  assert.equal(campaign.campaign.characters.state, "empty");
});

test("library tools handle empty listings and structured short content", async () => {
  assert.deepEqual(await listLibrary(contextFor([])), { count: 0, books: [] });
  const output = await readBook(contextFor({
    title: "Synthetic Heading",
    outline: [{ id: "section-synthetic-heading-1", title: "Synthetic Heading", level: 2, parentId: null }],
    blocks: [
      { text: "## Synthetic Heading", headingId: "section-synthetic-heading-1", headingLevel: 2, imageIds: [] },
      { text: "Original fixture paragraph.", imageIds: [] },
    ],
    images: [],
  }), { bookSlug: "synthetic-handbook", chapterSlug: "safe-examples" });
  assert.match(output.text, /## Synthetic Heading/);
  assert.match(output.text, /Original fixture paragraph/);
});

test("authenticated tools reject a logged-out synthetic page", async () => {
  const page = {
    goto: async () => {},
    waitForTimeout: async () => {},
    url: () => "https://www.dndbeyond.com/login",
    evaluate: async () => false,
  };
  const context = { pages: () => [page] };

  await assert.rejects(listCharacters(context), /mysterium-auth login/);
  await assert.rejects(listMyCampaigns(context), /mysterium-auth login/);
  await assert.rejects(listLibrary(context), /mysterium-auth login/);
  await assert.rejects(readBook(context, { bookSlug: "synthetic-handbook" }), /mysterium-auth login/);
  await assert.rejects(interact(context, "click", "button"), /mysterium-auth login/);
  await assert.rejects(getCurrentPageContent(context), /mysterium-auth login/);
});

test("character-service access denials are not misreported as expired authentication", async () => {
  const context = contextFor(() => ({ kind: "service-http-error", status: 403 }));
  await assert.rejects(getCharacter(context, "4242"), /denied the authenticated service request/);
});

test("character-service 401 responses use the shared authentication error", async () => {
  const context = contextFor(() => ({ kind: "service-http-error", status: 401 }));
  await assert.rejects(getCharacter(context, "4242"), /mysterium-auth login/);
});
