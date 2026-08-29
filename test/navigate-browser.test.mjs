import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { capturePageScreenshot, readPage } from "../dist/tools/navigate.js";
import { installSyntheticRoutes } from "./support/synthetic-routes.mjs";

test("generic page tools paginate without mutating the live DOM and capture bounded images", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const state = await installSyntheticRoutes(context);

  const responses = [];
  let response = await readPage(context, { url: "https://www.dndbeyond.com/synthetic-page", maxChars: 55 });
  responses.push(response);
  while (response.nextCursor) {
    response = await readPage(context, { cursor: response.nextCursor });
    responses.push(response);
  }

  const text = responses.map((entry) => entry.text).join("");
  assert.match(text, /Synthetic Page/);
  assert.match(text, /Unicode glyph: 😀/);
  assert.match(text, /Third synthetic paragraph/);
  assert.doesNotMatch(text, /Navigation excluded/);
  assert.doesNotMatch(text, /Hidden content/);
  assert.ok(responses.every((entry) => Array.from(entry.text).length <= 55));
  assert.equal(responses.at(-1).done, true);

  const page = context.pages()[0];
  assert.equal(await page.locator("#preserved-navigation").count(), 1, "extraction must not remove live DOM nodes");

  const viewport = await capturePageScreenshot(context);
  assert.equal(viewport.metadata.scope, "viewport");
  assert.equal(viewport.metadata.width, 640);
  assert.equal(viewport.metadata.height, 480);
  assert.equal(viewport.bytes.subarray(1, 4).toString("ascii"), "PNG");

  const element = await capturePageScreenshot(context, { scope: "element", selector: "#visual-target" });
  assert.equal(element.metadata.scope, "element");
  assert.equal(element.metadata.selector, "#visual-target");
  assert.equal(element.metadata.width, 240);
  assert.ok(element.metadata.height >= 80 && element.metadata.height <= 82);

  const firstCursor = responses[0].nextCursor;
  await page.locator("main").evaluate((element) => element.append("Changed after cursor."));
  await assert.rejects(readPage(context, { cursor: firstCursor }), /Page content changed/);

  const empty = await readPage(context, { url: "https://www.dndbeyond.com/synthetic-empty-page" });
  assert.equal(empty.text, "");
  assert.equal(empty.totalCharacters, 0);
  assert.equal(empty.done, true);
  assert.equal(empty.nextCursor, null);
  assert.deepEqual(state.unmatched, []);
});
