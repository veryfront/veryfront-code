import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { serverLogger as logger } from "./logger/index.ts";
import {
  type BundleManifestStore,
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "./bundle-manifest.ts";
import { BUNDLE_MANIFEST_DEV_TTL_MS, BUNDLE_MANIFEST_PROD_TTL_MS } from "./constants/cache.ts";

export async function initializeBundleManifest(
  config: VeryfrontConfig,
  mode: "development" | "production",
  adapter?: RuntimeAdapter,
): Promise<void> {
  const manifestConfig = config.cache?.bundleManifest;
  const enabled = manifestConfig?.enabled ?? mode === "production";

  if (!enabled) {
    logger.info("[bundle-manifest] Bundle manifest disabled");
    setBundleManifestStore(new InMemoryBundleManifestStore());
    return;
  }

  const envType = adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_TYPE");
  const storeType = manifestConfig?.type || envType || "memory";

  logger.info("[bundle-manifest] Initializing bundle manifest", {
    type: storeType,
    mode,
  });

  try {
    let store: BundleManifestStore;

    switch (storeType) {
      case "redis": {
        const { RedisBundleManifestStore } = await import("./bundle-manifest-redis.ts");
        const redisUrl = manifestConfig?.redisUrl ||
          adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_REDIS_URL");
        store = new RedisBundleManifestStore(
          {
            url: redisUrl,
            keyPrefix: manifestConfig?.keyPrefix,
          },
          adapter,
        );

        const available = await store.isAvailable();
        if (!available) {
          logger.warn("[bundle-manifest] Redis not available, falling back to in-memory");
          store = new InMemoryBundleManifestStore();
        } else {
          logger.info("[bundle-manifest] Redis store initialized");
        }
        break;
      }

      case "kv": {
        const { KVBundleManifestStore } = await import("./bundle-manifest-kv.ts");
        store = new KVBundleManifestStore({
          keyPrefix: manifestConfig?.keyPrefix,
        });

        const available = await store.isAvailable();
        if (!available) {
          logger.warn("[bundle-manifest] KV not available, falling back to in-memory");
          store = new InMemoryBundleManifestStore();
        } else {
          logger.info("[bundle-manifest] KV store initialized");
        }
        break;
      }

      case "memory":
      default: {
        store = new InMemoryBundleManifestStore();
        logger.info("[bundle-manifest] In-memory store initialized");
        break;
      }
    }

    setBundleManifestStore(store);

    try {
      const stats = await store.getStats();
      logger.info("[bundle-manifest] Store statistics", stats);
    } catch (error) {
      logger.debug("[bundle-manifest] Failed to get stats", { error });
    }
  } catch (error) {
    logger.error("[bundle-manifest] Failed to initialize store, using in-memory fallback", {
      error,
    });
    setBundleManifestStore(new InMemoryBundleManifestStore());
  }
}

export function getBundleManifestTTL(
  config: VeryfrontConfig,
  mode: "development" | "production",
): number | undefined {
  const manifestConfig = config.cache?.bundleManifest;
  if (manifestConfig?.ttl) {
    return manifestConfig.ttl;
  }

  if (mode === "production") {
    return BUNDLE_MANIFEST_PROD_TTL_MS;
  } else {
    return BUNDLE_MANIFEST_DEV_TTL_MS;
  }
}

export async function warmupBundleManifest(
  store: BundleManifestStore,
  keys: string[],
): Promise<void> {
  logger.info("[bundle-manifest] Warming up cache", { keys: keys.length });

  let loaded = 0;
  let failed = 0;

  for (const key of keys) {
    try {
      const metadata = await store.getBundleMetadata(key);
      if (metadata) {
        await store.getBundleCode(metadata.codeHash);
        loaded++;
      }
    } catch (error) {
      logger.debug("[bundle-manifest] Failed to warm up key", { key, error });
      failed++;
    }
  }

  logger.info("[bundle-manifest] Cache warmup complete", { loaded, failed });
}
