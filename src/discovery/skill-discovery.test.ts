import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import { discoverAll } from "./index.ts";

describe("src/discovery/skill-discovery", () => {
  beforeEach(() => {
    skillRegistry.clearAll();
  });

  it("keeps first duplicate skill across discovery roots and registry", async () => {
    const files = {
      "/project/skills-a/duplicate/SKILL.md": `---
name: duplicate
description: First copy
---
Use first.`,
      "/project/skills-b/duplicate/SKILL.md": `---
name: duplicate
description: Second copy
---
Use second.`,
      "/project/skills-b/other/SKILL.md": `---
name: other
description: Another skill
---
Other instructions.`,
    };

    const result = await discoverAll({
      baseDir: "/project",
      toolDirs: [],
      agentDirs: [],
      resourceDirs: [],
      promptDirs: [],
      workflowDirs: [],
      taskDirs: [],
      skillDirs: ["skills-a", "skills-b"],
      fsAdapter: createSkillTestAdapter(files),
      verbose: false,
    });

    const duplicate = result.skills.get("duplicate");
    assertExists(duplicate);
    assertEquals(duplicate.metadata.description, "First copy");

    const registryDuplicate = skillRegistry.get("duplicate");
    assertExists(registryDuplicate);
    assertEquals(registryDuplicate.metadata.description, "First copy");

    assertEquals(result.skills.has("other"), true);
  });
});
