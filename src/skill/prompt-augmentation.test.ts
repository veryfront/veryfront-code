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
      assertStringIncludes(result, "## Available Skills");
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
      assertStringIncludes(result, "load-skill");
      assertStringIncludes(result, "load-skill-reference");
      assertStringIncludes(result, "execute-skill-script");
    });
  });
});
