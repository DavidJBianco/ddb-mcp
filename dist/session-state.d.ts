import type { BrowserContext, Page } from "playwright";
export declare const SESSION_SCHEMA_VERSION = 1;
export declare const MAX_SESSION_BYTES = 1048576;
export declare const AUTH_REQUIRED_MESSAGE = "D&D Beyond authentication is missing or expired. Ask the user to run mysterium-auth login on the Docker host, complete authentication in the browser, and then retry this request.";
export interface StorageState {
    cookies: Array<Record<string, unknown>>;
    origins: Array<{
        origin: string;
        localStorage: Array<{
            name: string;
            value: string;
        }>;
    }>;
}
export declare class AuthenticationRequiredError extends Error {
    constructor(message?: string);
}
export declare function isDdbHostname(hostname: string): boolean;
export declare function validateStorageState(input: string | Buffer): StorageState;
export declare function isLoggedInOnCurrentPage(page: Page): Promise<boolean>;
export declare function throwIfAuthenticationRedirect(page: Page): void;
export declare function verifyContextAuthentication(context: BrowserContext): Promise<void>;
//# sourceMappingURL=session-state.d.ts.map