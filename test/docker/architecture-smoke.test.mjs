import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXPECTED_TOOLS } from "../support/tool-manifest.mjs";
import { captureStderr, withFailureDiagnostics } from "../support/failure-diagnostics.mjs";

const image = process.env.DDB_MCP_TEST_IMAGE ?? "ddb-mcp:test";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("production image negotiates MCP and lists tools through its normal entrypoint", { timeout: 30_000 }, async (t) => {
  const containerName = `ddb-mcp-test-entrypoint-${process.pid}`;
  const transport = new StdioClientTransport({
    command: "docker",
    args: ["run", "--rm", "--name", containerName, "--interactive", "--network", "none", image],
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  const diagnostics = captureStderr(transport);
  const client = new Client({ name: "ddb-mcp-architecture-test", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    spawnSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
  });
  await withFailureDiagnostics("production image MCP entrypoint", diagnostics, async () => {
    await client.connect(transport);

    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name).sort(),
      EXPECTED_TOOLS
    );
  });
});
