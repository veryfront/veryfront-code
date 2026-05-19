import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withoutHostBinaryInfraEnv } from "./proxy-mode.ts";

describe("withoutHostBinaryInfraEnv", () => {
  it("removes host cache and Veryfront API settings from binary test env", () => {
    const sanitized = withoutHostBinaryInfraEnv({
      KEEP_ME: "1",
      VERYFRONT_API_BASE_URL: "https://api.example.test",
      VERYFRONT_API_TOKEN: "<TOKEN>",
      VF_CACHE_BACKEND: "disk",
      VF_DISK_CACHE_DIR: "/tmp/cache",
      REDIS_URL: "redis://localhost:6379",
      CACHE_TYPE: "redis",
      REDIS_PREFIX: "vf",
      SSR_REDIS_CACHE_ENABLED: "1",
      VERYFRONT_BUNDLE_MANIFEST_REDIS_URL: "redis://localhost:6380",
    });

    assertEquals(sanitized, { KEEP_ME: "1" });
  });
});
