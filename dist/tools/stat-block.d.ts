import type { BrowserContext } from "playwright";
import { type OrdinarySearchResult, type SearchAccess } from "./search.js";
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
export declare class StatBlockInaccessibleError extends Error {
    constructor(message?: string);
}
export declare function normalizeCreatureName(value: string): string;
export declare function validateStatBlockRequest(request: StatBlockRequest): Required<Pick<StatBlockRequest, "legacy">> & StatBlockRequest;
export declare function creatureIdFromUrl(value: string): string | null;
export declare function selectStatBlockCandidates(query: string, results: OrdinarySearchResult[], legacy?: LegacyFilter): {
    eligible: StatBlockCandidate[];
    allExact: StatBlockCandidate[];
};
export declare function extractStatBlock(context: BrowserContext, creatureId: string, hintedUrl?: string): Promise<StatBlock>;
export declare function getStatBlock(context: BrowserContext, input: StatBlockRequest): Promise<StatBlockResult>;
export declare function resolveStatBlock(context: BrowserContext, input: StatBlockRequest): Promise<StatBlockResolution>;
//# sourceMappingURL=stat-block.d.ts.map