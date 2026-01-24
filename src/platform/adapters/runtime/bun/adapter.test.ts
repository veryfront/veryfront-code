import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BunAdapter, bunAdapter } from "./adapter.ts";

describe("BunAdapter", () => {
  describe("class", () => {
    it("should export BunAdapter class", () => {
      assertExists(BunAdapter);
      assertEquals(typeof BunAdapter, "function");
    });

    it("should export bunAdapter singleton", () => {
      assertExists(bunAdapter);
      assertEquals(bunAdapter instanceof BunAdapter, true);
    });
  });

  describe("instance", () => {
    function createAdapter(): BunAdapter {
      const adapter = new BunAdapter();
      assertExists(adapter);
      return adapter;
    }

    it("should be instantiable", () => {
      createAdapter();
    });

    it("should have id property", () => {
      const adapter = createAdapter();
      assertEquals(adapter.id, "bun");
    });

    it("should have name property", () => {
      const adapter = createAdapter();
      assertEquals(adapter.name, "bun");
    });

    it("should have fs adapter", () => {
      const adapter = createAdapter();
      assertExists(adapter.fs);
    });

    it("should have env adapter", () => {
      const adapter = createAdapter();
      assertExists(adapter.env);
    });

    it("should have server adapter", () => {
      const adapter = createAdapter();
      assertExists(adapter.server);
    });

    it("should have shell adapter", () => {
      const adapter = createAdapter();
      assertExists(adapter.shell);
    });

    it("should have capabilities", () => {
      const adapter = createAdapter();
      assertExists(adapter.capabilities);
      assertEquals(adapter.capabilities.typescript, true);
      assertEquals(adapter.capabilities.jsx, true);
      assertEquals(adapter.capabilities.http2, false);
      assertEquals(adapter.capabilities.websocket, true);
      assertEquals(adapter.capabilities.workers, true);
      assertEquals(adapter.capabilities.fileWatching, true);
      assertEquals(adapter.capabilities.shell, true);
      assertEquals(adapter.capabilities.writableFs, true);
    });

    it("should have serve method", () => {
      const adapter = createAdapter();
      assertExists(adapter.serve);
      assertEquals(typeof adapter.serve, "function");
    });

    it("should have shutdown method", () => {
      const adapter = createAdapter();
      assertExists(adapter.shutdown);
      assertEquals(typeof adapter.shutdown, "function");
    });
  });
});
