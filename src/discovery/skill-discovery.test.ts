import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import { discoverAll } from "./index.ts";

describe("src/discovery/skill-discovery", () => {
  beforeEach(() => {
    skillRegistryInternal.clearAll();
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

  it("discovers legacy display-style names by canonical directory id", async () => {
    const files = {
      "/project/skills/process-email/SKILL.md": `---
name: Process Email
description: Processes support emails.
metadata:
  display_name: Support Email Processor
  team: support
---
Use this skill for support email workflows.`,
    };

    const result = await discoverAll({
      baseDir: "/project",
      toolDirs: [],
      agentDirs: [],
      resourceDirs: [],
      promptDirs: [],
      workflowDirs: [],
      taskDirs: [],
      skillDirs: ["skills"],
      fsAdapter: createSkillTestAdapter(files),
      verbose: false,
    });

    const skill = result.skills.get("process-email");
    assertExists(skill);
    assertEquals(skill.id, "process-email");
    assertEquals(skill.metadata.name, "process-email");
    assertEquals(skill.metadata.displayName, "Support Email Processor");
    assertEquals(skill.metadata.metadata, {
      display_name: "Support Email Processor",
      team: "support",
    });

    const registrySkill = skillRegistry.get("process-email");
    assertExists(registrySkill);
    assertEquals(registrySkill.metadata.displayName, "Support Email Processor");
    assertEquals(result.skills.has("Process Email"), false);
  });
});
