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
  createDisabledBundleManifestStore,
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "./bundle-manifest.ts";
import { BUNDLE_MANIFEST_DEV_TTL_MS, BUNDLE_MANIFEST_PROD_TTL_MS } from "./constants/cache.ts";

const logger = serverLogger.component("bundle-manifest");

class UnsupportedBundleManifestStoreError extends Error {
  constructor(storeType: string) {
    super(
      storeType === "redis" || storeType === "kv"
        ? `Bundle manifest store type "${storeType}" is configured but is not implemented`
        : "Unsupported bundle manifest store type",
    );
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
    setBundleManifestStore(createDisabledBundleManifestStore());
    return;
  }

  const storeType = manifestConfig?.type ?? adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_TYPE") ??
    "memory";

  const reportedType = storeType === "memory" || storeType === "redis" || storeType === "kv"
    ? storeType
    : "unsupported";
  logger.debug("Initializing bundle manifest", { type: reportedType, mode });

  const store = await createStore(storeType, config.cache, adapter);
  setBundleManifestStore(store);
  const stats = await store.getStats();
  logger.debug("Store statistics", {
    totalBundles: stats.totalBundles,
    totalSize: stats.totalSize,
  });
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
    throw new UnsupportedBundleManifestStoreError(storeType);
  }

  logger.debug("In-memory store initialized");
  return new InMemoryBundleManifestStore();
}

export function getBundleManifestTTL(
  config: BundleManifestConfig,
  mode: "development" | "production",
): number | undefined {
  const ttl = config.cache?.bundleManifest?.ttl;
  if (ttl) return ttl;

  if (mode === "production") return BUNDLE_MANIFEST_PROD_TTL_MS;
  return BUNDLE_MANIFEST_DEV_TTL_MS;
}
