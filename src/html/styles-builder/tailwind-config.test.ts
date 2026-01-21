import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateTailwindV4Theme, getTailwindCDNUrl } from "./tailwind-config.ts";

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
