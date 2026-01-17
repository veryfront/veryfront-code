/**
 * RSC handler registry for managing per-project handlers
 * @module rsc-endpoints/handler-registry
 */

import { RSCDevServerHandler } from "../handlers/index.ts";
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import { registerCache } from "@veryfront/utils/memory/index.ts";

// Limit to prevent unbounded memory growth in multi-tenant environments
const RSC_HANDLERS_MAX_ENTRIES = 50;
const RSC_HANDLERS_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Global registry of RSC handlers by project directory
 * Maintains handlers per projectDir to avoid cross-project leakage
 * Using LRU cache to prevent unbounded memory growth
 */
const rscHandlersByProject = new LRUCache<string, RSCDevServerHandler>({
  maxEntries: RSC_HANDLERS_MAX_ENTRIES,
  ttlMs: RSC_HANDLERS_TTL_MS,
  cleanupIntervalMs: 300000, // 5 minutes
});

// Register with memory profiler
registerCache("rsc-handlers", () => ({
  name: "rsc-handlers",
  entries: rscHandlersByProject.size,
  maxEntries: RSC_HANDLERS_MAX_ENTRIES,
}));

/**
 * Get or create RSC handler instance for a project
 * @param projectDir - Project directory path
 * @returns RSC handler instance
 */
export function getRSCHandler(projectDir: string): RSCDevServerHandler {
  let handler = rscHandlersByProject.get(projectDir);
  if (!handler) {
    handler = new RSCDevServerHandler(projectDir);
    rscHandlersByProject.set(projectDir, handler);
  }
  return handler;
}

/**
 * Test-only: reset the singleton RSC handler to avoid cross-test leakage
 */
export function __resetRSCHandlerForTests(): void {
  rscHandlersByProject.clear();
}
