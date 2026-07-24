import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildSkillManifestPrompt,
  MAX_SKILL_MANIFEST_PROMPT_ENTRIES,
} from "./prompt-augmentation.ts";
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

    it("should truncate long skill lists", () => {
      const skills = new Map(
        Array.from(
          { length: MAX_SKILL_MANIFEST_PROMPT_ENTRIES + 2 },
          (_unused, index) => {
            const skillNumber = index + 1;
            const id = `skill-${skillNumber}`;
            return [id, createSkill(id, `Skill ${skillNumber}`)] as const;
          },
        ),
      );

      const result = buildSkillManifestPrompt(skills);

      assertStringIncludes(result, "**skill-1**: Skill 1");
      assertStringIncludes(
        result,
        `**skill-${MAX_SKILL_MANIFEST_PROMPT_ENTRIES}**: Skill ${MAX_SKILL_MANIFEST_PROMPT_ENTRIES}`,
      );
      assertEquals(
        result.includes(
          `**skill-${MAX_SKILL_MANIFEST_PROMPT_ENTRIES + 1}**: Skill ${
            MAX_SKILL_MANIFEST_PROMPT_ENTRIES + 1
          }`,
        ),
        false,
      );
      assertStringIncludes(
        result,
        "2 more skill summaries omitted from this prompt. Call load_skill only with a known skill ID.",
      );
      assertEquals(result.includes("Use load_skill to discover"), false);
    });

    it("should stop iterating after the prompt entry limit", () => {
      const skills = new Map(
        Array.from(
          { length: MAX_SKILL_MANIFEST_PROMPT_ENTRIES + 2 },
          (_unused, index) => {
            const id = `skill-${index + 1}`;
            return [id, createSkill(id, `Skill ${index + 1}`)] as const;
          },
        ),
      );
      const iterate = skills[Symbol.iterator].bind(skills);
      let visitedEntries = 0;
      skills[Symbol.iterator] = function* (): MapIterator<[string, Skill]> {
        for (const entry of iterate()) {
          visitedEntries += 1;
          yield entry;
        }
        return undefined;
      };

      buildSkillManifestPrompt(skills);

      assertEquals(visitedEntries, MAX_SKILL_MANIFEST_PROMPT_ENTRIES);
    });

    it("should include tool usage instructions", () => {
      const skills = new Map([["test", createSkill("test", "desc")]]);
      const result = buildSkillManifestPrompt(skills);
      assertStringIncludes(result, "load_skill");
      assertStringIncludes(result, "load_skill_reference");
      assertStringIncludes(result, "execute_skill_script");
    });
  });
});
