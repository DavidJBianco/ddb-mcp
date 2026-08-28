import { Buffer } from "node:buffer";
import type { APIResponse, BrowserContext, Page, Response } from "playwright";
import { z } from "zod";

import { getPage, isLoggedIn } from "../browser.js";
import { fetchAuthenticatedDdbJson } from "../service-auth.js";
import {
  characterDetailSchema,
  characterListEnvelopeSchema,
  characterPortraitMetadataSchema,
} from "../tool-contracts.js";
import { AuthenticationRequiredError, throwIfAuthenticationRedirect } from "../session-state.js";
import { openDomReadyPage } from "./page-readiness.js";

const CHARACTER_SERVICE_ORIGIN = "https://character-service.dndbeyond.com";
const CHARACTER_LIST_PATH = "/character/v5/characters/list";
const CHARACTER_LIST_TIMEOUT_MS = 30_000;
const PORTRAIT_TIMEOUT_MS = 30_000;
export const MAX_PORTRAIT_BYTES = 5 * 1024 * 1024;

const CHARACTER_IMAGE_HOSTS = new Set(["www.dndbeyond.com", "media.dndbeyond.com"]);
const portraitMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type PortraitMimeType = typeof portraitMimeTypes[number];

export type CharacterSortField = "created" | "name" | "level" | "modified";
export type CharacterSortDirection = "asc" | "desc";

export interface CharacterListRequest {
  names?: string[];
  classes?: string[];
  species?: string[];
  campaignIds?: string[];
  level?: number;
  minLevel?: number;
  maxLevel?: number;
  sortBy?: CharacterSortField;
  sortDirection?: CharacterSortDirection;
}

type CharacterListResult = z.infer<typeof characterListEnvelopeSchema>;
export type CharacterDetail = z.infer<typeof characterDetailSchema>;
export type CharacterPortraitMetadata = z.infer<typeof characterPortraitMetadataSchema>;

export interface CharacterPortraitResult {
  metadata: CharacterPortraitMetadata;
  bytes: Buffer | null;
}

export interface CharacterPortraitDependencies {
  fetchPortraitResponse?: (context: BrowserContext, sourceUrl: string) => Promise<APIResponse>;
}

const upstreamCharacterSummarySchema = z.object({
  id: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  name: z.string(),
  level: z.number().int().nonnegative(),
  classDescription: z.string(),
  raceName: z.string(),
  campaignId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).nullable(),
  campaignName: z.string().nullable(),
  status: z.number().int(),
  createdDate: z.union([z.string(), z.number().finite().nonnegative()]),
  lastModifiedDate: z.union([z.string(), z.number().finite().nonnegative()]),
}).passthrough();

const upstreamListEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    characters: z.array(z.unknown()),
  }).passthrough(),
  pagination: z.unknown().nullable(),
}).passthrough();

const upstreamDetailEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.record(z.string(), z.unknown()),
}).passthrough();

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function canonicalValues(values: string[] | undefined, label: string): string[] {
  if (!values) return [];
  return values.map((value) => {
    const trimmed = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!trimmed) throw new Error(`${label} filters cannot contain empty values.`);
    return trimmed;
  });
}

