import { getPage, isLoggedIn } from "../browser.js";
import { extractLibraryBookCards } from "./library.js";
const DDB_ORIGIN = "https://www.dndbeyond.com";
const SOURCE_SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/;
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
                if (name)
                    items.push({ name, type: extras, url, sources: sourcesFor(el, nameLink) });
            });
        }
        return items;
    }, category);
    return rawResults.map((result) => ({ ...result, sources: normalizeSourceAttributions(result.sources ?? []) }));
}
async function searchSourcebooks(page, query, scope) {
    if (!(await isLoggedIn(page)))
        throw new Error("Not logged in. Please run ddb_login first.");
    const ownership = scope === "accessible" ? "&ownership=owned-shared" : "";
    const url = `${DDB_ORIGIN}/en/library?type=sourcebooks${ownership}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
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
export async function search(context, query, category = "all", sourceScope) {
    const scope = validateSearchRequest(category, sourceScope);
    const page = await getPage(context);
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
        await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30_000 });
        await page.waitForTimeout(1500);
        results = await extractOrdinaryResults(page, category);
    }
    return JSON.stringify({ query, category, url: searchUrl, count: results.length, results }, null, 2);
}
//# sourceMappingURL=search.js.map