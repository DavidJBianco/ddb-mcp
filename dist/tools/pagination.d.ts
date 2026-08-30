export interface SegmentPosition {
    segmentIndex: number;
    offset: number;
}
export interface PaginationSegment<T> {
    text: string;
    values: readonly T[];
}
export interface SegmentPage<T> {
    text: string;
    next: SegmentPosition | null;
    values: T[];
}
interface PaginationErrors {
    limit: string;
    position: string;
    outside: string;
    offset: string;
}
export declare function encodeOpaqueCursor(payload: object): string;
export declare function decodeOpaqueCursorObject(cursor: string, expectedMessage: string, objectMessage: string): Record<string, unknown>;
export declare function codePointLength(value: string): number;
export declare function paginateSegments<T>(segments: readonly PaginationSegment<T>[], maxChars: number, maximumChars: number, start: SegmentPosition | undefined, errors: PaginationErrors): SegmentPage<T>;
export declare function splitTextAtNewlines(value: string): PaginationSegment<never>[];
export {};
//# sourceMappingURL=pagination.d.ts.map