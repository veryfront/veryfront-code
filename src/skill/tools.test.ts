import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { registerSkill, skillRegistry } from "./registry.ts";
import { createLoadSkillReferenceTool, createLoadSkillTool } from "./tools.ts";
import type { Skill } from "./types.ts";
import { createSkillTestAdapter } from "./testing.ts";

function createTestSkill(fsAdapter: FileSystemAdapter): Skill {
  return {
    id: "my-skill",
    metadata: {
      name: "my-skill",
      description: "Skill from adapter",
    },
    rootPath: "/project/skills/my-skill",
    fsAdapter,
  };
}

describe("src/skill/tools", () => {
  beforeEach(() => {
    skillRegistry.clearAll();
  });

  it("load-skill should list references and scripts via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
      "/project/skills/my-skill/references/guide.md": "Guide",
      "/project/skills/my-skill/scripts/run.sh": "echo run",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.references, ["references/guide.md"]);
    assertEquals(result.scripts, ["scripts/run.sh"]);
  });

  it("load-skill-reference should read content via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Reference text",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "my-skill",
      reference: "references/guide.md",
    });

    assertEquals(result.content, "Reference text");
    assertEquals(result.path, "references/guide.md");
  });
});
