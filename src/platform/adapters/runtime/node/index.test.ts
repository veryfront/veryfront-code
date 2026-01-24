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
  describe("NodeAdapter", () => {
    it("should export NodeAdapter class", () => {
      assertExportedFunction(NodeAdapter);
    });

    it("should export nodeAdapter singleton", () => {
      assertExists(nodeAdapter);
      assertEquals(nodeAdapter.id, "node");
      assertEquals(nodeAdapter.name, "node");
    });
  });

  describe("NodeFileSystemAdapter", () => {
    it("should export NodeFileSystemAdapter class", () => {
      assertExportedFunction(NodeFileSystemAdapter);
    });
  });

  describe("NodeEnvironmentAdapter", () => {
    it("should export NodeEnvironmentAdapter class", () => {
      assertExportedFunction(NodeEnvironmentAdapter);
    });
  });

  describe("NodeServerAdapter", () => {
    it("should export NodeServerAdapter class", () => {
      assertExportedFunction(NodeServerAdapter);
    });
  });

  describe("NodeWebSocket", () => {
    it("should export NodeWebSocket class", () => {
      assertExportedFunction(NodeWebSocket);
    });
  });

  describe("NodeServer", () => {
    it("should export NodeServer class", () => {
      assertExportedFunction(NodeServer);
    });
  });

  describe("createNodeServer", () => {
    it("should export createNodeServer function", () => {
      assertExportedFunction(createNodeServer);
    });
  });
});
