import { getEnv } from "#veryfront/platform/compat/process/env.ts";
import type {
  RedisClient,
  RedisClientOptions,
  RedisRuntimeProvider,
} from "#veryfront/extensions/distributed/redis-runtime-provider.ts";

export type { RedisClient, RedisClientOptions };

const sharedClientOwners = new Set<Readonly<RedisRuntimeProvider>>();
const resolvingOwners = new Set<Promise<void>>();
let disconnecting: Promise<void> | null = null;

export function getRedisClient(options: RedisClientOptions = {}): Promise<RedisClient> {
  if (disconnecting) return disconnecting.then(() => getRedisClient(options));

  // Loaded lazily so the provider module stays out of browser bundles.
  const resolving = import("#veryfront/extensions/distributed/defaults.ts")
    .then(({ ensureRedisRuntimeProvider }) => ensureRedisRuntimeProvider())
    .then((provider) => {
      sharedClientOwners.add(provider);
      return provider;
    });
  const trackedResolution = resolving.then(
    () => undefined,
    () => undefined,
  ).finally(() => {
    resolvingOwners.delete(trackedResolution);
  });
  resolvingOwners.add(trackedResolution);
  return resolving.then((provider) => provider.getClient(options));
}

/** Disconnect and clear the shared client so the next call reconnects fresh. */
export function disconnectRedisClient(): Promise<void> {
  if (disconnecting) return disconnecting;

  const pending = (async () => {
    await Promise.allSettled([...resolvingOwners]);
    const { getRegisteredRedisRuntimeProvider } = await import(
      "#veryfront/extensions/distributed/defaults.ts"
    );
    const currentProvider = getRegisteredRedisRuntimeProvider();
    if (currentProvider) sharedClientOwners.add(currentProvider);
    const owners = [...sharedClientOwners];
    const results = await Promise.allSettled(
      owners.map((provider) => provider.disconnectClient()),
    );
    const failures: unknown[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") sharedClientOwners.delete(owners[index]!);
      else failures.push(result.reason);
    });
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Redis shared client disconnect failed");
    }
  })();
  const tracked = pending.finally(() => {
    if (disconnecting === tracked) disconnecting = null;
  });
  disconnecting = tracked;
  return tracked;
}

export function isRedisConfigured(): boolean {
  return Boolean(getEnv("REDIS_URL"));
}
