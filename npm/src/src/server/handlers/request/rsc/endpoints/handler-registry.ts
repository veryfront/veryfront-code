/**
 * RSC handler registry for managing per-project handlers
 * @module rsc-endpoints/handler-registry
 */

import { RSCDevServerHandler } from "../handlers/index.js";
import { LRUCache } from "../../../../../utils/lru-wrapper.js";
import { registerCache } from "../../../../../utils/memory/index.js";

const RSC_HANDLERS_MAX_ENTRIES = 50;
const RSC_HANDLERS_TTL_MS = 60 * 60 * 1000; // 1 hour

let rscHandlersByProject: LRUCache<string, RSCDevServerHandler> | null = null;
let cacheRegistered = false;

function getHandlersCache(): LRUCache<string, RSCDevServerHandler> {
  if (rscHandlersByProject) return rscHandlersByProject;

  rscHandlersByProject = new LRUCache<string, RSCDevServerHandler>({
    maxEntries: RSC_HANDLERS_MAX_ENTRIES,
    ttlMs: RSC_HANDLERS_TTL_MS,
    cleanupIntervalMs: 300000, // 5 minutes
  });

  if (!cacheRegistered) {
    registerCache("rsc-handlers", () => ({
      name: "rsc-handlers",
      entries: rscHandlersByProject?.size ?? 0,
      maxEntries: RSC_HANDLERS_MAX_ENTRIES,
    }));
    cacheRegistered = true;
  }

  return rscHandlersByProject;
}

export function getRSCHandler(projectDir: string): RSCDevServerHandler {
  const cache = getHandlersCache();
  const existing = cache.get(projectDir);
  if (existing) return existing;

  const handler = new RSCDevServerHandler(projectDir);
  cache.set(projectDir, handler);
  return handler;
}

export function __resetRSCHandlerForTests(): void {
  rscHandlersByProject?.clear();
}

export function __destroyRSCHandlerForTests(): void {
  rscHandlersByProject?.destroy();
  rscHandlersByProject = null;
}
