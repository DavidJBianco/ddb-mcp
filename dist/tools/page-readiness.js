export async function openDomReadyPage(page, url, timeout) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
}
export async function waitForRenderedContent(page, selector, timeout = 15_000) {
    try {
        await page.waitForSelector(selector, { timeout });
    }
    catch {
        // Extraction remains authoritative: it distinguishes valid empty pages,
        // inaccessible content, and changed layouts after this bounded hint.
    }
}
//# sourceMappingURL=page-readiness.js.map