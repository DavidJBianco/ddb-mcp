import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PACKAGE_VERSION } from "../dist/version.js";

test("the MCP server version comes from package.json", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.equal(PACKAGE_VERSION, packageJson.version);
  assert.match(
    PACKAGE_VERSION,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
  );
});

test("the generated official PDF viewer and licenses are pinned", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.devDependencies["@modelcontextprotocol/server-pdf"], "1.7.5");

  const viewer = await readFile(new URL("../dist/apps/character-pdf-viewer.html", import.meta.url));
  assert.equal(
    createHash("sha256").update(viewer).digest("hex"),
    "df5cd587fb2da1b4d5f136caa7d199203764ecddf08c44c0ee07b085daf0b596"
  );

  for (const name of [
    "NOTICE.md",
    "modelcontextprotocol-ext-apps-LICENSE.txt",
    "pdfjs-dist-LICENSE.txt",
    "cantoo-pdf-lib-LICENSE.md",
    "standard-schema-LICENSE.txt",
    "zod-LICENSE.txt",
  ]) {
    const license = await readFile(new URL(`../third_party/pdf-viewer/${name}`, import.meta.url), "utf8");
    assert.ok(license.length > 100, `${name} must contain its attribution or license text`);
  }
});
