import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("platform/index.ts exports", () => {
  describe("adapters re-exports", () => {
    it("should export runtime", async () => {
      const { runtime } = await import("./index.ts");
      assertExists(runtime);
    });

    it("should export createFSAdapter", async () => {
      const { createFSAdapter } = await import("./index.ts");
      assertExists(createFSAdapter);
      assertEquals(typeof createFSAdapter, "function");
    });

    it("should export VeryfrontFSAdapter", async () => {
      const { VeryfrontFSAdapter } = await import("./index.ts");
      assertExists(VeryfrontFSAdapter);
      assertEquals(typeof VeryfrontFSAdapter, "function");
    });

    it("should export VeryfrontAPIClient", async () => {
      const { VeryfrontAPIClient } = await import("./index.ts");
      assertExists(VeryfrontAPIClient);
      assertEquals(typeof VeryfrontAPIClient, "function");
    });
  });

  describe("compat re-exports", () => {
    it("should export createKVStore", async () => {
      const { createKVStore } = await import("./index.ts");
      assertExists(createKVStore);
      assertEquals(typeof createKVStore, "function");
    });

    it("should export MemoryKv", async () => {
      const { MemoryKv } = await import("./index.ts");
      assertExists(MemoryKv);
      assertEquals(typeof MemoryKv, "function");
    });
  });
});
