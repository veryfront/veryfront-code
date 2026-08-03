import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import "./_test-setup.ts";
/**
 * Owner-scope leak tests for skills (threat model: controlled-adoption plan).
 *
 * Covers: `skills: true` leakage, explicit-id access to owned skills,
 * own-short-name-first resolution, skill tool enforcement for all three
 * skill tools, and error-message enumeration scoping.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { registerSkill, skillRegistry } from "./registry.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "./tools.ts";
import { type Skill, SKILL_NAME_REGEX, SKILL_PROVIDER_SAFE_ID_REGEX } from "./types.ts";

function makeSkill(input: {
  id: string;
  rootPath?: string;
  ownerAgentId?: string;
  shortName?: string;
}): Skill {
  return {
    id: input.id,
    metadata: { name: input.id, description: `${input.id} skill` },
    rootPath: input.rootPath ?? `/nonexistent/${input.id}`,
    ...(input.ownerAgentId === undefined ? {} : { ownerAgentId: input.ownerAgentId }),
    ...(input.shortName === undefined ? {} : { shortName: input.shortName }),
  };
}

function setupRegistry(): void {
  skillRegistryInternal.clearAll();
  registerSkill("global-howto", makeSkill({ id: "global-howto" }));
  registerSkill(
    "researcher--cite",
    makeSkill({ id: "researcher--cite", ownerAgentId: "researcher", shortName: "cite" }),
  );
  registerSkill(
    "writer--style",
    makeSkill({ id: "writer--style", ownerAgentId: "writer", shortName: "style" }),
  );
}

Deno.test("skills: true resolves to unowned skills plus the caller's own only", () => {
  setupRegistry();
  try {
    const researcher = skillRegistry.resolveForAgent(true, { agentId: "researcher" });
    assertEquals([...researcher.keys()].sort(), ["global-howto", "researcher--cite"]);

    const writer = skillRegistry.resolveForAgent(true, { agentId: "writer" });
    assertEquals([...writer.keys()].sort(), ["global-howto", "writer--style"]);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("skills: true without an agent scope resolves to unowned skills only", () => {
  setupRegistry();
  try {
    const projectLevel = skillRegistry.resolveForAgent(true);
    assertEquals([...projectLevel.keys()], ["global-howto"]);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("explicit selector resolves own short name before an exact global id", () => {
  setupRegistry();
  try {
    // A global skill whose id equals the researcher's own short name.
    registerSkill("cite", makeSkill({ id: "cite" }));

    const own = skillRegistry.resolveForAgent(["cite"], { agentId: "researcher" });
    assertEquals([...own.keys()], ["researcher--cite"]);

    const other = skillRegistry.resolveForAgent(["cite"], { agentId: "writer" });
    assertEquals([...other.keys()], ["cite"]);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("explicit selector cannot reach another agent's owned skill by full id", () => {
  setupRegistry();
  try {
    const resolved = skillRegistry.resolveForAgent(["researcher--cite"], { agentId: "writer" });
    assertEquals(resolved.size, 0);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("strict explicit selector rejects another agent's owned skill without owner-id leakage", () => {
  setupRegistry();
  try {
    const error = assertThrows(
      () =>
        skillRegistryInternal.resolveSelectorForAgent(["researcher--cite"], { agentId: "writer" }),
      Error,
      "configured skills are not available",
    );
    const message = String(error);
    assertEquals(message.includes("researcher--cite"), false);
    assertEquals(message.includes("writer--style"), false);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("strict explicit selector resolves own short name before exact visible id", () => {
  setupRegistry();
  try {
    registerSkill("cite", makeSkill({ id: "cite" }));

    const resolved = skillRegistryInternal.resolveSelectorForAgent(
      ["cite", "global-howto", "cite"],
      {
        agentId: "researcher",
      },
    );

    assertEquals(resolved.allowedSkillIds, ["researcher--cite", "global-howto"]);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("getVisibleSkillIds excludes other agents' owned skills", () => {
  setupRegistry();
  try {
    assertEquals(
      skillRegistry.getVisibleSkillIds({ agentId: "researcher" }).sort(),
      ["global-howto", "researcher--cite"],
    );
    assertEquals(skillRegistry.getVisibleSkillIds(), ["global-howto"]);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("hasVisibleSkills applies owner scope without building a catalog", () => {
  setupRegistry();
  try {
    assertEquals(skillRegistry.hasVisibleSkills({ agentId: "researcher" }), true);
    assertEquals(skillRegistry.hasVisibleSkills({ agentId: "writer" }), true);

    skillRegistryInternal.clearAll();
    registerSkill(
      "researcher--cite",
      makeSkill({ id: "researcher--cite", ownerAgentId: "researcher", shortName: "cite" }),
    );

    assertEquals(skillRegistry.hasVisibleSkills({ agentId: "researcher" }), true);
    assertEquals(skillRegistry.hasVisibleSkills({ agentId: "writer" }), false);
    assertEquals(skillRegistry.hasVisibleSkills(), false);
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("load_skill rejects another agent's owned skill and enumerates only visible ids", async () => {
  setupRegistry();
  try {
    const loadSkill = createLoadSkillTool();

    await assertRejects(
      () =>
        loadSkill.execute({ skillId: "researcher--cite" }, { agentId: "writer" }) as Promise<
          unknown
        >,
      Error,
      'Skill "researcher--cite" not found',
    );

    // The miss message must list only skills visible to the caller — never
    // another agent's owned skill ids.
    try {
      await loadSkill.execute({ skillId: "does-not-exist" }, { agentId: "writer" });
      throw new Error("expected load_skill to reject");
    } catch (error) {
      const message = String(error);
      assertEquals(message.includes("researcher--cite"), false);
      assertEquals(message.includes("global-howto"), true);
      assertEquals(message.includes("writer--style"), true);
    }
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("load_skill without agent context cannot reach any owned skill", async () => {
  setupRegistry();
  try {
    const loadSkill = createLoadSkillTool();
    await assertRejects(
      () => loadSkill.execute({ skillId: "researcher--cite" }, {}) as Promise<unknown>,
      Error,
      'Skill "researcher--cite" not found',
    );
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("load_skill_reference rejects another agent's owned skill", async () => {
  setupRegistry();
  try {
    const loadReference = createLoadSkillReferenceTool();
    await assertRejects(
      () =>
        loadReference.execute(
          { skillId: "researcher--cite", reference: "references/x.md" },
          { agentId: "writer" },
        ) as Promise<unknown>,
      Error,
      'Skill "researcher--cite" not found',
    );
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("execute_skill_script rejects another agent's owned skill", async () => {
  setupRegistry();
  try {
    const executeScript = createExecuteSkillScriptTool();
    await assertRejects(
      () =>
        executeScript.execute(
          { skillId: "researcher--cite", script: "scripts/run.sh" },
          { agentId: "writer" },
        ) as Promise<unknown>,
      Error,
      'Skill "researcher--cite" not found',
    );
  } finally {
    skillRegistryInternal.clearAll();
  }
});

Deno.test("load_skill loads the caller's own skill via its short name", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${tempDir}/SKILL.md`,
      `---\nname: cite\ndescription: Cite sources properly\n---\n\nAlways cite primary sources.\n`,
    );

    skillRegistryInternal.clearAll();
    registerSkill(
      "researcher--cite",
      makeSkill({
        id: "researcher--cite",
        rootPath: tempDir,
        ownerAgentId: "researcher",
        shortName: "cite",
      }),
    );

    const loadSkill = createLoadSkillTool();
    const content = await loadSkill.execute(
      { skillId: "cite" },
      { agentId: "researcher" },
    ) as { instructions: string; skillId: string };

    assertEquals(content.skillId, "researcher--cite");
    assertEquals(content.instructions.trim(), "Always cite primary sources.");
  } finally {
    skillRegistryInternal.clearAll();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("load_skill resolves provider-safe owned short names before plain-id validation", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${tempDir}/SKILL.md`,
      `---\nname: X Y\ndescription: Owned helper\n---\n\nUse the owned helper.\n`,
    );

    skillRegistryInternal.clearAll();
    registerSkill(
      "a_b--x_y",
      makeSkill({
        id: "a_b--x_y",
        rootPath: tempDir,
        ownerAgentId: "a.b",
        shortName: "x_y",
      }),
    );

    const loadSkill = createLoadSkillTool();
    const content = await loadSkill.execute(
      { skillId: "x_y" },
      { agentId: "a.b" },
    ) as { instructions: string; skillId: string };

    assertEquals(content.skillId, "a_b--x_y");
    assertEquals(content.instructions.trim(), "Use the owned helper.");
  } finally {
    skillRegistryInternal.clearAll();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("load_skill reports provider-safe guidance for invalid owned-looking selectors", async () => {
  setupRegistry();
  const originalNameTest = SKILL_NAME_REGEX.test;
  const originalProviderSafeTest = SKILL_PROVIDER_SAFE_ID_REGEX.test;
  SKILL_NAME_REGEX.test = () => true;
  SKILL_PROVIDER_SAFE_ID_REGEX.test = () => true;
  try {
    const loadSkill = createLoadSkillTool();

    await assertRejects(
      () => loadSkill.execute({ skillId: "Bad Name" }, { agentId: "writer" }) as Promise<unknown>,
      Error,
      'Invalid skill id "Bad Name": must be lowercase alphanumeric with hyphens, 1-64 characters',
    );

    await assertRejects(
      () =>
        loadSkill.execute({ skillId: "writer--Bad Name" }, { agentId: "writer" }) as Promise<
          unknown
        >,
      Error,
      'Invalid skill id "writer--Bad Name": must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters',
    );
  } finally {
    SKILL_NAME_REGEX.test = originalNameTest;
    SKILL_PROVIDER_SAFE_ID_REGEX.test = originalProviderSafeTest;
    skillRegistryInternal.clearAll();
  }
});
