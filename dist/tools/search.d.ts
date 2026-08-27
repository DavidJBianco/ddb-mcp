import type { BrowserContext, Page } from "playwright";
import { type LibraryBookCard } from "./library.js";
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
export declare function rememberedMonsterUrl(creatureId: string): string | undefined;
export declare function normalizeSourceAttribution(raw: RawSourceAttribution): SourceAttribution;
export declare function normalizeSourceAttributions(rawSources: RawSourceAttribution[]): SourceAttribution[];
export declare function validateSearchRequest(category: SearchCategory, sourceScope?: SourceScope): SourceScope;
export interface SearchEnvelope {
    query: string;
    category: SearchCategory;
    url: string;
    count: number;
    results: Array<OrdinarySearchResult | SourcebookSearchResult>;
}
export declare function searchResults(context: BrowserContext, query: string, category?: SearchCategory, sourceScope?: SourceScope, pageOverride?: Page): Promise<SearchEnvelope>;
export declare function search(context: BrowserContext, query: string, category?: SearchCategory, sourceScope?: SourceScope): Promise<SearchEnvelope>;
//# sourceMappingURL=search.d.ts.map