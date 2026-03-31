import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateBashCompletions,
  generateFishCompletions,
  generateZshCompletions,
} from "./command.ts";

describe("Completions Command", () => {
  describe("generateBashCompletions", () => {
    it("includes command names", () => {
      const script = generateBashCompletions();
      assertEquals(script.includes("deploy"), true);
      assertEquals(script.includes("build"), true);
      assertEquals(script.includes("dev"), true);
    });

    it("includes complete function", () => {
      const script = generateBashCompletions();
      assertEquals(script.includes("complete -F"), true);
    });
  });

  describe("generateZshCompletions", () => {
    it("includes compdef", () => {
      const script = generateZshCompletions();
      assertEquals(script.includes("#compdef veryfront"), true);
    });

    it("includes command descriptions", () => {
      const script = generateZshCompletions();
      assertEquals(script.includes("deploy:"), true);
    });
  });

  describe("generateFishCompletions", () => {
    it("includes complete commands", () => {
      const script = generateFishCompletions();
      assertEquals(script.includes("complete -c veryfront"), true);
      assertEquals(script.includes("deploy"), true);
    });
  });
});
