import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserContext } from "playwright";
export type BrowserContextProvider = () => Promise<BrowserContext>;
export declare function createServer(getContextForTool?: BrowserContextProvider): McpServer;
//# sourceMappingURL=index.d.ts.map