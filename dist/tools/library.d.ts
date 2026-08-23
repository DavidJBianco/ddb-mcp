import type { BrowserContext } from "playwright";
export declare const DEFAULT_MAX_CHARS = 10000;
export declare const SERVER_MAX_CHARS = 25000;
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
export declare function listLibrary(context: BrowserContext): Promise<string>;
export declare function readBook(context: BrowserContext, input: ReadBookRequest): Promise<string>;
export {};
//# sourceMappingURL=library.d.ts.map