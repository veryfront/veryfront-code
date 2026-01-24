import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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

function assertExportedFunction(value: unknown): void {
  assertExists(value);
  assertEquals(typeof value, "function");
}

describe("runtime/bun/index.ts exports", () => {
  describe("BunAdapter", () => {
    it("should export BunAdapter class", () => {
      assertExportedFunction(BunAdapter);
    });

    it("should export bunAdapter singleton", () => {
      assertExists(bunAdapter);
      assertEquals(bunAdapter.id, "bun");
      assertEquals(bunAdapter.name, "bun");
    });
  });

  describe("BunFileSystemAdapter", () => {
    it("should export BunFileSystemAdapter class", () => {
      assertExportedFunction(BunFileSystemAdapter);
    });
  });

  describe("BunEnvironmentAdapter", () => {
    it("should export BunEnvironmentAdapter class", () => {
      assertExportedFunction(BunEnvironmentAdapter);
    });
  });

  describe("BunServerAdapter", () => {
    it("should export BunServerAdapter class", () => {
      assertExportedFunction(BunServerAdapter);
    });
  });

  describe("BunWebSocket", () => {
    it("should export BunWebSocket class", () => {
      assertExportedFunction(BunWebSocket);
    });
  });

  describe("BunServer", () => {
    it("should export BunServer class", () => {
      assertExportedFunction(BunServer);
    });
  });

  describe("createBunServer", () => {
    it("should export createBunServer function", () => {
      assertExportedFunction(createBunServer);
    });
  });
});
