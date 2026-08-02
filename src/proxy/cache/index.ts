/**
 * Proxy Cache
 *
 * @module proxy/cache
 */

export type {
  CacheOptions,
  CacheStats,
  MemoryCacheOptions,
  TokenCache,
  TokenCacheEntry,
} from "./types.ts";
export { MemoryCache } from "./memory-cache.ts";
export { ResilientCache } from "./resilient-cache.ts";
export { TracingTokenCache } from "./tracing-cache.ts";

import type { CacheOptions, MemoryCacheOptions, TokenCache } from "./types.ts";
import type { TokenCacheStore } from "../../extensions/cache/index.ts";
import type { ExtensionTokenCacheStoreAcquisition } from "./extension-store.ts";
import { MemoryCache } from "./memory-cache.ts";
import { TracingTokenCache } from "./tracing-cache.ts";
import { tryResolve } from "../../extensions/contracts.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { assertCacheOptionsObject } from "./validation.ts";

const logger = proxyLogger.child({ module: "cache" });

const MISSING_EXTENSION_INFO =
  'Extension cache was requested, but no activated extension provides "TokenCacheStore".';

export interface CacheFromEnvOptions {
  /**
   * Explicit startup acquisition. A borrowed store remains open when the
   * proxy-owned cache wrapper closes.
   */
  extensionStore?: ExtensionTokenCacheStoreAcquisition;
}

function requireTokenCacheStore(): TokenCacheStore {
  const tokenCache = tryResolve<TokenCacheStore>("TokenCacheStore");
  if (!tokenCache) {
    throw INITIALIZATION_ERROR.create({ detail: MISSING_EXTENSION_INFO });
  }
  return tokenCache;
}

function readExtensionStoreAcquisition(
  options: CacheFromEnvOptions,
): ExtensionTokenCacheStoreAcquisition | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(options, "extensionStore");
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError("Proxy cache extensionStore must be a data property");
  }
  const acquisition = descriptor.value;
  if (acquisition === undefined) return undefined;
  assertCacheOptionsObject(
    acquisition,
    "Proxy extension store acquisition",
    ["kind", "store"],
  );
  const kindDescriptor = Object.getOwnPropertyDescriptor(acquisition, "kind");
  const storeDescriptor = Object.getOwnPropertyDescriptor(acquisition, "store");
  if (
    !kindDescriptor || !("value" in kindDescriptor) ||
    !storeDescriptor || !("value" in storeDescriptor)
  ) {
    throw new TypeError("Proxy extension store acquisition must use data properties");
  }
  const kind = kindDescriptor.value;
  const store = storeDescriptor.value;
  if (kind === "disabled") {
    if (store !== null) {
      throw new TypeError("Disabled Proxy extension store acquisition must not contain a store");
    }
    return acquisition as ExtensionTokenCacheStoreAcquisition;
  }
  if (
    (kind !== "borrowed" && kind !== "created") ||
    store === null ||
    typeof store !== "object" ||
    Array.isArray(store)
  ) {
    throw new TypeError("Proxy extension store acquisition is invalid");
  }
  return acquisition as ExtensionTokenCacheStoreAcquisition;
}

export async function createCache(options: CacheOptions): Promise<TokenCache> {
  assertCacheOptionsObject(options, "Proxy cache options", ["type", "options"]);
  const typeDescriptor = Object.getOwnPropertyDescriptor(options, "type");
  if (!typeDescriptor || !("value" in typeDescriptor)) {
    throw new TypeError("Proxy cache type must be a data property");
  }
  const cacheType = typeDescriptor.value;
  if (cacheType !== "memory" && cacheType !== "extension") {
    throw new TypeError("Proxy cache type must be memory or extension");
  }
  const optionsDescriptor = Object.getOwnPropertyDescriptor(options, "options");
  if (optionsDescriptor && !("value" in optionsDescriptor)) {
    throw new TypeError("Proxy cache backend options must be a data property");
  }
  const backendOptions = optionsDescriptor && "value" in optionsDescriptor
    ? optionsDescriptor.value
    : undefined;
  return withSpan(
    "cache.create",
    async () => {
      if (cacheType === "extension") {
        if (backendOptions !== undefined) {
          throw new TypeError("Extension cache configuration belongs to the selected extension");
        }
        return new TracingTokenCache(requireTokenCacheStore());
      }
      return new MemoryCache(backendOptions as MemoryCacheOptions | undefined);
    },
    { "cache.type": cacheType },
  );
}

export async function createCacheFromEnv(
  options: CacheFromEnvOptions = {},
): Promise<TokenCache> {
  assertCacheOptionsObject(options, "Proxy environment cache options", ["extensionStore"]);
  const extensionStore = readExtensionStoreAcquisition(options);
  const cacheType = getEnv("CACHE_TYPE") || "memory";
  if (cacheType !== "memory" && cacheType !== "extension") {
    throw new TypeError("CACHE_TYPE must be memory or extension");
  }
  if (cacheType === "memory" && extensionStore && extensionStore.kind !== "disabled") {
    throw new TypeError("An extension store cannot be supplied when CACHE_TYPE=memory");
  }
  if (cacheType === "extension" && extensionStore?.kind === "disabled") {
    throw new TypeError("CACHE_TYPE=extension requires an acquired extension store");
  }

  return withSpan(
    "cache.createFromEnv",
    async () => {
      if (cacheType !== "extension") return new MemoryCache();

      logger.debug("[Cache] Using explicitly activated TokenCacheStore extension");
      const store = extensionStore?.store ?? requireTokenCacheStore();
      return new TracingTokenCache(store, {
        // Registry resolution is borrowed by default. Only an explicit
        // composition descriptor may transfer created-store ownership.
        closeInner: extensionStore?.kind === "created",
      });
    },
    { "cache.type": cacheType },
  );
}
