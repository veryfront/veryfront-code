import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

function importIndex(): Promise<typeof import("./index.ts")> {
  return import("./index.ts");
}

describe("platform/index.ts exports", () => {
  describe("adapters re-exports", () => {
    it("does not export the mutable runtime registry", async () => {
      const publicPlatform = await importIndex();
      assertEquals("runtime" in publicPlatform, false);
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
    it("should export the host runtime seam", async () => {
      const publicPlatform = await importIndex();
      const { createInMemoryHostRuntime, isHostExit } = publicPlatform;
      assertEquals("liveHostRuntime" in publicPlatform, false, "live adapter stays internal");
      assertEquals(typeof createInMemoryHostRuntime, "function", "in-memory factory is exported");
      assertEquals(typeof isHostExit, "function", "host exit guard is exported");
    });

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
