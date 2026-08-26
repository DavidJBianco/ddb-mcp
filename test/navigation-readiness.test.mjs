import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const toolsDirectory = new URL("../src/tools/", import.meta.url);

test("all tool navigation uses the shared DOM-ready policy", async () => {
  const names = (await readdir(toolsDirectory)).filter((name) => name.endsWith(".ts"));
  for (const name of names) {
    const source = await readFile(new URL(name, toolsDirectory), "utf8");
    assert.doesNotMatch(source, /networkidle/, `${name} must not require network idle`);
    if (name !== "page-readiness.ts") {
      assert.doesNotMatch(source, /\.goto\s*\(/, `${name} must delegate navigation readiness`);
    }
  }

  const policy = await readFile(new URL("page-readiness.ts", toolsDirectory), "utf8");
  assert.match(policy, /waitUntil:\s*"domcontentloaded"/);
});
