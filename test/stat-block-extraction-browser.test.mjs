import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { searchResults } from "../dist/tools/search.js";
import { getStatBlock } from "../dist/tools/stat-block.js";

const currentStatBlock = `<!doctype html><html><body><main>
  <article class="mon-stat-block-2024">
    <header><h1 class="mon-stat-block-2024__name">Synthetic Guard</h1><p class="mon-stat-block-2024__meta">Medium or Small Humanoid, Neutral</p></header>
    <div class="styles_attributes_hash">
      <div class="styles_attribute__hash"><h2 class="styles_attributeLabel_hash">AC</h2><p>16</p></div>
      <div class="styles_attribute__hash"><h2 class="styles_attributeLabel_hash">Initiative</h2><p>+1 (11)</p></div>
      <div class="styles_attribute__hash"><h2 class="styles_attributeLabel_hash">HP</h2><p>11 (2d8 + 2)</p></div>
      <div class="styles_attribute__hash"><h2 class="styles_attributeLabel_hash">Speed</h2><p>30 ft.</p></div>
    </div>
    <table><thead><tr><th>Ability</th><th>Score</th><th>Mod</th><th>Save</th></tr></thead><tbody>
      <tr><td>STR</td><td>13</td><td>+1</td><td>+1</td></tr>
      <tr><td>DEX</td><td>12</td><td>+1</td><td>+1</td></tr>
      <tr><td>CON</td><td>12</td><td>+1</td><td>+1</td></tr>
      <tr><td>INT</td><td>10</td><td>+0</td><td>+0</td></tr>
      <tr><td>WIS</td><td>11</td><td>+0</td><td>+0</td></tr>
      <tr><td>CHA</td><td>10</td><td>+0</td><td>+0</td></tr>
    </tbody></table>
    <p><strong>Skills</strong> Perception +2</p>
    <p><strong>Senses</strong> Passive Perception 12</p>
    <p><strong>Languages</strong> Common</p>
    <p><strong>CR</strong> 1/8 (XP 25; PB +2)</p>
    <h2>Traits</h2>
    <div class="styles_entries_hash">
      <p><em><strong>Darklord Restoration.</strong></em> The guard revives after a synthetic interval.</p>
      <p><em><strong>Legendary Resistance (3/Day).</strong></em> The guard can choose to succeed instead.</p>
      <p><em><strong>Misty Escape.</strong></em> The guard becomes synthetic mist.</p>
      <p><em><strong>Vampire Weaknesses.</strong></em> The guard has these weaknesses: <em><strong>Sunlight.</strong></em> It dislikes synthetic sunlight.</p>
    </div>
    <h2>Actions</h2>
    <div class="styles_entries_hash"><p><strong>Spear.</strong> Synthetic melee or ranged attack.</p></div>
    <footer class="source">Synthetic Manual, pg. 1</footer>
  </article>
</main></body></html>`;

test("extracts the current abbreviated AC/HP stat-block layout", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route("https://www.dndbeyond.com/**", async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === "/"
      ? "<!doctype html><html><body>Signed in synthetic user</body></html>"
      : url.pathname === "/monsters"
        ? `<!doctype html><html><body><main class="listing-body"><div class="info" data-slug="synthetic-guard">
            <a class="link" href="/monsters/43-synthetic-guard">Synthetic Guard</a>
            <div class="row monster-challenge"><span>1/8</span></div>
          </div></main></body></html>`
        : currentStatBlock;
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body,
    });
  });
  const page = await context.newPage();

  const catalog = await searchResults(context, "Synthetic Guard", "monsters");
  assert.equal(catalog.results[0].creatureId, "43");
  const result = await getStatBlock(context, { creatureId: "43" });
  assert.equal(result.kind, "stat_block");
  if (result.kind !== "stat_block") throw new Error("expected a synthetic stat block");
  assert.equal(result.creature.name, "Synthetic Guard");
  assert.equal(result.creature.size, "Medium or Small");
  assert.equal(result.creature.type, "Humanoid");
  assert.equal(result.creature.challengeRating, "1/8 (XP 25; PB +2)");
  assert.deepEqual(result.attributes.slice(0, 4), [
    { label: "AC", value: "16" },
    { label: "Initiative", value: "+1 (11)" },
    { label: "HP", value: "11 (2d8 + 2)" },
    { label: "Speed", value: "30 ft." },
  ]);
  assert.deepEqual(result.abilities[0], { name: "STR", score: 13, modifier: "+1", save: "+1" });
  assert.equal(result.sections[0].title, "Traits");
  assert.deepEqual(result.sections[0].entries.map(({ name }) => name), [
    "Darklord Restoration",
    "Legendary Resistance (3/Day)",
    "Misty Escape",
    "Vampire Weaknesses",
  ]);
  assert.equal(result.sections[1].title, "Actions");
  assert.equal(result.sections[1].entries[0].name, "Spear");
  assert.match(result.markdown, /Synthetic melee or ranged attack/);
  assert.match(result.markdown, /\*\*Misty Escape\.\*\* The guard becomes synthetic mist/);
  assert.match(result.markdown, /\| Ability \| Score \| Modifier \| Save \|\n\| --- \| ---: \| ---: \| ---: \|\n\| STR \| 13 \| \+1 \| \+1 \|\n\| DEX/);
  assert.doesNotMatch(result.markdown, /\| Ability \| Score \| Modifier \| Save \|\n\n/);
});

test("concurrent stat-block lookups cannot cross their creature pages", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  await context.route("https://www.dndbeyond.com/**", async (route) => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname === "/") {
      body = "<!doctype html><html><body>Signed in synthetic user</body></html>";
    } else if (url.pathname === "/monsters") {
      const isStrahd = url.searchParams.get("filter-search") === "Synthetic Strahd";
      const id = isStrahd ? "44" : "43";
      const name = isStrahd ? "Synthetic Strahd" : "Synthetic Guard";
      body = `<!doctype html><html><body><main class="listing-body"><div class="info" data-slug="${name.toLowerCase().replaceAll(" ", "-")}">
        <a class="link" href="/monsters/${id}-${name.toLowerCase().replaceAll(" ", "-")}">${name}</a>
        <div class="row monster-challenge"><span>1/8</span></div>
      </div></main></body></html>`;
    } else {
      const isStrahd = url.pathname.startsWith("/monsters/44-");
      if (!isStrahd) await new Promise((resolve) => setTimeout(resolve, 75));
      body = isStrahd
        ? currentStatBlock.replaceAll("Synthetic Guard", "Synthetic Strahd")
        : currentStatBlock;
    }
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  });

  const [guard, strahd] = await Promise.all([
    getStatBlock(context, { query: "Synthetic Guard" }),
    getStatBlock(context, { query: "Synthetic Strahd" }),
  ]);
  assert.equal(guard.kind, "stat_block");
  assert.equal(strahd.kind, "stat_block");
  if (guard.kind !== "stat_block" || strahd.kind !== "stat_block") throw new Error("expected two synthetic stat blocks");
  assert.equal(guard.creature.name, "Synthetic Guard");
  assert.match(guard.creature.url, /\/monsters\/43-synthetic-guard$/);
  assert.equal(strahd.creature.name, "Synthetic Strahd");
  assert.match(strahd.creature.url, /\/monsters\/44-synthetic-strahd$/);
});
