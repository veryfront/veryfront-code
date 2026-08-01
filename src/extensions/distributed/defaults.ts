import { register, resolve, tryResolve } from "../contracts.ts";
import {
  importFirstPartyExtensionModule,
  isMissingFirstPartyExtensionModule,
} from "../first-party-import.ts";
import {
  captureRedisRuntimeProvider,
  type RedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "./redis-runtime-provider.ts";

type DefaultRedisRuntimeModule = {
  createRedisRuntimeProvider(): RedisRuntimeProvider;
};

let loading: Promise<void> | null = null;

function registeredProvider(): Readonly<RedisRuntimeProvider> | undefined {
  const provider = tryResolve<unknown>(RedisRuntimeProviderName);
  return provider === undefined ? undefined : captureRedisRuntimeProvider(provider);
}

async function loadDefaultProvider(): Promise<void> {
  try {
    const module = await importFirstPartyExtensionModule<DefaultRedisRuntimeModule>(
      "ext-redis",
      "@veryfront/ext-redis",
    );
    if (registeredProvider()) return;
    if (typeof module.createRedisRuntimeProvider !== "function") {
      throw new TypeError(
        "@veryfront/ext-redis must export createRedisRuntimeProvider",
      );
    }
    const provider = captureRedisRuntimeProvider(module.createRedisRuntimeProvider());
    if (!tryResolve(RedisRuntimeProviderName)) {
      register(RedisRuntimeProviderName, provider);
    }
  } catch (error) {
    if (
      !isMissingFirstPartyExtensionModule(error, [
        "extensions/ext-redis/src/index",
        "@veryfront/ext-redis",
      ])
    ) {
      throw error;
    }
    // Produce the stable extension-registry error and install recommendation.
    resolve(RedisRuntimeProviderName);
  }
}

/** Resolve an explicit provider or lazily load the first-party implementation. */
export async function ensureRedisRuntimeProvider(): Promise<Readonly<RedisRuntimeProvider>> {
  const existing = registeredProvider();
  if (existing) return existing;

  if (!loading) {
    const pending = loadDefaultProvider().finally(() => {
      if (loading === pending) loading = null;
    });
    loading = pending;
  }
  await loading;
  return captureRedisRuntimeProvider(resolve(RedisRuntimeProviderName));
}

/** Return the active provider without loading an extension. */
export function getRegisteredRedisRuntimeProvider(): Readonly<RedisRuntimeProvider> | undefined {
  return registeredProvider();
}
