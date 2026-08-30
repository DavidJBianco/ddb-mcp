import { createHash } from "node:crypto";
import type { BrowserContext, Page } from "playwright";

import { getPage, isLoggedIn } from "../browser.js";
import { AuthenticationRequiredError, throwIfAuthenticationRedirect } from "../session-state.js";
import { extractLibraryBookCards, listLibrarySnapshot, type LibraryBookCard, type LibraryEnvelope } from "./library.js";
import { openDomReadyPage, waitForRenderedContent } from "./page-readiness.js";
import { decodeOpaqueCursorObject, encodeOpaqueCursor } from "./pagination.js";

export type SearchCategory = "spells" | "monsters" | "items" | "races" | "classes" | "feats" | "sourcebooks" | "all";
export type SourceScope = "accessible" | "all";
export type LegacyFilter = "include" | "exclude" | "only";

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_SEARCH_SNIPPET_CHARS = 500;
export const MAX_SEARCH_SNIPPETS = 2;

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

export interface BookLocation {
  bookSlug: string;
  chapterSlug: string | null;
  sectionFragment: string | null;
  sectionTitleHint: string | null;
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
  legacy: boolean;
  snippets: string[];
  sources: SourceAttribution[];
  bookLocation: BookLocation | null;
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

export interface SearchOptions {
  bookSlug?: string;
  legacy?: LegacyFilter;
  limit?: number;
  cursor?: string;
  refresh?: boolean;
}

export interface SearchFilters {
  sourceScope: SourceScope | null;
  bookSlug: string | null;
  legacy: LegacyFilter | null;
}

interface SearchCursorPayload {
  version: 1;
  query: string;
  category: SearchCategory;
  sourceScope: SourceScope | null;
  bookSlug: string | null;
  legacy: LegacyFilter | null;
  limit: number;
  offset: number;
  fingerprint: string;
}

interface NormalizedSearchRequest {
  sourceScope: SourceScope | null;
  bookSlug: string | null;
  legacy: LegacyFilter | null;
  limit: number;
  cursor: SearchCursorPayload | null;
  refresh: boolean;
}

interface ExtractedOrdinaryResults {
  results: OrdinarySearchResult[];
  reportedCount: number | null;
  renderedCount: number;
}

export interface SearchEnvelope {
  query: string;
  category: SearchCategory;
  filters: SearchFilters;
  url: string;
  count: number;
  total: number;
  reportedCount: number | null;
  partial: boolean;
  results: Array<OrdinarySearchResult | SourcebookSearchResult>;
  nextCursor: string | null;
  done: boolean;
}

const DDB_ORIGIN = "https://www.dndbeyond.com";
const SOURCE_SLUG_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9\/_-]*$/;
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

function comparisonText(value: string | null | undefined): string {
  return (normalizeText(value) ?? "").normalize("NFKC").replace(/[‘’]/g, "'").toLocaleLowerCase("en-US");
}

function normalizeSlug(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)?.replace(/^\/+|\/+$/g, "") ?? null;
  return normalized && SOURCE_SLUG_PATTERN.test(normalized) ? normalized : null;
}

