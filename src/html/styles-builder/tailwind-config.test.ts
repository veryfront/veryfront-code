import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  convertTailwindConfigForBrowser,
  generateTailwindConfig,
  generateTailwindV4Theme,
  getTailwindCDNUrl,
} from "./tailwind-config.ts";

describe("tailwind-config", () => {
  describe("getTailwindCDNUrl", () => {
    it("should return Tailwind v4 CDN URL", () => {
      assertEquals(getTailwindCDNUrl(), "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4");
    });

    it("should return same URL regardless of config", () => {
      // Tailwind v4 doesn't use plugin params in URL - plugins are configured in CSS
      assertEquals(
        getTailwindCDNUrl({}),
        "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
      );
      assertEquals(
        getTailwindCDNUrl({ plugins: ["forms"] }),
        "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
      );
      assertEquals(
        getTailwindCDNUrl({ plugins: ["forms", "typography"] }),
        "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
      );
    });
  });

  describe("convertTailwindConfigForBrowser", () => {
    it("should return empty string for Tailwind v4 (JS config deprecated)", () => {
      // Tailwind v4 uses CSS @theme directive instead of JS config
      const input = `export default {
  theme: {
    extend: {}
  }
}`;
      const result = convertTailwindConfigForBrowser(input);
      assertEquals(result, "");
    });

    it("should handle empty string", () => {
      assertEquals(convertTailwindConfigForBrowser(""), "");
    });
  });

  describe("generateTailwindConfig", () => {
    it("should return empty string for Tailwind v4 (JS config deprecated)", () => {
      // Tailwind v4 uses @theme CSS instead of JavaScript config
      const result = generateTailwindConfig();
      assertEquals(result, "");
    });

    it("should return empty string with user config (deprecated)", () => {
      const result = generateTailwindConfig({
        theme: {
          extend: {
            colors: {
              custom: "#ff0000",
            },
          },
        },
      });
      assertEquals(result, "");
    });
  });

  describe("generateTailwindV4Theme", () => {
    it("should generate @theme CSS directive", () => {
      const result = generateTailwindV4Theme();
      assertStringIncludes(result, "@theme {");
    });

    it("should include color CSS variables", () => {
      const result = generateTailwindV4Theme();
      assertStringIncludes(result, "--color-background");
      assertStringIncludes(result, "--color-foreground");
      assertStringIncludes(result, "--color-primary");
      assertStringIncludes(result, "--color-secondary");
      assertStringIncludes(result, "hsl(var(--");
    });

    it("should include font family variables", () => {
      const result = generateTailwindV4Theme();
      assertStringIncludes(result, "--font-sans");
      assertStringIncludes(result, "--font-serif");
      assertStringIncludes(result, "--font-mono");
    });

    it("should include border radius variables", () => {
      const result = generateTailwindV4Theme();
      assertStringIncludes(result, "--radius-sm");
      assertStringIncludes(result, "--radius-md");
      assertStringIncludes(result, "--radius-lg");
      assertStringIncludes(result, "var(--radius)");
    });

    it("should include custom CSS from config", () => {
      const result = generateTailwindV4Theme({
        customCSS: ".custom-class { color: red; }",
      });
      assertStringIncludes(result, ".custom-class { color: red; }");
    });
  });
});
