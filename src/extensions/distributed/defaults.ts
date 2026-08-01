import { resolve, tryResolve } from "../contracts.ts";
import {
  captureRedisRuntimeProvider,
  type RedisRuntimeProvider,
  RedisRuntimeProviderName,
} from "./redis-runtime-provider.ts";

function registeredProvider(): Readonly<RedisRuntimeProvider> | undefined {
  const provider = tryResolve<unknown>(RedisRuntimeProviderName);
  return provider === undefined ? undefined : captureRedisRuntimeProvider(provider);
}

/** Resolve the provider registered by explicit extension orchestration. */
export async function ensureRedisRuntimeProvider(): Promise<Readonly<RedisRuntimeProvider>> {
  return captureRedisRuntimeProvider(resolve(RedisRuntimeProviderName));
}

/** Return the active provider without loading an extension. */
export function getRegisteredRedisRuntimeProvider(): Readonly<RedisRuntimeProvider> | undefined {
  return registeredProvider();
}
