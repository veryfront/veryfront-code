/**************************************************
 * Vendor Bundle Cache
 *
 * Caches vendor bundles by dependency hash to avoid redundant builds.
 * Provides per-project vendor bundle management with automatic invalidation.
 **************************************************/

import { getDisableLruIntervalEnv } from "#veryfront/config/env.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { getBuildConfig } from "./config/environment.ts";
import type { VendorBundleResult } from "./vendor-bundle.ts";

interface VendorCacheEntry {
  bundle: VendorBundleResult;
  timestamp: number;
  config: {
    reactVersion: string;
    dependencies: Record<string, string>;
  };
}

export class VendorCacheManager {
  private cache: LRUCache<string, VendorCacheEntry>;

  constructor() {
    const config = getBuildConfig();
    this.cache = new LRUCache<string, VendorCacheEntry>({
      maxEntries: config.cacheMaxEntries,
      ttlMs: isLruIntervalDisabled() ? undefined : config.cacheTTLMs,
    });
  }

  get(key: string): VendorBundleResult | undefined {
    return this.cache.get(key)?.bundle;
  }

  set(
    key: string,
    bundle: VendorBundleResult,
    reactVersion: string,
    dependencies: Record<string, string>,
  ): void {
    this.cache.set(key, {
      bundle,
      timestamp: Date.now(),
      config: { reactVersion, dependencies },
    });
  }

  invalidateProject(projectId: string): void {
    const prefix = `vendor:${projectId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; maxEntries: number; ttlMs: number } {
    const config = getBuildConfig();
    return {
      size: this.cache.size,
      maxEntries: config.cacheMaxEntries,
      ttlMs: config.cacheTTLMs,
    };
  }

  destroy(): void {
    this.cache.destroy();
  }
}

function isLruIntervalDisabled(): boolean {
  const globalFlag = (globalThis as { __vfDisableLruInterval?: unknown })
    .__vfDisableLruInterval;
  return globalFlag === true || getDisableLruIntervalEnv();
}

let defaultInstance: VendorCacheManager | undefined;

const TRANSFORM_VERSION = "3";

export async function generateVendorCacheKey(
  projectId: string,
  reactVersion: string,
  dependencies: Record<string, string>,
): Promise<string> {
  const configStr = JSON.stringify({
    transformVersion: TRANSFORM_VERSION,
    react: reactVersion,
    deps: Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  });

  const data = new TextEncoder().encode(configStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);

  return `vendor:${projectId}:${hash}`;
}

export function destroyVendorCache(): void {
  defaultInstance?.destroy();
  defaultInstance = undefined;
}
