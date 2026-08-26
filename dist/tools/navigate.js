import { getPage } from "../browser.js";
import { AuthenticationRequiredError, isLoggedInOnCurrentPage } from "../session-state.js";
import { openDomReadyPage, waitForRenderedContent } from "./page-readiness.js";
export async function navigate(context, url) {
    const page = await getPage(context);
    if (!isAllowedDdbUrl(url)) {
        throw new Error("Only D&D Beyond URLs (https://www.dndbeyond.com/...) are supported.");
    }
    await openDomReadyPage(page, url, 30_000);
    if (!isAllowedDdbUrl(page.url())) {
        throw new Error("Navigation redirected outside D&D Beyond and was blocked.");
    }
    if (!(await isLoggedInOnCurrentPage(page)))
        throw new AuthenticationRequiredError();
    await waitForRenderedContent(page, "body", 10_000);
    await page.waitForTimeout(1500);
    // Extract page text content and convert to readable markdown-ish format
    const content = await page.evaluate(() => {
        // Remove scripts and styles
        document.querySelectorAll("script, style, nav, footer, .ad-container, .advertisement").forEach((el) => el.remove());
        // Try to get the main content area
        const main = document.querySelector("main, article, .main-content, .page-content, #content") ?? document.body;
        return main.innerText;
    });
    const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n\n[Content truncated — use mysterium_read_book or a more specific URL to get full content]" : content;
    return `URL: ${url}\n\n${truncated}`;
}
export function isAllowedDdbUrl(value) {
    try {
        const parsed = new URL(value);
        return (parsed.protocol === "https:" &&
            parsed.username === "" &&
            parsed.password === "" &&
            parsed.port === "" &&
            (parsed.hostname === "www.dndbeyond.com" || parsed.hostname === "dndbeyond.com"));
    }
    catch {
        return false;
    }
}
export async function interact(context, action, selector, value) {
    const page = await getPage(context);
    if (action === "fill" && value === undefined)
        throw new Error("'value' is required for fill action.");
    if (!(await isLoggedInOnCurrentPage(page)))
        throw new AuthenticationRequiredError();
    switch (action) {
        case "click": {
            await page.locator(selector).first().click();
            await page.waitForTimeout(1000);
            return `Clicked element: ${selector}`;
        }
        case "fill": {
            await page.locator(selector).first().fill(value);
            await page.waitForTimeout(500);
            return `Filled '${selector}' with: ${value}`;
        }
        case "screenshot": {
            const screenshotPath = `/tmp/mysterium-screenshot-${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: false });
            return `Screenshot saved to: ${screenshotPath}`;
        }
        default:
            throw new Error(`Unknown action: ${action}. Use 'click', 'fill', or 'screenshot'.`);
    }
}
export async function getCurrentPageContent(context) {
    const page = await getPage(context);
    if (!(await isLoggedInOnCurrentPage(page)))
        throw new AuthenticationRequiredError();
    const url = page.url();
    const content = await page.evaluate(() => {
        document.querySelectorAll("script, style, nav, footer, .ad-container").forEach((el) => el.remove());
        const main = document.querySelector("main, article, .main-content, .page-content") ?? document.body;
        return main.innerText;
    });
    const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n[truncated]" : content;
    return `Current URL: ${url}\n\n${truncated}`;
}
//# sourceMappingURL=navigate.js.map