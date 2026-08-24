import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(repositoryRoot, "dist", "apps");
const temporaryRoot = join(outputRoot, ".viewer-build");
const viewers = [
  { source: "apps/character-pdf-viewer/index.html", output: "character-pdf-viewer.html" },
  { source: "apps/stat-block-viewer/index.html", output: "stat-block-viewer.html" },
];

await mkdir(outputRoot, { recursive: true });
try {
  for (const [index, viewer] of viewers.entries()) {
    const buildDirectory = join(temporaryRoot, String(index));
    const result = await build({
      root: repositoryRoot,
      base: "./",
      appType: "custom",
      publicDir: false,
      logLevel: "warn",
      plugins: [viteSingleFile()],
      build: {
        outDir: buildDirectory,
        emptyOutDir: true,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
        rollupOptions: { input: join(repositoryRoot, viewer.source) },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const htmlAsset = outputs
      .flatMap((output) => "output" in output ? output.output : [])
      .find((output) => output.type === "asset" && output.fileName.endsWith(".html"));
    if (!htmlAsset || typeof htmlAsset.source !== "string") {
      throw new Error(`Viewer build did not emit HTML for ${viewer.source}.`);
    }
    const html = htmlAsset.source;
    await writeFile(join(outputRoot, viewer.output), html.replace(/[ \t]+$/gm, ""));
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