function canonicalDdbUrl(value: string | null | undefined): string | null {
  if (!normalizeText(value)) return null;
  try {
    const url = new URL(value as string, DDB_ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!["dndbeyond.com", "www.dndbeyond.com"].includes(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch {
    return null;
  }
}

function boundedSnippet(value: string | null | undefined, title: string): string | null {
  let snippet = normalizeText(value);
  if (!snippet) return null;
  if (comparisonText(snippet).startsWith(comparisonText(title))) snippet = normalizeText(snippet.slice(title.length));
  if (!snippet) return null;
  return Array.from(snippet).slice(0, MAX_SEARCH_SNIPPET_CHARS).join("");
}

export function normalizeSourceAttribution(raw: RawSourceAttribution): SourceAttribution {
  const title = normalizeText(raw.title);
  const url = canonicalDdbUrl(raw.url);
  const pathSlug = url ? normalizeSlug(new URL(url).pathname.match(/^\/sources\/(.+?)\/?$/)?.[1]) : null;
  const hintedBookSlug = normalizeSlug(raw.bookSlug);
  const chapterSlug = normalizeSlug(raw.chapterSlug);
  return { title, url, bookSlug: hintedBookSlug ?? (chapterSlug ? null : pathSlug), chapterSlug };
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

export function resolveBookLocation(value: string, title: string, sources: SourceAttribution[], scopedBookSlug?: string): BookLocation | null {
  const canonical = canonicalDdbUrl(value);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  const path = decodeURIComponent(parsed.pathname.match(/^\/sources\/(.+?)\/?$/)?.[1] ?? "");
  if (!path) return null;
  const hintedSlugs = [scopedBookSlug, ...sources.map(({ bookSlug }) => bookSlug)]
    .map(normalizeSlug).filter((slug): slug is string => Boolean(slug)).sort((left, right) => right.length - left.length);
  let bookSlug = hintedSlugs.find((slug) => path === slug || path.startsWith(`${slug}/`)) ?? null;
  if (!bookSlug) {
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "dnd" && parts.length >= 2) bookSlug = parts.slice(0, 2).join("/");
    else if (parts.length === 1) bookSlug = parts[0];
  }
  if (!bookSlug) return null;
  const chapterSlug = normalizeSlug(path === bookSlug ? null : path.slice(bookSlug.length + 1));
  let sectionFragment: string | null = null;
  if (parsed.hash.length > 1) {
    try { sectionFragment = normalizeText(decodeURIComponent(parsed.hash.slice(1))); }
    catch { sectionFragment = normalizeText(parsed.hash.slice(1)); }
  }
  return { bookSlug, chapterSlug, sectionFragment, sectionTitleHint: chapterSlug ? normalizeText(title) : null };
}

export function decodeSearchCursor(cursor: string): SearchCursorPayload {
  const value = decodeOpaqueCursorObject(cursor, "Invalid search cursor: expected an opaque cursor returned by mysterium_search.", "Invalid search cursor: cursor payload must be an object.");
  if (value.version !== 1) throw new Error("Invalid search cursor: unsupported cursor version; restart without a cursor.");
  if (typeof value.query !== "string" || !value.query) throw new Error("Invalid search cursor: missing query binding.");
  if (!["spells", "monsters", "items", "races", "classes", "feats", "sourcebooks", "all"].includes(String(value.category))) throw new Error("Invalid search cursor: invalid category binding.");
  if (value.sourceScope !== null && !["accessible", "all"].includes(String(value.sourceScope))) throw new Error("Invalid search cursor: invalid source scope binding.");
  if (value.bookSlug !== null && (typeof value.bookSlug !== "string" || normalizeSlug(value.bookSlug) !== value.bookSlug)) throw new Error("Invalid search cursor: invalid book binding.");
  if (value.legacy !== null && !["include", "exclude", "only"].includes(String(value.legacy))) throw new Error("Invalid search cursor: invalid Legacy binding.");
  if (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > MAX_SEARCH_LIMIT) throw new Error("Invalid search cursor: invalid result limit.");
  if (!Number.isInteger(value.offset) || (value.offset as number) < 0) throw new Error("Invalid search cursor: invalid result position.");
  if (typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new Error("Invalid search cursor: invalid result fingerprint.");
  return value as unknown as SearchCursorPayload;
}

export function validateSearchRequest(category: SearchCategory, sourceScope?: SourceScope, options: SearchOptions = {}): NormalizedSearchRequest {
  if (sourceScope !== undefined && category !== "sourcebooks") throw new Error("source_scope is only valid when category is 'sourcebooks'.");
  const bookSlug = options.bookSlug === undefined ? null : normalizeSlug(options.bookSlug);
  if (options.bookSlug !== undefined && bookSlug !== options.bookSlug) throw new Error("book_slug must be a safe relative D&D Beyond sourcebook slug.");
  if (bookSlug && category !== "all") throw new Error("book_slug is only valid when category is 'all' or omitted.");
  if (options.refresh && !bookSlug) throw new Error("refresh is only valid for searches with book_slug; search results themselves are not cached.");
  if (category === "sourcebooks" && options.legacy !== undefined) throw new Error("legacy is not valid when category is 'sourcebooks' because catalog cards do not expose Legacy badges.");
  const decoded = options.cursor ? decodeSearchCursor(options.cursor) : null;
  const limit = options.limit ?? decoded?.limit ?? DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) throw new Error(`limit must be a positive integer no greater than ${MAX_SEARCH_LIMIT}.`);
  return {
    sourceScope: category === "sourcebooks" ? sourceScope ?? "accessible" : null,
    bookSlug,
    legacy: category === "sourcebooks" ? null : options.legacy ?? "include",
    limit,
    cursor: decoded,
    refresh: options.refresh ?? false,
  };
}

function resultFingerprint(results: Array<OrdinarySearchResult | SourcebookSearchResult>): string {
  return createHash("sha256").update(JSON.stringify(results), "utf8").digest("hex");
}

function resultMatchesBook(result: OrdinarySearchResult, bookSlug: string, bookTitle: string): boolean {
  if (result.bookLocation?.bookSlug === bookSlug) return true;
  return result.sources.some((source) => source.bookSlug === bookSlug || sourceLinkMatchesBook(source.url, bookSlug) || comparisonText(source.title) === comparisonText(bookTitle));
}

function libraryMatches(library: LibraryEnvelope, requestedSlug: string): LibraryEnvelope["books"] {
  const exact = library.books.find(({ slug }) => slug === requestedSlug);
  if (exact) return [exact];
  if (requestedSlug.includes("/")) return [];
  return library.books.filter(({ slug }) => slug.split("/").at(-1) === requestedSlug);
}

export function resolveLibraryBookSlug(
  library: LibraryEnvelope,
  requestedSlug: string
): { slug: string; title: string } | null {
  const matches = libraryMatches(library, requestedSlug);
  if (matches.length === 1) return { slug: matches[0].slug, title: matches[0].title };
  if (matches.length > 1) {
    throw new Error(`Sourcebook slug '${requestedSlug}' is ambiguous; use one of these canonical accessible slugs: ${matches.map(({ slug }) => slug).sort().join(", ")}.`);
  }
  return null;
}

async function resolveAccessibleBook(
  context: BrowserContext,
  requestedSlug: string,
  refresh: boolean
): Promise<{ slug: string; title: string }> {
  let snapshot = await listLibrarySnapshot(context, { refresh });
  let resolved = resolveLibraryBookSlug(snapshot.value, requestedSlug);
  if (!resolved && snapshot.status === "hit" && !refresh) {
    snapshot = await listLibrarySnapshot(context, { refresh: true });
    resolved = resolveLibraryBookSlug(snapshot.value, requestedSlug);
  }
  if (resolved) return resolved;
  throw new Error(`Sourcebook '${requestedSlug}' is not accessible in the authenticated library.`);
}

function sourceLinkMatchesBook(value: string | null, bookSlug: string): boolean {
  if (!value) return false;
  const canonical = canonicalDdbUrl(value);
  if (!canonical) return false;
  let sourcePath: string;
  try { sourcePath = decodeURIComponent(new URL(canonical).pathname.match(/^\/sources\/(.+?)\/?$/)?.[1] ?? ""); }
  catch { return false; }
  return sourcePath === bookSlug || sourcePath.startsWith(`${bookSlug}/`);
}

function bindSourceToBook(source: SourceAttribution, bookSlug: string, bookTitle: string): SourceAttribution {
  const matchesLink = sourceLinkMatchesBook(source.url, bookSlug);
  if (!matchesLink && comparisonText(source.title) !== comparisonText(bookTitle)) return source;
  let chapterSlug = source.chapterSlug;
  if (matchesLink && !chapterSlug && source.url) {
    try {
      const sourcePath = decodeURIComponent(new URL(source.url).pathname.match(/^\/sources\/(.+?)\/?$/)?.[1] ?? "");
      chapterSlug = normalizeSlug(sourcePath === bookSlug ? null : sourcePath.slice(bookSlug.length + 1));
    } catch {
      chapterSlug = null;
    }
  }
  return { ...source, bookSlug, chapterSlug };
}

function coalesceResults(results: OrdinarySearchResult[]): OrdinarySearchResult[] {
  const unique = new Map<string, OrdinarySearchResult>();
  for (const result of results) {
    const key = `${comparisonText(result.name)}\u0000${result.url}`;
    const existing = unique.get(key);
    if (!existing) { unique.set(key, result); continue; }
    existing.snippets = [...new Set([...existing.snippets, ...result.snippets])].slice(0, MAX_SEARCH_SNIPPETS);
    existing.sources = normalizeSourceAttributions([...existing.sources, ...result.sources]);
    existing.legacy ||= result.legacy;
    existing.bookLocation ??= result.bookLocation;
    if (existing.monster && result.monster) existing.monster.legacy ||= result.monster.legacy;
  }
  return [...unique.values()];
}

async function extractOrdinaryResults(page: Page, category: Exclude<SearchCategory, "sourcebooks">, scopedBookSlug?: string): Promise<ExtractedOrdinaryResults> {
  const extracted = await page.evaluate((cat) => {
    type BrowserSource = { title: string | null; url: string | null; bookSlug: string | null; chapterSlug: string | null };
    type BrowserMonster = { source: string | null; edition: "5e" | "5.5e" | null; legacy: boolean; challengeRating: string | null; type: string | null; tags: string[]; access: "accessible" | "unavailable" | "unknown" };
    type BrowserResult = { name: string; type: string; url: string; legacy: boolean; snippets: string[]; sources: BrowserSource[]; monster?: BrowserMonster };
    const items: BrowserResult[] = [];
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const legacyFor = (container: Element) => Array.from(container.querySelectorAll("[aria-label='legacy' i], .badge-label, [data-testid*='legacy' i], [class*='legacy-badge' i]"))
      .some((node) => normalize(node.getAttribute("aria-label")).toLowerCase() === "legacy" || normalize(node.textContent).toLowerCase() === "legacy");
    const sourcesFor = (container: Element, nameLink: HTMLAnchorElement | null): BrowserSource[] => {
      const sources: BrowserSource[] = [];
      const sourceContainers = Array.from(container.querySelectorAll(".source, .sources, [data-testid*='source' i], [class*='source-name' i], [class*='sourcebook' i]"));
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
          sources.push({ title: normalize(link.textContent) || normalize(link.title) || normalize(link.getAttribute("aria-label")) || null, url: link.href || null, bookSlug: element.dataset.bookSlug ?? null, chapterSlug: element.dataset.chapterSlug ?? null });
        }
      }
      return sources;
    };

    if (cat === "all") {
      const modern = Array.from(document.querySelectorAll(".ddb-search-results-listing-item"));
      const cards = modern.length > 0 ? modern : Array.from(document.querySelectorAll(".search-result, .results-item"));
      for (const el of cards) {
        const nameLink = el.querySelector(".ddb-search-results-listing-item-header-primary-text a[href], a.result-title, a.listing-name, h2 a, h3 a") as HTMLAnchorElement | null;
        const name = normalize(nameLink?.textContent) || normalize(el.querySelector("h2, h3")?.textContent);
        const categoryNode = el.querySelector(".ddb-search-results-listing-item-header-secondary .compendium, .ddb-search-results-listing-item-header-secondary .spells, .ddb-search-results-listing-item-header-secondary .items, .ddb-search-results-listing-item-header-secondary .feats, .ddb-search-results-listing-item-header-secondary .monsters, .ddb-search-results-listing-item-header-secondary .classes, .ddb-search-results-listing-item-header-secondary .races, .result-category, .result-type, .listing-tag");
        const type = normalize(categoryNode?.textContent);
        const snippets = Array.from(el.querySelectorAll(".ddb-search-results-listing-item-body, .result-snippet, .result-description, [data-testid*='snippet' i]")).map((node) => normalize(node.textContent)).filter(Boolean);
        if (name) items.push({ name, type, url: nameLink?.href ?? "", legacy: legacyFor(el), snippets, sources: sourcesFor(el, nameLink) });
      }
    } else {
      document.querySelectorAll(".listing-body div.info[data-slug]").forEach((el) => {
        const nameLink = el.querySelector("a.link") as HTMLAnchorElement | null;
        const name = normalize(nameLink?.textContent);
        const url = nameLink?.href ?? "";
        const levelEl = el.querySelector(".row.spell-level span, .row.monster-challenge span, .row.item-rarity span, .row.class-level span, .row.feat-prerequisite span");
        const schoolEl = el.querySelector(".row.spell-school .school");
        const schoolName = schoolEl ? (schoolEl.className.replace("school", "").trim() || "") : "";
        const extras = [normalize(levelEl?.textContent), schoolName].filter(Boolean).join(" | ");
        const sources = sourcesFor(el, nameLink);
        const legacy = legacyFor(el);
        if (name && cat === "monsters") {
          const text = normalize(el.textContent);
          const editionMatch = text.match(/\b(5\.5e|5e)\b/i);
          const tagContainer = el.querySelector(".row.monster-tags, [class*='monster-tag' i], [data-testid*='tag' i]");
          const tags = normalize(tagContainer?.textContent).replace(/^Monster Tags?:?\s*/i, "").split(/[,;|]/).map(normalize).filter(Boolean);
          const sourceContainer = el.querySelector(".source, .sources, [data-testid*='source' i], [class*='source-name' i], [class*='sourcebook' i]");
          const source = normalize(sourceContainer?.textContent).replace(/^Sources?:?\s*/i, "").replace(/\s+(?:5\.5e|5e)$/i, "").replace(/\s+/g, " ").trim();
          const monsterType = normalize(el.querySelector(".row.monster-type, [class*='monster-type' i]")?.textContent);
          const unavailable = /view in store|purchase|unlock/i.test(text) || Boolean(el.querySelector("[class*='locked' i], [data-testid*='locked' i]"));
          items.push({ name, type: extras, url, sources, legacy, snippets: [], monster: { source: source || null, edition: editionMatch ? editionMatch[1].toLowerCase() as "5e" | "5.5e" : null, legacy, challengeRating: normalize(levelEl?.textContent) || null, type: monsterType || null, tags, access: unavailable ? "unavailable" : "unknown" } });
        } else if (name) items.push({ name, type: extras, url, sources, legacy, snippets: [] });
      });
    }
    const countText = normalize(document.querySelector(".ddb-search-results-counts-text")?.textContent);
    const reportedMatch = countText.match(/returning\s+([\d,]+)\s+results?/i);
    return { results: items, reportedCount: reportedMatch ? Number(reportedMatch[1].replace(/,/g, "")) : null };
  }, category);

  const rawResults = Array.isArray(extracted) ? extracted : extracted.results;
  const reportedCount = Array.isArray(extracted) ? null : extracted.reportedCount;
  const normalizedResults = rawResults.flatMap((result) => {
    const url = canonicalDdbUrl(result.url);
    if (!url) return [];
    const sources = normalizeSourceAttributions(result.sources ?? []);
    const legacy = result.legacy ?? result.monster?.legacy ?? false;
    const snippets = [...new Set((result.snippets ?? []).map((snippet: string) => boundedSnippet(snippet, result.name)).filter((snippet: string | null): snippet is string => Boolean(snippet)))].slice(0, MAX_SEARCH_SNIPPETS);
    let creatureId: string | null | undefined;
    if (category === "monsters" || new URL(url).pathname.startsWith("/monsters/")) creatureId = new URL(url).pathname.match(MONSTER_PATH_PATTERN)?.[1] ?? null;
    const normalized: OrdinarySearchResult = { ...result, url, legacy, snippets, sources, bookLocation: resolveBookLocation(url, result.name, sources, scopedBookSlug), ...(category === "monsters" ? { creatureId } : {}), ...(result.monster ? { monster: { ...result.monster, legacy } } : {}) };
    if (category === "monsters" && creatureId) rememberMonsterUrl(creatureId, url);
    return [normalized];
  });
  return { results: coalesceResults(normalizedResults), reportedCount, renderedCount: rawResults.length };
}

async function searchSourcebooks(page: Page, query: string, scope: SourceScope): Promise<{ url: string; results: SourcebookSearchResult[] }> {
  if (!(await isLoggedIn(page))) throw new AuthenticationRequiredError();
  const ownership = scope === "accessible" ? "&ownership=owned-shared" : "";
  const url = `${DDB_ORIGIN}/en/library?type=sourcebooks${ownership}`;
  await openDomReadyPage(page, url, 30_000);
  throwIfAuthenticationRedirect(page);
  await waitForRenderedContent(page, "input[placeholder*='Filter by title' i]:visible", 15_000);
  const filter = page.locator("input[placeholder*='Filter by title' i]:visible").first();
  if ((await filter.count()) === 0) throw new Error("D&D Beyond's sourcebook title filter was not found; the library layout may have changed.");
  await filter.fill(query);
  await page.waitForTimeout(750);
  const cards = await extractLibraryBookCards(page);
  const results = cards.filter((card) => scope === "all" || card.access === "accessible").map(({ title, url: cardUrl, bookSlug, access }) => ({ name: title, type: "sourcebook" as const, url: cardUrl, bookSlug, access, sources: [] as [] }));
  return { url, results };
}

function validateCursorBindings(
  cursor: SearchCursorPayload | null,
  query: string,
  category: SearchCategory,
  request: NormalizedSearchRequest,
  deferBookBinding = false
): void {
  if (!cursor) return;
  if (cursor.query !== query || cursor.category !== category || cursor.sourceScope !== request.sourceScope || (!deferBookBinding && cursor.bookSlug !== request.bookSlug) || cursor.legacy !== request.legacy || cursor.limit !== request.limit) {
    throw new Error("Search cursor does not match query, category, source_scope, book_slug, legacy, and limit; restart without a cursor.");
  }
}

export function validateSearchContinuation(
  query: string,
  category: SearchCategory,
  sourceScope?: SourceScope,
  options: SearchOptions = {}
): void {
  const request = validateSearchRequest(category, sourceScope, options);
  validateCursorBindings(request.cursor, query, category, request, request.bookSlug !== null);
}

export async function searchResults(context: BrowserContext, query: string, category: SearchCategory = "all", sourceScope?: SourceScope, pageOverride?: Page, options: SearchOptions = {}): Promise<SearchEnvelope> {
  let request = validateSearchRequest(category, sourceScope, options);
  validateCursorBindings(request.cursor, query, category, request, request.bookSlug !== null);
  let selectedBook: { slug: string; title: string } | null = null;
  if (request.bookSlug) {
    selectedBook = await resolveAccessibleBook(context, request.bookSlug, request.refresh);
    request = { ...request, bookSlug: selectedBook.slug };
    validateCursorBindings(request.cursor, query, category, request);
  }
  const page = pageOverride ?? await getPage(context);

  let searchUrl: string;
  let results: Array<OrdinarySearchResult | SourcebookSearchResult>;
  let reportedCount: number | null = null;
  let renderedCount = 0;
  if (category === "sourcebooks") {
    const sourcebookSearch = await searchSourcebooks(page, query, request.sourceScope as SourceScope);
    searchUrl = sourcebookSearch.url;
    results = sourcebookSearch.results;
    renderedCount = results.length;
  } else {
    const categoryPaths: Record<Exclude<SearchCategory, "sourcebooks">, string> = { spells: "spells", monsters: "monsters", items: "magic-items", races: "races", classes: "classes", feats: "feats", all: "search" };
    const path = categoryPaths[category];
    const encodedQuery = encodeURIComponent(query);
    searchUrl = category === "all" ? `${DDB_ORIGIN}/search?q=${encodedQuery}` : `${DDB_ORIGIN}/${path}?filter-search=${encodedQuery}`;
    await openDomReadyPage(page, searchUrl, 30_000);
    throwIfAuthenticationRedirect(page);
    await waitForRenderedContent(page, ".ddb-search-results-body, .listing-body, .search-results, .results-item, [data-testid*='monster' i], main", 15_000);
    await page.waitForTimeout(1500);
    const extracted = await extractOrdinaryResults(page, category, request.bookSlug ?? undefined);
    reportedCount = extracted.reportedCount;
    renderedCount = extracted.renderedCount;
    let ordinary = extracted.results;
    if (selectedBook) {
      ordinary = ordinary.map((result) => ({ ...result, sources: result.sources.map((source) => bindSourceToBook(source, selectedBook.slug, selectedBook.title)) }))
        .filter((result) => resultMatchesBook(result, selectedBook.slug, selectedBook.title));
    }
    if (request.legacy === "exclude") ordinary = ordinary.filter(({ legacy }) => !legacy);
    if (request.legacy === "only") ordinary = ordinary.filter(({ legacy }) => legacy);
    results = ordinary;
  }

  const fingerprint = resultFingerprint(results);
  if (request.cursor && request.cursor.fingerprint !== fingerprint) throw new Error("Search results changed since this cursor was issued; restart without a cursor.");
  const offset = request.cursor?.offset ?? 0;
  if (offset > results.length) throw new Error("Invalid search cursor: result position is outside the current results.");
  const pageResults = results.slice(offset, offset + request.limit);
  const nextOffset = offset + pageResults.length;
  const nextCursor = nextOffset < results.length ? encodeOpaqueCursor({ version: 1, query, category, sourceScope: request.sourceScope, bookSlug: request.bookSlug, legacy: request.legacy, limit: request.limit, offset: nextOffset, fingerprint } satisfies SearchCursorPayload) : null;
  return {
    query,
    category,
    filters: { sourceScope: request.sourceScope, bookSlug: request.bookSlug, legacy: request.legacy },
    url: searchUrl,
    count: pageResults.length,
    total: results.length,
    reportedCount,
    partial: reportedCount !== null && reportedCount > renderedCount,
    results: pageResults,
    nextCursor,
    done: nextCursor === null,
  };
}

export async function search(context: BrowserContext, query: string, category: SearchCategory = "all", sourceScope?: SourceScope, options: SearchOptions = {}): Promise<SearchEnvelope> {
  return searchResults(context, query, category, sourceScope, undefined, options);
}
