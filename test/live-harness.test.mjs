import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("the complete live harness runs against synthetic MCP data without disclosing it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ddb-mcp-live-harness-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, "session.json");
  await writeFile(sessionPath, "{}");

  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "test/live/live-read.test.mjs"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DDB_MCP_LIVE_TESTS: "1",
        DDB_MCP_LIVE_TRANSPORT: "mock",
        DDB_MCP_SESSION_PATH: sessionPath,
      },
      timeout: 30_000,
    }
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.equal(result.signal, null);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /SYNTHETIC_PRIVATE_MARKER/);
  assert.doesNotMatch(output, new RegExp(sessionPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
