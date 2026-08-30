import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "../../dist/index.js";

const page = {
  url: () => "https://www.dndbeyond.com/synthetic-stdio-page",
  evaluate: async (extractor) => String(extractor).includes("sign in")
    ? true
    : { title: "Synthetic Stdio Page", text: "Synthetic stdio page content" },
};
const context = { pages: () => [page] };
const server = createServer(async () => context);

await server.connect(new StdioServerTransport());
