import type { BrowserContext, Page } from "playwright";
import { type MetadataCacheStatus } from "./metadata-cache.js";
export declare const DEFAULT_MAX_CHARS = 10000;
export declare const SERVER_MAX_CHARS = 25000;
export declare const LIBRARY_CACHE_TTL_MS: number;
export type ReadBookMode = "outline" | "content";
export interface ReadBookRequest {
    bookSlug: string;
    chapterSlug?: string;
    mode?: ReadBookMode;
    section?: string;
    cursor?: string;
    maxChars?: number;
}
export interface ImageMetadata {
    id: string;
    alt: string;
    caption: string;
    url: string;
}
export interface OutlineEntry {
    id: string;
    title: string;
    level: number;
    parentId: string | null;
    chapterSlug?: string;
    url?: string;
}
export interface ContentBlock {
    text: string;
    headingId?: string;
    headingLevel?: number;
    imageIds: string[];
}
export interface ExtractedBookPage {
    title: string;
    outline: OutlineEntry[];
    blocks: ContentBlock[];
    images: ImageMetadata[];
}
export type SourcebookAccess = "accessible" | "unavailable" | "unknown";
export interface LibraryBookCard {
    title: string;
    ownership: string;
    url: string;
    bookSlug: string | null;
    access: SourcebookAccess;
}
export interface LibraryBook {
    title: string;
    slug: string;
    ownership: string;
    url: string;
}
export interface LibraryEnvelope {
    count: number;
    books: LibraryBook[];
}
export interface LibraryListOptions {
    refresh?: boolean;
}
export interface ReadBookOutlineResult {
    kind: "outline";
    book: {
        slug: string;
        title?: string;
    };
    scope: {
        bookSlug: string;
        title: string;
    } | {
        chapterSlug: string;
        title: string;
    };
    url: string;
    entries: OutlineEntry[];
    nextCursor: null;
    done: true;
}
export interface ReadBookContentResult {
    kind: "content";
    book: {
        slug: string;
    };
    chapter: {
        slug: string;
        title: string;
        url: string;
    };
    section?: OutlineEntry;
    text: string;
    images: ImageMetadata[];
    nextCursor: string | null;
    done: boolean;
    maxChars: number;
    serverMaxChars: number;
}
export type ReadBookResult = ReadBookOutlineResult | ReadBookContentResult;
interface CursorPayload {
    version: 1;
    bookSlug: string;
    chapterSlug: string;
    section: string | null;
    maxChars: number;
    blockIndex: number;
    offset: number;
    fingerprint: string;
}
interface CursorPosition {
    blockIndex: number;
    offset: number;
}
interface PageChunk {
    text: string;
    next: CursorPosition | null;
    imageIds: string[];
}
export declare function encodeCursor(payload: CursorPayload): string;
export declare function decodeCursor(cursor: string): CursorPayload;
export declare function validateReadBookRequest(request: ReadBookRequest): Required<Pick<ReadBookRequest, "bookSlug" | "mode" | "maxChars">> & ReadBookRequest;
export declare function paginateBlocks(blocks: ContentBlock[], maxChars: number, start?: CursorPosition): PageChunk;
export declare function listLibrary(context: BrowserContext, options?: LibraryListOptions): Promise<LibraryEnvelope>;
export declare function listLibrarySnapshot(context: BrowserContext, options?: LibraryListOptions): Promise<{
    value: LibraryEnvelope;
    status: MetadataCacheStatus;
}>;
export declare function extractLibraryBookCards(page: Page): Promise<LibraryBookCard[]>;
export declare function readBook(context: BrowserContext, input: ReadBookRequest): Promise<ReadBookResult>;
export {};
//# sourceMappingURL=library.d.ts.map