import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getCampaign, listMyCampaigns } from "../dist/tools/campaign.js";
import { downloadCharacter, getCharacter, listCharacters } from "../dist/tools/character.js";
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

test("character tools handle synthetic API data, empty listings, and temporary downloads", async (t) => {
  const characterContext = contextFor((argument) => ({
    data: { id: Number(argument), name: "Synthetic Hero" },
  }));
  assert.equal(JSON.parse(await getCharacter(characterContext, "4242")).data.id, 4242);

  const directory = await mkdtemp(join(tmpdir(), "ddb-mcp-test-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "character.json");
  await downloadCharacter(characterContext, "4242", outputPath);
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).data.name, "Synthetic Hero");

  assert.deepEqual(JSON.parse(await listCharacters(contextFor([]))), []);
});

test("campaign tools return deterministic empty and detail shapes", async () => {
  assert.deepEqual(JSON.parse(await listMyCampaigns(contextFor([]))), []);
  assert.deepEqual(
    JSON.parse(await getCampaign(contextFor({ name: "Synthetic Campaign", characters: [] }), "7")),
    { name: "Synthetic Campaign", characters: [] }
  );
});

test("library tools handle empty listings and structured short content", async () => {
  assert.deepEqual(JSON.parse(await listLibrary(contextFor([]))), { count: 0, books: [] });
  const output = JSON.parse(await readBook(contextFor({
    title: "Synthetic Heading",
    outline: [{ id: "section-synthetic-heading-1", title: "Synthetic Heading", level: 2, parentId: null }],
    blocks: [
      { text: "## Synthetic Heading", headingId: "section-synthetic-heading-1", headingLevel: 2, imageIds: [] },
      { text: "Original fixture paragraph.", imageIds: [] },
    ],
    images: [],
  }), { bookSlug: "synthetic-handbook", chapterSlug: "safe-examples" }));
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

  await assert.rejects(listCharacters(context), /ddb-mcp-auth login/);
  await assert.rejects(listMyCampaigns(context), /ddb-mcp-auth login/);
  await assert.rejects(listLibrary(context), /ddb-mcp-auth login/);
  await assert.rejects(readBook(context, { bookSlug: "synthetic-handbook" }), /ddb-mcp-auth login/);
  await assert.rejects(interact(context, "click", "button"), /ddb-mcp-auth login/);
  await assert.rejects(getCurrentPageContent(context), /ddb-mcp-auth login/);
});

test("character-service authorization failures use the shared authentication error", async () => {
  const context = contextFor(() => {
    throw new Error("API returned 403: Forbidden");
  });
  await assert.rejects(getCharacter(context, "4242"), /ddb-mcp-auth login/);
});
