import assert from "node:assert/strict";
import test from "node:test";

import { interact, navigate } from "../dist/tools/navigate.js";

function contextWith(page) {
  return {
    pages: () => [page],
  };
}

test("navigate rejects non-D&D Beyond URLs without loading them", async () => {
  const page = {
    goto: async () => assert.fail("goto must not be called for a rejected URL"),
  };

  await assert.rejects(
    navigate(contextWith(page), "https://example.com/not-ddb"),
    /Only D&D Beyond URLs/
  );
});

test("interact clicks the first matching element", async () => {
  const events = [];
  const page = {
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
