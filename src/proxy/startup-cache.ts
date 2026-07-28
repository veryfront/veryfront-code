import type { TokenCacheStore } from "../extensions/cache/index.ts";
import { register, tryResolve, unregister } from "../extensions/contracts.ts";
import { type CacheFromEnvOptions, createCacheFromEnv } from "./cache/index.ts";
import {
  acquireRedisTokenCacheStoreFromEnv,
  type RedisTokenCacheStoreAcquisition,
} from "./cache/redis-extension.ts";
import type { TokenCache } from "./cache/types.ts";
import {
  assertCacheOptionsObject,
  requireSynchronousCacheRegistryOperation,
  snapshotOwnedTokenCacheOperations,
  snapshotTokenCacheClose,
  snapshotTokenCacheOperations,
} from "./cache/validation.ts";
import type { ProxyStartupRollback } from "./startup-rollback.ts";

export interface ProxyStartupCache {
  readonly cache: TokenCache;

  /**
   * Relinquish direct cache cleanup only after the handler has successfully
   * completed aggregate cleanup.
   */
  transferToHandler(): void;
}

export interface ProxyStartupCacheDependencies {
  acquireRedisStore?: () => Promise<RedisTokenCacheStoreAcquisition>;
  createCache?: (options: CacheFromEnvOptions) => Promise<TokenCache>;
  resolveRegisteredStore?: () => TokenCacheStore | undefined;
  registerStore?: (store: TokenCacheStore) => void;
  unregisterStore?: () => void;
}

