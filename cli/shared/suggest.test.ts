import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { levenshtein, suggestCommand } from "./suggest.ts";

describe("suggest", () => {
  describe("levenshtein", () => {
    it("returns 0 for identical strings", () => {
      assertEquals(levenshtein("deploy", "deploy"), 0);
    });

    it("returns length for empty vs non-empty", () => {
      assertEquals(levenshtein("", "abc"), 3);
      assertEquals(levenshtein("abc", ""), 3);
    });

    it("returns 0 for two empty strings", () => {
      assertEquals(levenshtein("", ""), 0);
    });

    it("detects single character substitution", () => {
      assertEquals(levenshtein("deploy", "deplpy"), 1);
    });

    it("detects single character deletion", () => {
      assertEquals(levenshtein("deploy", "deplo"), 1);
    });

    it("detects single character insertion", () => {
      assertEquals(levenshtein("deploy", "deployy"), 1);
    });

    it("detects transposition as 2 edits", () => {
      assertEquals(levenshtein("deploy", "depoly"), 2);
    });

    it("returns high distance for completely different strings", () => {
      const dist = levenshtein("abc", "xyz");
      assertEquals(dist, 3);
    });
  });

  describe("suggestCommand", () => {
    const commands = ["deploy", "build", "dev", "serve", "doctor", "clean"];

    it("suggests for single-char typo", () => {
      const result = suggestCommand("depoy", commands);
      assertEquals(result.includes("deploy"), true);
    });

    it("suggests for transposition", () => {
      const result = suggestCommand("biuld", commands);
      assertEquals(result.includes("build"), true);
    });

    it("returns empty for no close match", () => {
      const result = suggestCommand("xyzabc", commands);
      assertEquals(result.length, 0);
    });

    it("sorts by distance (closest first)", () => {
      // "dex" → "dev" (dist 1) should come before "demo" (dist 2)
      const result = suggestCommand("dex", ["deploy", "dev", "demo"]);
      assertEquals(result[0], "dev");
      assertEquals(result.includes("demo"), true);
    });

    it("respects maxDistance parameter", () => {
      const result = suggestCommand("depoy", commands, 1);
      assertEquals(result.includes("deploy"), true);
      const strict = suggestCommand("zzzzz", commands, 1);
      assertEquals(strict.length, 0);
    });

    it("handles empty input", () => {
      const result = suggestCommand("", commands);
      assertEquals(Array.isArray(result), true);
    });

    it("handles empty commands list", () => {
      const result = suggestCommand("deploy", []);
      assertEquals(result.length, 0);
    });

    it("does not suggest aliases when using canonical names", () => {
      // Router uses COMMANDS registry keys (canonical) not router keys (includes aliases)
      const canonical = ["deploy", "build", "generate", "serve"];
      const withAliases = ["deploy", "build", "generate", "g", "serve", "preview"];

      // "g" should not appear in canonical suggestions
      const resultCanonical = suggestCommand("ge", canonical);
      assertEquals(resultCanonical.includes("g"), false);

      // but would appear if aliases were included
      const resultWithAliases = suggestCommand("g", withAliases, 1);
      assertEquals(resultWithAliases.includes("g"), true);
    });
  });

  describe("integration with COMMANDS registry", () => {
    it("COMMANDS registry has no aliases", async () => {
      const { COMMANDS } = await import("../help/command-definitions.ts");
      const names = Object.keys(COMMANDS);
      // Known aliases that should NOT be in the registry
      assertEquals(names.includes("g"), false);
      assertEquals(names.includes("preview"), false);
    });

    it("COMMANDS entries have descriptions", async () => {
      const { COMMANDS } = await import("../help/command-definitions.ts");
      for (const [name, help] of Object.entries(COMMANDS)) {
        assertEquals(
          typeof help.description,
          "string",
          `Command "${name}" missing description`,
        );
        assertEquals(
          help.description.length > 0,
          true,
          `Command "${name}" has empty description`,
        );
      }
    });
  });
});
