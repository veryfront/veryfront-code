import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { build, getEsbuild, initializeEsbuild, stop, transform } from "./esbuild.ts";

// esbuild starts a child process that lives across tests, so we disable sanitizers
describe("platform/compat/esbuild", { sanitizeOps: false, sanitizeResources: false }, () => {
  describe("getEsbuild", () => {
    it("should return the esbuild module", async () => {
      const esbuild = await getEsbuild();
      assertExists(esbuild);
      assertEquals(typeof esbuild.transform, "function");
      assertEquals(typeof esbuild.build, "function");
      assertEquals(typeof esbuild.stop, "function");
    });

    it("should return same module on subsequent calls", async () => {
      const esbuild1 = await getEsbuild();
      const esbuild2 = await getEsbuild();
      assertEquals(esbuild1, esbuild2);
    });
  });

  describe("transform", () => {
    it("should transform TypeScript code", async () => {
      const result = await transform("const x: number = 1;", { loader: "ts" });
      assertExists(result);
      assertExists(result.code);
      assertEquals(result.code.includes(": number"), false);
      assertEquals(result.code.includes("1"), true);
    });

    it("should transform TSX code", async () => {
      const result = await transform(
        "const App = () => <div>Hello</div>;",
        { loader: "tsx", jsx: "automatic", jsxImportSource: "react" },
      );
      assertExists(result.code);
      assertEquals(result.code.includes("<div>"), false);
    });
  });

  describe("build", () => {
    it("should accept build options", async () => {
      // build with stdin is a quick way to test without files
      const result = await build({
        stdin: { contents: "export const x = 1;", loader: "ts" },
        write: false,
        bundle: false,
      });
      assertExists(result);
      assertExists(result.outputFiles);
      assertEquals(result.outputFiles!.length > 0, true);
    });
  });

  describe("stop", () => {
    it("should stop esbuild without error", async () => {
      await stop();
    });
  });

  describe("initializeEsbuild", () => {
    it("should initialize without error", async () => {
      await initializeEsbuild();
    });

    it("should be idempotent", async () => {
      await initializeEsbuild();
      await initializeEsbuild();
    });
  });
});
