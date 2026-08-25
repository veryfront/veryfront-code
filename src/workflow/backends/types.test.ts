import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { BackendConfig, RedisBackendConfig } from "#veryfront/workflow";

describe("workflow backend public config types", () => {
  it("retains defaultTtl as a deprecated public BackendConfig no-op", () => {
    const backendConfig = {
      defaultTtl: 30,
    } satisfies BackendConfig;
    const redisConfig = {
      defaultTtl: 30,
      runTtl: 60,
    } satisfies RedisBackendConfig;

    assertEquals(backendConfig.defaultTtl, 30);
    assertEquals(redisConfig.defaultTtl, 30);
  });
});
