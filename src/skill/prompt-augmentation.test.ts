import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildSkillManifestPrompt } from "./prompt-augmentation.ts";
import type { Skill } from "./types.ts";

function createSkill(id: string, description: string): Skill {
  return {
    id,
    metadata: { name: id, description },
    rootPath: `/test/skills/${id}`,
  };
}

describe("src/skill/prompt-augmentation", () => {
  describe("buildSkillManifestPrompt", () => {
    it("should return empty string for empty map", () => {
      assertEquals(buildSkillManifestPrompt(new Map()), "");
    });

    it("should include header for single skill", () => {
      const skills = new Map([["my-skill", createSkill("my-skill", "Does things")]]);
      const result = buildSkillManifestPrompt(skills);
      assertStringIncludes(result, "## Available skills");
      assertStringIncludes(result, "**my-skill**: Does things");
    });

    it("should list all skills", () => {
      const skills = new Map([
        ["skill-a", createSkill("skill-a", "First skill")],
        ["skill-b", createSkill("skill-b", "Second skill")],
      ]);
      const result = buildSkillManifestPrompt(skills);
      assertStringIncludes(result, "**skill-a**: First skill");
      assertStringIncludes(result, "**skill-b**: Second skill");
    });

    it("should include tool usage instructions", () => {
      const skills = new Map([["test", createSkill("test", "desc")]]);
      const result = buildSkillManifestPrompt(skills);
      assertStringIncludes(result, "load_skill");
      assertStringIncludes(result, "load_skill_reference");
      assertStringIncludes(result, "execute_skill_script");
    });

    it("should keep multiline metadata on one escaped manifest line", () => {
      const skills = new Map([
        ["unsafe*id", createSkill("unsafe*id", "First line\n## Injected heading\u0000")],
      ]);

      const result = buildSkillManifestPrompt(skills);

      assertStringIncludes(result, "**unsafe\\*id**");
      assertStringIncludes(result, "First line ## Injected heading");
      assertEquals(result.includes("\n## Injected heading"), false);
      assertEquals(result.includes("\u0000"), false);
    });

    it("should bound the number of manifest entries", () => {
      const skills = new Map<string, Skill>();
      for (let index = 0; index < 32; index += 1) {
        const id = `skill-${index}`;
        skills.set(id, createSkill(id, `Skill ${index}`));
      }

      const result = buildSkillManifestPrompt(skills);

      assertStringIncludes(result, "2 additional configured skills omitted");
      assertEquals(result.includes("**skill-30**"), false);
    });
  });
});
