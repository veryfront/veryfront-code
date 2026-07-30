import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { skillRegistry, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import { createLoadSkillTool } from "#veryfront/skill/tools.ts";
import { join, relative, resolve } from "#veryfront/compat/path";
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
    assertEquals(Object.isFrozen(duplicate), false);
    duplicate.metadata.description = "Caller-local mutation";

    const registryDuplicate = skillRegistry.get("duplicate");
    assertExists(registryDuplicate);
    assertEquals(registryDuplicate.metadata.description, "First copy");

    assertEquals(result.skills.has("other"), true);
    assertEquals(
      result.errors.map(({ code, sourceKind, sourceId }) => ({
        code,
        sourceKind,
        sourceId,
      })),
      [{
        code: "duplicate_id",
        sourceKind: "skill",
        sourceId: "duplicate",
      }],
    );
  });

  it("uses the directory identity and preserves a mismatched authored name as display metadata", async () => {
    const result = await discoverAll({
      baseDir: "/project",
      toolDirs: [],
      agentDirs: [],
      resourceDirs: [],
      promptDirs: [],
      workflowDirs: [],
      taskDirs: [],
      skillDirs: ["skills"],
      fsAdapter: createSkillTestAdapter({
        "/project/skills/missing/SKILL.md": `---
description: Missing name
---
Missing.`,
        "/project/skills/directory-name/SKILL.md": `---
name: different-name
description: Mismatched name
---
Mismatch.`,
        "/project/skills/valid/SKILL.md": `---
name: valid
description: |
  Valid skill
  with a multiline description
---
Valid.`,
      }),
      verbose: false,
    });

    assertEquals([...result.skills.keys()], ["directory-name", "valid"]);
    assertEquals(
      result.skills.get("directory-name")?.metadata.displayName,
      "different-name",
    );
    assertEquals(
      result.skills.get("valid")?.metadata.description,
      "Valid skill\nwith a multiline description",
    );
    assertEquals(
      result.errors.map(({ code, sourceId }) => ({ code, sourceId })),
      [{ code: "load_error", sourceId: "missing" }],
    );
  });

  it("rejects oversized skill documents before reading their contents", async () => {
    const skillPath = "/project/skills/oversized/SKILL.md";
    const baseAdapter = createSkillTestAdapter({
      [skillPath]: `---
name: oversized
description: Oversized
---
Body`,
    });
    let readAttempted = false;
    const result = await discoverAll({
      baseDir: "/project",
      toolDirs: [],
      agentDirs: [],
      resourceDirs: [],
      promptDirs: [],
      workflowDirs: [],
      taskDirs: [],
      skillDirs: ["skills"],
      fsAdapter: {
        ...baseAdapter,
        async stat(path: string) {
          const info = await baseAdapter.stat(path);
          return path === skillPath ? { ...info, size: 1_048_577 } : info;
        },
        async readFile(path: string) {
          if (path === skillPath) readAttempted = true;
          return await baseAdapter.readFile(path);
        },
      },
      verbose: false,
    });

    assertEquals(result.skills.size, 0);
    assertEquals(result.errors[0]?.code, "load_error");
    assertEquals(readAttempted, false);
  });

  it("anchors relative native discovery roots so discovered skills can be loaded", async () => {
    const tempDir = await Deno.makeTempDir({
      dir: Deno.cwd(),
      prefix: ".vf-relative-native-skill-",
    });
    try {
      const skillDir = join(tempDir, "skills", "demo");
      await Deno.mkdir(skillDir, { recursive: true });
      await Deno.writeTextFile(
        join(skillDir, "SKILL.md"),
        `---
name: demo
description: Native relative-root skill
---
Use the native skill.`,
      );

      const result = await discoverAll({
        baseDir: relative(Deno.cwd(), tempDir),
        toolDirs: [],
        agentDirs: [],
        skillDirs: ["skills"],
        resourceDirs: [],
        promptDirs: [],
        workflowDirs: [],
        taskDirs: [],
        scheduleDirs: [],
        webhookDirs: [],
        evalDirs: [],
      });

      const skill = result.skills.get("demo");
      assertExists(skill);
      assertEquals(skill.rootPath, resolve(skillDir));
      assertEquals(result.errors, []);

      const loaded = await createLoadSkillTool().execute({ skillId: "demo" });
      assertEquals(loaded.instructions.trim(), "Use the native skill.");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rebases absolute skill validation paths onto exact relative adapter keys", async () => {
    const adapter = createSkillTestAdapter({
      "skills/demo/SKILL.md": `---
name: demo
description: Hosted relative-root skill
---
Use the hosted skill.`,
      "skills/demo/references/guide.md": "Hosted guide",
    });

    const result = await discoverAll({
      baseDir: "",
      toolDirs: [],
      agentDirs: [],
      skillDirs: ["skills"],
      resourceDirs: [],
      promptDirs: [],
      workflowDirs: [],
      taskDirs: [],
      scheduleDirs: [],
      webhookDirs: [],
      evalDirs: [],
      fsAdapter: adapter,
    });

    const skill = result.skills.get("demo");
    assertExists(skill);
    assertEquals(skill.rootPath, resolve("skills/demo"));
    assertEquals(skill.fsAdapter === adapter, false);
    assertEquals(result.errors, []);

    const loaded = await createLoadSkillTool().execute({ skillId: "demo" });
    assertEquals(loaded.instructions.trim(), "Use the hosted skill.");
    assertEquals(loaded.references, ["references/guide.md"]);
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
