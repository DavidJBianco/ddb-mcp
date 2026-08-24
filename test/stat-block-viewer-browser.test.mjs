import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chromium } from "playwright";

const viewerPath = new URL("../dist/apps/stat-block-viewer.html", import.meta.url);

const statBlock = {
  kind: "stat_block",
  creature: {
    id: "42",
    name: "Synthetic Watcher",
    url: "https://www.dndbeyond.com/monsters/42-synthetic-watcher",
    source: "Synthetic Manual",
    edition: "5.5e",
    legacy: false,
    size: "Large",
    type: "Aberration",
    alignment: "Neutral",
    tags: ["NPC"],
    challengeRating: "7",
  },
  attributes: [
    { label: "Armor Class", value: "16" },
    { label: "Hit Points", value: "85" },
  ],
  abilities: [
    { name: "STR", score: 18, modifier: "+4", save: "+7" },
    { name: "DEX", score: 12, modifier: "+1", save: null },
  ],
  sections: [
    { title: "Traits", kind: "traits", entries: [
      { name: "Alert", text: "Alert. The watcher cannot be surprised." },
      { name: "Restoration", text: "Restoration. The watcher returns after a synthetic interval." },
      { name: "Misty Escape", text: "Misty Escape. The watcher becomes synthetic mist." },
    ] },
    { title: "Actions", kind: "actions", entries: [{ name: "Ray", text: "Ray. Synthetic ranged attack." }] },
  ],
  markdown: "# Synthetic Watcher\n\n| Ability | Score | Modifier | Save |\n| --- | ---: | ---: | ---: |\n| STR | 18 | +4 | +7 |\n| DEX | 12 | +1 | |\n\n## Actions\n\n**Ray.** Synthetic ranged attack.",
};

async function openViewer(page, canonicalBlock = statBlock, extraCss = "", appToolResult, waitForCreature = true, preload = false) {
  const html = (await readFile(viewerPath, "utf8")).replace("</head>", `<style>${extraCss}</style></head>`);
  await page.setContent('<!doctype html><iframe id="viewer" style="width:100%;height:900px;border:0"></iframe>');
  await page.evaluate(({ canonicalBlock, appToolResult, preload }) => {
    window.hostMessages = [];
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;
      window.hostMessages.push(message);
      const reply = (result) => event.source.postMessage({ jsonrpc: "2.0", id: message.id, result }, "*");
      if (message.method === "ui/initialize") {
        reply({
          protocolVersion: "2026-01-26",
          hostInfo: { name: "Synthetic MCP App Host", version: "1.0.0" },
          hostCapabilities: { openLinks: {}, downloadFile: {}, serverTools: {}, sandbox: { permissions: { clipboardWrite: {} } } },
          hostContext: { theme: "light", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] }
        });
      } else if (message.method === "ui/notifications/initialized") {
        event.source.postMessage({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            content: [{ type: "text", text: "Ready" }],
            structuredContent: { kind: "resolved", candidate: canonicalBlock.creature },
            ...(preload ? { _meta: { statBlock: canonicalBlock } } : {}),
          }
        }, "*");
      } else if (message.method === "tools/call") {
        reply(appToolResult ?? { content: [{ type: "text", text: "Loaded" }], structuredContent: canonicalBlock });
      } else if (message.method === "ui/request-display-mode") {
        reply({ mode: message.params.mode });
      } else if (message.method === "ui/open-link" || message.method === "ui/download-file") {
        reply({});
      }
    });
  }, { canonicalBlock, appToolResult, preload });
  await page.locator("#viewer").evaluate((iframe, source) => { iframe.srcdoc = source; }, html);
  const frame = page.frameLocator("#viewer");
  if (waitForCreature) {
    await frame.locator("#creature-name").waitFor({ timeout: 10_000 }).catch(async (error) => {
      const messages = await page.evaluate(() => window.hostMessages);
      const status = await frame.locator("#status").textContent().catch(() => "viewer document did not load");
      throw new Error(`Viewer did not render (${status}); host methods: ${(messages ?? []).map(({ method }) => method).join(", ")}`, { cause: error });
    });
  }
  return frame;
}

test("the viewer redraws from app-private data without repeating the D&D Beyond read", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const frame = await openViewer(page, statBlock, "", undefined, true, true);

  assert.equal(await frame.locator("#creature-name").textContent(), "Synthetic Watcher");
  assert.equal((await page.evaluate(() => window.hostMessages)).filter(({ method }) => method === "tools/call").length, 0);

  await page.evaluate((canonicalBlock) => {
    document.querySelector("#viewer").contentWindow.postMessage({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        content: [{ type: "text", text: "Ready again" }],
        structuredContent: { kind: "resolved", candidate: canonicalBlock.creature },
        _meta: { statBlock: canonicalBlock },
      },
    }, "*");
  }, statBlock);
  await page.waitForTimeout(100);

  assert.equal(await frame.locator("#creature-name").textContent(), "Synthetic Watcher");
  assert.equal((await page.evaluate(() => window.hostMessages)).filter(({ method }) => method === "tools/call").length, 0);
  assert.equal(await frame.locator("#status").isHidden(), true);
});