function readDependency(
  dependencies: ProxyStartupCacheDependencies,
  key: keyof ProxyStartupCacheDependencies,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Proxy startup cache ${key} must be a data property`);
  }
  return descriptor.value;
}

function dependency<TFunction extends (...args: never[]) => unknown>(
  dependencies: ProxyStartupCacheDependencies,
  key: keyof ProxyStartupCacheDependencies,
  fallback: TFunction,
): TFunction {
  const configured = readDependency(dependencies, key);
  if (configured === undefined) return fallback;
  if (typeof configured !== "function") {
    throw new TypeError(`Proxy startup cache ${key} must be a function`);
  }
  return configured as TFunction;
}

function snapshotAcquisition(
  value: RedisTokenCacheStoreAcquisition,
): RedisTokenCacheStoreAcquisition {
  assertCacheOptionsObject(
    value,
    "Proxy startup Redis acquisition",
    ["kind", "store"],
  );
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  const storeDescriptor = Object.getOwnPropertyDescriptor(value, "store");
  if (
    !kindDescriptor || !("value" in kindDescriptor) ||
    !storeDescriptor || !("value" in storeDescriptor)
  ) {
    throw new TypeError("Proxy startup Redis acquisition must use data properties");
  }
  const kind = kindDescriptor.value;
  const store = storeDescriptor.value;
  if (kind === "disabled" && store === null) {
    return Object.freeze({ kind, store });
  }
  if (
    (kind !== "borrowed" && kind !== "created") ||
    store === null ||
    typeof store !== "object" ||
    Array.isArray(store)
  ) {
    throw new TypeError("Proxy startup Redis acquisition is invalid");
  }
  return Object.freeze({ kind, store: store as TokenCacheStore });
}

function ownValidatedCache(
  rollback: ProxyStartupRollback,
  name: string,
  cache: TokenCache,
  label: string,
  releasePrevious: () => void = () => {},
): Readonly<{ cache: TokenCache; release: () => void }> {
  // Arm a stable close before validating the complete operation surface. If
  // validation throws, rollback never performs another property read across
  // the untrusted cache boundary.
  const provisionalClose = snapshotTokenCacheClose(cache, label);
  const releaseProvisional = rollback.own(
    `${name}-provisional`,
    provisionalClose,
  );
  releasePrevious();
  const ownedCache = snapshotOwnedTokenCacheOperations(cache, label);
  const releaseStable = rollback.own(name, ownedCache.close);
  releaseProvisional();
  return Object.freeze({ cache: ownedCache, release: releaseStable });
}

function throwCleanupFailures(failures: unknown[]): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(
    failures,
    "Failed to clean up a late Proxy Redis store acquisition",
  );
}

function restoreCreatedStoreRegistration(
  createdStore: TokenCacheStore,
  previousStore: TokenCacheStore | undefined,
  resolveRegisteredStore: () => TokenCacheStore | undefined,
  registerStore: (store: TokenCacheStore) => void,
  unregisterStore: () => void,
  labelPrefix: string,
): void {
  if (resolveRegisteredStore() !== createdStore) return;
  if (previousStore === undefined) {
    requireSynchronousCacheRegistryOperation(
      (unregisterStore as () => unknown)(),
      `${labelPrefix} unregistration`,
    );
    return;
  }
  requireSynchronousCacheRegistryOperation(
    (registerStore as (store: TokenCacheStore) => unknown)(previousStore),
    `${labelPrefix} registration restoration`,
  );
}

async function cleanUpRedisAcquisition(
  value: RedisTokenCacheStoreAcquisition,
  previousStore: TokenCacheStore | undefined,
  resolveRegisteredStore: () => TokenCacheStore | undefined,
  registerStore: (store: TokenCacheStore) => void,
  unregisterStore: () => void,
): Promise<void> {
  const acquisition = snapshotAcquisition(value);
  if (acquisition.kind !== "created") return;

  const failures: unknown[] = [];
  try {
    restoreCreatedStoreRegistration(
      acquisition.store,
      previousStore,
      resolveRegisteredStore,
      registerStore,
      unregisterStore,
      "Late Proxy Redis store",
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    await snapshotTokenCacheClose(
      acquisition.store,
      "Late Proxy Redis store",
    )();
  } catch (error) {
    failures.push(error);
  }
  throwCleanupFailures(failures);
}

/**
 * Acquire the proxy cache while keeping registry restoration independent from
 * close ownership.
 *
 * A created Redis store moves through store -> cache -> handler ownership.
 * Borrowed stores are never closed by the proxy startup transaction.
 */
export async function acquireProxyStartupCache(
  rollback: ProxyStartupRollback,
  dependencies: ProxyStartupCacheDependencies = {},
  abortSignal?: AbortSignal,
): Promise<ProxyStartupCache> {
  assertCacheOptionsObject(
    dependencies,
    "Proxy startup cache dependencies",
    [
      "acquireRedisStore",
      "createCache",
      "resolveRegisteredStore",
      "registerStore",
      "unregisterStore",
    ],
  );
  const acquireRedisStore = dependency(
    dependencies,
    "acquireRedisStore",
    acquireRedisTokenCacheStoreFromEnv,
  ) as () => Promise<RedisTokenCacheStoreAcquisition>;
  const createCache = dependency(
    dependencies,
    "createCache",
    createCacheFromEnv,
  ) as (options: CacheFromEnvOptions) => Promise<TokenCache>;
  const resolveRegisteredStore = dependency(
    dependencies,
    "resolveRegisteredStore",
    () => tryResolve<TokenCacheStore>("TokenCacheStore"),
  ) as () => TokenCacheStore | undefined;
  const registerStore = dependency(
    dependencies,
    "registerStore",
    (store: TokenCacheStore) => register("TokenCacheStore", store),
  ) as (store: TokenCacheStore) => void;
  const unregisterStore = dependency(
    dependencies,
    "unregisterStore",
    () => unregister("TokenCacheStore"),
  ) as () => void;

  return await rollback.run(async () => {
    const previousStore = resolveRegisteredStore();
    const redisAcquisition = await rollback.acquire(
      "redis-token-cache-acquisition",
      acquireRedisStore,
      (value) =>
        cleanUpRedisAcquisition(
          value,
          previousStore,
          resolveRegisteredStore,
          registerStore,
          unregisterStore,
        ),
      abortSignal,
    );
    const acquisition = snapshotAcquisition(redisAcquisition.value);
    let cacheStoreAcquisition = acquisition;

    let releaseStoreClose = (): void => {};
    if (acquisition.kind === "created") {
      const createdStore = acquisition.store;
      const cacheStore = snapshotOwnedTokenCacheOperations(
        createdStore,
        "Created Proxy Redis store",
      );
      cacheStoreAcquisition = Object.freeze({
        kind: "created",
        store: cacheStore,
      });

      // Registry restoration is intentionally not transferred to cache/handler.
      // It remains armed until startup commits and runs even if close times out.
      rollback.own("token-cache-store-registration", () => {
        restoreCreatedStoreRegistration(
          createdStore,
          previousStore,
          resolveRegisteredStore,
          registerStore,
          unregisterStore,
          "Proxy startup cache",
        );
      });
      releaseStoreClose = ownValidatedCache(
        rollback,
        "redis-token-cache-store",
        cacheStore,
        "Created Proxy Redis store",
        redisAcquisition.release,
      ).release;
    } else if (acquisition.kind === "borrowed") {
      // Validate borrowed infrastructure without ever taking close ownership.
      snapshotTokenCacheOperations(
        acquisition.store,
        "Borrowed Proxy Redis store",
      );
      redisAcquisition.release();
    } else {
      redisAcquisition.release();
    }

    const cacheAcquisition = await rollback.acquire(
      "token-cache-acquisition",
      () => createCache({ redisStore: cacheStoreAcquisition }),
      async (lateCache) => {
        await snapshotTokenCacheClose(
          lateCache,
          "Late Proxy startup cache",
        )();
        releaseStoreClose();
      },
      abortSignal,
    );
    const ownedCache = ownValidatedCache(
      rollback,
      "token-cache",
      cacheAcquisition.value,
      "Proxy startup cache",
      cacheAcquisition.release,
    );

    // A created store is now closed transitively by the cache. Borrowed stores
    // never had direct close ownership.
    releaseStoreClose();

    return Object.freeze({
      cache: ownedCache.cache,
      transferToHandler: ownedCache.release,
    });
  }, abortSignal);
}
