import type { Page } from "playwright";

export async function openDomReadyPage(page: Page, url: string, timeout: number): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
}

export async function waitForRenderedContent(
  page: Page,
  selector: string,
  timeout = 15_000
): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch {
    // Extraction remains authoritative: it distinguishes valid empty pages,
    // inaccessible content, and changed layouts after this bounded hint.
  }
}
