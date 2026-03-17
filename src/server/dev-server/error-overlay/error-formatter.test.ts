import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatErrorType, getSuggestion, parseErrorLocation } from "./error-formatter.ts";

function assertSuggestion(errorMessage: string, expectedSubstring: string): void {
  const suggestion = getSuggestion(new Error(errorMessage));
  assertEquals(typeof suggestion, "string");
  assertEquals(suggestion?.includes(expectedSubstring), true);
}

describe("server/dev-server/error-overlay/error-formatter", () => {
  describe("getSuggestion", () => {
    it("should suggest for parse errors", () => {
      assertSuggestion("Unexpected token at line 5", "syntax");
    });

    it("should suggest for module not found", () => {
      assertSuggestion("Cannot find module './missing'", "module");
    });

    it("should suggest for frontmatter issues", () => {
      assertSuggestion("Invalid frontmatter block", "YAML");
    });

    it("should suggest for React hook violations", () => {
      assertSuggestion("Invalid hook call inside class", "hooks");
    });

    it("should suggest for hydration errors", () => {
      assertSuggestion("Hydration mismatch detected", "Hydration");
    });

    it("should return undefined for unrecognized errors", () => {
      assertEquals(getSuggestion(new Error("xyzzy")), undefined);
    });
  });

  describe("parseErrorLocation", () => {
    it("should extract line and column from stack trace when file is known", () => {
      const error = new Error("something broke");
      error.stack = `Error: something broke
    at RootLayout (file:///projects/css-test/app/layout.tsx:12:9)
    at renderWithHooks (node_modules/react-dom/server.js:100:5)`;

      const location = parseErrorLocation(error, "app/layout.tsx");
      assertEquals(location.line, 12);
      assertEquals(location.column, 9);
    });

    it("should extract line and column from first frame when file is not in stack (bundled SSR)", () => {
      const error = new Error("SSR test error: something broke during render");
      error.stack = `Error: SSR test error: something broke during render
    at Module.RootLayout (file:///tmp/vf-ssr-bundle-abc123.js:42:11)
    at renderWithHooks (node_modules/react-dom/server.js:100:5)
    at processChild (node_modules/react-dom/server.js:200:3)`;

      const location = parseErrorLocation(error, "app/layout.tsx");
      assertEquals(location.line, 42);
      assertEquals(location.column, 11);
    });

    it("should return undefined line/column when stack is missing", () => {
      const error = new Error("no stack");
      error.stack = undefined;

      const location = parseErrorLocation(error, "app/layout.tsx");
      assertEquals(location.line, undefined);
      assertEquals(location.column, undefined);
    });

    it("should match file path as suffix (not require exact match)", () => {
      const error = new Error("fail");
      error.stack = `Error: fail
    at Page (file:///Users/matt/Sites/veryfront-code/projects/css-test/app/page.tsx:7:15)`;

      const location = parseErrorLocation(error, "app/page.tsx");
      assertEquals(location.line, 7);
      assertEquals(location.column, 15);
    });
  });

  describe("formatErrorType", () => {
    it("should capitalize the first letter", () => {
      assertEquals(formatErrorType("build"), "Build");
      assertEquals(formatErrorType("runtime"), "Runtime");
      assertEquals(formatErrorType("hydration"), "Hydration");
    });
  });
});
