import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "esbuild";
import { transpileCode } from "./transpiler.ts";

describe(
  "build/compiler/mdx-compiler/transpiler",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      if ((globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) return;
      await esbuild.stop();
    });

    describe("transpileCode", () => {
      it("should transpile JSX code in development mode", async () => {
        const code = `const el = <div>Hello</div>;`;
        const result = await transpileCode(code, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        assertStringIncludes(result, "jsx");
      });

      it("should transpile JSX code in production mode", async () => {
        const code = `const el = <div>Hello</div>;`;
        const result = await transpileCode(code, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "production",
        });
        // Production should minify
        assertEquals(result.includes("\n\n"), false);
      });

      it("should output ESM format", async () => {
        const code = `export const Comp = () => <span>test</span>;`;
        const result = await transpileCode(code, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        // ESM uses export
        assertStringIncludes(result, "export");
      });

      it("should handle empty code", async () => {
        const result = await transpileCode("", {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        assertEquals(result.trim(), "");
      });

      it("should use automatic JSX runtime", async () => {
        const code = `const el = <div className="test">Hello</div>;`;
        const result = await transpileCode(code, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        // automatic runtime imports jsx from react/jsx-runtime
        assertStringIncludes(result, "react/jsx-runtime");
      });

      it("should handle multiple JSX elements", async () => {
        const code = `
          const a = <div>A</div>;
          const b = <span>B</span>;
          const c = <p>C</p>;
        `;
        const result = await transpileCode(code, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        assertStringIncludes(result, "react/jsx-runtime");
      });

      it("should handle plain JS without JSX", async () => {
        const code = `const x = 42; export default x;`;
        const result = await transpileCode(code, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        assertStringIncludes(result, "42");
      });
    });
  },
);
