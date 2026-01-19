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
    it("should be instantiable", () => {
      const adapter = new BunAdapter();
      assertExists(adapter);
    });

    it("should have id property", () => {
      const adapter = new BunAdapter();
      assertEquals(adapter.id, "bun");
    });

    it("should have name property", () => {
      const adapter = new BunAdapter();
      assertEquals(adapter.name, "bun");
    });

    it("should have fs adapter", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.fs);
    });

    it("should have env adapter", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.env);
    });

    it("should have server adapter", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.server);
    });

    it("should have shell adapter", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.shell);
    });

    it("should have capabilities", () => {
      const adapter = new BunAdapter();
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
      const adapter = new BunAdapter();
      assertExists(adapter.serve);
      assertEquals(typeof adapter.serve, "function");
    });

    it("should have shutdown method", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.shutdown);
      assertEquals(typeof adapter.shutdown, "function");
    });
  });
});
