import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { captureRedisConnectionPolicy, hasRedisUrl, resolveRedisUrl } from "./connection-config.ts";

describe("Redis extension connection policy", () => {
  it("captures explicit configuration and ignores later caller mutation", () => {
    const options = { url: "rediss://cache.example/0", connectTimeoutMs: 2_000 };
    const policy = captureRedisConnectionPolicy(options);
    options.url = "rediss://mutated.example/0";

    assertEquals(policy.url, "rediss://cache.example/0");
    assertEquals(Object.isFrozen(policy), true);
  });

  it("allows plaintext only for loopback development endpoints", () => {
    assertEquals(resolveRedisUrl({}, () => "redis://127.0.0.1:6379/0"), "redis://127.0.0.1:6379/0");
    assertEquals(resolveRedisUrl({}, () => "redis://[::1]:6379/0"), "redis://[::1]:6379/0");
    assertThrows(
      () => resolveRedisUrl({}, () => "redis://cache.example:6379/0"),
      TypeError,
      "must use rediss://",
    );
  });

  it("fails closed on missing, malformed, accessor, and unknown configuration", () => {
    assertEquals(hasRedisUrl({}, () => undefined), false);
    assertThrows(
      () => resolveRedisUrl({}, () => undefined),
      TypeError,
      "requires a configured URL",
    );
    assertThrows(
      () => captureRedisConnectionPolicy({ url: "https://cache.example" }),
      TypeError,
      "redis:// or rediss://",
    );
    assertThrows(
      () => captureRedisConnectionPolicy({ unexpected: true } as never),
      TypeError,
      "unknown option",
    );

    const accessor = {} as { url?: string };
    Object.defineProperty(accessor, "url", {
      enumerable: true,
      get: () => "rediss://cache.example",
    });
    assertThrows(
      () => captureRedisConnectionPolicy(accessor),
      TypeError,
      "data property",
    );
  });
});
