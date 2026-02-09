import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCollector, parseCompileError } from "./error-collector.ts";

describe("cli/mc./error-collector", () => {
  describe("ErrorCollector", () => {
    it("should add and retrieve errors", () => {
      const ec = new ErrorCollector();
      ec.add({ type: "compile", category: "BUILD", message: "fail" });

      assertEquals(ec.count, 1);

      const first = ec.getAll()[0];
      assertExists(first);
      assertEquals(first.message, "fail");
      assertEquals(first.category, "BUILD");
      assertEquals(first.type, "compile"); // Backward compat
    });

    it("should add typed errors", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("syntax", "file.ts", 10, 5);
      ec.addRuntimeError("crash", "stack trace");
      ec.addBundleError("bundle fail", "mod.js");
      ec.addHMRError("hmr fail");
      ec.addModuleError("module fail");

      assertEquals(ec.count, 5);

      const counts = ec.countByType();
      assertEquals(counts.compile, 1);
      assertEquals(counts.runtime, 1);
      assertEquals(counts.bundle, 1);
      assertEquals(counts.hmr, 1);
      assertEquals(counts.module, 1);
    });

    it("should enforce maxErrors", () => {
      const ec = new ErrorCollector({ maxErrors: 2 });
      ec.add({ type: "compile", message: "1" });
      ec.add({ type: "compile", message: "2" });
      ec.add({ type: "compile", message: "3" });

      assertEquals(ec.count, 2);
    });

    it("should filter by type", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a");
      ec.addRuntimeError("b");

      const compiles = ec.getAll({ type: "compile" });
      assertEquals(compiles.length, 1);

      const first = compiles[0];
      assertExists(first);
      assertEquals(first.type, "compile");
    });

    it("should filter by file string", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a", "src/a.ts");
      ec.addCompileError("b", "src/b.ts");

      assertEquals(ec.getAll({ file: "src/a.ts" }).length, 1);
    });

    it("should filter by file regex", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a", "src/foo.ts");
      ec.addCompileError("b", "lib/bar.ts");

      assertEquals(ec.getAll({ file: /^src\// }).length, 1);
    });

    it("should get by id", () => {
      const ec = new ErrorCollector();
      const err = ec.add({ type: "compile", message: "test" });

      assertEquals(ec.get(err.id)?.message, "test");
      assertEquals(ec.get("nonexistent"), undefined);
    });

    it("should clear by file", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a", "src/a.ts");
      ec.addCompileError("b", "src/b.ts");

      assertEquals(ec.clearFile("src/a.ts"), 1);
      assertEquals(ec.count, 1);
    });

    it("should clear by type", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a");
      ec.addRuntimeError("b");

      assertEquals(ec.clearType("compile"), 1);
      assertEquals(ec.count, 1);
    });

    it("should clear all", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a");
      ec.addRuntimeError("b");

      ec.clear();
      assertEquals(ec.count, 0);
    });

    it("should notify subscribers", () => {
      const ec = new ErrorCollector();
      const received: string[] = [];
      const unsub = ec.subscribe((err) => received.push(err.message));

      ec.addCompileError("test");
      assertEquals(received, ["test"]);

      unsub();
      ec.addCompileError("after");
      assertEquals(received.length, 1);
    });

    it("should support slug-based error tracking", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("build failed", "src/app.ts", 10, 5, "build-failed");
      ec.addRuntimeError("render error", undefined, undefined, "render-error");

      assertEquals(ec.count, 2);

      const buildErrors = ec.getAll({ slug: "build-failed" });
      assertEquals(buildErrors.length, 1);
      assertEquals(buildErrors[0]?.slug, "build-failed");
    });

    it("should filter by category", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a"); // BUILD category
      ec.addRuntimeError("b"); // RUNTIME category

      const buildErrors = ec.getAll({ category: "BUILD" });
      assertEquals(buildErrors.length, 1);
      assertEquals(buildErrors[0]?.category, "BUILD");

      const runtimeErrors = ec.getAll({ category: "RUNTIME" });
      assertEquals(runtimeErrors.length, 1);
      assertEquals(runtimeErrors[0]?.category, "RUNTIME");
    });

    it("should count by category", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a");
      ec.addRuntimeError("b");
      ec.addHMRError("c");

      const counts = ec.countByCategory();
      assertEquals(counts.BUILD, 1); // compile → BUILD
      assertEquals(counts.RUNTIME, 1);
      assertEquals(counts.DEV, 1); // hmr → DEV
      assertEquals(counts.MODULE, 0);
    });

    it("should clear by category", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a"); // BUILD
      ec.addRuntimeError("b"); // RUNTIME

      assertEquals(ec.clearCategory("BUILD"), 1);
      assertEquals(ec.count, 1);

      const remaining = ec.getAll();
      assertEquals(remaining[0]?.category, "RUNTIME");
    });

    it("should auto-compute category from type for backward compat", () => {
      const ec = new ErrorCollector();
      ec.add({ type: "compile", message: "test" });

      const first = ec.getAll()[0];
      assertExists(first);
      assertEquals(first.category, "BUILD"); // Auto-computed
      assertEquals(first.type, "compile");
    });

    it("should auto-compute type from category for backward compat", () => {
      const ec = new ErrorCollector();
      ec.add({ category: "RUNTIME", type: "runtime", message: "test" });

      const first = ec.getAll()[0];
      assertExists(first);
      assertEquals(first.type, "runtime");
      assertEquals(first.category, "RUNTIME");
    });
  });

  describe("parseCompileError", () => {
    it("should parse TypeScript error format", () => {
      const result = parseCompileError(
        "src/app.ts(10,5): error TS2304: Cannot find name",
      );

      assertEquals(result?.type, "compile");
      assertEquals(result?.category, "BUILD");
      assertEquals(result?.file, "src/app.ts");
      assertEquals(result?.line, 10);
      assertEquals(result?.column, 5);
    });

    it("should parse esbuild error format", () => {
      const result = parseCompileError("ERROR: [mod.js:5:12] Unexpected token");

      assertEquals(result?.type, "bundle");
      assertEquals(result?.category, "BUILD");
      assertEquals(result?.file, "mod.js");
      assertEquals(result?.line, 5);
    });

    it("should parse generic error messages", () => {
      const result = parseCompileError("Some error occurred");

      assertEquals(result?.type, "compile");
      assertEquals(result?.category, "BUILD");
      assertEquals(result?.message, "Some error occurred");
    });

    it("should return null for non-error output", () => {
      assertEquals(parseCompileError("all good"), null);
    });
  });
});
