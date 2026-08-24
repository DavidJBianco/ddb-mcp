import assert from "node:assert/strict";
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

test("the generated read-only PDF viewer is self-contained and licensed", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.devDependencies["@modelcontextprotocol/server-pdf"], undefined);
  assert.equal(packageJson.devDependencies["pdfjs-dist"], "6.2.108");
  assert.equal(packageJson.devDependencies["vite-plugin-singlefile"], "2.3.0");

  const viewer = await readFile(new URL("../dist/apps/character-pdf-viewer.html", import.meta.url), "utf8");
  assert.ok(viewer.length > 1_000_000);
  assert.match(viewer, /Mysterium PDF Viewer/);
  assert.match(viewer, /Download PDF/);
  assert.match(viewer, /Search this PDF/);
  assert.doesNotMatch(viewer, /Copy (?:text|JSON|image)|Download PNG/);
  assert.doesNotMatch(viewer, /<script[^>]+src=|<link[^>]+href=/i);

  for (const name of [
    "NOTICE.md",
    "modelcontextprotocol-ext-apps-LICENSE.txt",
    "pdfjs-dist-LICENSE.txt",
    "standard-schema-LICENSE.txt",
    "zod-LICENSE.txt",
  ]) {
    const license = await readFile(new URL(`../third_party/pdf-viewer/${name}`, import.meta.url), "utf8");
    assert.ok(license.length > 100, `${name} must contain its attribution or license text`);
  }
});

test("the generated stat-block viewer is self-contained and licensed", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.devDependencies.html2canvas, "^1.4.1");
  assert.equal(packageJson.devDependencies.esbuild, undefined);
  assert.equal(packageJson.devDependencies.vite, "6.4.3");

  const viewer = await readFile(new URL("../dist/apps/stat-block-viewer.html", import.meta.url), "utf8");
  assert.ok(viewer.length > 100_000);
  assert.match(viewer, /Mysterium Stat Block Viewer/);
  assert.match(viewer, /Download PNG/);
  assert.doesNotMatch(viewer, /<script[^>]+src=|<link[^>]+href=/i);
  assert.doesNotMatch(viewer, /https:\/\/(?:unpkg|cdn)\./i);

  for (const name of ["NOTICE.md", "html2canvas-LICENSE.txt", "bundled-dependencies-LICENSES.txt"]) {
    const notice = await readFile(new URL(`../third_party/stat-block-viewer/${name}`, import.meta.url), "utf8");
    assert.ok(notice.length > 100);
  }
});
