import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXPECTED_TOOLS } from "../support/tool-manifest.mjs";

const image = process.env.DDB_MCP_TEST_IMAGE ?? "ddb-mcp:test";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("production image negotiates MCP and lists tools through its normal entrypoint", { timeout: 30_000 }, async (t) => {
  const transport = new StdioClientTransport({
    command: "docker",
    args: ["run", "--rm", "--interactive", "--network", "none", image],
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "ddb-mcp-architecture-test", version: "1.0.0" });
  t.after(async () => client.close());
  await client.connect(transport);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map(({ name }) => name).sort(),
    EXPECTED_TOOLS
  );
});
