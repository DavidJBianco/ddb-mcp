import type { BrowserContext, Page } from "playwright";

import { getPage, isLoggedIn } from "../browser.js";
import { AuthenticationRequiredError, throwIfAuthenticationRedirect } from "../session-state.js";
import { extractLibraryBookCards, type LibraryBookCard } from "./library.js";

export type SearchCategory = "spells" | "monsters" | "items" | "races" | "classes" | "feats" | "sourcebooks" | "all";
export type SourceScope = "accessible" | "all";

export interface RawSourceAttribution {
  title?: string | null;
  url?: string | null;
  bookSlug?: string | null;
  chapterSlug?: string | null;
}

export interface SourceAttribution {
  title: string | null;
  url: string | null;
  bookSlug: string | null;
  chapterSlug: string | null;
}

export type SearchAccess = "accessible" | "unavailable" | "unknown";

export interface MonsterSearchMetadata {
  source: string | null;
  edition: "5e" | "5.5e" | null;
  legacy: boolean;
  challengeRating: string | null;
  type: string | null;
  tags: string[];
  access: SearchAccess;
}

export interface OrdinarySearchResult {
  name: string;
  type: string;
  url: string;
  sources: SourceAttribution[];
  creatureId?: string | null;
  monster?: MonsterSearchMetadata;
}

export interface SourcebookSearchResult {
  name: string;
  type: "sourcebook";
  url: string;
  bookSlug: string | null;
  access: LibraryBookCard["access"];
  sources: [];
}

const DDB_ORIGIN = "https://www.dndbeyond.com";
const SOURCE_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/;
const MONSTER_PATH_PATTERN = /^\/monsters\/(\d+)(?:-[a-zA-Z0-9][a-zA-Z0-9-]*)?\/?$/;
const MAX_REMEMBERED_MONSTER_URLS = 512;
const monsterUrlByCreatureId = new Map<string, string>();

function rememberMonsterUrl(creatureId: string, value: string): void {
  try {
    const url = new URL(value, DDB_ORIGIN);
    const urlId = url.protocol === "https:" && ["dndbeyond.com", "www.dndbeyond.com"].includes(url.hostname.toLowerCase())
      ? url.pathname.match(MONSTER_PATH_PATTERN)?.[1]
      : undefined;
    if (urlId !== creatureId) return;
    monsterUrlByCreatureId.delete(creatureId);
    monsterUrlByCreatureId.set(creatureId, url.href);
    while (monsterUrlByCreatureId.size > MAX_REMEMBERED_MONSTER_URLS) {
      const oldest = monsterUrlByCreatureId.keys().next().value;
      if (oldest === undefined) break;
      monsterUrlByCreatureId.delete(oldest);
    }
  } catch {
    // Search results with malformed URLs are returned without a reusable creature URL.
  }
}

