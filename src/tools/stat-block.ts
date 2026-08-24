import type { BrowserContext, Page } from "playwright";

import { isLoggedIn } from "../browser.js";
import { AuthenticationRequiredError, isDdbHostname, throwIfAuthenticationRedirect } from "../session-state.js";
import { rememberedMonsterUrl, searchResults, type OrdinarySearchResult, type SearchAccess } from "./search.js";

const DDB_ORIGIN = "https://www.dndbeyond.com";
const CREATURE_ID_PATTERN = /^\d+$/;
const MONSTER_PATH_PATTERN = /^\/monsters\/(\d+)(?:-[a-zA-Z0-9][a-zA-Z0-9-]*)?\/?$/;

export type LegacyFilter = "include" | "exclude" | "only";

export interface StatBlockRequest {
  query?: string;
  creatureId?: string;
  legacy?: LegacyFilter;
}

export interface StatBlockCandidate {
  id: string;
  name: string;
  url: string;
  source: string | null;
  edition: "5e" | "5.5e" | null;
  legacy: boolean;
  challengeRating: string | null;
  type: string | null;
  tags: string[];
  access: SearchAccess;
  accessFailure?: string;
}

export interface StatBlockAbility {
  name: string;
  score: number | null;
  modifier: string | null;
  save: string | null;
}

export interface StatBlockAttribute {
  label: string;
  value: string;
}

export interface StatBlockEntry {
  name: string | null;
  text: string;
}

export interface StatBlockSection {
  title: string;
  kind: string;
  entries: StatBlockEntry[];
}

export interface StatBlock extends Record<string, unknown> {
  kind: "stat_block";
  creature: {
    id: string;
    name: string;
    url: string;
    source: string | null;
    edition: "5e" | "5.5e" | null;
    legacy: boolean;
    size: string | null;
    type: string | null;
    alignment: string | null;
    tags: string[];
    challengeRating: string | null;
  };
  attributes: StatBlockAttribute[];
  abilities: StatBlockAbility[];
  sections: StatBlockSection[];
  markdown: string;
}

export interface StatBlockCandidates extends Record<string, unknown> {
  kind: "candidates";
  query: string;
  normalizedQuery: string;
  legacy: LegacyFilter;
  candidates: StatBlockCandidate[];
}

export interface StatBlockNotFound extends Record<string, unknown> {
  kind: "not_found";
  query: string;
  normalizedQuery: string;
  legacy: LegacyFilter;
  candidates: [];
}

export type StatBlockResult = StatBlock | StatBlockCandidates | StatBlockNotFound;

export interface StatBlockResolved extends Record<string, unknown> {
  kind: "resolved";
  query: string | null;
  normalizedQuery: string | null;
  legacy: LegacyFilter;
  candidate: StatBlockCandidate;
}

export type StatBlockResolution = StatBlockResolved | StatBlockCandidates | StatBlockNotFound;

interface ExtractedStatBlock {
  name: string;
  source: string | null;
  edition: "5e" | "5.5e" | null;
  legacy: boolean;
  size: string | null;
  type: string | null;
  alignment: string | null;
  tags: string[];
  challengeRating: string | null;
  attributes: StatBlockAttribute[];
  abilities: StatBlockAbility[];
  sections: StatBlockSection[];
  markdown: string;
}

type StatBlockExtractionResult = ExtractedStatBlock | {
  extractionError: "inaccessible" | "unrecognized_layout" | "incomplete_stat_block";
};

export class StatBlockInaccessibleError extends Error {
  constructor(message = "This stat block is not accessible with the current D&D Beyond account.") {
    super(message);
    this.name = "StatBlockInaccessibleError";
  }
}

export function normalizeCreatureName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function validateStatBlockRequest(request: StatBlockRequest): Required<Pick<StatBlockRequest, "legacy">> & StatBlockRequest {
  const query = request.query?.replace(/\s+/g, " ").trim();
  const creatureId = request.creatureId?.trim();
  if (Boolean(query) === Boolean(creatureId)) {
    throw new Error("Provide exactly one of query or creature_id.");
  }
  if (creatureId && !CREATURE_ID_PATTERN.test(creatureId)) {
    throw new Error("creature_id must contain only digits.");
  }
  const legacy = request.legacy ?? "include";
  if (!["include", "exclude", "only"].includes(legacy)) {
    throw new Error("legacy must be include, exclude, or only.");
  }
  return { ...request, query, creatureId, legacy };
}

