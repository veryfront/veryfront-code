import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { generateThemeVariables } from "./theme-variables.ts";

describe("theme-variables", () => {
  describe("generateThemeVariables", () => {
    it("should return CSS string with theme variables", () => {
      const css = generateThemeVariables();

      assert(typeof css === "string");
      assert(css.length > 0);
    });

    it("should include :root selector", () => {
      const css = generateThemeVariables();

      assert(css.includes(":root {"));
    });

    it("should include light theme variables", () => {
      const css = generateThemeVariables();

      assert(css.includes("--background:"));
      assert(css.includes("--foreground:"));
      assert(css.includes("--primary:"));
      assert(css.includes("--secondary:"));
    });

    it("should include dark theme variables", () => {
      const css = generateThemeVariables();

      assert(css.includes('[data-theme="dark"]'));
    });

    it("should include all semantic color variables", () => {
      const css = generateThemeVariables();

      assert(css.includes("--muted:"));
      assert(css.includes("--card:"));
      assert(css.includes("--popover:"));
      assert(css.includes("--destructive:"));
      assert(css.includes("--border:"));
      assert(css.includes("--input:"));
      assert(css.includes("--success:"));
    });

    it("should include radius variable", () => {
      const css = generateThemeVariables();

      assert(css.includes("--radius:"));
    });

    it("should include vf-tailwind base styles", () => {
      const css = generateThemeVariables();

      assert(css.includes(".vf-tailwind"));
    });

    it("should set font-family", () => {
      const css = generateThemeVariables();

      assert(css.includes("font-family:"));
      assert(css.includes("Inter"));
    });
  });
});
