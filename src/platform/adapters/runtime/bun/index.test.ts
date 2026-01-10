import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  BunAdapter,
  bunAdapter,
  BunEnvironmentAdapter,
  BunFileSystemAdapter,
  BunServer,
  BunServerAdapter,
  BunWebSocket,
  createBunServer,
} from "./index.ts";

describe("runtime/bun/index.ts exports", () => {
  describe("BunAdapter", () => {
    it("should export BunAdapter class", () => {
      assertExists(BunAdapter);
      assertEquals(typeof BunAdapter, "function");
    });

    it("should export bunAdapter singleton", () => {
      assertExists(bunAdapter);
      assertEquals(bunAdapter.id, "bun");
      assertEquals(bunAdapter.name, "bun");
    });
  });

  describe("BunFileSystemAdapter", () => {
    it("should export BunFileSystemAdapter class", () => {
      assertExists(BunFileSystemAdapter);
      assertEquals(typeof BunFileSystemAdapter, "function");
    });
  });

  describe("BunEnvironmentAdapter", () => {
    it("should export BunEnvironmentAdapter class", () => {
      assertExists(BunEnvironmentAdapter);
      assertEquals(typeof BunEnvironmentAdapter, "function");
    });
  });

  describe("BunServerAdapter", () => {
    it("should export BunServerAdapter class", () => {
      assertExists(BunServerAdapter);
      assertEquals(typeof BunServerAdapter, "function");
    });
  });

  describe("BunWebSocket", () => {
    it("should export BunWebSocket class", () => {
      assertExists(BunWebSocket);
      assertEquals(typeof BunWebSocket, "function");
    });
  });

  describe("BunServer", () => {
    it("should export BunServer class", () => {
      assertExists(BunServer);
      assertEquals(typeof BunServer, "function");
    });
  });

  describe("createBunServer", () => {
    it("should export createBunServer function", () => {
      assertExists(createBunServer);
      assertEquals(typeof createBunServer, "function");
    });
  });
});
