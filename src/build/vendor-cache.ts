
import { LRUCache } from "@veryfront/utils/lru-wrapper.ts";
import type { VendorBundleResult } from "./vendor-bundle.ts";
import { getBuildConfig } from "./config/environment.ts";
import { getEnv } from "../platform/compat/process.ts";

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
    const disableIntervals = isLruIntervalDisabled();
    this.cache = new LRUCache<string, VendorCacheEntry>({
      maxEntries: config.cacheMaxEntries,
      ttlMs: disableIntervals ? undefined : config.cacheTTLMs,
    });
  }

  get(key: string): VendorBundleResult | undefined {
    const entry = this.cache.get(key);
    return entry?.bundle;
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
      config: {
        reactVersion,
        dependencies,
      },
    });
  }

  invalidateProject(projectId: string): void {
    const prefix = `vendor:${projectId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
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
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) {
    return true;
  }
  return getEnv("VF_DISABLE_LRU_INTERVAL") === "1";
}

let defaultInstance: VendorCacheManager | undefined;

function _getDefaultInstance(): VendorCacheManager {
  if (!defaultInstance) {
    defaultInstance = new VendorCacheManager();
  }
  return defaultInstance;
}

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

  const encoder = new TextEncoder();
  const data = encoder.encode(configStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);

  return `vendor:${projectId}:${hash}`;
}

export function destroyVendorCache(): void {
  if (defaultInstance) {
    defaultInstance.destroy();
    defaultInstance = undefined;
  }
}
