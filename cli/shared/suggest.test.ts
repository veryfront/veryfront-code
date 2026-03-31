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
      const result = suggestCommand("dev", ["deploy", "dev", "demo"]);
      assertEquals(result[0], "dev");
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
  });
});