export function rememberedMonsterUrl(creatureId: string): string | undefined {
  return monsterUrlByCreatureId.get(creatureId);
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeSlug(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)?.replace(/^\/+|\/+$/g, "") ?? null;
  return normalized && SOURCE_SLUG_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeSourceAttribution(raw: RawSourceAttribution): SourceAttribution {
  const title = normalizeText(raw.title);
  let url: string | null = null;
  let pathSlug: string | null = null;

  if (normalizeText(raw.url)) {
    try {
      const parsed = new URL(raw.url as string, DDB_ORIGIN);
      if ((parsed.hostname === "dndbeyond.com" || parsed.hostname === "www.dndbeyond.com") && parsed.protocol === "https:") {
        url = parsed.href;
        pathSlug = normalizeSlug(parsed.pathname.match(/^\/sources\/(.+?)\/?$/)?.[1]);
      }
    } catch {
      // Preserve the title, but do not expose malformed or external URLs.
    }
  }

  const hintedBookSlug = normalizeSlug(raw.bookSlug);
  const chapterSlug = normalizeSlug(raw.chapterSlug);
  return {
    title,
    url,
    bookSlug: hintedBookSlug ?? (chapterSlug ? null : pathSlug),
    chapterSlug,
  };
}

export function normalizeSourceAttributions(rawSources: RawSourceAttribution[]): SourceAttribution[] {
  const unique = new Map<string, SourceAttribution>();
  for (const raw of rawSources) {
    const source = normalizeSourceAttribution(raw);
    if (!source.title && !source.url && !source.bookSlug && !source.chapterSlug) continue;
    const key = JSON.stringify(source);
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

export function validateSearchRequest(category: SearchCategory, sourceScope?: SourceScope): SourceScope {
  if (sourceScope !== undefined && category !== "sourcebooks") {
    throw new Error("source_scope is only valid when category is 'sourcebooks'.");
  }
  return sourceScope ?? "accessible";
}

async function extractOrdinaryResults(page: Page, category: Exclude<SearchCategory, "sourcebooks">): Promise<OrdinarySearchResult[]> {
  const rawResults = await page.evaluate((cat) => {
    type BrowserSource = { title: string | null; url: string | null; bookSlug: string | null; chapterSlug: string | null };
    type BrowserMonster = {
      source: string | null;
      edition: "5e" | "5.5e" | null;
      legacy: boolean;
      challengeRating: string | null;
      type: string | null;
      tags: string[];
      access: "accessible" | "unavailable" | "unknown";
    };
    type BrowserResult = { name: string; type: string; url: string; sources: BrowserSource[]; monster?: BrowserMonster };
    const items: BrowserResult[] = [];
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

    const sourcesFor = (container: Element, nameLink: HTMLAnchorElement | null): BrowserSource[] => {
      const sources: BrowserSource[] = [];
      const sourceContainers = Array.from(container.querySelectorAll(
        ".source, .sources, [data-testid*='source' i], [class*='source-name' i], [class*='sourcebook' i]"
      ));
      for (const sourceContainer of sourceContainers) {
        const links = Array.from(sourceContainer.querySelectorAll("a[href]")) as HTMLAnchorElement[];
        const sourceLinks = links.filter((link) => link !== nameLink && /\/sources\//.test(link.getAttribute("href") ?? link.href));
        if (sourceLinks.length === 0) {
          const title = normalize(sourceContainer.textContent).replace(/^sources?\s*:?\s*/i, "");
          if (title) sources.push({ title, url: null, bookSlug: null, chapterSlug: null });
          continue;
        }
        for (const link of sourceLinks) {
          const element = link as HTMLElement;
          sources.push({
            title: normalize(link.textContent) || normalize(link.title) || normalize(link.getAttribute("aria-label")) || null,
            url: link.href || null,
            bookSlug: element.dataset.bookSlug ?? null,
            chapterSlug: element.dataset.chapterSlug ?? null,
          });
        }
      }
      return sources;
    };

    if (cat === "all") {
      document.querySelectorAll(".search-result, .results-item").forEach((el) => {
        const nameLink = el.querySelector("a.result-title, a.listing-name, h2 a, h3 a") as HTMLAnchorElement | null;
        const name = normalize(nameLink?.textContent) || normalize(el.querySelector("h2, h3")?.textContent);
        const type = normalize(el.querySelector(".result-category, .result-type, .listing-tag")?.textContent);
        const link = (nameLink ?? (el.querySelector("a") as HTMLAnchorElement | null))?.href ?? "";
        if (name) items.push({ name, type, url: link, sources: sourcesFor(el, nameLink) });
      });
    } else {
      document.querySelectorAll(".listing-body div.info[data-slug]").forEach((el) => {
        const nameLink = el.querySelector("a.link") as HTMLAnchorElement | null;
        const name = normalize(nameLink?.textContent);
        const url = nameLink?.href ?? "";
        const levelEl = el.querySelector(
          ".row.spell-level span, .row.monster-challenge span, .row.item-rarity span, .row.class-level span, .row.feat-prerequisite span"
        );
        const schoolEl = el.querySelector(".row.spell-school .school");
        const schoolName = schoolEl ? (schoolEl.className.replace("school", "").trim() || "") : "";
        const extras = [normalize(levelEl?.textContent), schoolName].filter(Boolean).join(" | ");
        const sources = sourcesFor(el, nameLink);
        if (name && cat === "monsters") {
          const text = normalize(el.textContent);
          const editionMatch = text.match(/\b(5\.5e|5e)\b/i);
          const tagContainer = el.querySelector(".row.monster-tags, [class*='monster-tag' i], [data-testid*='tag' i]");
          const tags = normalize(tagContainer?.textContent)
            .replace(/^Monster Tags?:?\s*/i, "")
            .split(/[,;|]/)
            .map(normalize)
            .filter(Boolean);
          const sourceContainer = el.querySelector(".source, .sources, [data-testid*='source' i], [class*='source-name' i], [class*='sourcebook' i]");
          const source = normalize(sourceContainer?.textContent)
            .replace(/^Sources?:?\s*/i, "")
            .replace(/\s+(?:5\.5e|5e)$/i, "")
            .replace(/\s+/g, " ")
            .trim();
          const monsterType = normalize(el.querySelector(".row.monster-type, [class*='monster-type' i]")?.textContent);
          const unavailable = /view in store|purchase|unlock/i.test(text) || Boolean(el.querySelector("[class*='locked' i], [data-testid*='locked' i]"));
          items.push({
            name,
            type: extras,
            url,
            sources,
            monster: {
              source: source || null,
              edition: editionMatch ? editionMatch[1].toLowerCase() as "5e" | "5.5e" : null,
              legacy: /\bLegacy\b/i.test(text) || Boolean(el.querySelector("[class*='legacy' i], [data-testid*='legacy' i]")),
              challengeRating: normalize(levelEl?.textContent) || null,
              type: monsterType || null,
              tags,
              access: unavailable ? "unavailable" : "unknown",
            },
          });
        } else if (name) items.push({ name, type: extras, url, sources });
      });
    }

    return items;
  }, category);

  return rawResults.map((result) => {
    let creatureId: string | null | undefined;
    if (category === "monsters") {
      try {
        const parsed = new URL(result.url, DDB_ORIGIN);
        creatureId = parsed.protocol === "https:" && (parsed.hostname === "dndbeyond.com" || parsed.hostname === "www.dndbeyond.com")
          ? parsed.pathname.match(MONSTER_PATH_PATTERN)?.[1] ?? null
          : null;
      } catch {
        creatureId = null;
      }
    }
    const normalized = {
      ...result,
      sources: normalizeSourceAttributions(result.sources ?? []),
      ...(category === "monsters" ? { creatureId } : {}),
    };
    if (category === "monsters" && creatureId) rememberMonsterUrl(creatureId, result.url);
    return normalized;
  });
}

async function searchSourcebooks(page: Page, query: string, scope: SourceScope): Promise<{ url: string; results: SourcebookSearchResult[] }> {
  if (!(await isLoggedIn(page))) throw new AuthenticationRequiredError();

  const ownership = scope === "accessible" ? "&ownership=owned-shared" : "";
  const url = `${DDB_ORIGIN}/en/library?type=sourcebooks${ownership}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  throwIfAuthenticationRedirect(page);

  const filter = page.locator("input[placeholder*='Filter by title' i]:visible").first();
  if ((await filter.count()) === 0) {
    throw new Error("D&D Beyond's sourcebook title filter was not found; the library layout may have changed.");
  }
  await filter.fill(query);
  await page.waitForTimeout(750);

  const cards = await extractLibraryBookCards(page);
  const results = cards
    .filter((card) => scope === "all" || card.access === "accessible")
    .map(({ title, url: cardUrl, bookSlug, access }) => ({
      name: title,
      type: "sourcebook" as const,
      url: cardUrl,
      bookSlug,
      access,
      sources: [] as [],
    }));
  return { url, results };
}

export interface SearchEnvelope {
  query: string;
  category: SearchCategory;
  url: string;
  count: number;
  results: Array<OrdinarySearchResult | SourcebookSearchResult>;
}

export async function searchResults(
  context: BrowserContext,
  query: string,
  category: SearchCategory = "all",
  sourceScope?: SourceScope,
  pageOverride?: Page
): Promise<SearchEnvelope> {
  const scope = validateSearchRequest(category, sourceScope);
  const page = pageOverride ?? await getPage(context);

  let searchUrl: string;
  let results: Array<OrdinarySearchResult | SourcebookSearchResult>;
  if (category === "sourcebooks") {
    const sourcebookSearch = await searchSourcebooks(page, query, scope);
    searchUrl = sourcebookSearch.url;
    results = sourcebookSearch.results;
  } else {
    const categoryPaths: Record<Exclude<SearchCategory, "sourcebooks">, string> = {
      spells: "spells",
      monsters: "monsters",
      items: "magic-items",
      races: "races",
      classes: "classes",
      feats: "feats",
      all: "search",
    };
    const path = categoryPaths[category];
    const encodedQuery = encodeURIComponent(query);
    searchUrl = category === "all"
      ? `${DDB_ORIGIN}/search?q=${encodedQuery}`
      : `${DDB_ORIGIN}/${path}?filter-search=${encodedQuery}`;
    await page.goto(searchUrl, {
      waitUntil: category === "monsters" ? "domcontentloaded" : "networkidle",
      timeout: 30_000,
    });
    throwIfAuthenticationRedirect(page);
    if (category === "monsters") {
      await page.waitForSelector(
        ".listing-body, .search-results, [data-testid*='monster' i], main",
        { timeout: 15_000 }
      ).catch(() => undefined);
    }
    await page.waitForTimeout(1500);
    results = await extractOrdinaryResults(page, category);
  }

  return { query, category, url: searchUrl, count: results.length, results };
}

export async function search(
  context: BrowserContext,
  query: string,
  category: SearchCategory = "all",
  sourceScope?: SourceScope
): Promise<string> {
  return JSON.stringify(await searchResults(context, query, category, sourceScope), null, 2);
}
