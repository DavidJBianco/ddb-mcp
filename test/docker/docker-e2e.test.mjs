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
const testRoot = fileURLToPath(new URL("..", import.meta.url));

async function connectDockerClient(t, args, containerName) {
  const transport = new StdioClientTransport({
    command: "docker",
    args,
    cwd: repositoryRoot,
    stderr: "pipe",
  });
  const diagnostics = captureStderr(transport);
  const client = new Client({ name: "ddb-mcp-docker-test", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    spawnSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
  });
  await withFailureDiagnostics("Docker MCP connection", diagnostics, () => client.connect(transport));
  return { client, diagnostics };
}

test("production image executes synthetic browser-backed MCP calls", { timeout: 120_000 }, async (t) => {
  const containerName = `ddb-mcp-test-browser-${process.pid}`;
  const { client, diagnostics } = await connectDockerClient(t, [
    "run",
    "--rm",
    "--name",
    containerName,
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
  ], containerName);

  await withFailureDiagnostics("browser-backed Docker MCP", diagnostics, async () => {
    const calledTools = [];
    async function callSuccessfully(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, `${name} should succeed`);
      assert.equal(result.content[0].type, "text");
      calledTools.push(name);
      return result.content[0].text;
    }

    await callSuccessfully("ddb_login");
    assert.equal(JSON.parse(await callSuccessfully("ddb_list_characters")).length, 1);

    const characterText = await callSuccessfully("ddb_get_character", { character_id: "4242" });
    assert.equal(JSON.parse(characterText).data.name, "Synthetic Hero");
    await callSuccessfully("ddb_download_character", {
      character_id: "4242",
      output_path: "/tmp/synthetic-character.json",
    });

    assert.equal(
      JSON.parse(await callSuccessfully("ddb_get_campaign", { campaign_id: "7" })).name,
      "Synthetic Campaign"
    );
    assert.equal(JSON.parse(await callSuccessfully("ddb_list_campaigns")).length, 1);

    await callSuccessfully("ddb_navigate", {
      url: "https://www.dndbeyond.com/synthetic-page",
    });
    await callSuccessfully("ddb_interact", {
      action: "click",
      selector: "#synthetic-button",
    });
    assert.match(await callSuccessfully("ddb_current_page"), /Synthetic Page/);

    const searchText = await callSuccessfully("ddb_search", {
      query: "shield",
      category: "spells",
    });
    assert.equal(JSON.parse(searchText).results[0].name, "Synthetic Shield");

    assert.equal(JSON.parse(await callSuccessfully("ddb_list_library")).count, 1);
    assert.match(
      await callSuccessfully("ddb_read_book", { book_slug: "synthetic-handbook" }),
      /Safe Examples/
    );

    const fallbackResult = await client.callTool({
      name: "ddb_get_character",
      arguments: { character_id: "999", fallback_scrape: true },
    });
    assert.equal(fallbackResult.isError, undefined);
    assert.equal(JSON.parse(fallbackResult.content[0].text).Name, "Synthetic Fallback Hero");

    assert.deepEqual(calledTools.sort(), EXPECTED_TOOLS);

    const failureResult = await client.callTool({
      name: "ddb_get_campaign",
      arguments: { campaign_id: "network-error" },
    });
    assert.equal(failureResult.isError, true);
    assert.match(failureResult.content[0].text, /Failed to get campaign/);
  });
});
