import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bundleCss, extractCssVariables, processCssImports } from "./css-bundler.ts";
import type { BundleResult } from "../types/bundler-types.ts";

function createBundleResult(): BundleResult {
  return {
    outputs: new Map(),
    dependencies: new Map(),
    errors: [],
    warnings: [],
  };
}

describe("build/renderer/services/css-bundler", () => {
  describe("bundleCss", () => {
    it("should add CSS to result outputs", () => {
      const result = createBundleResult();
      bundleCss(
        { path: "style.css", content: "body { color: red; }" },
        { mode: "development", projectDir: "/tmp", external: [] },
        result,
      );
      assertEquals(result.outputs.has("style.css"), true);
      const output = result.outputs.get("style.css")!;
      assertEquals(output.content, "body { color: red; }");
      assertEquals(output.type, "css");
    });

    it("should minify CSS in production mode", () => {
      const result = createBundleResult();
      bundleCss(
        { path: "style.css", content: "body {\n  color: red;\n  /* comment */\n}" },
        { mode: "production", projectDir: "/tmp", external: [] },
        result,
      );
      const output = result.outputs.get("style.css")!;
      // Should remove comments and extra whitespace
      assertEquals(output.content.includes("/* comment */"), false);
      assertEquals(output.content.includes("\n"), false);
    });

    it("should not minify CSS in development mode", () => {
      const result = createBundleResult();
      const css = "body {\n  color: red;\n  /* comment */\n}";
      bundleCss(
        { path: "style.css", content: css },
        { mode: "development", projectDir: "/tmp", external: [] },
        result,
      );
      const output = result.outputs.get("style.css")!;
      assertEquals(output.content, css);
    });

    it("should handle empty CSS", () => {
      const result = createBundleResult();
      bundleCss(
        { path: "empty.css", content: "" },
        { mode: "production", projectDir: "/tmp", external: [] },
        result,
      );
      assertEquals(result.outputs.has("empty.css"), true);
      assertEquals(result.outputs.get("empty.css")!.content, "");
    });

    it("should minify url() quotes in production", () => {
      const result = createBundleResult();
      bundleCss(
        { path: "bg.css", content: 'body { background: url("image.png"); }' },
        { mode: "production", projectDir: "/tmp", external: [] },
        result,
      );
      const output = result.outputs.get("bg.css")!;
      assertEquals(output.content.includes("url(image.png)"), true);
    });

    it("should remove trailing semicolons before closing braces in production", () => {
      const result = createBundleResult();
      bundleCss(
        { path: "s.css", content: "div { color: red; }" },
        { mode: "production", projectDir: "/tmp", external: [] },
        result,
      );
      const output = result.outputs.get("s.css")!;
      assertEquals(output.content.includes(";}"), false);
    });
  });

  describe("processCssImports", () => {
    it("should return CSS as-is (no-op)", () => {
      const css = '@import "other.css"; body { color: red; }';
      assertEquals(processCssImports(css, "/path/to/file.css"), css);
    });

    it("should handle empty string", () => {
      assertEquals(processCssImports("", "/path"), "");
    });
  });

  describe("extractCssVariables", () => {
    it("should extract CSS custom properties", () => {
      const css = `:root {
        --primary-color: #ff0000;
        --font-size: 16px;
        --spacing: 8px;
      }`;
      const vars = extractCssVariables(css);
      assertEquals(vars["primary-color"], "#ff0000");
      assertEquals(vars["font-size"], "16px");
      assertEquals(vars["spacing"], "8px");
    });

    it("should handle empty CSS", () => {
      const vars = extractCssVariables("");
      assertEquals(Object.keys(vars).length, 0);
    });

    it("should handle CSS without variables", () => {
      const vars = extractCssVariables("body { color: red; }");
      assertEquals(Object.keys(vars).length, 0);
    });

    it("should handle variables with complex values", () => {
      const css = `
        --bg-gradient: linear-gradient(to right, #000, #fff);
        --font-stack: 'Helvetica Neue', Arial, sans-serif;
      `;
      const vars = extractCssVariables(css);
      assertEquals(vars["bg-gradient"], "linear-gradient(to right, #000, #fff)");
      assertEquals(vars["font-stack"], "'Helvetica Neue', Arial, sans-serif");
    });

    it("should handle multiple declarations of same variable (last wins)", () => {
      const css = `
        --color: red;
        --color: blue;
      `;
      const vars = extractCssVariables(css);
      assertEquals(vars["color"], "blue");
    });

    it("should trim whitespace from values", () => {
      const css = `--padding:   12px  ;`;
      const vars = extractCssVariables(css);
      assertEquals(vars["padding"], "12px");
    });

    it("should handle variables with hyphens in names", () => {
      const css = `--my-custom-var-123: value;`;
      const vars = extractCssVariables(css);
      assertEquals(vars["my-custom-var-123"], "value");
    });
  });
});
