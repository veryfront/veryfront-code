import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileCache, estimateSize, FileCache, LRUTracker } from "./index.ts";

describe("fs/cache/index.ts exports", () => {
  const cases: Array<{ name: string; value: unknown }> = [
    { name: "FileCache", value: FileCache },
    { name: "createFileCache", value: createFileCache },
    { name: "estimateSize", value: estimateSize },
    { name: "LRUTracker", value: LRUTracker },
  ];

  for (const { name, value } of cases) {
    describe(name, () => {
      it(`should export ${name}`, () => {
        assertExists(value);
        assertEquals(typeof value, "function");
      });
    });
  }
});
