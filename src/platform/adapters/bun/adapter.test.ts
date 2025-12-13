import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert, assertExists } from "std/assert/mod.ts";
import { BunAdapter, bunAdapter } from "./adapter.ts";

describe("platform/adapters/bun/adapter", () => {
  describe("BunAdapter", () => {
    it("should have correct id and platform", () => {
      const adapter = new BunAdapter();
      assertEquals(adapter.id, "bun");
      assertEquals(adapter.name, "bun");
      assertEquals(adapter.platform, "bun");
    });

    it("should have filesystem adapter", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.fs, "fs adapter should exist");
    });

    it("should have environment adapter", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.env, "env adapter should exist");
    });

    it("should have server adapter", () => {
      const adapter = new BunAdapter();
      assertExists(adapter.server, "server adapter should exist");
    });

    it("should have correct capabilities", () => {
      const adapter = new BunAdapter();

      assertEquals(adapter.capabilities.typescript, true);
      assertEquals(adapter.capabilities.jsx, true);
      assertEquals(adapter.capabilities.http2, false);
      assertEquals(adapter.capabilities.websocket, true);
      assertEquals(adapter.capabilities.workers, true);
      assertEquals(adapter.capabilities.fileWatching, true);
      assertEquals(adapter.capabilities.shell, true);
      assertEquals(adapter.capabilities.kvStore, false);
      assertEquals(adapter.capabilities.writableFs, true);
    });

    it("should have correct features", () => {
      const adapter = new BunAdapter();

      assertEquals(adapter.features.websocket, true);
      assertEquals(adapter.features.http2, false);
      assertEquals(adapter.features.workers, true);
      assertEquals(adapter.features.jsx, true);
      assertEquals(adapter.features.typescript, true);
    });

    it("should have serve method", () => {
      const adapter = new BunAdapter();
      assert(typeof adapter.serve === "function", "serve should be a function");
    });

    it("serve method should be callable", () => {
      const adapter = new BunAdapter();

      // We can verify the signature without actually starting a server
      // since this test runs in Deno, not Bun runtime
      assert(typeof adapter.serve === "function");

      // Verify it's a method bound to the adapter
      assertEquals(adapter.serve.length, 1, "serve should have 1 required parameter (handler)");
    });
  });

  describe("bunAdapter singleton", () => {
    it("should be an instance of BunAdapter", () => {
      assert(bunAdapter instanceof BunAdapter, "bunAdapter should be instance of BunAdapter");
    });

    it("should have same properties as new instance", () => {
      assertEquals(bunAdapter.id, "bun");
      assertEquals(bunAdapter.name, "bun");
      assertEquals(bunAdapter.platform, "bun");
    });
  });
});
