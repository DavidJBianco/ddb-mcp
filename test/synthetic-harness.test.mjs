import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function isolatedChildEnvironment(overrides) {
  const environment = { ...process.env, ...overrides };
  // Node marks child processes spawned from a test worker with this private
  // variable. It must not leak into the nested harness process.
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

test("offline synthetic harness exercises the authenticated-test protocol safely", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mysterium-synthetic-harness-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, "session.json");
  await writeFile(sessionPath, "{}");

  const result = spawnSync(
    process.execPath,
    ["test/live/live-read.test.mjs"],
    {
      encoding: "utf8",
      env: isolatedChildEnvironment({
        MYSTERIUM_LIVE_TRANSPORT: "mock",
        MYSTERIUM_SESSION_PATH: sessionPath,
      }),
      timeout: 30_000,
    }
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.equal(result.signal, null);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /SYNTHETIC_PRIVATE_MARKER/);
  assert.doesNotMatch(output, new RegExp(sessionPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("offline synthetic failures expose only sanitized diagnostics", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mysterium-synthetic-harness-failure-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const sessionPath = join(directory, "session.json");
  await writeFile(sessionPath, "{}");

  const result = spawnSync(
    process.execPath,
    ["test/live/live-read.test.mjs"],
    {
      encoding: "utf8",
      env: isolatedChildEnvironment({
        MYSTERIUM_LIVE_TRANSPORT: "mock",
        MYSTERIUM_LIVE_MOCK_FAIL_TOOL: "mysterium_list_characters",
        MYSTERIUM_SESSION_PATH: sessionPath,
      }),
      timeout: 30_000,
    }
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /mysterium_list_characters returned a tool error/);
  assert.match(output, /HTTP status: 403/);
  assert.match(output, /category: authentication or authorization/);
  assert.match(output, /endpoint: www\.dndbeyond\.com\/characters\/\[redacted\]/);
  assert.match(output, /captured server stderr lines:/);
  assert.doesNotMatch(output, /SYNTHETIC_PRIVATE_MARKER/);
  assert.doesNotMatch(output, /characters\/4242/);
  assert.doesNotMatch(output, new RegExp(sessionPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
