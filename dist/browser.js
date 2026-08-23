import { chromium } from "playwright";
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join } from "path";
import { AuthenticationRequiredError, isLoggedInOnCurrentPage, validateStorageState, verifyContextAuthentication, } from "./session-state.js";
const configuredSessionPath = process.env.DDB_MCP_SESSION_PATH?.trim();
if (configuredSessionPath && !isAbsolute(configuredSessionPath)) {
    throw new Error("DDB_MCP_SESSION_PATH must be an absolute path.");
}
export const SESSION_PATH = configuredSessionPath ?? join(homedir(), ".config", "ddb-mcp", "session.json");
export const SESSION_DIR = dirname(SESSION_PATH);
let browserInstance = null;
let contextInstance = null;
let contextSessionFingerprint = null;
async function discardContext() {
    if (contextInstance) {
        await contextInstance.close().catch(() => undefined);
        contextInstance = null;
    }
    contextSessionFingerprint = null;
}
function readSessionFingerprint() {
    if (!existsSync(SESSION_PATH))
        throw new AuthenticationRequiredError();
    try {
        const stats = statSync(SESSION_PATH);
        if (!stats.isFile())
            throw new AuthenticationRequiredError();
        validateStorageState(readFileSync(SESSION_PATH));
        return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
    }
    catch (error) {
        if (error instanceof AuthenticationRequiredError)
            throw error;
        throw new AuthenticationRequiredError();
    }
}
export async function getBrowser() {
    if (browserInstance)
        return browserInstance;
    browserInstance = await chromium.launch({
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    });
    return browserInstance;
}
export async function getAuthenticatedContext() {
    // Reject unusable state before starting the relatively expensive browser
    // process. getContext validates the fingerprint again to avoid a TOCTOU gap.
    try {
        readSessionFingerprint();
    }
    catch (error) {
        await discardContext();
        throw error;
    }
    const browser = await getBrowser();
    return getContext(browser);
}
export async function getContext(browser) {
    let fingerprint;
    try {
        fingerprint = readSessionFingerprint();
    }
    catch (error) {
        await discardContext();
        throw error;
    }
    if (contextInstance && contextSessionFingerprint === fingerprint)
        return contextInstance;
    await discardContext();
    const candidate = await browser.newContext({
        storageState: SESSION_PATH,
        viewport: { width: 1280, height: 800 },
    });
    try {
        await verifyContextAuthentication(candidate);
    }
    catch (error) {
        await candidate.close().catch(() => undefined);
        if (error instanceof AuthenticationRequiredError)
            throw error;
        throw new AuthenticationRequiredError();
    }
    contextInstance = candidate;
    contextSessionFingerprint = fingerprint;
    return contextInstance;
}
export async function isLoggedIn(page) {
    try {
        await page.goto("https://www.dndbeyond.com", { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(2000);
        return isLoggedInOnCurrentPage(page);
    }
    catch {
        return false;
    }
}
export async function getPage(context) {
    const pages = context.pages();
    if (pages.length > 0)
        return pages[0];
    return context.newPage();
}
export async function closeBrowser() {
    await discardContext();
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}
//# sourceMappingURL=browser.js.map