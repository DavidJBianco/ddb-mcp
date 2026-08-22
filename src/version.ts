import { readFileSync } from "node:fs";

interface PackageMetadata {
  version?: unknown;
}

const packagePath = new URL("../package.json", import.meta.url);
const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as PackageMetadata;

if (typeof metadata.version !== "string" || metadata.version.length === 0) {
  throw new Error("package.json must contain a non-empty version string");
}

export const PACKAGE_VERSION = metadata.version;
