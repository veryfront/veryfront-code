import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateThemeVariables } from "./theme-variables.ts";

describe("theme-variables", () => {
  describe("generateThemeVariables", () => {
    function getResult(): string {
      return generateThemeVariables();
    }

    it("should include :root selector", () => {
      assertStringIncludes(getResult(), ":root {");
    });

    it("should include dark theme selector", () => {
      assertStringIncludes(getResult(), '[data-theme="dark"]');
    });

    it("should include all required CSS variables", () => {
      const result = getResult();
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
      const result = getResult();
      const inputVars = ["--input-foreground", "--input-border", "--input-placeholder"];

      for (const varName of inputVars) {
        assertStringIncludes(result, varName);
      }
    });

    it("should include code-block variable", () => {
      assertStringIncludes(getResult(), "--code-block");
    });

    it("should include vf-tailwind base styles", () => {
      const result = getResult();
      const baseStyles = [".vf-tailwind", "line-height: 1.5", "font-family:"];

      for (const style of baseStyles) {
        assertStringIncludes(result, style);
      }
    });

    it("should include tap-highlight-color reset", () => {
      assertStringIncludes(getResult(), "-webkit-tap-highlight-color");
    });

    it("should include Inter as primary font", () => {
      assertStringIncludes(getResult(), "Inter");
    });

    it("should have different values for light and dark modes", () => {
      const result = getResult();
      const modeValues = ["0 0% 100%", "222.2 84% 4.9%"];

      for (const value of modeValues) {
        assertStringIncludes(result, value);
      }
    });
  });
});
