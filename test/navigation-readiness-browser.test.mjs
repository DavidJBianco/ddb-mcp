import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { chromium } from "playwright";

import {
  openDomReadyPage,
  waitForRenderedContent,
} from "../dist/tools/page-readiness.js";

test("DOM-ready navigation completes while background traffic remains active", async (t) => {
  const openResponses = new Set();
  const server = createServer((request, response) => {
    if (request.url === "/background") {
      openResponses.add(response);
      response.on("close", () => openResponses.delete(response));
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("still active");
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
      <html><body><main id="ready">Rendered content</main>
      <script>fetch('/background').catch(() => {});</script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const response of openResponses) response.end();
    await new Promise((resolve) => server.close(resolve));
  });

  const address = server.address();
  assert(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();

  await openDomReadyPage(page, `http://127.0.0.1:${address.port}/`, 2_000);
  await waitForRenderedContent(page, "#ready", 1_000);
  assert.equal(await page.locator("#ready").textContent(), "Rendered content");
  assert.equal(openResponses.size, 1);
});
