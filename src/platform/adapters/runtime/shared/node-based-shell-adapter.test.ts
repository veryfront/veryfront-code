import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NodeBasedShellAdapter } from "./node-based-shell-adapter.ts";

function captureNodeError(operation: () => unknown): NodeJS.ErrnoException {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  if (!(captured instanceof Error)) throw new TypeError("Expected operation to throw");
  return captured as NodeJS.ErrnoException;
}

function createAdapter(): NodeBasedShellAdapter {
  return new NodeBasedShellAdapter();
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
      const error = captureNodeError(
        () => createAdapter().statSync("./non-existent-file-12345.txt"),
      );
      assertEquals(error.code, "ENOENT");
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

      assertEquals(typeof content, "string", "readFileSync must return decoded text");
      assertEquals(
        JSON.parse(content).name,
        "veryfront",
        "readFileSync must decode the file as UTF-8 JSON text, not bytes",
      );
    });

    it("should throw for non-existent file", () => {
      const error = captureNodeError(
        () => createAdapter().readFileSync("./non-existent-file-12345.txt"),
      );
      assertEquals(error.code, "ENOENT");
    });
  });
});
