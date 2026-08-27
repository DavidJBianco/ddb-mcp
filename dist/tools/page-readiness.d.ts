import type { Page } from "playwright";
export declare function openDomReadyPage(page: Page, url: string, timeout: number): Promise<void>;
export declare function waitForRenderedContent(page: Page, selector: string, timeout?: number): Promise<void>;
//# sourceMappingURL=page-readiness.d.ts.map