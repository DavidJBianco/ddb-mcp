import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("offline safeguard: GitHub workflows cannot invoke authenticated tests", async () => {
  const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
  const files = await readdir(workflowDirectory);
  const contents = await Promise.all(
    files.filter((file) => /\.ya?ml$/.test(file)).map((file) => readFile(new URL(file, workflowDirectory), "utf8"))
  );

  for (const content of contents) {
    assert.doesNotMatch(content, /npm run test:live(?::docker)?|make live-test(?:-host)?/);
  }
});
