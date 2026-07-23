import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorCollector, parseCompileError } from "./error-collector.ts";

describe("cli/mc./error-collector", () => {
  describe("ErrorCollector", () => {
    it("should reject invalid maxErrors values", () => {
      assertThrows(() => new ErrorCollector({ maxErrors: -1 }), RangeError, "maxErrors");
      assertThrows(() => new ErrorCollector({ maxErrors: 1.5 }), RangeError, "maxErrors");
      assertThrows(
        () => new ErrorCollector({ maxErrors: Number.NaN }),
        RangeError,
        "maxErrors",
      );
    });

    it("should support a zero-sized collector without retaining errors", () => {
      const ec = new ErrorCollector({ maxErrors: 0 });
      const received: string[] = [];
      ec.subscribe((error) => received.push(error.message));

      const error = ec.addRuntimeError("reported");

      assertEquals(error.message, "reported");
      assertEquals(received, ["reported"]);
      assertEquals(ec.count, 0);
    });

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

    it("should preserve file, context, and slug metadata for file-context error helpers", () => {
      const ec = new ErrorCollector();
      const sharedContext = { source: "dev-server" };

      ec.addBundleError("bundle fail", "bundle.ts", sharedContext, "bundle-failed");
      ec.addHMRError("hmr fail", "hmr.ts", sharedContext, "hmr-failed");
      ec.addModuleError("module fail", "module.ts", sharedContext, "module-failed");

      assertEquals(
        ec.getAll({ type: "bundle" }).map((error) => ({
          file: error.file,
          context: error.context,
          slug: error.slug,
          category: error.category,
        })),
        [{
          file: "bundle.ts",
          context: sharedContext,
          slug: "bundle-failed",
          category: "BUILD",
        }],
      );

      assertEquals(
        ec.getAll({ type: "hmr" }).map((error) => ({
          file: error.file,
          context: error.context,
          slug: error.slug,
          category: error.category,
        })),
        [{
          file: "hmr.ts",
          context: sharedContext,
          slug: "hmr-failed",
          category: "DEV",
        }],
      );

      assertEquals(
        ec.getAll({ type: "module" }).map((error) => ({
          file: error.file,
          context: error.context,
          slug: error.slug,
          category: error.category,
        })),
        [{
          file: "module.ts",
          context: sharedContext,
          slug: "module-failed",
          category: "MODULE",
        }],
      );
    });

    it("should enforce maxErrors", () => {
      const ec = new ErrorCollector({ maxErrors: 2 });
      ec.add({ type: "compile", category: "BUILD", message: "1" });
      ec.add({ type: "compile", category: "BUILD", message: "2" });
      ec.add({ type: "compile", category: "BUILD", message: "3" });

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

    it("should filter deterministically with stateful file regex patterns", () => {
      const ec = new ErrorCollector();
      ec.addCompileError("a", "src/a.ts");
      ec.addCompileError("b", "src/b.ts");
      const pattern = /^src\//g;

      assertEquals(ec.getAll({ file: pattern }).length, 2);
      assertEquals(ec.getAll({ file: pattern }).length, 2);
    });

    it("should redact retained error details without mutating caller context", () => {
      const ec = new ErrorCollector();
      const context = { apiKey: "secret", safe: "value" };

      const error = ec.addRuntimeError(
        "failed https://user:password@example.test/path?access_token=secret",
        "at https://example.test/path?token=secret",
        context,
      );

      assertEquals(error.message.includes("secret"), false);
      assertEquals(error.stack?.includes("secret"), false);
      assertEquals(error.context, { apiKey: "[REDACTED]", safe: "value" });
      assertEquals(context.apiKey, "secret");
    });

    it("should not expose retained errors to caller or subscriber mutation", () => {
      const ec = new ErrorCollector();
      ec.subscribe((error) => {
        error.message = "subscriber mutation";
        if (error.context) error.context.value = "subscriber mutation";
      });

      const returned = ec.addRuntimeError("original", undefined, { value: "original" });
      returned.message = "caller mutation";
      if (returned.context) returned.context.value = "caller mutation";

      const retained = ec.get(returned.id);
      assertExists(retained);
      assertEquals(retained.message, "original");
      assertEquals(retained.context?.value, "original");

      retained.message = "query mutation";
      assertEquals(ec.get(returned.id)?.message, "original");
    });

    it("detaches structured Date and URL context for every observer", () => {
      const ec = new ErrorCollector();
      const date = new Date("2025-01-02T03:04:05.000Z");
      const url = new URL("https://user:password@example.test/path?token=secret");
      let subscriberDate: Date | undefined;
      ec.subscribe((error) => {
        subscriberDate = error.context?.date as Date;
        subscriberDate.setUTCFullYear(2030);
      });

      const returned = ec.addRuntimeError("structured", undefined, { date, url });
      (returned.context?.date as Date).setUTCFullYear(2040);
      (returned.context?.url as URL).pathname = "/mutated";

      const retained = ec.get(returned.id)?.context;
      assertEquals((retained?.date as Date).getUTCFullYear(), 2025);
      assertEquals((retained?.url as URL).pathname, "/path");
      assertEquals((retained?.url as URL).href.includes("secret"), false);
      assertEquals(date.getUTCFullYear(), 2025);
      assertEquals(subscriberDate?.getUTCFullYear(), 2030);
    });

    it("should get by id", () => {
      const ec = new ErrorCollector();
      const err = ec.add({ type: "compile", category: "BUILD", message: "test" });

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

    it("should require explicit type and category", () => {
      const ec = new ErrorCollector();
      ec.add({ type: "compile", category: "BUILD", message: "test" });

      const first = ec.getAll()[0];
      assertExists(first);
      assertEquals(first.category, "BUILD");
      assertEquals(first.type, "compile");
    });

    it("should reject mismatched type/category pairs", () => {
      const ec = new ErrorCollector();
      assertThrows(
        () => ec.add({ category: "RUNTIME", type: "compile", message: "test" }),
        Error,
        "mismatched type/category",
      );
    });

    it("rejects unknown runtime types before category lookup", () => {
      const ec = new ErrorCollector();

      assertThrows(
        () =>
          ec.add({
            category: undefined,
            type: "__proto__",
            message: "invalid",
          } as never),
        Error,
        "invalid error type",
      );

      assertEquals(ec.count, 0);
    });

    it("does not create NaN buckets from legacy malformed entries", () => {
      const ec = new ErrorCollector();
      const internal = ec as unknown as {
        errors: Map<string, { type: string; category: string }>;
      };
      internal.errors.set("legacy-invalid", {
        type: "unknown",
        category: "unknown",
      });

      const typeCounts = ec.countByType();
      const categoryCounts = ec.countByCategory();
      assertEquals(Object.values(typeCounts).every(Number.isFinite), true);
      assertEquals(Object.values(categoryCounts).every(Number.isFinite), true);
      assertEquals(Object.hasOwn(typeCounts, "unknown"), false);
      assertEquals(Object.hasOwn(categoryCounts, "unknown"), false);
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
