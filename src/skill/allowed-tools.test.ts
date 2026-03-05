import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  filterToolsForSkill,
  isToolAllowedBySkill,
  matchesAllowedTool,
  validateAllowedToolPatterns,
} from "./allowed-tools.ts";

describe("src/skill/allowed-tools", () => {
  describe("matchesAllowedTool", () => {
    it("should match exact tool name", () => {
      assertEquals(matchesAllowedTool("Read", "Read"), true);
    });

    it("should not match different tool name", () => {
      assertEquals(matchesAllowedTool("Write", "Read"), false);
    });

    it("should match prefix wildcard", () => {
      assertEquals(matchesAllowedTool("api:list-users", "api:*"), true);
    });

    it("should not match different prefix", () => {
      assertEquals(matchesAllowedTool("db:query", "api:*"), false);
    });

    it("should return false for invalid pattern", () => {
      assertEquals(matchesAllowedTool("Read", "Bash(git:*)"), false);
    });
  });

  describe("filterToolsForSkill", () => {
    const tools = [
      { name: "Read", description: "Read", parameters: {} },
      { name: "Write", description: "Write", parameters: {} },
      { name: "api:list", description: "API", parameters: {} },
      { name: "load-skill", description: "Load", parameters: {} },
    ];

    it("should return all tools when allowedTools is undefined", () => {
      const result = filterToolsForSkill(tools, undefined);
      assertEquals(result.length, 4);
    });

    it("should return all tools when allowedTools is empty", () => {
      const result = filterToolsForSkill(tools, []);
      assertEquals(result.length, 4);
    });

    it("should filter to only allowed tools + skill tools", () => {
      const result = filterToolsForSkill(tools, ["Read"]);
      assertEquals(result.length, 2); // Read + load-skill
      assertEquals(result.map((t) => t.name).sort(), ["Read", "load-skill"]);
    });

    it("should support prefix wildcards", () => {
      const result = filterToolsForSkill(tools, ["api:*"]);
      assertEquals(result.length, 2); // api:list + load-skill
    });

    it("should always include skill tools", () => {
      const result = filterToolsForSkill(tools, ["Write"]);
      assertEquals(result.some((t) => t.name === "load-skill"), true);
    });
  });

  describe("isToolAllowedBySkill", () => {
    it("should allow all tools when no policy", () => {
      assertEquals(isToolAllowedBySkill("anything", undefined), true);
    });

    it("should allow all tools when empty policy", () => {
      assertEquals(isToolAllowedBySkill("anything", []), true);
    });

    it("should allow matching tool", () => {
      assertEquals(isToolAllowedBySkill("Read", ["Read", "Write"]), true);
    });

    it("should reject non-matching tool", () => {
      assertEquals(isToolAllowedBySkill("Bash", ["Read", "Write"]), false);
    });

    it("should always allow skill system tools", () => {
      assertEquals(isToolAllowedBySkill("load-skill", ["Read"]), true);
      assertEquals(isToolAllowedBySkill("load-skill-reference", ["Read"]), true);
      assertEquals(isToolAllowedBySkill("execute-skill-script", ["Read"]), true);
    });
  });

  describe("validateAllowedToolPatterns", () => {
    it("should accept valid patterns", () => {
      const result = validateAllowedToolPatterns(["Read", "api:*", "Write"]);
      assertEquals(result, ["Read", "api:*", "Write"]);
    });

    it("should reject invalid patterns", () => {
      try {
        validateAllowedToolPatterns(["Bash(git:*)"]);
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid allowed-tools pattern"), true);
      }
    });

    it("should accept empty array", () => {
      assertEquals(validateAllowedToolPatterns([]), []);
    });
  });
});
