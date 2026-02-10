import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

function importIndex(): Promise<typeof import("./index.ts")> {
  return import("./index.ts");
}

describe("platform/index.ts exports", () => {
  describe("adapters re-exports", () => {
    it("should export runtime", async () => {
      const { runtime } = await importIndex();
      assertExists(runtime);
    });

    it("should export createFSAdapter", async () => {
      const { createFSAdapter } = await importIndex();
      assertExists(createFSAdapter);
      assertEquals(typeof createFSAdapter, "function");
    });

    it("should export VeryfrontFSAdapter", async () => {
      const { VeryfrontFSAdapter } = await importIndex();
      assertExists(VeryfrontFSAdapter);
      assertEquals(typeof VeryfrontFSAdapter, "function");
    });

    it("should export VeryfrontApiClient", async () => {
      const { VeryfrontApiClient } = await importIndex();
      assertExists(VeryfrontApiClient);
      assertEquals(typeof VeryfrontApiClient, "function");
    });
  });

  describe("compat re-exports", () => {
    it("should export createKVStore", async () => {
      const { createKVStore } = await importIndex();
      assertExists(createKVStore);
      assertEquals(typeof createKVStore, "function");
    });

    it("should export MemoryKv", async () => {
      const { MemoryKv } = await importIndex();
      assertExists(MemoryKv);
      assertEquals(typeof MemoryKv, "function");
    });
  });
});
