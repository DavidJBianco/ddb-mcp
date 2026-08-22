import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const importSessionPath =
  "import('./dist/browser.js').then(({SESSION_PATH}) => process.stdout.write(String(SESSION_PATH === process.env.DDB_MCP_SESSION_PATH)))";

test("an absolute external session path can be selected without reading it", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", importSessionPath], {
    encoding: "utf8",
    env: { ...process.env, DDB_MCP_SESSION_PATH: "/tmp/ddb-mcp-external-session.json" },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "true");
});

test("a relative external session path is rejected without echoing it", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", importSessionPath], {
    encoding: "utf8",
    env: { ...process.env, DDB_MCP_SESSION_PATH: "private/session.json" },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DDB_MCP_SESSION_PATH must be an absolute path/);
  assert.doesNotMatch(result.stderr, /private\/session\.json/);
});
