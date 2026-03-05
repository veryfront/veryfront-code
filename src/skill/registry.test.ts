import { assertEquals } from "#veryfront/testing/assert.ts";
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
});
