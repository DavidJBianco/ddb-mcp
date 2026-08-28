import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserContext } from "playwright";
import { type CharacterPortraitDependencies } from "./tools/character.js";
import { type CharacterPdfDependencies } from "./tools/character-pdf.js";
export type BrowserContextProvider = () => Promise<BrowserContext>;
export interface ServerOptions {
    characterPdfDependencies?: CharacterPdfDependencies;
    characterPortraitDependencies?: CharacterPortraitDependencies;
}
export declare function createServer(getContextForTool?: BrowserContextProvider, options?: ServerOptions): McpServer;
//# sourceMappingURL=index.d.ts.map