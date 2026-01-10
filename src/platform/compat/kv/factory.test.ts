import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { createKVStore, openKv, polyfillDenoKv } from "./factory.ts";

describe("kv/factory", () => {
  describe("openKv", () => {
    it("should export openKv function", () => {
      assertExists(openKv);
      assertEquals(typeof openKv, "function");
    });

    it("should return a KV store", async () => {
      const kv = await openKv();
      assertExists(kv);
      assertExists(kv.get);
      assertExists(kv.set);
      assertExists(kv.delete);
      assertExists(kv.list);
      assertExists(kv.close);
      kv.close();
    });
  });

  describe("createKVStore", () => {
    it("should export createKVStore function", () => {
      assertExists(createKVStore);
      assertEquals(typeof createKVStore, "function");
    });

    it("should create a KV store", async () => {
      const kv = await createKVStore();
      assertExists(kv);
      assertExists(kv.get);
      assertExists(kv.set);
      kv.close();
    });
  });

  describe("polyfillDenoKv", () => {
    it("should export polyfillDenoKv function", () => {
      assertExists(polyfillDenoKv);
      assertEquals(typeof polyfillDenoKv, "function");
    });

    it("should be callable without error", () => {
      // polyfillDenoKv should not throw
      polyfillDenoKv();
    });
  });
});
