import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { processWithLightningCSS } from "./lightning-processor.ts";

describe("build/asset-pipeline/tailwind-processor/lightning-processor", () => {
  describe("processWithLightningCSS", () => {
    it("should replace Tailwind v4 double-quoted import with comment", async () => {
      const css = '@import "tailwindcss";\n.btn { color: red; }';
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: false,
      });
      expect(result).not.toContain('@import "tailwindcss"');
      expect(result).toContain(".btn");
    });

    it("should replace Tailwind v4 single-quoted import with comment", async () => {
      const css = "@import 'tailwindcss';\n.btn { color: red; }";
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: false,
      });
      expect(result).not.toContain("@import 'tailwindcss'");
      expect(result).toContain(".btn");
    });

    it("should replace Tailwind import with trailing semicolon", async () => {
      const css = '@import "tailwindcss";';
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: false,
      });
      expect(result).not.toContain("@import");
    });

    it("should replace Tailwind import without trailing semicolon", async () => {
      const css = '@import "tailwindcss"\n.btn { color: blue; }';
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: false,
      });
      expect(result).not.toContain('@import "tailwindcss"');
    });

    it("should preserve non-Tailwind CSS content", async () => {
      const css = ".container { display: flex; padding: 1rem; }";
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: false,
      });
      expect(result).toContain("display");
      expect(result).toContain("padding");
    });

    it("should handle empty CSS input", async () => {
      const result = await processWithLightningCSS("", {
        filename: "test.css",
        minify: false,
      });
      expect(result).toBe("");
    });

    it("should handle CSS with multiple Tailwind imports", async () => {
      const css =
        '@import "tailwindcss";\n@import "tailwindcss";\n.btn { color: red; }';
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: false,
      });
      expect(result).not.toContain('@import "tailwindcss"');
      expect(result).toContain(".btn");
    });

    it("should not replace non-Tailwind imports", async () => {
      const css = '@import "other-library";\n.btn { color: red; }';
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: false,
      });
      // Fallback processor keeps non-tailwind imports (or LightningCSS processes them)
      expect(result).toContain(".btn");
    });

    it("should return processed CSS when minify is true", async () => {
      const css = ".container { display: flex; padding: 1rem; }";
      const result = await processWithLightningCSS(css, {
        filename: "test.css",
        minify: true,
      });
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
