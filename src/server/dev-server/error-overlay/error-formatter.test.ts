import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatErrorType, getSuggestion } from "./error-formatter.ts";

describe("server/dev-server/error-overlay/error-formatter", () => {
  describe("getSuggestion", () => {
    it("should suggest for parse errors", () => {
      const s = getSuggestion(new Error("Unexpected token at line 5"));
      assertEquals(typeof s, "string");
      assertEquals(s!.includes("syntax"), true);
    });

    it("should suggest for module not found", () => {
      const s = getSuggestion(new Error("Cannot find module './missing'"));
      assertEquals(typeof s, "string");
      assertEquals(s!.includes("module"), true);
    });

    it("should suggest for frontmatter issues", () => {
      const s = getSuggestion(new Error("Invalid frontmatter block"));
      assertEquals(typeof s, "string");
      assertEquals(s!.includes("YAML"), true);
    });

    it("should suggest for React hook violations", () => {
      const s = getSuggestion(new Error("Invalid hook call inside class"));
      assertEquals(typeof s, "string");
      assertEquals(s!.includes("hooks"), true);
    });

    it("should suggest for hydration errors", () => {
      const s = getSuggestion(new Error("Hydration mismatch detected"));
      assertEquals(typeof s, "string");
      assertEquals(s!.includes("Hydration"), true);
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
