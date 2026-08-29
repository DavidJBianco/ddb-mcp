import type { BrowserContext } from "playwright";
import { type SegmentPosition } from "./pagination.js";
export declare const DEFAULT_PAGE_MAX_CHARS = 8000;
export declare const SERVER_PAGE_MAX_CHARS = 25000;
export declare const MAX_SCREENSHOT_BYTES: number;
export declare const MAX_SCREENSHOT_DIMENSION = 4096;
export declare const MAX_SCREENSHOT_PIXELS = 16777216;
export declare const MAX_SCREENSHOT_SELECTOR_CHARS = 500;
export type PageOperation = "navigate" | "current_page";
export type ScreenshotScope = "viewport" | "element";
export interface PageContentRequest {
    url?: string;
    cursor?: string;
    maxChars?: number;
}
export interface PageContentEnvelope {
    source: "dndbeyond-rendered-page";
    schemaVersion: "v1";
    operation: PageOperation;
    requestedUrl: string | null;
    page: {
        url: string;
        title: string;
    };
    text: string;
    totalCharacters: number;
    maxChars: number;
    nextCursor: string | null;
    done: boolean;
}
export interface PageScreenshotRequest {
    scope?: ScreenshotScope;
    selector?: string;
}
export interface PageScreenshotMetadata {
    source: "dndbeyond-page-screenshot";
    schemaVersion: "v1";
    url: string;
    title: string;
    scope: ScreenshotScope;
    selector: string | null;
    width: number;
    height: number;
    mimeType: "image/png";
    byteCount: number;
}
export interface PageScreenshotResult {
    metadata: PageScreenshotMetadata;
    bytes: Buffer;
}
interface PageCursorPayload {
    version: 1;
    url: string;
    maxChars: number;
    segmentIndex: number;
    offset: number;
    fingerprint: string;
}
export declare function isAllowedDdbUrl(value: string): boolean;
export declare function encodePageCursor(payload: PageCursorPayload): string;
export declare function decodePageCursor(cursor: string): PageCursorPayload;
export declare function validatePageContentRequest(request: PageContentRequest): Required<Pick<PageContentRequest, "maxChars">> & PageContentRequest;
export declare function validatePageScreenshotRequest(request: PageScreenshotRequest): Required<Pick<PageScreenshotRequest, "scope">> & PageScreenshotRequest;
export declare function normalizePageText(value: string): string;
export declare function paginatePageText(text: string, maxChars: number, start?: SegmentPosition): {
    text: string;
    next: SegmentPosition | null;
};
export declare function readPage(context: BrowserContext, input?: PageContentRequest): Promise<PageContentEnvelope>;
export declare function capturePageScreenshot(context: BrowserContext, request?: PageScreenshotRequest): Promise<PageScreenshotResult>;
export {};
//# sourceMappingURL=navigate.d.ts.map