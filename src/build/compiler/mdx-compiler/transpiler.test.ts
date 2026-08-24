import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import * as esbuild from "veryfront/extensions/bundler";
import { transpileCode } from "./transpiler.ts";

describe(
  "build/compiler/mdx-compiler/transpiler",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
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
        const options = { projectDir: "/tmp", outputDir: "/tmp/out" };
        const dev = await transpileCode(code, { ...options, mode: "development" });
        const prod = await transpileCode(code, { ...options, mode: "production" });

        assertEquals(prod.length < dev.length, true, "production must minify");
        assertEquals(
          prod.includes(" = "),
          false,
          "minified output must not keep declaration spacing",
        );
        assertEquals(
          prod.includes("{ children"),
          false,
          "minified output must not keep object spacing",
        );
        assertStringIncludes(
          dev,
          "const el = /* @__PURE__ */",
          "development output must stay unminified",
        );
      });

      it("should output ESM format", async () => {
        const code = `export const Comp = () => <span>test</span>;`;
        const result = await transpileCode(code, {
          projectDir: "/tmp",
          outputDir: "/tmp/out",
          mode: "development",
        });
        assertStringIncludes(result, "export {", "must emit an ESM export clause");
        assertStringIncludes(
          result,
          'import { jsx } from "react/jsx-runtime"',
          "ESM output imports the JSX runtime rather than requiring it",
        );
        assertEquals(result.includes("module.exports"), false, "must not emit CommonJS");
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
