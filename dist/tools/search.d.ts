import type { BrowserContext, Page } from "playwright";
import { type LibraryBookCard, type LibraryEnvelope } from "./library.js";
export type SearchCategory = "spells" | "monsters" | "items" | "races" | "classes" | "feats" | "sourcebooks" | "all";
export type SourceScope = "accessible" | "all";
export type LegacyFilter = "include" | "exclude" | "only";
export declare const DEFAULT_SEARCH_LIMIT = 20;
export declare const MAX_SEARCH_LIMIT = 50;
export declare const MAX_SEARCH_SNIPPET_CHARS = 500;
export declare const MAX_SEARCH_SNIPPETS = 2;
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
export declare function rememberedMonsterUrl(creatureId: string): string | undefined;
export declare function normalizeSourceAttribution(raw: RawSourceAttribution): SourceAttribution;
export declare function normalizeSourceAttributions(rawSources: RawSourceAttribution[]): SourceAttribution[];
export declare function resolveBookLocation(value: string, title: string, sources: SourceAttribution[], scopedBookSlug?: string): BookLocation | null;
export declare function decodeSearchCursor(cursor: string): SearchCursorPayload;
export declare function validateSearchRequest(category: SearchCategory, sourceScope?: SourceScope, options?: SearchOptions): NormalizedSearchRequest;
export declare function resolveLibraryBookSlug(library: LibraryEnvelope, requestedSlug: string): {
    slug: string;
    title: string;
} | null;
export declare function validateSearchContinuation(query: string, category: SearchCategory, sourceScope?: SourceScope, options?: SearchOptions): void;
export declare function searchResults(context: BrowserContext, query: string, category?: SearchCategory, sourceScope?: SourceScope, pageOverride?: Page, options?: SearchOptions): Promise<SearchEnvelope>;
export declare function search(context: BrowserContext, query: string, category?: SearchCategory, sourceScope?: SourceScope, options?: SearchOptions): Promise<SearchEnvelope>;
export {};
//# sourceMappingURL=search.d.ts.map