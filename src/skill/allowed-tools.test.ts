import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  filterToolsForSkill,
  isToolAllowedBySkill,
  matchesAllowedTool,
  validateAllowedToolPatterns,
} from "./allowed-tools.ts";
import { SKILL_TOOL_IDS } from "./types.ts";

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

    it("should reject double-colon patterns", () => {
      assertEquals(matchesAllowedTool("api::list", "api::*"), false);
    });

    it("should reject leading digit patterns", () => {
      assertEquals(matchesAllowedTool("123tool", "123tool"), false);
    });

    it("should reject trailing colon patterns", () => {
      assertEquals(matchesAllowedTool("api:", "api:"), false);
    });
  });

  describe("filterToolsForSkill", () => {
    const tools = [
      { name: "Read", description: "Read", parameters: {} },
      { name: "Write", description: "Write", parameters: {} },
      { name: "api:list", description: "API", parameters: {} },
      { name: "load_skill", description: "Load", parameters: {} },
      { name: "load_skill_reference", description: "Load reference", parameters: {} },
      { name: "execute_skill_script", description: "Execute script", parameters: {} },
    ];

    it("should return all tools when allowedTools is undefined", () => {
      const result = filterToolsForSkill(tools, undefined);
      assertEquals(result.length, 6);
      assertEquals(result === tools, false);
    });

    it("should constrain skill infrastructure tools when allowedTools is undefined", () => {
      const result = filterToolsForSkill(tools, undefined, {
        hasActiveSkill: true,
        references: [],
        scripts: [],
      });

      assertEquals(result.map((t) => t.name), [
        "Read",
        "Write",
        "api:list",
        "load_skill",
      ]);
    });

    it("should return only load_skill when allowedTools is empty and no skill files are available", () => {
      const result = filterToolsForSkill(tools, []);
      assertEquals(result.length, 1);
      assertEquals(result.map((t) => t.name), ["load_skill"]);
    });

    it("should filter to allowed tools plus load_skill when no skill files are available", () => {
      const result = filterToolsForSkill(tools, ["Read"]);
      assertEquals(result.length, 2); // Read + load_skill
      assertEquals(result.map((t) => t.name).sort(), ["Read", "load_skill"]);
    });

    it("should expose load_skill_reference only when the active skill has references", () => {
      const result = filterToolsForSkill(tools, ["Read"], {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: [],
      });

      assertEquals(result.map((t) => t.name).sort(), [
        "Read",
        "load_skill",
        "load_skill_reference",
      ]);
    });

    it("should expose execute_skill_script only when the active skill has scripts", () => {
      const result = filterToolsForSkill(tools, ["Read"], {
        hasActiveSkill: true,
        references: [],
        scripts: ["scripts/run.sh"],
      });

      assertEquals(result.map((t) => t.name).sort(), [
        "Read",
        "execute_skill_script",
        "load_skill",
      ]);
    });

    it("should support prefix wildcards", () => {
      const result = filterToolsForSkill(tools, ["api:*"]);
      assertEquals(result.length, 2); // api:list + load_skill
    });

    it("should always include load_skill", () => {
      const result = filterToolsForSkill(tools, ["Write"]);
      assertEquals(result.some((t) => t.name === "load_skill"), true);
      assertEquals(result.some((t) => t.name === "load_skill_reference"), false);
      assertEquals(result.some((t) => t.name === "execute_skill_script"), false);
    });
  });

  describe("isToolAllowedBySkill", () => {
    it("should allow all tools when no policy", () => {
      assertEquals(isToolAllowedBySkill("anything", undefined), true);
    });

    it("should still constrain skill infrastructure tools when no policy", () => {
      assertEquals(
        isToolAllowedBySkill("load_skill_reference", undefined, {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        false,
      );
      assertEquals(
        isToolAllowedBySkill("Read", undefined, {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        true,
      );
    });

    it("should deny non-skill tools when empty policy", () => {
      assertEquals(isToolAllowedBySkill("anything", []), false);
    });

    it("should allow only load_skill when empty policy and no active skill files are available", () => {
      assertEquals(isToolAllowedBySkill("load_skill", []), true);
      assertEquals(isToolAllowedBySkill("load_skill_reference", []), false);
      assertEquals(isToolAllowedBySkill("execute_skill_script", []), false);
    });

    it("should allow matching tool", () => {
      assertEquals(isToolAllowedBySkill("Read", ["Read", "Write"]), true);
    });

    it("should reject non-matching tool", () => {
      assertEquals(isToolAllowedBySkill("Bash", ["Read", "Write"]), false);
    });

    it("should always allow load_skill", () => {
      assertEquals(isToolAllowedBySkill("load_skill", ["Read"]), true);
      assertEquals(isToolAllowedBySkill("load_skill_reference", ["Read"]), false);
      assertEquals(isToolAllowedBySkill("execute_skill_script", ["Read"]), false);
    });

    it("should allow load_skill_reference only when the active skill has references", () => {
      assertEquals(
        isToolAllowedBySkill("load_skill_reference", ["Read"], {
          hasActiveSkill: true,
          references: ["references/guide.md"],
          scripts: [],
        }),
        true,
      );
      assertEquals(
        isToolAllowedBySkill("load_skill_reference", ["Read"], {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        false,
      );
    });

    it("should allow execute_skill_script only when the active skill has scripts", () => {
      assertEquals(
        isToolAllowedBySkill("execute_skill_script", ["Read"], {
          hasActiveSkill: true,
          references: [],
          scripts: ["scripts/run.sh"],
        }),
        true,
      );
      assertEquals(
        isToolAllowedBySkill("execute_skill_script", ["Read"], {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        false,
      );
    });
  });

  describe("validateAllowedToolPatterns", () => {
    it("should accept valid patterns", () => {
      const result = validateAllowedToolPatterns(["Read", "api:*", "Write"]);
      assertEquals(result, ["Read", "api:*", "Write"]);
    });

    it("should return a deduplicated snapshot", () => {
      const patterns = ["Read", "Read", "api:*"];
      const result = validateAllowedToolPatterns(patterns);

      patterns[0] = "Write";
      assertEquals(result, ["Read", "api:*"]);
    });

    it("should reject accessor-backed entries without invoking them", () => {
      let invoked = false;
      const patterns = Object.defineProperty(["Read"], "0", {
        enumerable: true,
        get() {
          invoked = true;
          return "Write";
        },
      });

      assertThrows(
        () => validateAllowedToolPatterns(patterns),
        Error,
        "dense array",
      );
      assertEquals(invoked, false);
    });

    it("should reject sparse or excessive pattern lists", () => {
      const sparse = Array<string>(1);
      try {
        validateAllowedToolPatterns(sparse);
        throw new Error("expected sparse patterns to be rejected");
      } catch (error) {
        assertEquals(String(error).includes("dense array"), true);
      }

      try {
        validateAllowedToolPatterns(Array.from({ length: 257 }, () => "Read"));
        throw new Error("expected excessive patterns to be rejected");
      } catch (error) {
        assertEquals(String(error).includes("at most 256"), true);
      }
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

  it("should expose skill infrastructure IDs through an immutable set view", () => {
    assertEquals(SKILL_TOOL_IDS.has("load_skill"), true);
    assertEquals(SKILL_TOOL_IDS.size, 3);
    assertEquals([...SKILL_TOOL_IDS.keys()], [...SKILL_TOOL_IDS.values()]);
    assertEquals([...SKILL_TOOL_IDS.entries()][0], ["load_skill", "load_skill"]);
    assertEquals([...SKILL_TOOL_IDS][0], "load_skill");
    const visited: string[] = [];
    SKILL_TOOL_IDS.forEach((value, duplicate, set) => {
      assertEquals(value, duplicate);
      assertEquals(set, SKILL_TOOL_IDS);
      visited.push(value);
    });
    assertEquals(visited.length, 3);
    assertEquals("add" in SKILL_TOOL_IDS, false);
    assertEquals(
      (() => {
        try {
          Set.prototype.add.call(SKILL_TOOL_IDS, "attacker_tool");
          return false;
        } catch {
          return true;
        }
      })(),
      true,
    );
    assertEquals(SKILL_TOOL_IDS.has("attacker_tool"), false);
    assertEquals(
      [...SKILL_TOOL_IDS.union(new Set(["custom_tool"]))].includes("custom_tool"),
      true,
    );
    assertEquals([...SKILL_TOOL_IDS.intersection(new Set(["load_skill"]))], ["load_skill"]);
    assertEquals(SKILL_TOOL_IDS.difference(new Set(["load_skill"])).size, 2);
    assertEquals(
      [...SKILL_TOOL_IDS.symmetricDifference(new Set(["load_skill", "custom_tool"]))].sort(),
      ["custom_tool", "execute_skill_script", "load_skill_reference"],
    );
    assertEquals(SKILL_TOOL_IDS.isSubsetOf(new Set(SKILL_TOOL_IDS)), true);
    assertEquals(SKILL_TOOL_IDS.isSubsetOf(new Set(["load_skill"])), false);
    assertEquals(SKILL_TOOL_IDS.isSupersetOf(new Set(["load_skill"])), true);
    assertEquals(SKILL_TOOL_IDS.isSupersetOf(new Set(["custom_tool"])), false);
    assertEquals(SKILL_TOOL_IDS.isDisjointFrom(new Set(["custom_tool"])), true);
    assertEquals(SKILL_TOOL_IDS.isDisjointFrom(new Set(["load_skill"])), false);
  });
});
