import { writeFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "ddb-mcp-live-mock", version: "1.0.0" });
const text = (value) => ({ content: [{ type: "text", text: value }] });
const sensitive = "SYNTHETIC_PRIVATE_MARKER";

server.tool("ddb_login", "mock", {}, async () => text("Already logged in"));
server.tool("ddb_list_characters", "mock", {}, async () =>
  text(JSON.stringify([{ id: "4242", name: sensitive }]))
);
server.tool(
  "ddb_get_character",
  "mock",
  { character_id: z.string(), fallback_scrape: z.boolean().optional() },
  async ({ character_id, fallback_scrape }) =>
    text(JSON.stringify(fallback_scrape ? { Name: sensitive } : { data: { id: character_id, name: sensitive } }))
);
server.tool(
  "ddb_download_character",
  "mock",
  { character_id: z.string(), output_path: z.string().optional() },
  async ({ character_id, output_path }) => {
    writeFileSync(output_path, JSON.stringify({ data: { id: character_id, name: sensitive } }));
    return text("download complete");
  }
);
server.tool("ddb_list_campaigns", "mock", {}, async () =>
  text(JSON.stringify([{ id: "7", name: sensitive }]))
);
server.tool("ddb_get_campaign", "mock", { campaign_id: z.string() }, async () =>
  text(JSON.stringify({ name: sensitive }))
);
server.tool("ddb_navigate", "mock", { url: z.string() }, async ({ url }) => text(`URL: ${url}\n\n${sensitive}`));
server.tool(
  "ddb_interact",
  "mock",
  { action: z.enum(["click", "fill", "screenshot"]), selector: z.string(), value: z.string().optional() },
  async () => {
    const path = "/tmp/ddb-screenshot-live-mock.png";
    writeFileSync(path, "synthetic screenshot");
    return text(`Screenshot saved to: ${path}`);
  }
);
server.tool("ddb_current_page", "mock", {}, async () =>
  text(`Current URL: https://www.dndbeyond.com/characters\n\n${sensitive}`)
);
server.tool(
  "ddb_search",
  "mock",
  { query: z.string(), category: z.string().optional() },
  async () => text(JSON.stringify({ results: [{ name: sensitive }] }))
);
server.tool("ddb_list_library", "mock", {}, async () =>
  text(JSON.stringify({ books: [{ slug: "synthetic-book", title: sensitive }] }))
);
server.tool(
  "ddb_read_book",
  "mock",
  { book_slug: z.string(), chapter_slug: z.string().optional() },
  async () => text(`# synthetic-book\n\n${sensitive}`)
);

await server.connect(new StdioServerTransport());
