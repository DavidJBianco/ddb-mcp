import type { APIResponse, BrowserContext } from "playwright";
export declare const PDF_ACQUISITION_TIMEOUT_MS = 90000;
export declare const PDF_MAX_BYTES: number;
export declare const PDF_CHUNK_BYTES: number;
export declare const PDF_CACHE_TTL_MS: number;
export declare const PDF_CACHE_MAX_ENTRIES = 2;
export declare const PDF_CACHE_MAX_TOTAL_BYTES: number;
export interface CharacterPdf {
    bytes: Buffer;
    filename: string;
    title: string;
    mimeType: "application/pdf";
    totalBytes: number;
    sha256: string;
}
export interface CharacterPdfMetadata extends Omit<CharacterPdf, "bytes">, Record<string, unknown> {
    url: string;
    initialPage: 1;
}
export interface PdfByteRange extends Record<string, unknown> {
    url: string;
    bytes: string;
    offset: number;
    byteCount: number;
    totalBytes: number;
    hasMore: boolean;
}
export interface CharacterPdfDependencies {
    fetchPdf?: (context: BrowserContext, url: string, timeout: number) => Promise<APIResponse>;
    now?: () => number;
    createHandle?: () => string;
}
export declare function acquireCharacterPdf(context: BrowserContext, characterId: string, dependencies?: CharacterPdfDependencies): Promise<CharacterPdf>;
export declare class CharacterPdfStore {
    private readonly entries;
    private totalBytes;
    private readonly now;
    private readonly createHandle;
    constructor(dependencies?: Pick<CharacterPdfDependencies, "now" | "createHandle">);
    put(pdf: CharacterPdf): CharacterPdfMetadata;
    read(url: string, offset: number, byteCount: number): PdfByteRange;
    private purgeExpired;
    private delete;
}
//# sourceMappingURL=character-pdf.d.ts.map