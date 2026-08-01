import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { requireRedisUrl } from "./connection-config.ts";

describe("Redis connection configuration", () => {
  it("accepts canonical redis and rediss URLs without rewriting them", () => {
    assertEquals(
      requireRedisUrl("redis://127.0.0.1:6379/0"),
      "redis://127.0.0.1:6379/0",
    );
    assertEquals(
      requireRedisUrl("rediss://user:secret@cache.example:6380/1"),
      "rediss://user:secret@cache.example:6380/1",
    );
  });

  it("rejects malformed, non-Redis, fragment, and control-character URLs", () => {
    for (
      const value of [
        "cache.example:6379",
        "https://cache.example",
        "redis://cache.example/0#fragment",
        "redis://cache.example/0\n",
      ]
    ) {
      assertThrows(() => requireRedisUrl(value), TypeError);
    }
  });
});
