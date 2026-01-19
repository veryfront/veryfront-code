/**
 * RSC handler registry for managing per-project handlers
 * @module rsc-endpoints/handler-registry
 */

import { RSCDevServerHandler } from "../handlers/index.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";

// Limit to prevent unbounded memory growth in multi-tenant environments
const RSC_HANDLERS_MAX_ENTRIES = 50;
const RSC_HANDLERS_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Global registry of RSC handlers by project directory
 * Maintains handlers per projectDir to avoid cross-project leakage
 * Using LRU cache to prevent unbounded memory growth
 *
 * Note: Lazy-initialized to ensure __vfDisableLruInterval flag is set
 * before the cache is created (prevents interval leaks in tests)
 */
let rscHandlersByProject: LRUCache<string, RSCDevServerHandler> | null = null;
let cacheRegistered = false;

function getHandlersCache(): LRUCache<string, RSCDevServerHandler> {
  if (!rscHandlersByProject) {
    rscHandlersByProject = new LRUCache<string, RSCDevServerHandler>({
      maxEntries: RSC_HANDLERS_MAX_ENTRIES,
      ttlMs: RSC_HANDLERS_TTL_MS,
      cleanupIntervalMs: 300000, // 5 minutes
    });

    // Register with memory profiler (only once)
    if (!cacheRegistered) {
      registerCache("rsc-handlers", () => ({
        name: "rsc-handlers",
        entries: rscHandlersByProject?.size ?? 0,
        maxEntries: RSC_HANDLERS_MAX_ENTRIES,
      }));
      cacheRegistered = true;
    }
  }
  return rscHandlersByProject;
}

/**
 * Get or create RSC handler instance for a project
 * @param projectDir - Project directory path
 * @returns RSC handler instance
 */
export function getRSCHandler(projectDir: string): RSCDevServerHandler {
  const cache = getHandlersCache();
  let handler = cache.get(projectDir);
  if (!handler) {
    handler = new RSCDevServerHandler(projectDir);
    cache.set(projectDir, handler);
  }
  return handler;
}

/**
 * Test-only: reset the singleton RSC handler to avoid cross-test leakage
 */
export function __resetRSCHandlerForTests(): void {
  if (rscHandlersByProject) {
    rscHandlersByProject.clear();
  }
}

/**
 * Test-only: destroy the RSC handler cache and stop cleanup interval
 * This should be called in afterAll to prevent resource leaks
 */
export function __destroyRSCHandlerForTests(): void {
  if (rscHandlersByProject) {
    rscHandlersByProject.destroy();
    rscHandlersByProject = null;
  }
}
