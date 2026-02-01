import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  bundleCss,
  extractCssVariables,
  processCssImports,
} from "../../../../../src/build/renderer/services/css-bundler.ts";
import type {
  BundleResult,
  BundlerOptions,
} from "../../../../../src/build/renderer/types/bundler-types.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

function createResult(): BundleResult {
  return {
    outputs: new Map(),
    errors: [],
    warnings: [],
    dependencies: new Map(),
  };
}

describe("CSS Bundler", () => {
  describe("bundleCss", () => {
    it("bundles CSS in development mode", async () => {
      await withTestContext("css-bundle-dev", (context) => {
        const source = {
          path: "/test/styles.css",
          content: `
            .container {
              padding: 20px;
              margin: 10px;
            }
          `,
        };

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "development",
        };

        const result = createResult();

        bundleCss(source, options, result);

        const output = result.outputs.get(source.path);
        assertExists(output);
        assertEquals(output.type, "css");
        assertEquals(output.path, source.path);

        // In dev mode, CSS should not be minified
        assertEquals(output.content.includes("padding"), true);
        assertEquals(output.content.includes("margin"), true);
      });
    });

    it("minifies CSS in production mode", async () => {
      await withTestContext("css-bundle-prod", (context) => {
        const source = {
          path: "/test/styles.css",
          content: `
            /* This is a comment */
            .container {
              padding: 20px;
              margin: 10px;
            }

            .header {
              background: blue;
            }
          `,
        };

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult();

        bundleCss(source, options, result);

        const output = result.outputs.get(source.path)!;
        const minified = output.content;

        // Should remove comments
        assertEquals(minified.includes("/* This is a comment */"), false);

        // Should minify whitespace
        assertEquals(minified.includes("\n"), false);

        // Should preserve selectors and properties
        assertEquals(minified.includes(".container"), true);
        assertEquals(minified.includes("padding"), true);
      });
    });

    it("removes quotes from URLs when minifying", async () => {
      await withTestContext("css-bundle-url", (context) => {
        const source = {
          path: "/test/styles.css",
          content: `
            .background {
              background: url("image.png");
            }
            .icon {
              background: url('icon.svg');
            }
          `,
        };

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult();

        bundleCss(source, options, result);

        const output = result.outputs.get(source.path)!;

        // Should remove quotes from URLs
        assertEquals(output.content.includes("url(image.png)"), true);
        assertEquals(output.content.includes("url(icon.svg)"), true);
        assertEquals(output.content.includes('url("'), false);
        assertEquals(output.content.includes("url('"), false);
      });
    });

    it("removes trailing semicolons before closing braces", async () => {
      await withTestContext("css-bundle-semicolon", (context) => {
        const source = {
          path: "/test/styles.css",
          content: `
            .box {
              width: 100px;
              height: 100px;
            }
          `,
        };

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult();

        bundleCss(source, options, result);

        const output = result.outputs.get(source.path)!;

        // Should not have ;} pattern
        assertEquals(output.content.includes(";}"), false);
        // Should have just }
        assertEquals(output.content.includes("}"), true);
      });
    });

    it("handles malformed CSS gracefully", async () => {
      await withTestContext("css-bundle-error", (context) => {
        const source = {
          path: "/test/malformed.css",
          content: `
            .incomplete {
              color: red
            /* Unclosed comment
          `,
        };

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult();

        // Should not throw - just process as best as possible
        bundleCss(source, options, result);

        // Should have output even for malformed CSS
        assertExists(result.outputs.get(source.path));
      });
    });

    it("handles empty CSS", async () => {
      await withTestContext("css-bundle-empty", (context) => {
        const source = {
          path: "/test/empty.css",
          content: "",
        };

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult();

        bundleCss(source, options, result);

        const output = result.outputs.get(source.path)!;
        assertEquals(output.content, "");
      });
    });
  });

  describe("processCssImports", () => {
    it("preserves relative imports", () => {
      const css = `
        @import "./variables.css";
        @import "../base/reset.css";

        .component { color: red; }
      `;

      const processed = processCssImports(css, "/styles/components.css");

      // Should preserve relative imports
      assertEquals(processed.includes('@import "./variables.css"'), true);
      assertEquals(processed.includes('@import "../base/reset.css"'), true);
    });

    it("preserves absolute imports", () => {
      const css = `
        @import "normalize.css";
        @import url("https://fonts.googleapis.com/css?family=Roboto");

        .component { color: red; }
      `;

      const processed = processCssImports(css, "/styles/components.css");

      // Should preserve absolute imports
      assertEquals(processed.includes('@import "normalize.css"'), true);
      assertEquals(processed.includes('url("https://fonts.googleapis.com'), true);
    });

    it("handles imports without semicolons", () => {
      const css = `
        @import "./variables.css"
        @import "./theme.css";

        .component { color: red; }
      `;

      const processed = processCssImports(css, "/styles/components.css");

      // Should handle both forms
      assertEquals(processed.includes('@import "./variables.css"'), true);
      assertEquals(processed.includes('@import "./theme.css"'), true);
    });

    it("handles CSS without imports", () => {
      const css = `
        .component {
          color: red;
          padding: 10px;
        }
      `;

      const processed = processCssImports(css, "/styles/components.css");

      // Should return unchanged
      assertEquals(processed, css);
    });
  });

  describe("extractCssVariables", () => {
    it("extracts CSS custom properties", () => {
      const css = `
        :root {
          --primary-color: #007bff;
          --secondary-color: #6c757d;
          --font-size: 16px;
        }
      `;

      const variables = extractCssVariables(css);

      assertEquals(variables["primary-color"], "#007bff");
      assertEquals(variables["secondary-color"], "#6c757d");
      assertEquals(variables["font-size"], "16px");
    });

    it("handles variables with spaces", () => {
      const css = `
        :root {
          --spacing-large:   20px;
          --spacing-medium: 15px  ;
        }
      `;

      const variables = extractCssVariables(css);

      assertEquals(variables["spacing-large"], "20px");
      assertEquals(variables["spacing-medium"], "15px");
    });

    it("handles complex variable values", () => {
      const css = `
        :root {
          --shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          --gradient: linear-gradient(to right, #ff0000, #00ff00);
        }
      `;

      const variables = extractCssVariables(css);

      assertEquals(variables["shadow"], "0 2px 4px rgba(0, 0, 0, 0.1)");
      assertEquals(
        variables["gradient"],
        "linear-gradient(to right, #ff0000, #00ff00)",
      );
    });

    it("handles CSS without variables", () => {
      const css = `
        .component {
          color: red;
          padding: 10px;
        }
      `;

      const variables = extractCssVariables(css);

      assertEquals(Object.keys(variables).length, 0);
    });

    it("handles duplicate variable names (last wins)", () => {
      const css = `
        :root {
          --color: blue;
        }
        .dark {
          --color: black;
        }
      `;

      const variables = extractCssVariables(css);

      // Last value should win
      assertEquals(variables["color"], "black");
    });

    it("handles hyphenated variable names", () => {
      const css = `
        :root {
          --primary-button-bg-color: #007bff;
          --font-family-sans-serif: "Helvetica Neue", sans-serif;
        }
      `;

      const variables = extractCssVariables(css);

      assertEquals(variables["primary-button-bg-color"], "#007bff");
      assertEquals(
        variables["font-family-sans-serif"],
        '"Helvetica Neue", sans-serif',
      );
    });
  });

  describe("integration tests", () => {
    it("processes complete CSS bundle", async () => {
      await withTestContext("css-integration", (context) => {
        const source = {
          path: "/test/app.css",
          content: `
            /* Application styles */
            @import "./variables.css";

            :root {
              --primary: #007bff;
              --spacing: 1rem;
            }

            .container {
              padding: var(--spacing);
              background: url("background.jpg");
            }

            .button {
              color: var(--primary);
              border: 1px solid var(--primary);
            }
          `,
        };

        const options: BundlerOptions = {
          sources: [],
          projectDir: context.projectDir,
          mode: "production",
        };

        const result = createResult();

        bundleCss(source, options, result);

        const output = result.outputs.get(source.path)!;

        // Should be minified
        assertEquals(output.content.includes("/* Application styles */"), false);

        // Should preserve functional content
        assertEquals(output.content.includes(".container"), true);
        assertEquals(output.content.includes(".button"), true);
        assertEquals(output.content.includes("--primary"), true);

        // Should optimize URLs
        assertEquals(output.content.includes("url(background.jpg)"), true);

        // Extract variables from original CSS
        const variables = extractCssVariables(source.content);
        assertEquals(variables["primary"], "#007bff");
        assertEquals(variables["spacing"], "1rem");
      });
    });
  });
});
