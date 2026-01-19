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

describe("runtime/node/index.ts exports", () => {
  describe("NodeAdapter", () => {
    it("should export NodeAdapter class", () => {
      assertExists(NodeAdapter);
      assertEquals(typeof NodeAdapter, "function");
    });

    it("should export nodeAdapter singleton", () => {
      assertExists(nodeAdapter);
      assertEquals(nodeAdapter.id, "node");
      assertEquals(nodeAdapter.name, "node");
    });
  });

  describe("NodeFileSystemAdapter", () => {
    it("should export NodeFileSystemAdapter class", () => {
      assertExists(NodeFileSystemAdapter);
      assertEquals(typeof NodeFileSystemAdapter, "function");
    });
  });

  describe("NodeEnvironmentAdapter", () => {
    it("should export NodeEnvironmentAdapter class", () => {
      assertExists(NodeEnvironmentAdapter);
      assertEquals(typeof NodeEnvironmentAdapter, "function");
    });
  });

  describe("NodeServerAdapter", () => {
    it("should export NodeServerAdapter class", () => {
      assertExists(NodeServerAdapter);
      assertEquals(typeof NodeServerAdapter, "function");
    });
  });

  describe("NodeWebSocket", () => {
    it("should export NodeWebSocket class", () => {
      assertExists(NodeWebSocket);
      assertEquals(typeof NodeWebSocket, "function");
    });
  });

  describe("NodeServer", () => {
    it("should export NodeServer class", () => {
      assertExists(NodeServer);
      assertEquals(typeof NodeServer, "function");
    });
  });

  describe("createNodeServer", () => {
    it("should export createNodeServer function", () => {
      assertExists(createNodeServer);
      assertEquals(typeof createNodeServer, "function");
    });
  });
});
