import assert from "node:assert/strict";
import test from "node:test";

import { interact, isAllowedDdbUrl, navigate } from "../dist/tools/navigate.js";

function contextWith(page) {
  return {
    pages: () => [page],
  };
}

test("navigate rejects non-D&D Beyond URLs without loading them", async () => {
  const page = {
    url: () => "https://www.dndbeyond.com/synthetic-page",
    evaluate: async () => true,
    goto: async () => assert.fail("goto must not be called for a rejected URL"),
  };

  await assert.rejects(
    navigate(contextWith(page), "https://example.com/not-ddb"),
    /Only D&D Beyond URLs/
  );
});

test("D&D Beyond URL validation rejects lookalike and unsafe origins", () => {
  assert.equal(isAllowedDdbUrl("https://www.dndbeyond.com/characters"), true);
  assert.equal(isAllowedDdbUrl("https://dndbeyond.com/spells"), true);
  assert.equal(isAllowedDdbUrl("https://www.dndbeyond.com.evil.example/"), false);
  assert.equal(isAllowedDdbUrl("https://dndbeyond.com@evil.example/"), false);
  assert.equal(isAllowedDdbUrl("http://www.dndbeyond.com/"), false);
  assert.equal(isAllowedDdbUrl("https://www.dndbeyond.com:8443/"), false);
  assert.equal(isAllowedDdbUrl("not a URL"), false);
});

test("navigate blocks a redirect outside D&D Beyond", async () => {
  const page = {
    goto: async () => {},
    url: () => "https://evil.example/redirected",
  };

  await assert.rejects(
    navigate(contextWith(page), "https://www.dndbeyond.com/redirect"),
    /redirected outside D&D Beyond/
  );
});

test("interact clicks the first matching element", async () => {
  const events = [];
  const page = {
    url: () => "https://www.dndbeyond.com/synthetic-page",
    evaluate: async () => true,
    locator: (selector) => {
      events.push(["locator", selector]);
      return {
        first: () => ({
          click: async () => events.push(["click"]),
        }),
      };
    },
    waitForTimeout: async (milliseconds) => events.push(["wait", milliseconds]),
  };

  const result = await interact(contextWith(page), "click", "button.save");

  assert.equal(result, "Clicked element: button.save");
  assert.deepEqual(events, [
    ["locator", "button.save"],
    ["click"],
    ["wait", 1000],
  ]);
});

test("interact requires a value before filling a field", async () => {
  const page = {
    locator: () => assert.fail("locator must not be called without a fill value"),
  };

  await assert.rejects(
    interact(contextWith(page), "fill", "input[name='character-name']"),
    /'value' is required/
  );
});

test("interact fills a field and records a screenshot", async () => {
  const events = [];
  const page = {
    url: () => "https://www.dndbeyond.com/synthetic-page",
    evaluate: async () => true,
    locator: (selector) => ({
      first: () => ({
        fill: async (value) => events.push(["fill", selector, value]),
      }),
    }),
    waitForTimeout: async () => {},
    screenshot: async (options) => events.push(["screenshot", options.fullPage]),
  };
  const context = contextWith(page);

  await interact(context, "fill", "#name", "Synthetic Name");
  const screenshot = await interact(context, "screenshot", "body");

  assert.deepEqual(events[0], ["fill", "#name", "Synthetic Name"]);
  assert.deepEqual(events[1], ["screenshot", false]);
  assert.match(screenshot, /^Screenshot saved to: \/tmp\/ddb-screenshot-/);
});
