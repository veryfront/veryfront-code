import { registerSkill, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { createLoadSkillReferenceTool } from "#veryfront/skill/tools.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import type { Skill } from "#veryfront/skill/types.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";

function createTestSkill(id: string): Skill {
  return {
    id,
    metadata: {
      name: id,
      description: `Skill ${id}`,
    },
    rootPath: `/project/skills/${id}`,
    fsAdapter: createSkillTestAdapter({
      [`/project/skills/${id}/references/guide.md`]: "Guide",
      [`/project/skills/${id}/references/private/secret.md`]: "Secret",
    }),
  };
}

describe("skill tool intrinsic isolation", () => {
  beforeEach(() => {
    skillRegistryInternal.clearAll();
  });

  it("rejects forged availability when Array.prototype.includes is poisoned", async () => {
    registerSkill("my-skill", createTestSkill("my-skill"));
    const tool = createLoadSkillReferenceTool();
    const originalIncludes = Array.prototype.includes;
    Array.prototype.includes = () => true;

    try {
      await assertRejects(
        () =>
          tool.execute({
            skillId: "my-skill",
            reference: "references/private/secret.md",
          }, {
            activeSkillId: "my-skill",
            activeSkillToolAvailability: {
              hasActiveSkill: true,
              references: ["references/private/secret.md"],
              scripts: [],
            },
          }),
        Error,
        "advertised by load_skill",
      );
    } finally {
      Array.prototype.includes = originalIncludes;
    }
  });
});
