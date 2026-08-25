import { getPage, isLoggedIn } from "../browser.js";
import { AuthenticationRequiredError, throwIfAuthenticationRedirect } from "../session-state.js";
import { extractLibraryBookCards } from "./library.js";
const DDB_ORIGIN = "https://www.dndbeyond.com";
const SOURCE_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/;
const MONSTER_PATH_PATTERN = /^\/monsters\/(\d+)(?:-[a-zA-Z0-9][a-zA-Z0-9-]*)?\/?$/;
const MAX_REMEMBERED_MONSTER_URLS = 512;
const monsterUrlByCreatureId = new Map();
function rememberMonsterUrl(creatureId, value) {
    try {
        const url = new URL(value, DDB_ORIGIN);
        const urlId = url.protocol === "https:" && ["dndbeyond.com", "www.dndbeyond.com"].includes(url.hostname.toLowerCase())
            ? url.pathname.match(MONSTER_PATH_PATTERN)?.[1]
            : undefined;
        if (urlId !== creatureId)
            return;
        monsterUrlByCreatureId.delete(creatureId);
        monsterUrlByCreatureId.set(creatureId, url.href);
        while (monsterUrlByCreatureId.size > MAX_REMEMBERED_MONSTER_URLS) {
            const oldest = monsterUrlByCreatureId.keys().next().value;
            if (oldest === undefined)
                break;
            monsterUrlByCreatureId.delete(oldest);
        }
    }
    catch {
        // Search results with malformed URLs are returned without a reusable creature URL.
    }
}
export function rememberedMonsterUrl(creatureId) {
    return monsterUrlByCreatureId.get(creatureId);
}
function normalizeText(value) {
    const normalized = (value ?? "").replace(/\s+/g, " ").trim();
    return normalized || null;
}
function normalizeSlug(value) {
    const normalized = normalizeText(value)?.replace(/^\/+|\/+$/g, "") ?? null;
    return normalized && SOURCE_SLUG_PATTERN.test(normalized) ? normalized : null;
}
export function normalizeSourceAttribution(raw) {
    const title = normalizeText(raw.title);
    let url = null;
    let pathSlug = null;
    if (normalizeText(raw.url)) {
        try {
            const parsed = new URL(raw.url, DDB_ORIGIN);
            if ((parsed.hostname === "dndbeyond.com" || parsed.hostname === "www.dndbeyond.com") && parsed.protocol === "https:") {
                url = parsed.href;
                pathSlug = normalizeSlug(parsed.pathname.match(/^\/sources\/(.+?)\/?$/)?.[1]);
            }
        }
        catch {
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
export function normalizeSourceAttributions(rawSources) {
    const unique = new Map();
    for (const raw of rawSources) {
        const source = normalizeSourceAttribution(raw);
        if (!source.title && !source.url && !source.bookSlug && !source.chapterSlug)
            continue;
        const key = JSON.stringify(source);
        if (!unique.has(key))
            unique.set(key, source);
    }
    return [...unique.values()];
}
export function validateSearchRequest(category, sourceScope) {
    if (sourceScope !== undefined && category !== "sourcebooks") {
        throw new Error("source_scope is only valid when category is 'sourcebooks'.");
    }
    return sourceScope ?? "accessible";
}
async function extractOrdinaryResults(page, category) {
    const rawResults = await page.evaluate((cat) => {
        const items = [];
        const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
        const sourcesFor = (container, nameLink) => {
            const sources = [];
            const sourceContainers = Array.from(container.querySelectorAll(".source, .sources, [data-testid*='source' i], [class*='source-name' i], [class*='sourcebook' i]"));
            for (const sourceContainer of sourceContainers) {
                const links = Array.from(sourceContainer.querySelectorAll("a[href]"));
                const sourceLinks = links.filter((link) => link !== nameLink && /\/sources\//.test(link.getAttribute("href") ?? link.href));
                if (sourceLinks.length === 0) {
                    const title = normalize(sourceContainer.textContent).replace(/^sources?\s*:?\s*/i, "");
                    if (title)
                        sources.push({ title, url: null, bookSlug: null, chapterSlug: null });
                    continue;
                }
                for (const link of sourceLinks) {
                    const element = link;
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
                const nameLink = el.querySelector("a.result-title, a.listing-name, h2 a, h3 a");
                const name = normalize(nameLink?.textContent) || normalize(el.querySelector("h2, h3")?.textContent);
                const type = normalize(el.querySelector(".result-category, .result-type, .listing-tag")?.textContent);
                const link = (nameLink ?? el.querySelector("a"))?.href ?? "";
                if (name)
                    items.push({ name, type, url: link, sources: sourcesFor(el, nameLink) });
            });
        }
        else {
            document.querySelectorAll(".listing-body div.info[data-slug]").forEach((el) => {
                const nameLink = el.querySelector("a.link");
                const name = normalize(nameLink?.textContent);
                const url = nameLink?.href ?? "";
                const levelEl = el.querySelector(".row.spell-level span, .row.monster-challenge span, .row.item-rarity span, .row.class-level span, .row.feat-prerequisite span");
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
                            edition: editionMatch ? editionMatch[1].toLowerCase() : null,
                            legacy: /\bLegacy\b/i.test(text) || Boolean(el.querySelector("[class*='legacy' i], [data-testid*='legacy' i]")),
                            challengeRating: normalize(levelEl?.textContent) || null,
                            type: monsterType || null,
                            tags,
                            access: unavailable ? "unavailable" : "unknown",
                        },
                    });
                }
                else if (name)
                    items.push({ name, type: extras, url, sources });
            });
        }
        return items;
    }, category);
    return rawResults.map((result) => {
        let creatureId;
        if (category === "monsters") {
            try {
                const parsed = new URL(result.url, DDB_ORIGIN);
                creatureId = parsed.protocol === "https:" && (parsed.hostname === "dndbeyond.com" || parsed.hostname === "www.dndbeyond.com")
                    ? parsed.pathname.match(MONSTER_PATH_PATTERN)?.[1] ?? null
                    : null;
            }
            catch {
                creatureId = null;
            }
        }
        const normalized = {
            ...result,
            sources: normalizeSourceAttributions(result.sources ?? []),
            ...(category === "monsters" ? { creatureId } : {}),
        };
        if (category === "monsters" && creatureId)
            rememberMonsterUrl(creatureId, result.url);
        return normalized;
    });
}
async function searchSourcebooks(page, query, scope) {
    if (!(await isLoggedIn(page)))
        throw new AuthenticationRequiredError();
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
        type: "sourcebook",
        url: cardUrl,
        bookSlug,
        access,
        sources: [],
    }));
    return { url, results };
}
export async function searchResults(context, query, category = "all", sourceScope, pageOverride) {
    const scope = validateSearchRequest(category, sourceScope);
    const page = pageOverride ?? await getPage(context);
    let searchUrl;
    let results;
    if (category === "sourcebooks") {
        const sourcebookSearch = await searchSourcebooks(page, query, scope);
        searchUrl = sourcebookSearch.url;
        results = sourcebookSearch.results;
    }
    else {
        const categoryPaths = {
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
            await page.waitForSelector(".listing-body, .search-results, [data-testid*='monster' i], main", { timeout: 15_000 }).catch(() => undefined);
        }
        await page.waitForTimeout(1500);
        results = await extractOrdinaryResults(page, category);
    }
    return { query, category, url: searchUrl, count: results.length, results };
}
export async function search(context, query, category = "all", sourceScope) {
    return searchResults(context, query, category, sourceScope);
}
//# sourceMappingURL=search.js.map