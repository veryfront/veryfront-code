import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import { ExtensionLoader, tryResolve } from "#veryfront/extensions/index.ts";
import { RedisRuntimeProviderName } from "#veryfront/extensions/distributed/index.ts";
import { getRedisModule } from "#veryfront/platform/adapters/redis/modules.ts";
import { createServerBuiltinExtensions } from "#veryfront/server/runtime-extensions.ts";

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function withEnvironment(
  proxyMode: string,
  redisUrl: string | undefined,
  fn: () => Promise<void>,
) {
  const previous = {
    PROXY_MODE: getEnv("PROXY_MODE"),
    REDIS_URL: getEnv("REDIS_URL"),
    VERYFRONT_CLI_LOCAL_PROXY_MODE: getEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE"),
  };
  setEnv("PROXY_MODE", proxyMode);
  deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
  if (redisUrl === undefined) deleteEnv("REDIS_URL");
  else setEnv("REDIS_URL", redisUrl);
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
  }
}

describe("hosted server Redis composition", () => {
  it("registers the workflow Redis runtime and releases it with the extension generation", async () => {
    await withEnvironment("1", "redis://localhost:6379", async () => {
      const redis = createServerBuiltinExtensions().filter((entry) =>
        entry.extension.name === "ext-redis"
      );
      assertEquals(redis.length, 1);
      const loader = new ExtensionLoader(logger);
      try {
        await loader.setupAll(redis, {});
        assertExists(tryResolve(RedisRuntimeProviderName));
        const { NodeRedis } = await getRedisModule();
        assertExists(NodeRedis);
      } finally {
        await loader.teardownAll();
      }
      assertEquals(tryResolve(RedisRuntimeProviderName), undefined);
    });
  });

  it("keeps Redis opt-in for local projects", async () => {
    await withEnvironment("0", "redis://localhost:6379", async () => {
      assertEquals(
        createServerBuiltinExtensions().some((entry) => entry.extension.name === "ext-redis"),
        false,
      );
    });
  });

  it("keeps local CLI proxy mode opt-in even with a Redis connection", async () => {
    await withEnvironment("1", "redis://localhost:6379", async () => {
      setEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE", "1");
      assertEquals(
        createServerBuiltinExtensions().some((entry) => entry.extension.name === "ext-redis"),
        false,
      );
    });
  });

  it("does not activate Redis without a hosted runtime connection", async () => {
    await withEnvironment("1", undefined, async () => {
      assertEquals(
        createServerBuiltinExtensions().some((entry) => entry.extension.name === "ext-redis"),
        false,
      );
    });
  });
});
