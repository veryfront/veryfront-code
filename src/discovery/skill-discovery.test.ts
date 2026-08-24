import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
import { discoverAll as discoverAllRaw } from "./index.ts";
import type { DiscoveryConfig } from "./types.ts";

function discoverAll(config: DiscoveryConfig) {
  return discoverAllRaw({ ...config, allowHostProjectCodeExecution: true });
}

describe("src/discovery/skill-discovery", () => {
  beforeEach(() => {
    skillRegistryInternal.clearAll();
  });

  it("keeps first duplicate skill across discovery roots and registry", async () => {
    // Exercise the product composition path, not the test-only parser setup.
    const originalParser = tryResolve<SkillDocumentParserProvider>(
      SkillDocumentParserProviderName,
    );
    unregister(SkillDocumentParserProviderName);
    try {
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
      assertExists(
        tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName),
      );
      assertExists(duplicate);
      assertEquals(duplicate.metadata.description, "First copy");

      const registryDuplicate = skillRegistry.get("duplicate");
      assertExists(registryDuplicate);
      assertEquals(registryDuplicate.metadata.description, "First copy");

      assertEquals(result.skills.has("other"), true);
    } finally {
      if (originalParser === undefined) {
        unregister(SkillDocumentParserProviderName);
      } else {
        register(SkillDocumentParserProviderName, originalParser);
      }
    }
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

  it("publishes skills from an adapter-relative project namespace", async () => {
    const adapter = createSkillTestAdapter({
      "skills/cloud-skill/SKILL.md": `---
name: cloud-skill
description: Adapter-relative skill
---
Use the cloud-backed skill.`,
    });

    const result = await discoverAll({
      baseDir: "",
      toolDirs: [],
      agentDirs: [],
      resourceDirs: [],
      promptDirs: [],
      workflowDirs: [],
      taskDirs: [],
      skillDirs: ["skills"],
      fsAdapter: adapter,
      verbose: false,
    });

    assertEquals(result.errors, []);
    assertEquals(result.skills.get("cloud-skill")?.rootPath, "skills/cloud-skill");
    assertStrictEquals(
      skillRegistryInternal.get("cloud-skill")?.fsAdapter,
      adapter,
    );
  });

  it("reports a malformed SKILL.md in result.errors while publishing the valid siblings", async () => {
    const files = {
      "/project/skills/good/SKILL.md": `---
name: good
description: A valid sibling skill
---
Use the valid skill.`,
      "/project/skills/bad/SKILL.md": `---
name: bad
description: A skill with conflicting tool declarations
allowed-tools: Read
allowed_tools: Write
---
Use the invalid skill.`,
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

    assertEquals(result.skills.has("good"), true, "a valid sibling must still publish");
    assertEquals(
      result.errors.length,
      1,
      "a SKILL.md that fails validation must surface exactly one discovery error",
    );
    assertEquals(result.errors[0]?.file, "/project/skills/bad/SKILL.md");
    assertStringIncludes(
      String(result.errors[0]?.error),
      "must not declare both",
      "the discovery error must carry the validation cause",
    );
  });
});
