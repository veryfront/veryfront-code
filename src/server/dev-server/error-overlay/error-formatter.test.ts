import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatErrorType, getSuggestion } from "./error-formatter.ts";

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

  describe("formatErrorType", () => {
    it("should capitalize the first letter", () => {
      assertEquals(formatErrorType("build"), "Build");
      assertEquals(formatErrorType("runtime"), "Runtime");
      assertEquals(formatErrorType("hydration"), "Hydration");
    });
  });
});