export function creatureIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value, DDB_ORIGIN);
    if (
      url.protocol !== "https:" ||
      !["dndbeyond.com", "www.dndbeyond.com"].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password ||
      url.port
    ) return null;
    return url.pathname.match(MONSTER_PATH_PATTERN)?.[1] ?? null;
  } catch {
    return null;
  }
}

function candidateFromSearch(result: OrdinarySearchResult): StatBlockCandidate | null {
  const id = result.creatureId ?? creatureIdFromUrl(result.url);
  if (!id) return null;
  return {
    id,
    name: result.name,
    url: result.url,
    source: result.monster?.source ?? result.sources[0]?.title ?? null,
    edition: result.monster?.edition ?? null,
    legacy: result.monster?.legacy ?? false,
    challengeRating: result.monster?.challengeRating ?? (result.type || null),
    type: result.monster?.type ?? null,
    tags: result.monster?.tags ?? [],
    access: result.monster?.access ?? "unknown",
  };
}

export function selectStatBlockCandidates(
  query: string,
  results: OrdinarySearchResult[],
  legacy: LegacyFilter = "include"
): { eligible: StatBlockCandidate[]; allExact: StatBlockCandidate[] } {
  const normalizedQuery = normalizeCreatureName(query);
  const allExact = results
    .filter((result) => normalizeCreatureName(result.name) === normalizedQuery)
    .map(candidateFromSearch)
    .filter((candidate): candidate is StatBlockCandidate => candidate !== null);

  if (legacy === "exclude") return { eligible: allExact.filter((candidate) => !candidate.legacy), allExact };
  if (legacy === "only") return { eligible: allExact.filter((candidate) => candidate.legacy), allExact };
  const current = allExact.filter((candidate) => !candidate.legacy);
  return { eligible: current.length > 0 ? current : allExact.filter((candidate) => candidate.legacy), allExact };
}

function safeMonsterUrl(value: string, expectedId?: string): URL {
  let url: URL;
  try {
    url = new URL(value, DDB_ORIGIN);
  } catch {
    throw new Error("D&D Beyond returned an invalid monster URL.");
  }
  const id = creatureIdFromUrl(url.href);
  if (!id || (expectedId && id !== expectedId)) {
    throw new Error("D&D Beyond returned an unsafe or mismatched monster URL.");
  }
  return url;
}

function inaccessibleMessage(page: Page): string {
  try {
    const current = new URL(page.url());
    if (!["dndbeyond.com", "www.dndbeyond.com"].includes(current.hostname.toLowerCase())) {
      return "The stat block redirected to a store or other unavailable page.";
    }
  } catch {
    return "The stat block redirected to an invalid page.";
  }
  return "This stat block is not accessible with the current D&D Beyond account.";
}

