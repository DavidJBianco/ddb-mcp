import { Buffer } from "node:buffer";
import type { APIResponse, BrowserContext } from "playwright";
import { z } from "zod";
import { characterDetailSchema, characterListEnvelopeSchema, characterPortraitMetadataSchema } from "../tool-contracts.js";
export declare const CHARACTER_LIST_CACHE_TTL_MS: number;
export declare const MAX_PORTRAIT_BYTES: number;
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
    refresh?: boolean;
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
export declare function validateCharacterListRequest(request: CharacterListRequest): void;
export declare function normalizeCharacterList(upstreamPages: unknown[], request?: CharacterListRequest): CharacterListResult;
export declare function listCharacters(context: BrowserContext, request?: CharacterListRequest): Promise<CharacterListResult>;
export declare function normalizeCharacterDetail(envelope: unknown, characterId: string): CharacterDetail;
export declare function getCharacter(context: BrowserContext, characterId: string): Promise<CharacterDetail>;
export declare function getCharacterPortrait(context: BrowserContext, characterId: string, dependencies?: CharacterPortraitDependencies): Promise<CharacterPortraitResult>;
export {};
//# sourceMappingURL=character.d.ts.map