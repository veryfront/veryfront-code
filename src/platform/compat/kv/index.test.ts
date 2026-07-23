import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createKVStore,
  KV_PORTABLE_LIMITS,
  MemoryKv,
  openKv,
  polyfillDenoKv,
  SqliteKv,
} from "./index.ts";
import type { KvJsonValue } from "./index.ts";

describe("compat/kv/index.ts exports", () => {
  const cases: Array<[string, unknown]> = [
    ["openKv function", openKv],
    ["createKVStore function", createKVStore],
    ["polyfillDenoKv function", polyfillDenoKv],
    ["MemoryKv class", MemoryKv],
    ["SqliteKv class", SqliteKv],
  ];

  for (const [name, value] of cases) {
    it(`should export ${name}`, () => {
      assertExists(value);
      assertEquals(typeof value, "function");
    });
  }

  it("exports the portable contract", () => {
    const value: KvJsonValue = { nested: [null, true, 1, "value"] };

    assertEquals(value, { nested: [null, true, 1, "value"] });
    assertEquals(KV_PORTABLE_LIMITS.maxKeyBytes, 2_048);
    assertEquals(KV_PORTABLE_LIMITS.maxValueBytes, 60 * 1_024);
  });
});
