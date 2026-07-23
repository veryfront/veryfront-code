import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeBasedShellAdapter } from "./node-based-shell-adapter.ts";
import { VeryfrontError } from "#veryfront/errors";

function createAdapter(): NodeBasedShellAdapter {
  return new NodeBasedShellAdapter();
}

function captureError(operation: () => unknown): VeryfrontError {
  try {
    operation();
  } catch (error) {
    if (error instanceof VeryfrontError) return error;
    throw error;
  }
  throw new Error("Expected operation to throw");
}

describe("NodeBasedShellAdapter", () => {
  it("should export NodeBasedShellAdapter class", () => {
    assertExists(NodeBasedShellAdapter);
    assertEquals(typeof NodeBasedShellAdapter, "function");
  });

  it("should be instantiable", () => {
    assertExists(createAdapter());
  });

  describe("statSync", () => {
    it("should have statSync method", () => {
      const adapter = createAdapter();
      assertExists(adapter.statSync);
      assertEquals(typeof adapter.statSync, "function");
    });

    it("should stat existing directory", () => {
      const result = createAdapter().statSync(".");
      assertEquals(result.isDirectory, true);
      assertEquals(result.isFile, false);
    });

    it("should stat existing file", () => {
      const result = createAdapter().statSync("./deno.json");
      assertEquals(result.isFile, true);
      assertEquals(result.isDirectory, false);
    });

    it("should throw for non-existent path", () => {
      const path = "./non-existent-file-12345.txt";
      const error = captureError(() => createAdapter().statSync(path));
      assertEquals(error.slug, "file-not-found");
      assertEquals(error.message.includes(path), false);
    });
  });

  describe("readFileSync", () => {
    it("should have readFileSync method", () => {
      const adapter = createAdapter();
      assertExists(adapter.readFileSync);
      assertEquals(typeof adapter.readFileSync, "function");
    });

    it("should read existing file", () => {
      const content = createAdapter().readFileSync("./deno.json");
      assertEquals(typeof content, "string");
      assertEquals(content.length > 0, true);
    });

    it("should throw for non-existent file", () => {
      const path = "./non-existent-file-12345.txt";
      const error = captureError(() => createAdapter().readFileSync(path));
      assertEquals(error.slug, "file-not-found");
      assertEquals(error.message.includes(path), false);
    });
  });
});
