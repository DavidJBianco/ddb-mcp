export type MetadataCacheStatus = "hit" | "refreshed";

interface CacheEntry<T> {
  value?: T;
  expiresAt: number;
  pending?: Promise<T>;
}

export interface MetadataCacheOptions {
  refresh?: boolean;
  now?: () => number;
}

const caches = new WeakMap<object, Map<string, CacheEntry<unknown>>>();

function cacheFor(owner: object): Map<string, CacheEntry<unknown>> {
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
export async function cachedMetadata<T>(
  owner: object,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  options: MetadataCacheOptions = {}
): Promise<{ value: T; status: MetadataCacheStatus }> {
  if (!key) throw new Error("Metadata cache keys cannot be empty.");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Metadata cache TTL must be positive.");
  const now = options.now ?? Date.now;
  const cache = cacheFor(owner);
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (!options.refresh && existing?.value !== undefined && existing.expiresAt > now()) {
    return { value: existing.value, status: "hit" };
  }
  if (existing?.pending) return { value: await existing.pending, status: "refreshed" };

  const entry: CacheEntry<T> = existing ?? { expiresAt: 0 };
  const pending = load();
  entry.pending = pending;
  cache.set(key, entry as CacheEntry<unknown>);
  try {
    const value = await pending;
    entry.value = value;
    entry.expiresAt = now() + ttlMs;
    return { value, status: "refreshed" };
  } finally {
    entry.pending = undefined;
    if (entry.value === undefined) cache.delete(key);
  }
}

export function clearMetadataCache(owner: object, key?: string): void {
  if (key === undefined) caches.delete(owner);
  else caches.get(owner)?.delete(key);
}
