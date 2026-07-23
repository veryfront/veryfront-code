import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "./logger/index.ts";

/** Minimal config interface to avoid importing from config layer */
interface BundleManifestConfig {
  cache?: {
    bundleManifest?: {
      enabled?: boolean;
      type?: string;
      redisUrl?: string;
      keyPrefix?: string;
      ttl?: number;
    };
  };
}
import {
  type BundleManifestStore,
  getBundleManifestStore,
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "./bundle-manifest.ts";
import { BUNDLE_MANIFEST_DEV_TTL_MS, BUNDLE_MANIFEST_PROD_TTL_MS } from "./constants/cache.ts";

const logger = serverLogger.component("bundle-manifest");

class UnsupportedBundleManifestStoreError extends Error {
  constructor(storeType: string, reason = "is configured but is not implemented") {
    super(`Bundle manifest store type "${storeType}" ${reason}`);
    this.name = "UnsupportedBundleManifestStoreError";
  }
}

export async function initializeBundleManifest(
  config: BundleManifestConfig,
  mode: "development" | "production",
  adapter?: RuntimeAdapter,
): Promise<void> {
  const manifestConfig = config.cache?.bundleManifest;
  const enabled = manifestConfig?.enabled ?? mode === "production";

  if (!enabled) {
    logger.debug("Bundle manifest disabled");
    return;
  }

  const storeType = manifestConfig?.type ?? adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_TYPE") ??
    "memory";

  logger.debug("Initializing bundle manifest", { type: storeType, mode });

  const store = await createStore(storeType, config.cache, adapter);
  if (store !== getBundleManifestStore()) setBundleManifestStore(store);

  try {
    const stats = await store.getStats();
    logger.debug("Store statistics", stats);
  } catch (error) {
    logger.debug("Failed to get stats", { error });
  }
}

async function createStore(
  storeType: string,
  _cacheConfig: BundleManifestConfig["cache"],
  _adapter?: RuntimeAdapter,
): Promise<BundleManifestStore> {
  if (storeType === "redis") {
    throw new UnsupportedBundleManifestStoreError(storeType);
  }

  if (storeType === "kv") {
    throw new UnsupportedBundleManifestStoreError(storeType);
  }

  if (storeType !== "memory") {
    throw new UnsupportedBundleManifestStoreError(storeType, "is not supported");
  }

  logger.debug("In-memory store initialized");
  const current = getBundleManifestStore();
  return current instanceof InMemoryBundleManifestStore
    ? current
    : new InMemoryBundleManifestStore();
}

export function getBundleManifestTTL(
  config: BundleManifestConfig,
  mode: "development" | "production",
): number | undefined {
  const ttl = config.cache?.bundleManifest?.ttl;
  if (ttl !== undefined) return ttl;

  if (mode === "production") return BUNDLE_MANIFEST_PROD_TTL_MS;
  return BUNDLE_MANIFEST_DEV_TTL_MS;
}
