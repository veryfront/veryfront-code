/**
 * Owner-scope leak tests for skills (threat model: controlled-adoption plan).
 *
 * Covers: `skills: true` leakage, explicit-id access to owned skills,
 * own-short-name-first resolution, skill tool enforcement for all three
 * skill tools, and error-message enumeration scoping.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { registerSkill, skillRegistry } from "./registry.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "./tools.ts";
import type { Skill } from "./types.ts";

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
  skillRegistry.clearAll();
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
    skillRegistry.clearAll();
  }
});

Deno.test("skills: true without an agent scope resolves to unowned skills only", () => {
  setupRegistry();
  try {
    const projectLevel = skillRegistry.resolveForAgent(true);
    assertEquals([...projectLevel.keys()], ["global-howto"]);
  } finally {
    skillRegistry.clearAll();
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
    skillRegistry.clearAll();
  }
});

Deno.test("explicit selector cannot reach another agent's owned skill by full id", () => {
  setupRegistry();
  try {
    const resolved = skillRegistry.resolveForAgent(["researcher--cite"], { agentId: "writer" });
    assertEquals(resolved.size, 0);
  } finally {
    skillRegistry.clearAll();
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
    skillRegistry.clearAll();
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
    skillRegistry.clearAll();
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
    skillRegistry.clearAll();
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
    skillRegistry.clearAll();
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
    skillRegistry.clearAll();
  }
});

Deno.test("load_skill loads the caller's own skill via its short name", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${tempDir}/SKILL.md`,
      `---\nname: cite\ndescription: Cite sources properly\n---\n\nAlways cite primary sources.\n`,
    );

    skillRegistry.clearAll();
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
    skillRegistry.clearAll();
    await Deno.remove(tempDir, { recursive: true });
  }
});
