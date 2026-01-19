import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { NodeAdapter, nodeAdapter } from "./adapter.ts";

describe("NodeAdapter", () => {
  describe("class", () => {
    it("should export NodeAdapter class", () => {
      assertExists(NodeAdapter);
      assertEquals(typeof NodeAdapter, "function");
    });

    it("should export nodeAdapter singleton", () => {
      assertExists(nodeAdapter);
      assertEquals(nodeAdapter instanceof NodeAdapter, true);
    });
  });

  describe("instance", () => {
    it("should be instantiable", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter);
    });

    it("should have id property", () => {
      const adapter = new NodeAdapter();
      assertEquals(adapter.id, "node");
    });

    it("should have name property", () => {
      const adapter = new NodeAdapter();
      assertEquals(adapter.name, "node");
    });

    it("should have fs adapter", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter.fs);
    });

    it("should have env adapter", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter.env);
    });

    it("should have server adapter", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter.server);
    });

    it("should have shell adapter", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter.shell);
    });

    it("should have capabilities", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter.capabilities);
      assertEquals(adapter.capabilities.typescript, false);
      assertEquals(adapter.capabilities.jsx, false);
      assertEquals(adapter.capabilities.http2, true);
      assertEquals(adapter.capabilities.websocket, true);
      assertEquals(adapter.capabilities.workers, true);
      assertEquals(adapter.capabilities.fileWatching, true);
      assertEquals(adapter.capabilities.shell, true);
      assertEquals(adapter.capabilities.writableFs, true);
    });

    it("should have serve method", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter.serve);
      assertEquals(typeof adapter.serve, "function");
    });

    it("should have shutdown method", () => {
      const adapter = new NodeAdapter();
      assertExists(adapter.shutdown);
      assertEquals(typeof adapter.shutdown, "function");
    });
  });
});