test("the stat-block MCP App renders responsively and exercises its host actions", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 520, height: 900 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => { window.copiedText = value; },
        write: async () => {},
      },
    });
    Object.defineProperty(window, "ClipboardItem", { configurable: true, value: class ClipboardItem {} });
  });
  const page = await context.newPage();
  const frame = await openViewer(page);

  assert.equal(await frame.locator("#creature-name").textContent(), "Synthetic Watcher");
  assert.equal(await frame.locator(".badge", { hasText: "5.5e" }).count(), 1);
  assert.equal(await frame.locator(".badge", { hasText: "NPC" }).count(), 1);
  assert.equal(await frame.locator(".section[data-kind='traits'] .entry").count(), 3);
  assert.deepEqual(await frame.locator(".section[data-kind='traits'] .entry-name").allTextContents(), [
    "Alert. ",
    "Restoration. ",
    "Misty Escape. ",
  ]);
  assert.ok((await frame.locator("#stat-block").boundingBox()).width <= 500);

  await frame.locator("#zoom-in").click();
  assert.equal(await frame.locator("#zoom-level").textContent(), "110%");
  await frame.locator("#fullscreen").click();
  await frame.locator("#copy-text").click();
  await frame.locator(".toast", { hasText: "Copied" }).waitFor();
  assert.match(await frame.locator("body").evaluate(() => window.copiedText), /\| Save \|\n\| --- \|.*\n\| STR \|/);
  await frame.locator("#open-source").click();
  await frame.locator("#download-png").click();
  await frame.locator(".toast", { hasText: "Download ready" }).waitFor({ timeout: 15_000 });

  const messages = await page.evaluate(() => window.hostMessages);
  const readerCall = messages.find(({ method, params }) => method === "tools/call" && params.name === "read_stat_block_for_app");
  assert.deepEqual(readerCall.params.arguments, {
    creature_id: "42",
    creature_url: "https://www.dndbeyond.com/monsters/42-synthetic-watcher",
  });
  assert.ok(messages.some(({ method, params }) => method === "ui/request-display-mode" && params.mode === "fullscreen"));
  assert.ok(messages.some(({ method, params }) => method === "ui/open-link" && params.url.endsWith("/42-synthetic-watcher")));
  const download = messages.find(({ method }) => method === "ui/download-file");
  assert.equal(download.params.contents.length, 1);
  assert.equal(download.params.contents[0].resource.mimeType, "image/png");
  assert.match(download.params.contents[0].resource.blob, /^iVBOR/);
});

test("the stat-block MCP App splits tall exports deterministically at section boundaries", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const tallBlock = {
    ...statBlock,
    sections: ["Traits", "Actions", "Legendary Actions"].map((title, index) => ({
      title,
      kind: title.toLowerCase().replaceAll(" ", "_"),
      entries: [{ name: `Entry ${index + 1}`, text: `Entry ${index + 1}. Synthetic panel content.` }],
    })),
  };
  const frame = await openViewer(page, tallBlock, ".section { min-height: 4100px; }");
  await frame.locator("#copy-image:disabled").waitFor();
  await frame.locator("#download-png").click();
  await frame.locator(".toast", { hasText: "Download ready" }).waitFor({ timeout: 30_000 });

  const messages = await page.evaluate(() => window.hostMessages);
  const download = messages.find(({ method }) => method === "ui/download-file");
  assert.deepEqual(download.params.contents.map(({ resource }) => resource.uri), [
    "file:///synthetic-watcher-stat-block-1.png",
    "file:///synthetic-watcher-stat-block-2.png",
  ]);
  assert.ok(download.params.contents.every(({ resource }) => resource.blob.startsWith("iVBOR")));
});

test("the stat-block MCP App shows the app-only reader's actionable error", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const frame = await openViewer(
    page,
    statBlock,
    "",
    { content: [{ type: "text", text: "D&D Beyond's stat-block layout was not recognized." }], isError: true },
    false
  );

  await frame.locator("#status.error").waitFor();
  assert.equal(
    await frame.locator("#status").textContent(),
    "Could not load Synthetic Watcher (creature 42): D&D Beyond's stat-block layout was not recognized."
  );
});
