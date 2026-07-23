import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { getCacheSetBatchEntrySchema } from "./cache-backend.schema.ts";

describe("cache backend schemas", () => {
  const schema = getCacheSetBatchEntrySchema();

  it("accepts a bounded cache batch entry", () => {
    assertEquals(
      schema.safeParse({ key: "project:key", value: "", ttl: 300 }).success,
      true,
    );
  });

  it("rejects keys that backends cannot accept", () => {
    assertEquals(schema.safeParse({ key: "", value: "value" }).success, false);
    assertEquals(schema.safeParse({ key: "bad\nkey", value: "value" }).success, false);
    assertEquals(schema.safeParse({ key: "bad\u0085key", value: "value" }).success, false);
    assertEquals(schema.safeParse({ key: "bad\ud800key", value: "value" }).success, false);
    assertEquals(
      schema.safeParse({ key: "x".repeat(4097), value: "value" }).success,
      false,
    );
  });

  it("rejects TTLs outside the backend contract", () => {
    assertEquals(
      schema.safeParse({ key: "key", value: "value", ttl: 365 * 24 * 60 * 60 + 1 })
        .success,
      false,
    );
  });
});
