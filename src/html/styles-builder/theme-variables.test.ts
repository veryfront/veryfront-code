import { assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { generateThemeVariables } from "./theme-variables.ts";

describe("theme-variables", () => {
  describe("generateThemeVariables", () => {
    it("should include :root selector", () => {
      const result = generateThemeVariables();
      assertStringIncludes(result, ":root {");
    });

    it("should include dark theme selector", () => {
      const result = generateThemeVariables();
      assertStringIncludes(result, '[data-theme="dark"]');
    });

    it("should include all required CSS variables", () => {
      const result = generateThemeVariables();
      const requiredVars = [
        "--background",
        "--foreground",
        "--muted",
        "--muted-foreground",
        "--primary",
        "--primary-foreground",
        "--secondary",
        "--secondary-foreground",
        "--highlight",
        "--highlight-foreground",
        "--card",
        "--card-foreground",
        "--panel",
        "--panel-foreground",
        "--popover",
        "--popover-foreground",
        "--destructive",
        "--destructive-foreground",
        "--border",
        "--divider",
        "--input",
        "--ring",
        "--success",
        "--radius",
      ];

      for (const varName of requiredVars) {
        assertStringIncludes(result, varName);
      }
    });

    it("should include input-related variables", () => {
      const result = generateThemeVariables();
      assertStringIncludes(result, "--input-foreground");
      assertStringIncludes(result, "--input-border");
      assertStringIncludes(result, "--input-placeholder");
    });

    it("should include code-block variable", () => {
      const result = generateThemeVariables();
      assertStringIncludes(result, "--code-block");
    });

    it("should include vf-tailwind base styles", () => {
      const result = generateThemeVariables();
      assertStringIncludes(result, ".vf-tailwind");
      assertStringIncludes(result, "line-height: 1.5");
      assertStringIncludes(result, "font-family:");
    });

    it("should include tap-highlight-color reset", () => {
      const result = generateThemeVariables();
      assertStringIncludes(result, "-webkit-tap-highlight-color");
    });

    it("should include Inter as primary font", () => {
      const result = generateThemeVariables();
      assertStringIncludes(result, "Inter");
    });

    it("should have different values for light and dark modes", () => {
      const result = generateThemeVariables();
      // Light mode background is white (0 0% 100%)
      // Dark mode background is dark (222.2 84% 4.9%)
      // Both should be present
      assertStringIncludes(result, "0 0% 100%");
      assertStringIncludes(result, "222.2 84% 4.9%");
    });
  });
});
