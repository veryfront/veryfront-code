import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { BunAdapter, bunAdapter, BunEnvironmentAdapter, BunFileSystemAdapter } from "./bun.ts";

describe("bun.ts exports", () => {
  describe("BunAdapter class", () => {
    it("should export BunAdapter class", () => {
      assertExists(BunAdapter);
      assertEquals(typeof BunAdapter, "function");
    });

    it("should be instantiable", () => {
      const adapter = new BunAdapter();
      assertExists(adapter);
    });
  });

  describe("bunAdapter singleton", () => {
    it("should export bunAdapter instance", () => {
      assertExists(bunAdapter);
    });

    it("should have correct id", () => {
      assertEquals(bunAdapter.id, "bun");
    });

    it("should have correct name", () => {
      assertEquals(bunAdapter.name, "bun");
    });

    it("should have fs adapter", () => {
      assertExists(bunAdapter.fs);
      assertExists(bunAdapter.fs.readFile);
      assertExists(bunAdapter.fs.writeFile);
      assertExists(bunAdapter.fs.exists);
    });

    it("should have env adapter", () => {
      assertExists(bunAdapter.env);
      assertExists(bunAdapter.env.get);
      assertExists(bunAdapter.env.set);
      assertExists(bunAdapter.env.toObject);
    });

    it("should have capabilities", () => {
      assertExists(bunAdapter.capabilities);
      assertEquals(bunAdapter.capabilities.typescript, true);
      assertEquals(bunAdapter.capabilities.jsx, true);
      assertEquals(bunAdapter.capabilities.websocket, true);
      assertEquals(bunAdapter.capabilities.http2, false); // Bun doesn't support http2
    });

    it("should have serve method", () => {
      assertExists(bunAdapter.serve);
      assertEquals(typeof bunAdapter.serve, "function");
    });
  });

  describe("BunEnvironmentAdapter", () => {
    it("should export BunEnvironmentAdapter class", () => {
      assertExists(BunEnvironmentAdapter);
      assertEquals(typeof BunEnvironmentAdapter, "function");
    });
  });

  describe("BunFileSystemAdapter", () => {
    it("should export BunFileSystemAdapter class", () => {
      assertExists(BunFileSystemAdapter);
      assertEquals(typeof BunFileSystemAdapter, "function");
    });
  });
});
