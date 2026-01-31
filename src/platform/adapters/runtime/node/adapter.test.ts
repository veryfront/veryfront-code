import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeAdapter, nodeAdapter } from "./adapter.ts";

function createAdapter(): NodeAdapter {
  return new NodeAdapter();
}

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
      assertExists(createAdapter());
    });

    it("should have id property", () => {
      assertEquals(createAdapter().id, "node");
    });

    it("should have name property", () => {
      assertEquals(createAdapter().name, "node");
    });

    it("should have fs adapter", () => {
      assertExists(createAdapter().fs);
    });

    it("should have env adapter", () => {
      assertExists(createAdapter().env);
    });

    it("should have server adapter", () => {
      assertExists(createAdapter().server);
    });

    it("should have shell adapter", () => {
      assertExists(createAdapter().shell);
    });

    it("should have capabilities", () => {
      const { capabilities } = createAdapter();
      assertExists(capabilities);
      assertEquals(capabilities.typescript, false);
      assertEquals(capabilities.jsx, false);
      assertEquals(capabilities.http2, true);
      assertEquals(capabilities.websocket, true);
      assertEquals(capabilities.workers, true);
      assertEquals(capabilities.fileWatching, true);
      assertEquals(capabilities.shell, true);
      assertEquals(capabilities.writableFs, true);
    });

    it("should have serve method", () => {
      const { serve } = createAdapter();
      assertExists(serve);
      assertEquals(typeof serve, "function");
    });

    it("should have shutdown method", () => {
      const { shutdown } = createAdapter();
      assertExists(shutdown);
      assertEquals(typeof shutdown, "function");
    });
  });
});
