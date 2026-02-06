import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert";
import { BuildError, CompilationError } from "./build-errors.ts";
import { VeryfrontError } from "./types.ts";

describe("build-errors", () => {
  describe("BuildError", () => {
    it("should create error with correct slug", () => {
      const error = new BuildError("Build failed");
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.name, "BuildError");
      assertEquals(error.slug, "build-failed");
      assertEquals(error.message, "Build failed");
    });

    it("should include context", () => {
      const error = new BuildError("Build failed", { file: "index.ts" });
      assertEquals((error.context as { file?: string } | undefined)?.file, "index.ts");
    });
  });

  describe("CompilationError", () => {
    it("should create error with correct slug", () => {
      const error = new CompilationError("Compilation failed");
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.name, "CompilationError");
      assertEquals(error.slug, "compilation-error");
      assertEquals(error.message, "Compilation failed");
    });

    it("should include context", () => {
      const error = new CompilationError("Syntax error", { line: 42 });
      assertEquals((error.context as { line?: number } | undefined)?.line, 42);
    });
  });
});
