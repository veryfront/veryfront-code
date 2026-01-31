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
  it("should export BunAdapter class", () => {
    assertExportedFunction(BunAdapter);
  });

  it("should export bunAdapter singleton", () => {
    assertExists(bunAdapter);
    assertEquals(bunAdapter.id, "bun");
    assertEquals(bunAdapter.name, "bun");
  });

  it("should export BunFileSystemAdapter class", () => {
    assertExportedFunction(BunFileSystemAdapter);
  });

  it("should export BunEnvironmentAdapter class", () => {
    assertExportedFunction(BunEnvironmentAdapter);
  });

  it("should export BunServerAdapter class", () => {
    assertExportedFunction(BunServerAdapter);
  });

  it("should export BunWebSocket class", () => {
    assertExportedFunction(BunWebSocket);
  });

  it("should export BunServer class", () => {
    assertExportedFunction(BunServer);
  });

  it("should export createBunServer function", () => {
    assertExportedFunction(createBunServer);
  });
});