async function extractStatBlockFromPage(page: Page, creatureId: string, hintedUrl?: string): Promise<StatBlock> {
  if (!CREATURE_ID_PATTERN.test(creatureId)) throw new Error("creature_id must contain only digits.");
  if (!(await isLoggedIn(page))) throw new AuthenticationRequiredError();

  const knownUrl = hintedUrl ?? rememberedMonsterUrl(creatureId);
  if (!knownUrl) {
    throw new Error("No validated catalog URL is known for this creature_id. Resolve the creature by query first, then retry the returned ID.");
  }
  const requested = safeMonsterUrl(knownUrl, creatureId);
  await page.goto(requested.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const finalUrl = page.url();
  try {
    throwIfAuthenticationRedirect(page);
  } catch (error) {
    try {
      const redirected = new URL(finalUrl);
      if (!isDdbHostname(redirected.hostname)) throw new StatBlockInaccessibleError(inaccessibleMessage(page));
    } catch (urlError) {
      if (urlError instanceof StatBlockInaccessibleError) throw urlError;
    }
    throw error;
  }
  let resolvedUrl: URL;
  try {
    resolvedUrl = safeMonsterUrl(finalUrl, creatureId);
  } catch {
    throw new StatBlockInaccessibleError(inaccessibleMessage(page));
  }
  await page.waitForSelector(
    "[data-testid*='stat-block' i], .mon-stat-block-2024, .mon-stat-block, [class*='mon-stat-block'], [class*='StatBlock'], article",
    { timeout: 15_000 }
  ).catch(() => undefined);

  const extracted = await page.evaluate((): StatBlockExtractionResult => {
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const hasArmorClass = (value: string) => /(?:\bArmor Class\b|\bAC\s*\d)/i.test(value);
    const hasHitPoints = (value: string) => /(?:\bHit Points\b|\bHP\s*\d)/i.test(value);
    const pageText = normalize(document.body.textContent);
    if (/view in store|unlock this content|purchase (?:this|the)|marketplace/i.test(pageText) && !hasArmorClass(pageText)) {
      return { extractionError: "inaccessible" };
    }

    const liveRoot =
      document.querySelector("[data-testid*='stat-block' i]") ??
      document.querySelector(".mon-stat-block-2024") ??
      document.querySelector(".mon-stat-block") ??
      document.querySelector("[class*='mon-stat-block']") ??
      document.querySelector("[class*='StatBlock']") ??
      document.querySelector("article");
    if (!liveRoot) return { extractionError: "unrecognized_layout" };
    const root = liveRoot.cloneNode(true) as Element;
    root.querySelectorAll("script, style, button, nav, footer:not([class*='source' i]):not([data-testid*='source' i]), aside, form, .comments, [id*='comment' i], [class*='comment' i], .ad-container, .advertisement").forEach((node) => node.remove());

    const bodyText = normalize(root.textContent);
    if (!hasArmorClass(bodyText) || !hasHitPoints(bodyText)) return { extractionError: "incomplete_stat_block" };

    const heading = root.querySelector("h1, [class*='name' i]");
    const name = normalize(heading?.textContent) || normalize(document.querySelector("h1")?.textContent);
    if (!name) return { extractionError: "incomplete_stat_block" };
    const legacy = /\bLegacy\b/i.test(bodyText.slice(0, 800)) || Boolean(root.querySelector("[class*='legacy' i], [data-testid*='legacy' i]"));
    const editionMatch = bodyText.match(/\b(5\.5e|5e)\b/i);
    const edition = editionMatch ? editionMatch[1].toLowerCase() as "5e" | "5.5e" : null;

    const meta = normalize(
      root.querySelector("[class*='meta' i], [class*='type' i]")?.textContent ??
      Array.from(root.querySelectorAll("p")).find((node) => /Tiny|Small|Medium|Large|Huge|Gargantuan/i.test(node.textContent ?? ""))?.textContent
    );
    const metaMatch = meta.match(/^((?:Tiny|Small|Medium|Large|Huge|Gargantuan)(?:\s+or\s+(?:Tiny|Small|Medium|Large|Huge|Gargantuan))?)\s+(.+?)(?:,\s*(.+))?$/i);
    const size = metaMatch?.[1] ?? null;
    const type = metaMatch?.[2] ?? null;
    const alignment = metaMatch?.[3] ?? null;

    const labels = ["Armor Class", "AC", "Hit Points", "HP", "Speed", "Initiative", "Saving Throws", "Skills", "Vulnerabilities", "Damage Vulnerabilities", "Resistances", "Damage Resistances", "Immunities", "Damage Immunities", "Condition Immunities", "Gear", "Senses", "Languages", "Challenge", "CR", "Proficiency Bonus", "PB"];
    const attributes: StatBlockAttribute[] = [];
    const seenAttributes = new Set<string>();
    const firstSectionHeading = root.querySelector("h2, h3, h4, [class*='section-title' i], [class*='heading' i]");
    const addAttribute = (label: string, value: string) => {
      const cleanLabel = normalize(label).replace(/:$/, "");
      const cleanValue = normalize(value);
      if (!cleanLabel || !cleanValue) return;
      const key = `${cleanLabel.toLowerCase()}\0${cleanValue}`;
      if (seenAttributes.has(key)) return;
      seenAttributes.add(key);
      attributes.push({ label: cleanLabel, value: cleanValue });
    };

    const semanticAttributeSelector = "[class*='attribute' i], [class*='tidbit' i], [class*='property' i]";
    root.querySelectorAll(`${semanticAttributeSelector}, p, li`).forEach((node) => {
      const containsNestedAttributeRow = node.matches(semanticAttributeSelector) &&
        Array.from(node.querySelectorAll(semanticAttributeSelector)).some((descendant) =>
          Boolean(descendant.querySelector(":scope > strong, :scope > b, [class*='label' i]")));
      if (containsNestedAttributeRow) return;
      const text = normalize(node.textContent);
      if (!text || text.length > 600) return;
      const strong = node.querySelector(":scope > strong, :scope > b, [class*='label' i]");
      if (strong) {
        const label = normalize(strong.textContent);
        const knownLabel = labels.some((known) => known.toLowerCase() === label.replace(/:$/, "").toLowerCase());
        const semanticAttribute = node.matches("[class*='attribute' i], [class*='tidbit' i], [class*='property' i]");
        const beforeSections = !firstSectionHeading || Boolean(node.compareDocumentPosition(firstSectionHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (knownLabel || (beforeSections && semanticAttribute && label.length <= 80)) {
          addAttribute(label, text.slice(label.length).replace(/^\s*:?\s*/, ""));
          return;
        }
      }
      for (const label of labels) {
        const match = text.match(new RegExp(`^${label.replace(/ /g, "\\s+")}\\s*:?\\s+(.+)$`, "i"));
        if (match) {
          addAttribute(label, match[1]);
          break;
        }
      }
    });

    const abilityNames = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
    const abilities: StatBlockAbility[] = [];
    for (const abilityName of abilityNames) {
      const nodes = Array.from(root.querySelectorAll("th, td, div, span"));
      const labelNode = nodes.find((node) => normalize(node.textContent).toUpperCase() === abilityName);
      if (!labelNode) continue;
      const container = labelNode.closest("tr, [class*='ability' i], [class*='stat' i]") ?? labelNode.parentElement;
      const text = normalize(container?.textContent);
      const cells = container?.matches("tr")
        ? Array.from(container.querySelectorAll(":scope > th, :scope > td")).map((cell) => normalize(cell.textContent))
        : [];
      const abilityCellIndex = cells.findIndex((cell) => cell.toUpperCase() === abilityName);
      if (abilityCellIndex >= 0) {
        const score = Number(cells[abilityCellIndex + 1]);
        abilities.push({
          name: abilityName,
          score: Number.isFinite(score) ? score : null,
          modifier: cells[abilityCellIndex + 2]?.replace("−", "-") || null,
          save: cells[abilityCellIndex + 3]?.replace("−", "-") || null,
        });
        continue;
      }
      const scoreMatch = text.match(new RegExp(`${abilityName}\\s*(\\d{1,2})(?:\\s*\\(([+−-]?\\d+)\\)|\\s+([+−-]\\d+)(?:\\s+([+−-]\\d+))?)`, "i")) ?? text.match(/(\d{1,2})\s*\(([+−-]?\d+)\)/);
      const saveMatch = text.match(/(?:Save|Saving Throw)\s*([+−-]?\d+)/i);
      abilities.push({
        name: abilityName,
        score: scoreMatch ? Number(scoreMatch[1]) : null,
        modifier: (scoreMatch?.[2] ?? scoreMatch?.[3])?.replace("−", "-") ?? null,
        save: (scoreMatch?.[4] ?? saveMatch?.[1])?.replace("−", "-") ?? null,
      });
    }

    const sectionKind = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "section";
    const headings = Array.from(root.querySelectorAll("h2, h3, h4, [class*='section-title' i], [class*='heading' i]"))
      .filter((node, index, all) => {
        const title = normalize(node.textContent).replace(/:$/, "");
        return title &&
          !labels.some((label) => label.toLowerCase() === title.toLowerCase()) &&
          all.indexOf(node) === index;
      });
    const sections: StatBlockSection[] = [];
    for (const sectionHeading of headings) {
      const title = normalize(sectionHeading.textContent);
      if (!title || title === name || /Description|Comments|Lore|Habitat/i.test(title)) continue;
      const entries: StatBlockEntry[] = [];
      const seenEntryNodes = new Set<Element>();
      const addEntry = (node: Element) => {
        if (seenEntryNodes.has(node)) return;
        seenEntryNodes.add(node);
        const text = normalize(node.textContent);
        if (!text || /^(?:Description|Comments)$/i.test(text)) return;
        const marker = node.querySelector("strong, b");
        const markerText = normalize(marker?.textContent);
        const entryName = markerText && text.toLowerCase().startsWith(markerText.toLowerCase())
          ? markerText.replace(/[.:]$/, "")
          : null;
        entries.push({ name: entryName, text });
      };
      const entryNodes = (container: Element): Element[] => {
        const textBlocks = [
          ...(container.matches("p, li") ? [container] : []),
          ...Array.from(container.querySelectorAll("p, li")),
        ].filter((node) => !node.querySelector("p, li"));
        if (textBlocks.length > 0) return textBlocks;

        const markedBlocks: Element[] = [];
        for (const marker of Array.from(container.querySelectorAll("strong, b"))) {
          let block = marker.parentElement;
          while (block?.parentElement && container.contains(block.parentElement) &&
            normalize(block.textContent) === normalize(marker.textContent)) {
            block = block.parentElement;
          }
          if (block && !markedBlocks.some((candidate) => candidate === block || candidate.contains(block))) {
            markedBlocks.push(block);
          }
        }
        return markedBlocks.length > 0 ? markedBlocks : [container];
      };
      let cursor = sectionHeading.nextElementSibling;
      while (cursor && !cursor.matches("h2, h3, h4, footer, [class*='section-title' i], [class*='heading' i], [class*='source' i], [data-testid*='source' i]")) {
        entryNodes(cursor).forEach(addEntry);
        cursor = cursor.nextElementSibling;
      }
      if (entries.length > 0) sections.push({ title, kind: sectionKind(title), entries });
    }

    if (sections.length === 0) {
      const actionText = Array.from(root.querySelectorAll("p, li"))
        .map((node) => normalize(node.textContent))
        .filter((text) => text && !attributes.some(({ label, value }) => text === `${label} ${value}`));
      if (actionText.length > 0) sections.push({
        title: "Stat Block",
        kind: "stat_block",
        entries: actionText.map((text) => ({ name: null, text })),
      });
    }

    const challenge = attributes.find(({ label }) => /^(Challenge|CR)$/i.test(label))?.value ?? null;
    const sourceNode = root.querySelector("[class*='source' i], [data-testid*='source' i]") ??
      Array.from(root.querySelectorAll("p, div")).find((node) => /(?:Basic Rules|Monster Manual|Source:)\b/i.test(normalize(node.textContent)) && normalize(node.textContent).length < 180);
    const source = normalize(sourceNode?.textContent)
      .replace(/^Sources?:?\s*/i, "")
      .replace(/\s+(?:5\.5e|5e)$/i, "")
      .replace(/\s+/g, " ")
      .trim() || null;
    const tagText = normalize(root.querySelector("[class*='tag' i], [data-testid*='tag' i]")?.textContent);
    const tags = tagText ? tagText.replace(/^Monster Tags?:?\s*/i, "").split(/[,;|]/).map(normalize).filter(Boolean) : [];

    const markdownBlocks = [`# ${name}`];
    if (meta) markdownBlocks.push(`_${meta}_`);
    if (legacy) markdownBlocks.push("**Legacy**");
    for (const attribute of attributes) markdownBlocks.push(`**${attribute.label}:** ${attribute.value}`);
    if (abilities.length > 0) {
      const abilityTable = ["| Ability | Score | Modifier | Save |", "| --- | ---: | ---: | ---: |"];
      abilities.forEach((ability) => abilityTable.push(`| ${ability.name} | ${ability.score ?? ""} | ${ability.modifier ?? ""} | ${ability.save ?? ""} |`));
      markdownBlocks.push(abilityTable.join("\n"));
    }
    sections.forEach((section) => {
      markdownBlocks.push(`## ${section.title}`);
      section.entries.forEach((entry) => markdownBlocks.push(entry.name ? `**${entry.name}.** ${entry.text.replace(new RegExp(`^${entry.name}\\s*[.:]?\\s*`, "i"), "")}` : entry.text));
    });

    return { name, source, edition, legacy, size, type, alignment, tags, challengeRating: challenge, attributes, abilities, sections, markdown: markdownBlocks.join("\n\n") };
  });

  try {
    safeMonsterUrl(page.url(), creatureId);
  } catch {
    throw new Error("The stat-block page changed during extraction; retry the lookup.");
  }

  if (!extracted) throw new StatBlockInaccessibleError();
  if ("extractionError" in extracted) {
    if (extracted.extractionError === "inaccessible") throw new StatBlockInaccessibleError();
    if (extracted.extractionError === "unrecognized_layout") {
      throw new Error("D&D Beyond's stat-block layout was not recognized.");
    }
    throw new Error("D&D Beyond returned an incomplete stat block; Armor Class/AC, Hit Points/HP, or the creature name was missing.");
  }
  return {
    kind: "stat_block",
    creature: {
      id: creatureId,
      name: extracted.name,
      url: resolvedUrl.href,
      source: extracted.source,
      edition: extracted.edition,
      legacy: extracted.legacy,
      size: extracted.size,
      type: extracted.type,
      alignment: extracted.alignment,
      tags: extracted.tags,
      challengeRating: extracted.challengeRating,
    },
    attributes: extracted.attributes,
    abilities: extracted.abilities,
    sections: extracted.sections,
    markdown: extracted.markdown,
  };
}

async function withStatBlockPage<T>(context: BrowserContext, operation: (page: Page) => Promise<T>): Promise<T> {
  const page = await context.newPage();
  try {
    return await operation(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function extractStatBlock(context: BrowserContext, creatureId: string, hintedUrl?: string): Promise<StatBlock> {
  return withStatBlockPage(context, (page) => extractStatBlockFromPage(page, creatureId, hintedUrl));
}

export async function getStatBlock(context: BrowserContext, input: StatBlockRequest): Promise<StatBlockResult> {
  return withStatBlockPage(context, async (page) => {
    const resolution = await resolveStatBlockOnPage(context, page, input);
    if (resolution.kind !== "resolved") return resolution;
    const selected = resolution.candidate;
    try {
      return await extractStatBlockFromPage(page, selected.id, selected.url);
    } catch (error) {
      if (!(error instanceof StatBlockInaccessibleError) || resolution.query === null || resolution.normalizedQuery === null) throw error;
      const request = validateStatBlockRequest(input);
      const envelope = await searchResults(context, resolution.query, "monsters", undefined, page);
      const ordinary = envelope.results.filter((result): result is OrdinarySearchResult => result.type !== "sourcebook");
      const { allExact } = selectStatBlockCandidates(resolution.query, ordinary, request.legacy);
      return {
        kind: "candidates",
        query: resolution.query,
        normalizedQuery: resolution.normalizedQuery,
        legacy: request.legacy,
        candidates: allExact.map((candidate) => candidate.id === selected.id
          ? { ...candidate, access: "unavailable", accessFailure: error.message }
          : candidate),
      };
    }
  });
}

async function resolveStatBlockOnPage(context: BrowserContext, page: Page, input: StatBlockRequest): Promise<StatBlockResolution> {
  const request = validateStatBlockRequest(input);
  if (request.creatureId) {
    const knownUrl = rememberedMonsterUrl(request.creatureId);
    if (!knownUrl) {
      throw new Error("No validated catalog URL is known for this creature_id. Resolve the creature by query first, then retry the returned ID.");
    }
    return {
      kind: "resolved",
      query: null,
      normalizedQuery: null,
      legacy: request.legacy,
      candidate: {
        id: request.creatureId,
        name: `Creature ${request.creatureId}`,
        url: knownUrl,
        source: null,
        edition: null,
        legacy: false,
        challengeRating: null,
        type: null,
        tags: [],
        access: "unknown",
      },
    };
  }

  const query = request.query!;
  const envelope = await searchResults(context, query, "monsters", undefined, page);
  const ordinary = envelope.results.filter((result): result is OrdinarySearchResult => result.type !== "sourcebook");
  const { eligible } = selectStatBlockCandidates(query, ordinary, request.legacy);
  const normalizedQuery = normalizeCreatureName(query);
  if (eligible.length === 0) return { kind: "not_found", query, normalizedQuery, legacy: request.legacy, candidates: [] };
  if (eligible.length > 1) return { kind: "candidates", query, normalizedQuery, legacy: request.legacy, candidates: eligible };
  return { kind: "resolved", query, normalizedQuery, legacy: request.legacy, candidate: eligible[0] };
}

export async function resolveStatBlock(context: BrowserContext, input: StatBlockRequest): Promise<StatBlockResolution> {
  return withStatBlockPage(context, (page) => resolveStatBlockOnPage(context, page, input));
}
