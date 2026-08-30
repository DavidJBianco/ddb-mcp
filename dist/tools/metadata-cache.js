const caches = new WeakMap();
function cacheFor(owner) {
    let cache = caches.get(owner);
    if (!cache) {
        cache = new Map();
        caches.set(owner, cache);
    }
    return cache;
}
/**
 * Cache small discovery metadata for the lifetime of an authenticated browser
 * context. Values expire a fixed interval after loading; reads do not extend
 * the expiry. Concurrent callers share one in-flight refresh.
 */
export async function cachedMetadata(owner, key, ttlMs, load, options = {}) {
    if (!key)
        throw new Error("Metadata cache keys cannot be empty.");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0)
        throw new Error("Metadata cache TTL must be positive.");
    const now = options.now ?? Date.now;
    const cache = cacheFor(owner);
    const existing = cache.get(key);
    if (!options.refresh && existing?.value !== undefined && existing.expiresAt > now()) {
        return { value: existing.value, status: "hit" };
    }
    if (existing?.pending)
        return { value: await existing.pending, status: "refreshed" };
    const entry = existing ?? { expiresAt: 0 };
    const pending = load();
    entry.pending = pending;
    cache.set(key, entry);
    try {
        const value = await pending;
        entry.value = value;
        entry.expiresAt = now() + ttlMs;
        return { value, status: "refreshed" };
    }
    finally {
        entry.pending = undefined;
        if (entry.value === undefined)
            cache.delete(key);
    }
}
export function clearMetadataCache(owner, key) {
    if (key === undefined)
        caches.delete(owner);
    else
        caches.get(owner)?.delete(key);
}
//# sourceMappingURL=metadata-cache.js.map