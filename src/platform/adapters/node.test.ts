import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeAdapter, nodeAdapter, NodeEnvironmentAdapter, NodeFileSystemAdapter } from "./node.ts";

describe("node.ts exports", () => {
  it("exports NodeAdapter class and it is instantiable", () => {
    assertExists(NodeAdapter);
    assertEquals(typeof NodeAdapter, "function");

    const adapter = new NodeAdapter();
    assertExists(adapter);
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
      assertExists(nodeAdapter.fs);
      assertExists(nodeAdapter.fs.readFile);
      assertExists(nodeAdapter.fs.writeFile);
      assertExists(nodeAdapter.fs.exists);
    });

    it("has env adapter", () => {
      assertExists(nodeAdapter.env);
      assertExists(nodeAdapter.env.get);
      assertExists(nodeAdapter.env.set);
      assertExists(nodeAdapter.env.toObject);
    });

    it("has capabilities", () => {
      assertExists(nodeAdapter.capabilities);
      assertEquals(nodeAdapter.capabilities.typescript, false);
      assertEquals(nodeAdapter.capabilities.jsx, false);
      assertEquals(nodeAdapter.capabilities.websocket, true);
      assertEquals(nodeAdapter.capabilities.http2, true);
    });

    it("has serve method", () => {
      assertExists(nodeAdapter.serve);
      assertEquals(typeof nodeAdapter.serve, "function");
    });
  });

  it("exports NodeEnvironmentAdapter class", () => {
    assertExists(NodeEnvironmentAdapter);
    assertEquals(typeof NodeEnvironmentAdapter, "function");
  });

  it("exports NodeFileSystemAdapter class", () => {
    assertExists(NodeFileSystemAdapter);
    assertEquals(typeof NodeFileSystemAdapter, "function");
  });
});
