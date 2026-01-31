import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createKVStore, MemoryKv, openKv, polyfillDenoKv, SqliteKv } from "./index.ts";

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
});
