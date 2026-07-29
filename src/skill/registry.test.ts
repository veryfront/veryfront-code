import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getAllSkills, getSkill, registerSkill, skillRegistry } from "./registry.ts";
import type { Skill } from "./types.ts";

function createTestSkill(id: string): Skill {
  return {
    id,
    metadata: { name: id, description: `Test skill ${id}` },
    rootPath: `/test/skills/${id}`,
  };
}

function createScopedTestSkill(input: {
  id: string;
  ownerAgentId?: string;
  shortName?: string;
}): Skill {
  return {
    ...createTestSkill(input.id),
    ...(input.ownerAgentId === undefined ? {} : { ownerAgentId: input.ownerAgentId }),
    ...(input.shortName === undefined ? {} : { shortName: input.shortName }),
  };
}

describe("src/skill/registry", () => {
  beforeEach(() => {
    skillRegistry.clearAll();
  });

  describe("registerSkill / getSkill", () => {
    it("should register and retrieve a skill", () => {
      const skill = createTestSkill("my-skill");
      registerSkill("my-skill", skill);
      assertEquals(getSkill("my-skill"), skill);
    });

    it("should return undefined for missing skill", () => {
      assertEquals(getSkill("nonexistent"), undefined);
    });
  });

  describe("getAllSkills", () => {
    it("should return all registered skills", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));
      const all = getAllSkills();
      assertEquals(all.size, 2);
      assertEquals(all.has("a"), true);
      assertEquals(all.has("b"), true);
    });

    it("should return empty map when no skills registered", () => {
      assertEquals(getAllSkills().size, 0);
    });
  });

  describe("resolveForAgent", () => {
    it("should return all skills for true", () => {
      registerSkill("x", createTestSkill("x"));
      registerSkill("y", createTestSkill("y"));
      const resolved = skillRegistry.resolveForAgent(true);
      assertEquals(resolved.size, 2);
    });

    it("should return only matching skills for string[]", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));
      registerSkill("c", createTestSkill("c"));
      const resolved = skillRegistry.resolveForAgent(["a", "c"]);
      assertEquals(resolved.size, 2);
      assertEquals(resolved.has("a"), true);
      assertEquals(resolved.has("c"), true);
      assertEquals(resolved.has("b"), false);
    });

    it("should skip missing IDs silently", () => {
      registerSkill("a", createTestSkill("a"));
      const resolved = skillRegistry.resolveForAgent(["a", "nonexistent"]);
      assertEquals(resolved.size, 1);
      assertEquals(resolved.has("a"), true);
    });

    it("should return empty map for all missing IDs", () => {
      const resolved = skillRegistry.resolveForAgent(["x", "y"]);
      assertEquals(resolved.size, 0);
    });
  });

  describe("resolveSelectorForAgent", () => {
    it("preserves omitted, true, empty, and allowlist selector policies", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));

      const omitted = skillRegistry.resolveSelectorForAgent(undefined);
      assertEquals(omitted.policy, { kind: "all-visible", source: "omitted" });
      assertEquals(omitted.allowedSkillIds, ["a", "b"]);

      const all = skillRegistry.resolveSelectorForAgent(true);
      assertEquals(all.policy, { kind: "all-visible", source: "true" });
      assertEquals(all.allowedSkillIds, ["a", "b"]);

      const none = skillRegistry.resolveSelectorForAgent([]);
      assertEquals(none.policy, { kind: "none" });
      assertEquals(none.allowedSkillIds, []);

      const selected = skillRegistry.resolveSelectorForAgent(["b"]);
      assertEquals(selected.policy, { kind: "allowlist", entries: ["b"] });
      assertEquals(selected.allowedSkillIds, ["b"]);
    });

    it("deduplicates explicit selections in request order and exposes source paths", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));

      const resolved = skillRegistry.resolveSelectorForAgent(["b", "a", "b"]);
      assertEquals(resolved.allowedSkillIds, ["b", "a"]);
      assertEquals(resolved.skillSourcePaths, {
        b: "/test/skills/b/SKILL.md",
        a: "/test/skills/a/SKILL.md",
      });
      assertEquals(resolved.definitions.map((skill) => skill.id), ["b", "a"]);
    });

    it("rejects unresolved explicit entries without echoing requested ids", () => {
      registerSkill("a", createTestSkill("a"));

      const error = assertThrows(
        () => skillRegistry.resolveSelectorForAgent(["missing-skill"]),
        Error,
        "configured skills are not available",
      );

      assertEquals(String(error).includes("missing-skill"), false);
    });

    it("applies the canonical selector matrix for owner-visible skills", () => {
      registerSkill("global", createScopedTestSkill({ id: "global" }));
      registerSkill("bundled", createScopedTestSkill({ id: "bundled" }));
      registerSkill(
        "agent--cite",
        createScopedTestSkill({ id: "agent--cite", ownerAgentId: "agent", shortName: "cite" }),
      );
      registerSkill(
        "other--style",
        createScopedTestSkill({ id: "other--style", ownerAgentId: "other", shortName: "style" }),
      );
      registerSkill("cite", createScopedTestSkill({ id: "cite" }));

      const cases: Array<{
        selector: true | string[] | undefined;
        expectedPolicy: object;
        expectedIds: string[];
      }> = [
        {
          selector: undefined,
          expectedPolicy: { kind: "all-visible", source: "omitted" },
          expectedIds: ["global", "bundled", "agent--cite", "cite"],
        },
        {
          selector: true,
          expectedPolicy: { kind: "all-visible", source: "true" },
          expectedIds: ["global", "bundled", "agent--cite", "cite"],
        },
        {
          selector: [],
          expectedPolicy: { kind: "none" },
          expectedIds: [],
        },
        {
          selector: ["bundled", "cite", "global", "bundled"],
          expectedPolicy: { kind: "allowlist", entries: ["bundled", "cite", "global", "bundled"] },
          expectedIds: ["bundled", "agent--cite", "global"],
        },
      ];

      for (const testCase of cases) {
        const snapshot = skillRegistry.resolveSelectorForAgent(testCase.selector, {
          agentId: "agent",
        });
        assertEquals(snapshot.policy, testCase.expectedPolicy);
        assertEquals(snapshot.allowedSkillIds, testCase.expectedIds);
        assertEquals(snapshot.definitions.map((skill) => skill.id), testCase.expectedIds);
      }
    });
  });
});
