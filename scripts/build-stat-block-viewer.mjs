import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const entry = new URL("apps/stat-block-viewer/app.ts", root);
const templatePath = new URL("apps/stat-block-viewer/index.html", root);
const cssPath = new URL("apps/stat-block-viewer/styles.css", root);
const outputPath = new URL("dist/apps/stat-block-viewer.html", root);

const bundled = await build({
  entryPoints: [entry.pathname],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  write: false,
  legalComments: "inline",
});
const javascript = bundled.outputFiles[0]?.text;
if (!javascript) throw new Error("Stat block viewer bundling produced no JavaScript.");

const [template, css] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(cssPath, "utf8"),
]);
const html = template
  .replace("/*__STAT_BLOCK_CSS__*/", () => css)
  .replace("/*__STAT_BLOCK_JS__*/", () => javascript.replace(/<\/script/gi, "<\\/script"))
  .replace(/[ \t]+$/gm, "");
await mkdir(new URL("dist/apps/", root), { recursive: true });
await writeFile(outputPath, html);