function normalizeDate(value: string | number, label: string): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Character list contained an invalid ${label}.`);
  return new Date(timestamp).toISOString();
}

function numericId(value: string | number, label: string): string {
  const id = String(value);
  if (!/^\d+$/.test(id)) throw new Error(`Character list contained an invalid ${label}.`);
  return id;
}

function compareNumericIds(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  return normalizedLeft.length - normalizedRight.length || normalizedLeft.localeCompare(normalizedRight);
}

function classComponents(value: string): string[] {
  return value
    .split("/")
    .map((component) => normalizeText(component).replace(/\s+\d+$/, ""))
    .filter(Boolean);
}

export function validateCharacterListRequest(request: CharacterListRequest): void {
  const levels = [request.level, request.minLevel, request.maxLevel].filter((value) => value !== undefined);
  if (levels.some((value) => !Number.isInteger(value) || value! < 0 || value! > 20)) {
    throw new Error("Character levels must be integers from 0 through 20.");
  }
  if (request.level !== undefined && (request.minLevel !== undefined || request.maxLevel !== undefined)) {
    throw new Error("level cannot be combined with min_level or max_level.");
  }
  if (request.minLevel !== undefined && request.maxLevel !== undefined && request.minLevel > request.maxLevel) {
    throw new Error("min_level cannot be greater than max_level.");
  }
  canonicalValues(request.names, "Name");
  canonicalValues(request.classes, "Class");
  canonicalValues(request.species, "Species");
  for (const id of request.campaignIds ?? []) {
    if (!/^\d+$/.test(id)) throw new Error("Campaign IDs must contain only decimal digits.");
  }
}

export function normalizeCharacterList(
  upstreamPages: unknown[],
  request: CharacterListRequest = {}
): CharacterListResult {
  validateCharacterListRequest(request);
  if (upstreamPages.length === 0) throw new Error("Character list returned no response pages.");

  const characters: CharacterListResult["characters"] = [];
  for (const page of upstreamPages) {
    const parsedEnvelope = upstreamListEnvelopeSchema.safeParse(page);
    if (!parsedEnvelope.success) throw new Error("D&D Beyond returned an unexpected character-list response shape.");
    for (const item of parsedEnvelope.data.data.characters) {
      const parsedItem = upstreamCharacterSummarySchema.safeParse(item);
      if (!parsedItem.success) throw new Error("D&D Beyond returned an unexpected character summary shape.");
      const value = parsedItem.data;
      const campaignId = value.campaignId === null ? null : numericId(value.campaignId, "campaign ID");
      if ((campaignId === null) !== (value.campaignName === null)) {
        throw new Error("D&D Beyond returned incomplete campaign information for a character.");
      }
      characters.push({
        id: numericId(value.id, "character ID"),
        name: value.name.trim(),
        level: value.level,
        classDescription: value.classDescription.trim(),
        species: value.raceName.trim(),
        campaign: campaignId === null ? null : { id: campaignId, name: value.campaignName!.trim() },
        status: value.status,
        createdAt: normalizeDate(value.createdDate, "creation date"),
        modifiedAt: normalizeDate(value.lastModifiedDate, "modification date"),
      });
    }
  }

  const seen = new Set<string>();
  for (const character of characters) {
    if (seen.has(character.id)) throw new Error("D&D Beyond returned a duplicate character across list pages.");
    seen.add(character.id);
  }

  const names = canonicalValues(request.names, "Name");
  const classes = canonicalValues(request.classes, "Class");
  const species = canonicalValues(request.species, "Species");
  const campaignIds = request.campaignIds ?? [];
  const normalizedNames = names.map(normalizeText);
  const normalizedClasses = classes.map(normalizeText);
  const normalizedSpecies = species.map(normalizeText);

  const filtered = characters.filter((character) => {
    if (normalizedNames.length > 0 && !normalizedNames.some((name) => normalizeText(character.name).includes(name))) return false;
    if (normalizedClasses.length > 0) {
      const components = classComponents(character.classDescription);
      if (!normalizedClasses.some((value) => components.includes(value))) return false;
    }
    if (normalizedSpecies.length > 0 && !normalizedSpecies.includes(normalizeText(character.species))) return false;
    if (campaignIds.length > 0 && (character.campaign === null || !campaignIds.includes(character.campaign.id))) return false;
    if (request.level !== undefined && character.level !== request.level) return false;
    if (request.minLevel !== undefined && character.level < request.minLevel) return false;
    if (request.maxLevel !== undefined && character.level > request.maxLevel) return false;
    return true;
  });

  const field = request.sortBy ?? "name";
  const direction = request.sortDirection ?? "asc";
  filtered.sort((left, right) => {
    let primary = 0;
    if (field === "name") primary = normalizeText(left.name).localeCompare(normalizeText(right.name), "en-US");
    if (field === "level") primary = left.level - right.level;
    if (field === "created") primary = left.createdAt.localeCompare(right.createdAt);
    if (field === "modified") primary = left.modifiedAt.localeCompare(right.modifiedAt);
    if (primary !== 0) return direction === "asc" ? primary : -primary;
    const nameTie = normalizeText(left.name).localeCompare(normalizeText(right.name), "en-US");
    return nameTie || compareNumericIds(left.id, right.id);
  });

  const result: CharacterListResult = {
    count: filtered.length,
    total: characters.length,
    filters: {
      names,
      classes,
      species,
      campaignIds: [...campaignIds],
      level: request.level ?? null,
      minLevel: request.minLevel ?? null,
      maxLevel: request.maxLevel ?? null,
    },
    sort: { field, direction },
    characters: filtered,
  };
  return characterListEnvelopeSchema.parse(result);
}

function isCharacterListResponse(response: Response): boolean {
  try {
    const url = new URL(response.url());
    return url.origin === CHARACTER_SERVICE_ORIGIN && url.pathname === CHARACTER_LIST_PATH;
  } catch {
    return false;
  }
}

async function waitForCharacterListResponse(page: Page): Promise<Response> {
  const responsePromise = page.waitForResponse(isCharacterListResponse, { timeout: CHARACTER_LIST_TIMEOUT_MS });
  try {
    await openDomReadyPage(page, "https://www.dndbeyond.com/characters", CHARACTER_LIST_TIMEOUT_MS);
    throwIfAuthenticationRedirect(page);
    return await responsePromise;
  } catch (error) {
    void responsePromise.catch(() => undefined);
    throw error;
  }
}

export async function listCharacters(
  context: BrowserContext,
  request: CharacterListRequest = {}
): Promise<CharacterListResult> {
  validateCharacterListRequest(request);
  const page = await getPage(context);
  if (!(await isLoggedIn(page))) throw new AuthenticationRequiredError();

  const response = await waitForCharacterListResponse(page);
  if (response.status() === 401 || response.status() === 403) throw new AuthenticationRequiredError();
  if (!response.ok()) throw new Error(`Character list request returned HTTP ${response.status()}.`);

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error("D&D Beyond returned a non-JSON character-list response.");
  }
  return normalizeCharacterList([envelope], request);
}

async function fetchCharacterEnvelope(page: Page, characterId: string): Promise<unknown> {
  return fetchAuthenticatedDdbJson(page, `${CHARACTER_SERVICE_ORIGIN}/character/v5/character/${characterId}`);
}

function portraitUrlFromCharacter(character: Record<string, unknown>): string | null {
  const decorations = character.decorations;
  if (decorations === null || decorations === undefined) return null;
  if (typeof decorations !== "object" || Array.isArray(decorations)) {
    throw new Error("D&D Beyond returned an unexpected character decorations shape.");
  }
  const avatarUrl = (decorations as Record<string, unknown>).avatarUrl;
  if (avatarUrl === null || avatarUrl === undefined) return null;
  if (typeof avatarUrl !== "string") throw new Error("D&D Beyond returned an invalid character portrait URL.");
  let parsed: URL;
  try {
    parsed = new URL(avatarUrl);
  } catch {
    throw new Error("D&D Beyond returned an invalid character portrait URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("D&D Beyond returned a non-HTTPS character portrait URL.");
  return parsed.href;
}

export function normalizeCharacterDetail(envelope: unknown, characterId: string): CharacterDetail {
  const parsed = upstreamDetailEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new Error("D&D Beyond returned an unexpected character-detail response shape.");
  const upstreamId = parsed.data.data.id;
  if ((typeof upstreamId !== "number" && typeof upstreamId !== "string") || String(upstreamId) !== characterId) {
    throw new Error("D&D Beyond returned character data for a different ID.");
  }
  return characterDetailSchema.parse({
    source: "dndbeyond-character-service",
    schemaVersion: "v5",
    portraitUrl: portraitUrlFromCharacter(parsed.data.data),
    character: parsed.data.data,
  });
}

export async function getCharacter(context: BrowserContext, characterId: string): Promise<CharacterDetail> {
  const page = await getPage(context);
  if (!(await isLoggedIn(page))) throw new AuthenticationRequiredError();
  return normalizeCharacterDetail(await fetchCharacterEnvelope(page, characterId), characterId);
}

function validatePortraitUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !CHARACTER_IMAGE_HOSTS.has(url.hostname)) {
    throw new Error("D&D Beyond returned a character portrait URL on an unapproved host.");
  }
  return url;
}

function portraitMimeType(headers: Record<string, string>): PortraitMimeType {
  const mimeType = (headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!portraitMimeTypes.includes(mimeType as PortraitMimeType)) {
    throw new Error("D&D Beyond returned a non-image response for the character portrait.");
  }
  return mimeType as PortraitMimeType;
}

function imageSignatureMimeType(bytes: Buffer): PortraitMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function fetchPortraitResponse(context: BrowserContext, sourceUrl: string): Promise<APIResponse> {
  let current = validatePortraitUrl(sourceUrl);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await context.request.get(current.href, {
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: PORTRAIT_TIMEOUT_MS,
    });
    if (response.status() >= 300 && response.status() < 400) {
      const location = response.headers().location;
      if (!location) throw new Error("D&D Beyond returned a portrait redirect without a destination.");
      if (redirectCount === 3) throw new Error("D&D Beyond returned too many portrait redirects.");
      current = validatePortraitUrl(new URL(location, current).href);
      continue;
    }
    return response;
  }
  throw new Error("D&D Beyond returned too many portrait redirects.");
}

export async function getCharacterPortrait(
  context: BrowserContext,
  characterId: string,
  dependencies: CharacterPortraitDependencies = {}
): Promise<CharacterPortraitResult> {
  const detail = await getCharacter(context, characterId);
  if (detail.portraitUrl === null) {
    return {
      metadata: characterPortraitMetadataSchema.parse({
        characterId,
        available: false,
        portraitUrl: null,
        mimeType: null,
        byteCount: 0,
      }),
      bytes: null,
    };
  }

  const response = await (dependencies.fetchPortraitResponse ?? fetchPortraitResponse)(context, detail.portraitUrl);
  if (!response.ok()) throw new Error(`D&D Beyond returned HTTP ${response.status()} for the character portrait.`);
  const headers = response.headers();
  const declaredLength = headers["content-length"] === undefined ? null : Number(headers["content-length"]);
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 1)) {
    throw new Error("D&D Beyond returned an invalid character portrait length.");
  }
  if (declaredLength !== null && declaredLength > MAX_PORTRAIT_BYTES) {
    throw new Error("The character portrait exceeds the 5 MiB limit.");
  }
  portraitMimeType(headers);
  const bytes = await response.body();
  if (bytes.length === 0) throw new Error("D&D Beyond returned an empty character portrait.");
  if (bytes.length > MAX_PORTRAIT_BYTES) throw new Error("The character portrait exceeds the 5 MiB limit.");
  if (declaredLength !== null && bytes.length !== declaredLength) {
    throw new Error("The character portrait length did not match its response metadata.");
  }
  const mimeType = imageSignatureMimeType(bytes);
  if (mimeType === null) throw new Error("The character portrait did not have a recognized image signature.");

  return {
    metadata: characterPortraitMetadataSchema.parse({
      characterId,
      available: true,
      portraitUrl: detail.portraitUrl,
      mimeType,
      byteCount: bytes.length,
    }),
    bytes,
  };
}
