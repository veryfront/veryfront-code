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
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "./bundle-manifest.ts";
import { BUNDLE_MANIFEST_DEV_TTL_MS, BUNDLE_MANIFEST_PROD_TTL_MS } from "./constants/cache.ts";

const logger = serverLogger.component("bundle-manifest");

export async function initializeBundleManifest(
  config: BundleManifestConfig,
  mode: "development" | "production",
  adapter?: RuntimeAdapter,
): Promise<void> {
  const manifestConfig = config.cache?.bundleManifest;
  const enabled = manifestConfig?.enabled ?? mode === "production";

  if (!enabled) {
    logger.debug("Bundle manifest disabled");
    setBundleManifestStore(new InMemoryBundleManifestStore());
    return;
  }

  const storeType = manifestConfig?.type ?? adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_TYPE") ??
    "memory";

  logger.debug("Initializing bundle manifest", { type: storeType, mode });

  try {
    const store = await createStore(storeType, config.cache, adapter);
    setBundleManifestStore(store);

    try {
      const stats = await store.getStats();
      logger.debug("Store statistics", stats);
    } catch (error) {
      logger.debug("Failed to get stats", { error });
    }
  } catch (error) {
    logger.error("Failed to initialize store, using in-memory fallback", {
      error,
    });
    setBundleManifestStore(new InMemoryBundleManifestStore());
  }
}

async function createStore(
  storeType: string,
  cacheConfig: BundleManifestConfig["cache"],
  adapter?: RuntimeAdapter,
): Promise<BundleManifestStore> {
  const bundleManifest = cacheConfig?.bundleManifest;

  if (storeType === "redis") {
    const { RedisBundleManifestStore } = await import("./bundle-manifest-redis.ts");
    const redisUrl = bundleManifest?.redisUrl ??
      adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_REDIS_URL");

    const store = new RedisBundleManifestStore(
      {
        url: redisUrl,
        keyPrefix: bundleManifest?.keyPrefix,
      },
      adapter,
    );

    if (!(await store.isAvailable())) {
      logger.warn("Redis not available, falling back to in-memory");
      return new InMemoryBundleManifestStore();
    }

    logger.debug("Redis store initialized");
    return store;
  }

  if (storeType === "kv") {
    const { KVBundleManifestStore } = await import("./bundle-manifest-kv.ts");
    const store = new KVBundleManifestStore({
      keyPrefix: bundleManifest?.keyPrefix,
    });

    if (!(await store.isAvailable())) {
      logger.warn("KV not available, falling back to in-memory");
      return new InMemoryBundleManifestStore();
    }

    logger.debug("KV store initialized");
    return store;
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

export async function warmupBundleManifest(
  store: BundleManifestStore,
  keys: string[],
): Promise<void> {
  logger.debug("Warming up cache", { keys: keys.length });

  let loaded = 0;
  let failed = 0;

  for (const key of keys) {
    try {
      const metadata = await store.getBundleMetadata(key);
      if (!metadata) continue;

      await store.getBundleCode(metadata.codeHash);
      loaded++;
    } catch (error) {
      logger.debug("Failed to warm up key", { key, error });
      failed++;
    }
  }

  logger.debug("Cache warmup complete", { loaded, failed });
}
