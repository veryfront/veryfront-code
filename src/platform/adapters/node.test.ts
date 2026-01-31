import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeAdapter, nodeAdapter, NodeEnvironmentAdapter, NodeFileSystemAdapter } from "./node.ts";

describe("node.ts exports", () => {
  it("exports NodeAdapter class and it is instantiable", () => {
    assertEquals(typeof NodeAdapter, "function");
    assertExists(new NodeAdapter());
  });

  describe("nodeAdapter singleton", () => {
    it("exports nodeAdapter instance", () => {
      assertExists(nodeAdapter);
    });

    it("has correct id and name", () => {
      assertEquals(nodeAdapter.id, "node");
      assertEquals(nodeAdapter.name, "node");
    });

    it("has fs adapter", () => {
      assertExists(nodeAdapter.fs?.readFile);
      assertExists(nodeAdapter.fs?.writeFile);
      assertExists(nodeAdapter.fs?.exists);
    });

    it("has env adapter", () => {
      assertExists(nodeAdapter.env?.get);
      assertExists(nodeAdapter.env?.set);
      assertExists(nodeAdapter.env?.toObject);
    });

    it("has capabilities", () => {
      assertEquals(nodeAdapter.capabilities.typescript, false);
      assertEquals(nodeAdapter.capabilities.jsx, false);
      assertEquals(nodeAdapter.capabilities.websocket, true);
      assertEquals(nodeAdapter.capabilities.http2, true);
    });

    it("has serve method", () => {
      assertEquals(typeof nodeAdapter.serve, "function");
    });
  });

  it("exports NodeEnvironmentAdapter class", () => {
    assertEquals(typeof NodeEnvironmentAdapter, "function");
  });

  it("exports NodeFileSystemAdapter class", () => {
    assertEquals(typeof NodeFileSystemAdapter, "function");
  });
});
