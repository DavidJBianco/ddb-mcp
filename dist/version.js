import { readFileSync } from "node:fs";
const packagePath = new URL("../package.json", import.meta.url);
const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error("package.json must contain a non-empty version string");
}
export const PACKAGE_VERSION = metadata.version;
//# sourceMappingURL=version.js.map