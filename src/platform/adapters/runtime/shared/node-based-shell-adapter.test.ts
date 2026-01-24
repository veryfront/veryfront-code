import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeBasedShellAdapter } from "./node-based-shell-adapter.ts";

function createAdapter(): NodeBasedShellAdapter {
  return new NodeBasedShellAdapter();
}

describe("NodeBasedShellAdapter", () => {
  describe("class", () => {
    it("should export NodeBasedShellAdapter class", () => {
      assertExists(NodeBasedShellAdapter);
      assertEquals(typeof NodeBasedShellAdapter, "function");
    });

    it("should be instantiable", () => {
      const adapter = createAdapter();
      assertExists(adapter);
    });
  });

  describe("statSync", () => {
    it("should have statSync method", () => {
      const adapter = createAdapter();
      assertExists(adapter.statSync);
      assertEquals(typeof adapter.statSync, "function");
    });

    it("should stat existing directory", () => {
      const adapter = createAdapter();
      const result = adapter.statSync(".");
      assertEquals(result.isDirectory, true);
      assertEquals(result.isFile, false);
    });

    it("should stat existing file", () => {
      const adapter = createAdapter();
      const result = adapter.statSync("./deno.json");
      assertEquals(result.isFile, true);
      assertEquals(result.isDirectory, false);
    });

    it("should throw for non-existent path", () => {
      const adapter = createAdapter();
      assertThrows(() => adapter.statSync("./non-existent-file-12345.txt"), Error);
    });
  });

  describe("readFileSync", () => {
    it("should have readFileSync method", () => {
      const adapter = createAdapter();
      assertExists(adapter.readFileSync);
      assertEquals(typeof adapter.readFileSync, "function");
    });

    it("should read existing file", () => {
      const adapter = createAdapter();
      const content = adapter.readFileSync("./deno.json");
      assertEquals(typeof content, "string");
      assertEquals(content.length > 0, true);
    });

    it("should throw for non-existent file", () => {
      const adapter = createAdapter();
      assertThrows(() => adapter.readFileSync("./non-existent-file-12345.txt"), Error);
    });
  });
});
