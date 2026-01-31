import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createNodeServer,
  NodeAdapter,
  nodeAdapter,
  NodeEnvironmentAdapter,
  NodeFileSystemAdapter,
  NodeServer,
  NodeServerAdapter,
  NodeWebSocket,
} from "./index.ts";

function assertExportedFunction(value: unknown): void {
  assertExists(value);
  assertEquals(typeof value, "function");
}

describe("runtime/node/index.ts exports", () => {
  it("should export NodeAdapter class", () => {
    assertExportedFunction(NodeAdapter);
  });

  it("should export nodeAdapter singleton", () => {
    assertExists(nodeAdapter);
    assertEquals(nodeAdapter.id, "node");
    assertEquals(nodeAdapter.name, "node");
  });

  it("should export NodeFileSystemAdapter class", () => {
    assertExportedFunction(NodeFileSystemAdapter);
  });

  it("should export NodeEnvironmentAdapter class", () => {
    assertExportedFunction(NodeEnvironmentAdapter);
  });

  it("should export NodeServerAdapter class", () => {
    assertExportedFunction(NodeServerAdapter);
  });

  it("should export NodeWebSocket class", () => {
    assertExportedFunction(NodeWebSocket);
  });

  it("should export NodeServer class", () => {
    assertExportedFunction(NodeServer);
  });

  it("should export createNodeServer function", () => {
    assertExportedFunction(createNodeServer);
  });
});
