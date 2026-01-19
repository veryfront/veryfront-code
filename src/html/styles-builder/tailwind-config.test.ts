import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  convertTailwindConfigForBrowser,
  generateTailwindConfig,
  getTailwindCDNUrl,
} from "./tailwind-config.ts";

describe("tailwind-config", () => {
  describe("getTailwindCDNUrl", () => {
    it("should return base URL without plugins", () => {
      assertEquals(getTailwindCDNUrl(), "https://cdn.tailwindcss.com");
    });

    it("should return base URL for empty config", () => {
      assertEquals(getTailwindCDNUrl({}), "https://cdn.tailwindcss.com");
    });

    it("should return base URL for config without plugins", () => {
      assertEquals(
        getTailwindCDNUrl({ theme: { extend: {} } }),
        "https://cdn.tailwindcss.com",
      );
    });

    it("should append single plugin", () => {
      assertEquals(
        getTailwindCDNUrl({ plugins: ["forms"] }),
        "https://cdn.tailwindcss.com?plugins=forms",
      );
    });

    it("should append multiple plugins", () => {
      assertEquals(
        getTailwindCDNUrl({ plugins: ["forms", "typography", "aspect-ratio"] }),
        "https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio",
      );
    });

    it("should handle empty plugins array", () => {
      assertEquals(
        getTailwindCDNUrl({ plugins: [] }),
        "https://cdn.tailwindcss.com",
      );
    });
  });

  describe("convertTailwindConfigForBrowser", () => {
    it("should convert export default to tailwind.config", () => {
      const input = `export default {
  theme: {
    extend: {}
  }
}`;
      const result = convertTailwindConfigForBrowser(input);
      assertStringIncludes(result, "tailwind.config = {");
      assertEquals(result.includes("export default"), false);
    });

    it("should convert module.exports to tailwind.config", () => {
      const input = `module.exports = {
  theme: {
    extend: {}
  }
}`;
      const result = convertTailwindConfigForBrowser(input);
      assertStringIncludes(result, "tailwind.config = {");
      assertEquals(result.includes("module.exports"), false);
    });

    it("should handle empty string", () => {
      assertEquals(convertTailwindConfigForBrowser(""), "");
    });

    it("should preserve content after conversion", () => {
      const input = `export default {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#ff0000"
      }
    }
  }
}`;
      const result = convertTailwindConfigForBrowser(input);
      assertStringIncludes(result, "content:");
      assertStringIncludes(result, "brand:");
    });
  });

  describe("generateTailwindConfig", () => {
    it("should generate valid JavaScript assignment", () => {
      const result = generateTailwindConfig();
      assertStringIncludes(result, "tailwind.config = ");
    });

    it("should include darkMode configuration", () => {
      const result = generateTailwindConfig();
      assertStringIncludes(result, "darkMode");
      // JSON.stringify escapes quotes, so the string contains \"dark\"
      assertStringIncludes(result, '[data-theme=\\"dark\\"]');
    });

    it("should include container configuration", () => {
      const result = generateTailwindConfig();
      assertStringIncludes(result, "container");
      assertStringIncludes(result, "center");
      assertStringIncludes(result, "padding");
    });

    it("should include default theme colors", () => {
      const result = generateTailwindConfig();
      assertStringIncludes(result, "background");
      assertStringIncludes(result, "foreground");
      assertStringIncludes(result, "primary");
      assertStringIncludes(result, "secondary");
      assertStringIncludes(result, "hsl(var(--");
    });

    it("should include default border radius", () => {
      const result = generateTailwindConfig();
      assertStringIncludes(result, "borderRadius");
      assertStringIncludes(result, "var(--radius)");
    });

    it("should merge user theme extensions", () => {
      const result = generateTailwindConfig({
        theme: {
          extend: {
            colors: {
              custom: "#ff0000",
            },
          },
        },
      });
      assertStringIncludes(result, "custom");
      assertStringIncludes(result, "#ff0000");
      // Should still have defaults
      assertStringIncludes(result, "primary");
    });

    it("should deep merge nested theme extensions", () => {
      const result = generateTailwindConfig({
        theme: {
          extend: {
            colors: {
              primary: {
                light: "#aaaaaa",
              },
            },
          },
        },
      });
      // User's primary.light should be merged
      assertStringIncludes(result, "light");
      assertStringIncludes(result, "#aaaaaa");
    });
  });
});
