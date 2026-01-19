import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeAdapter, nodeAdapter, NodeEnvironmentAdapter, NodeFileSystemAdapter } from "./node.ts";

describe("node.ts exports", () => {
  describe("NodeAdapter class", () => {
    it("should export NodeAdapter class", () => {
      assertExists(NodeAdapter);
      assertEquals(typeof NodeAdapter, "function");
    });

    it("should be instantiable", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter);
    });
  });

  describe("nodeAdapter singleton", () => {
    it("should export nodeAdapter instance", () => {
      assertExists(nodeAdapter);
    });

    it("should have correct id", () => {
      assertEquals(nodeAdapter.id, "node");
    });

    it("should have correct name", () => {
      assertEquals(nodeAdapter.name, "node");
    });

    it("should have fs adapter", () => {
      assertExists(nodeAdapter.fs);
      assertExists(nodeAdapter.fs.readFile);
      assertExists(nodeAdapter.fs.writeFile);
      assertExists(nodeAdapter.fs.exists);
    });

    it("should have env adapter", () => {
      assertExists(nodeAdapter.env);
      assertExists(nodeAdapter.env.get);
      assertExists(nodeAdapter.env.set);
      assertExists(nodeAdapter.env.toObject);
    });

    it("should have capabilities", () => {
      assertExists(nodeAdapter.capabilities);
      assertEquals(nodeAdapter.capabilities.typescript, false);
      assertEquals(nodeAdapter.capabilities.jsx, false);
      assertEquals(nodeAdapter.capabilities.websocket, true);
      assertEquals(nodeAdapter.capabilities.http2, true);
    });

    it("should have serve method", () => {
      assertExists(nodeAdapter.serve);
      assertEquals(typeof nodeAdapter.serve, "function");
    });
  });

  describe("NodeEnvironmentAdapter", () => {
    it("should export NodeEnvironmentAdapter class", () => {
      assertExists(NodeEnvironmentAdapter);
      assertEquals(typeof NodeEnvironmentAdapter, "function");
    });
  });

  describe("NodeFileSystemAdapter", () => {
    it("should export NodeFileSystemAdapter class", () => {
      assertExists(NodeFileSystemAdapter);
      assertEquals(typeof NodeFileSystemAdapter, "function");
    });
  });
});
