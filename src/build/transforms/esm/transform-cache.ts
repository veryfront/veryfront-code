import { registerCache } from "../../../core/memory/index.ts";

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 2_000;
const CLEANUP_INTERVAL_MS = 60000; // 1 minute

export interface TransformCacheEntry {
  code: string;
  hash: string;
  timestamp: number;
  expiresAt: number;
}

const transformCache = new Map<string, TransformCacheEntry>();

// Register with memory profiler
registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: transformCache.size,
  maxEntries: MAX_ENTRIES,
}));

// Periodic cleanup of expired entries to prevent memory bloat
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

function startPeriodicCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of transformCache) {
      if (entry.expiresAt <= now) {
        transformCache.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Unref the timer so it doesn't prevent process exit or cause test leaks
  if (typeof Deno !== "undefined" && "unrefTimer" in Deno) {
    Deno.unrefTimer(cleanupInterval);
  }
}

// Start cleanup on module load
startPeriodicCleanup();

export function stopPeriodicCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  }
}

export function generateCacheKey(
  projectId: string | undefined,
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
): string {
  const projectKey = projectId?.trim() || "default";
  const ssrKey = ssr ? "ssr" : "browser";
  return `${projectKey}:${filePath}:${contentHash}:${ssrKey}`;
}

export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  const entry = transformCache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    transformCache.delete(key);
    return undefined;
  }

  return entry;
}

export function setCachedTransform(
  key: string,
  code: string,
  hash: string,
  ttl: number = DEFAULT_TTL,
): void {
  const now = Date.now();
  transformCache.set(key, {
    code,
    hash,
    timestamp: now,
    expiresAt: now + Math.max(1, ttl),
  });

  if (transformCache.size > MAX_ENTRIES) {
    pruneCache();
  }
}

export function destroyTransformCache(): void {
  transformCache.clear();
}

function pruneCache(): void {
  const entries = Array.from(transformCache.entries())
    .sort(([, a], [, b]) => a.timestamp - b.timestamp);

  const excess = transformCache.size - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    const [key] = entries[i]!;
    transformCache.delete(key);
  }
}
