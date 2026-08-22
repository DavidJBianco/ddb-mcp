import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const image = process.env.DDB_MCP_TEST_IMAGE ?? "ddb-mcp:test";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const testRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedTools = [
  "ddb_current_page",
  "ddb_download_character",
  "ddb_get_campaign",
  "ddb_get_character",
  "ddb_interact",
  "ddb_list_campaigns",
  "ddb_list_characters",
  "ddb_list_library",
  "ddb_login",
  "ddb_navigate",
  "ddb_read_book",
  "ddb_search",
];

async function connectDockerClient(t, args) {
  const transport = new StdioClientTransport({
    command: "docker",
    args,
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  const client = new Client({ name: "ddb-mcp-docker-test", version: "1.0.0" });
  t.after(async () => client.close());
  await client.connect(transport);
  return client;
}

test("production image negotiates MCP through its normal entrypoint", { timeout: 30_000 }, async (t) => {
  const client = await connectDockerClient(t, ["run", "--rm", "--interactive", "--network", "none", image]);
  const listed = await client.listTools();

  assert.deepEqual(
    listed.tools.map(({ name }) => name).sort(),
    expectedTools
  );
});

test("production image executes synthetic browser-backed MCP calls", { timeout: 60_000 }, async (t) => {
  const client = await connectDockerClient(t, [
    "run",
    "--rm",
    "--interactive",
    "--network",
    "none",
    "--mount",
    `type=bind,src=${testRoot},dst=/app/test,readonly`,
    "--entrypoint",
    "tini",
    image,
    "--",
    "xvfb-run",
    "-a",
    "--server-args=-screen 0 1280x1024x24",
    "node",
    "/app/test/fixtures/synthetic-mcp-server.mjs",
  ]);

  const searchResult = await client.callTool({
    name: "ddb_search",
    arguments: { query: "shield", category: "spells" },
  });
  assert.equal(searchResult.isError, undefined);
  assert.equal(JSON.parse(searchResult.content[0].text).results[0].name, "Synthetic Shield");

  const characterResult = await client.callTool({
    name: "ddb_get_character",
    arguments: { character_id: "4242" },
  });
  assert.equal(characterResult.isError, undefined);
  assert.equal(JSON.parse(characterResult.content[0].text).data.name, "Synthetic Hero");

  const failureResult = await client.callTool({
    name: "ddb_get_campaign",
    arguments: { campaign_id: "network-error" },
  });
  assert.equal(failureResult.isError, true);
  assert.match(failureResult.content[0].text, /Failed to get campaign/);
});
