export type MetadataCacheStatus = "hit" | "refreshed";
export interface MetadataCacheOptions {
    refresh?: boolean;
    now?: () => number;
}
/**
 * Cache small discovery metadata for the lifetime of an authenticated browser
 * context. Values expire a fixed interval after loading; reads do not extend
 * the expiry. Concurrent callers share one in-flight refresh.
 */
export declare function cachedMetadata<T>(owner: object, key: string, ttlMs: number, load: () => Promise<T>, options?: MetadataCacheOptions): Promise<{
    value: T;
    status: MetadataCacheStatus;
}>;
export declare function clearMetadataCache(owner: object, key?: string): void;
//# sourceMappingURL=metadata-cache.d.ts.map