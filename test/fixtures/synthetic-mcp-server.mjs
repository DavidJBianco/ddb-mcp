import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

import { createServer } from "../../dist/index.js";
import { installSyntheticRoutes } from "../support/synthetic-routes.mjs";

const browser = await chromium.launch({
  headless: false,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext();
const routeState = await installSyntheticRoutes(context);
const syntheticPdf = await readFile(new URL("synthetic-character-sheet.pdf", import.meta.url));
const syntheticPortrait = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const server = createServer(async () => context, {
  characterPdfDependencies: {
    createHandle: () => "docker-synthetic",
    fetchPdf: async () => ({
      status: () => 200,
      url: () => "https://www.dndbeyond.com/sheet-pdfs/synthetic-character-sheet.pdf",
      headers: () => ({
        "content-type": "application/pdf",
        "content-length": String(syntheticPdf.length),
      }),
      body: async () => syntheticPdf,
    }),
  },
  characterPortraitDependencies: {
    fetchPortraitResponse: async () => ({
      ok: () => true,
      status: () => 200,
      headers: () => ({
        "content-type": "image/jpeg",
        "content-length": String(syntheticPortrait.length),
      }),
      body: async () => syntheticPortrait,
    }),
  },
});
const transport = new StdioServerTransport();
let closing;

function closeBrowser() {
  closing ??= browser.close().catch(() => {});
  return closing;
}

await server.connect(transport);
const serverOnClose = transport.onclose;
transport.onclose = () => {
  serverOnClose?.();
  void closeBrowser();
};

process.once("SIGINT", () => void closeBrowser().finally(() => process.exit(0)));
process.once("SIGTERM", () => void closeBrowser().finally(() => process.exit(0)));
process.stdin.once("end", () => void closeBrowser());
process.once("beforeExit", () => {
  if (routeState.unmatched.length > 0) {
    process.stderr.write(`Unexpected synthetic requests: ${routeState.unmatched.length}\n`);
    process.exitCode = 1;
  }
});
