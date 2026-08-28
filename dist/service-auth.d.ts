import type { Page } from "playwright";
export declare class DdbServiceRequestError extends Error {
    readonly status: number;
    constructor(status: number);
}
/**
 * Performs a read-only D&D Beyond JSON request with the same short-term bearer
 * token flow used by D&D Beyond's web applications. The token is acquired and
 * consumed inside the browser page; it is never returned to Node.js callers.
 */
export declare function fetchAuthenticatedDdbJson(page: Page, serviceUrl: string): Promise<unknown>;
//# sourceMappingURL=service-auth.d.ts.map