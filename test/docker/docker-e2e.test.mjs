import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EXPECTED_TOOLS } from "../support/tool-manifest.mjs";
import { captureStderr, withFailureDiagnostics } from "../support/failure-diagnostics.mjs";

const image = process.env.MYSTERIUM_TEST_IMAGE ?? "mysterium:test";
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
  const client = new Client({ name: "mysterium-docker-test", version: "1.0.0" });
  client.registerCapabilities({
    extensions: {
      "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
    },
  });
  t.after(async () => {
    await client.close();
    spawnSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
  });
  await withFailureDiagnostics("Docker MCP connection", diagnostics, () => client.connect(transport));
  return { client, diagnostics };
}

test("production image returns the host authentication instruction when session state is missing", { timeout: 30_000 }, async (t) => {
  const containerName = `mysterium-test-missing-auth-${process.pid}`;
  const { client, diagnostics } = await connectDockerClient(t, [
    "run", "--rm", "--name", containerName, "--interactive", "--network", "none", image,
  ], containerName);
  await withFailureDiagnostics("missing Docker authentication", diagnostics, async () => {
    const result = await client.callTool({ name: "mysterium_list_characters", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /mysterium-auth login/);
  });
});

test("production image executes synthetic browser-backed MCP calls", { timeout: 120_000 }, async (t) => {
  const containerName = `mysterium-test-browser-${process.pid}`;
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
      assert.equal(
        result.isError,
        undefined,
        `${name} should succeed: ${result.content?.[0]?.type === "text" ? result.content[0].text : "no text error"}`
      );
      assert.equal(result.content[0].type, "text");
      if (!calledTools.includes(name)) calledTools.push(name);
      return result.content[0].text;
    }

    const characterList = JSON.parse(await callSuccessfully("mysterium_list_characters"));
    assert.equal(characterList.count, 1);
    assert.equal(characterList.characters[0].id, "4242");
    const emptyCharacterList = await client.callTool({
      name: "mysterium_list_characters",
      arguments: { names: ["missing"] },
    });
    assert.equal(emptyCharacterList.isError, undefined);
    assert.deepEqual(JSON.parse(emptyCharacterList.content[0].text), emptyCharacterList.structuredContent);
    assert.equal(emptyCharacterList.structuredContent.count, 0);
    assert.equal(emptyCharacterList.structuredContent.total, 1);

    const characterText = await callSuccessfully("mysterium_get_character", { character_id: "4242" });
    assert.equal(JSON.parse(characterText).character.name, "Synthetic Hero");
    assert.match(JSON.parse(characterText).portraitUrl, /synthetic-hero\.jpeg/);
    const characterParity = await client.callTool({
      name: "mysterium_get_character",
      arguments: { character_id: "4242" },
    });
    assert.deepEqual(JSON.parse(characterParity.content[0].text), characterParity.structuredContent);
    const portraitResult = await client.callTool({
      name: "mysterium_get_character_portrait",
      arguments: { character_id: "4242" },
    });
    assert.equal(portraitResult.isError, undefined);
    calledTools.push("mysterium_get_character_portrait");
    assert.deepEqual(JSON.parse(portraitResult.content[0].text), portraitResult.structuredContent);
    assert.equal(portraitResult.content[1].type, "image");
    assert.equal(portraitResult.content[1].mimeType, "image/jpeg");
    assert.deepEqual(Buffer.from(portraitResult.content[1].data, "base64"), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    const pdfResult = await client.callTool({
      name: "mysterium_export_character_pdf",
      arguments: { character_id: "4242" },
    });
    assert.equal(pdfResult.isError, undefined);
    calledTools.push("mysterium_export_character_pdf");
    const pdfBytes = await readFile(new URL("../fixtures/synthetic-character-sheet.pdf", import.meta.url));
    assert.equal(pdfResult.structuredContent.totalBytes, pdfBytes.length);
    assert.equal(pdfResult.structuredContent.sha256, createHash("sha256").update(pdfBytes).digest("hex"));

    const rangeResult = await client.callTool({
      name: "read_pdf_bytes",
      arguments: { url: pdfResult.structuredContent.url },
    });
    assert.equal(rangeResult.isError, undefined);
    calledTools.push("read_pdf_bytes");
    assert.deepEqual(Buffer.from(rangeResult.structuredContent.bytes, "base64"), pdfBytes);

    assert.equal(
      JSON.parse(await callSuccessfully("mysterium_get_campaign", { campaign_id: "7" })).name,
      "Synthetic Campaign"
    );
    assert.equal(JSON.parse(await callSuccessfully("mysterium_list_campaigns")).length, 1);

    await callSuccessfully("mysterium_navigate", {
      url: "https://www.dndbeyond.com/synthetic-page",
    });
    await callSuccessfully("mysterium_interact", {
      action: "click",
      selector: "#synthetic-button",
    });
    assert.match(await callSuccessfully("mysterium_current_page"), /Synthetic Page/);

    const searchText = await callSuccessfully("mysterium_search", {
      query: "shield",
      category: "spells",
    });
    const searchResult = JSON.parse(searchText).results[0];
    assert.equal(searchResult.name, "Synthetic Shield");
    assert.deepEqual(searchResult.sources, [
      {
        title: "Synthetic Handbook",
        url: "https://www.dndbeyond.com/sources/synthetic-handbook",
        bookSlug: "synthetic-handbook",
        chapterSlug: null,
      },
      {
        title: "Synthetic Expansion",
        url: "https://www.dndbeyond.com/sources/synthetic-expansion/chapter-one",
        bookSlug: "synthetic-expansion",
        chapterSlug: "chapter-one",
      },
      {
        title: "Printed Reference",
        url: null,
        bookSlug: null,
        chapterSlug: null,
      },
    ]);
    assert.deepEqual(JSON.parse(searchText).results[1].sources, []);

    const accessibleSources = JSON.parse(await callSuccessfully("mysterium_search", {
      query: "handbook",
      category: "sourcebooks",
    }));
    assert.equal(accessibleSources.count, 1);
    assert.equal(accessibleSources.results[0].access, "accessible");
    assert.equal(accessibleSources.results[0].bookSlug, "synthetic-handbook");

    const catalogSources = JSON.parse(await callSuccessfully("mysterium_search", {
      query: "book",
      category: "sourcebooks",
      source_scope: "all",
    }));
    assert.deepEqual(catalogSources.results.map(({ access }) => access), ["accessible", "unavailable"]);
    assert.match(catalogSources.results[1].url, /marketplace\.dndbeyond\.com/);

    const statBlock = JSON.parse(await callSuccessfully("mysterium_get_stat_block", {
      query: "Synthetic Watcher",
    }));
    assert.equal(statBlock.kind, "stat_block");
    assert.equal(statBlock.creature.id, "42");
    assert.equal(statBlock.creature.source, "Synthetic Manual");
    assert.equal(statBlock.creature.edition, "5.5e");
    assert.equal(statBlock.creature.legacy, false);
    assert.match(statBlock.markdown, /Observing Ray/);
    assert.doesNotMatch(statBlock.markdown, /comment must never/);

    const viewedStatBlock = await client.callTool({
      name: "mysterium_view_stat_block",
      arguments: { query: "Synthetic Watcher" },
    });
    assert.equal(viewedStatBlock.isError, undefined);
    calledTools.push("mysterium_view_stat_block");
    assert.equal(viewedStatBlock.structuredContent.kind, "resolved");
    assert.equal(viewedStatBlock.structuredContent.candidate.id, "42");

    const appStatBlock = await client.callTool({
      name: "read_stat_block_for_app",
      arguments: { creature_id: "42" },
    });
    assert.equal(appStatBlock.isError, undefined);
    calledTools.push("read_stat_block_for_app");
    assert.equal(appStatBlock.structuredContent.kind, "stat_block");
    assert.equal(appStatBlock.structuredContent.creature.name, "Synthetic Watcher");

    assert.equal(JSON.parse(await callSuccessfully("mysterium_list_library")).count, 1);
    const bookOutline = JSON.parse(await callSuccessfully("mysterium_read_book", {
      book_slug: "synthetic-handbook",
    }));
    assert.equal(bookOutline.kind, "outline");
    assert.equal(bookOutline.entries[0].chapterSlug, "safe-examples");

    const chapterOutline = JSON.parse(await callSuccessfully("mysterium_read_book", {
      book_slug: "synthetic-handbook",
      chapter_slug: "safe-examples",
      mode: "outline",
    }));
    assert.equal(chapterOutline.entries.filter(({ title }) => title === "Repeated").length, 2);

    const contentPages = [];
    let cursor;
    do {
      const page = JSON.parse(await callSuccessfully("mysterium_read_book", {
        book_slug: "synthetic-handbook",
        chapter_slug: "safe-examples",
        section: "section-details-1",
        max_chars: cursor ? undefined : 80,
        cursor,
      }));
      contentPages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const combinedContent = contentPages.map(({ text }) => text).join("");
    assert.match(combinedContent, /Nested synthetic rule/);
    assert.match(combinedContent, /1\. First ordered step/);
    assert.match(combinedContent, /\| Kind \| Value \|/);
    assert.deepEqual(contentPages.flatMap(({ images }) => images).map(({ alt }) => alt), ["Synthetic diagram"]);
    assert.match(await callSuccessfully("mysterium_current_page"), /Preserved navigation marker/);

    const alternate = JSON.parse(await callSuccessfully("mysterium_read_book", {
      book_slug: "synthetic-handbook",
      chapter_slug: "alternate-layout",
    }));
    assert.match(alternate.text, /Alternate supported sourcebook structure/);

    const changedLayout = await client.callTool({
      name: "mysterium_read_book",
      arguments: { book_slug: "synthetic-handbook", chapter_slug: "changed-layout" },
    });
    assert.equal(changedLayout.isError, true);
    assert.match(changedLayout.content[0].text, /layout was not recognized/);

    assert.deepEqual(calledTools.sort(), EXPECTED_TOOLS);

    const failureResult = await client.callTool({
      name: "mysterium_get_campaign",
      arguments: { campaign_id: "network-error" },
    });
    assert.equal(failureResult.isError, true);
    assert.match(failureResult.content[0].text, /Failed to get campaign/);
  });
});
