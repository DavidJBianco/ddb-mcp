import type { BrowserContext } from "playwright";
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
export declare function normalizeSourceAttribution(raw: RawSourceAttribution): SourceAttribution;
export declare function normalizeSourceAttributions(rawSources: RawSourceAttribution[]): SourceAttribution[];
export declare function validateSearchRequest(category: SearchCategory, sourceScope?: SourceScope): SourceScope;
export declare function search(context: BrowserContext, query: string, category?: SearchCategory, sourceScope?: SourceScope): Promise<string>;
//# sourceMappingURL=search.d.ts.map