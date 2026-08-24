import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_PACKAGE_VERSION = "1.7.5";
const EXPECTED_VIEWER_SHA256 = "df5cd587fb2da1b4d5f136caa7d199203764ecddf08c44c0ee07b085daf0b596";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const packageEntry = fileURLToPath(import.meta.resolve("@modelcontextprotocol/server-pdf"));
const packageRoot = join(dirname(packageEntry), "..");
const packageJsonPath = join(packageRoot, "package.json");
const viewerPath = join(dirname(packageEntry), "mcp-app.html");
const outputPath = join(repositoryRoot, "dist", "apps", "character-pdf-viewer.html");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
if (packageJson.version !== EXPECTED_PACKAGE_VERSION) {
  throw new Error(
    `Refusing to copy PDF viewer ${String(packageJson.version)}; expected ${EXPECTED_PACKAGE_VERSION}.`
  );
}

const viewer = await readFile(viewerPath);
const digest = createHash("sha256").update(viewer).digest("hex");
if (digest !== EXPECTED_VIEWER_SHA256) {
  throw new Error(`Refusing to copy PDF viewer with unapproved SHA-256 ${digest}.`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, viewer);
