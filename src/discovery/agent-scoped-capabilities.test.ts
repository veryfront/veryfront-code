import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
/**
 * Directory-agent discovery tests: colocated capabilities register with owner
 * metadata (pure registration), and the owner-aware resolver keeps agents
 * isolated — including coordinators from their delegates (plan tests 14, 15).
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  isProviderSafeToolName,
  isSafePathSegment,
  namespaceAgentCapability,
} from "./agent-scoped-capabilities.ts";
import { discoverRuntimeAgentMarkdownDefinitions } from "./handlers/runtime-agent-markdown-handler.ts";
import type { DiscoveryResult, FileDiscoveryContext } from "./types.ts";
import { registerSkill, skillRegistry } from "#veryfront/skill/registry.ts";
import { agentRegistry } from "../agent/composition/index.ts";

function emptyResult(): DiscoveryResult {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
  };
}

const context: FileDiscoveryContext = {
  platform: "node",
  allowHostProjectCodeExecution: true,
};

async function writeFixtureProject(root: string): Promise<string> {
  const agentsDir = `${root}/agents`;
  await Deno.mkdir(`${agentsDir}/researcher/skills/cite`, { recursive: true });
  await Deno.writeTextFile(
    `${agentsDir}/lead.md`,
    `---\nname: Lead\nskills: true\ndelegates: [researcher]\n---\nCoordinate the work.\n`,
  );
  await Deno.writeTextFile(
    `${agentsDir}/researcher/AGENT.md`,
    `---\nname: Researcher\nskills: true\n---\nResearch thoroughly.\n`,
  );
  await Deno.writeTextFile(
    `${agentsDir}/researcher/SKILL.md`,
    `---\nname: researcher\ndescription: Research methodology\n---\nFollow the method.\n`,
  );
  await Deno.writeTextFile(
    `${agentsDir}/researcher/skills/cite/SKILL.md`,
    `---\nname: cite\ndescription: Cite sources\n---\nCite primary sources.\n`,
  );
  return agentsDir;
}

function cleanupAgents(ids: string[]): void {
  for (const id of ids) {
    agentRegistry.delete(id);
  }
}

Deno.test("namespaceAgentCapability uses the -- separator and provider-safe names", () => {
  assertEquals(namespaceAgentCapability("researcher", "cite"), "researcher--cite");
  assertEquals(namespaceAgentCapability("a.b", "x"), "a_b--x");
  assertEquals(isProviderSafeToolName("researcher--fetch-paper"), true);
  assertEquals(isProviderSafeToolName("researcher__fetch"), true);
  assertEquals(isProviderSafeToolName("bad.name"), false);
  assertEquals(isProviderSafeToolName("a".repeat(65)), false);
});

Deno.test("isSafePathSegment rejects traversal segments", () => {
  assertEquals(isSafePathSegment("."), false);
  assertEquals(isSafePathSegment(".."), false);
  assertEquals(isSafePathSegment("researcher"), true);
  assertEquals(isSafePathSegment("a/b"), false);
});

Deno.test("directory and flat agents discover side by side with owned skills registered", async () => {
  const root = await Deno.makeTempDir();
  skillRegistryInternal.clearAll();
  try {
    const agentsDir = await writeFixtureProject(root);
    const result = emptyResult();

    await discoverRuntimeAgentMarkdownDefinitions(agentsDir, result, context);

    assertEquals(result.errors, []);
    assertEquals([...result.agents.keys()].sort(), ["lead", "researcher"]);

    const own = skillRegistry.get("researcher");
    assertEquals(own?.ownerAgentId, "researcher");
    assertEquals(own?.shortName, "researcher");

    const nested = skillRegistry.get("researcher--cite");
    assertEquals(nested?.ownerAgentId, "researcher");
    assertEquals(nested?.shortName, "cite");
  } finally {
    skillRegistryInternal.clearAll();
    cleanupAgents(["lead", "researcher"]);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("directory agents with dotted ids register provider-safe owned skill ids", async () => {
  const root = await Deno.makeTempDir();
  skillRegistryInternal.clearAll();
  try {
    const agentsDir = `${root}/agents`;
    await Deno.mkdir(`${agentsDir}/a.b/skills/x_y`, { recursive: true });
    await Deno.writeTextFile(
      `${agentsDir}/a.b/AGENT.md`,
      `---\nname: Dotted Agent\nskills: [x_y]\n---\nHandle dotted ids.\n`,
    );
    await Deno.writeTextFile(
      `${agentsDir}/a.b/skills/x_y/SKILL.md`,
      `---\nname: X Y\ndescription: Owned underscore helper\nmetadata:\n  display_name: X Y\n---\nUse X Y.\n`,
    );

    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(agentsDir, result, context);

    assertEquals(result.errors, []);
    const skill = skillRegistry.get("a_b--x_y");
    assertEquals(skill?.id, "a_b--x_y");
    assertEquals(skill?.metadata.name, "a_b--x_y");
    assertEquals(skill?.metadata.displayName, "X Y");
    assertEquals(skill?.ownerAgentId, "a.b");
    assertEquals(skill?.shortName, "x_y");
  } finally {
    skillRegistryInternal.clearAll();
    cleanupAgents(["a.b"]);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a coordinator's skills: true does not include its delegate's owned skills", async () => {
  const root = await Deno.makeTempDir();
  skillRegistryInternal.clearAll();
  try {
    const agentsDir = await writeFixtureProject(root);
    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(agentsDir, result, context);

    // Lead delegates to researcher but must not see researcher's owned skills.
    const leadSkills = skillRegistry.resolveForAgent(true, { agentId: "lead" });
    assertEquals([...leadSkills.keys()], []);

    // The specialist sees its own skills.
    const researcherSkills = skillRegistry.resolveForAgent(true, { agentId: "researcher" });
    assertEquals([...researcherSkills.keys()].sort(), ["researcher", "researcher--cite"]);

    // And the delegate tool exists on the coordinator (delegation unaffected).
    // skills: true also merges the shared skill tools into config.tools.
    const lead = result.agents.get("lead");
    const tools = lead?.config.tools as Record<string, unknown> | undefined;
    assertEquals(Object.keys(tools ?? {}).includes("agent_researcher"), true);
  } finally {
    skillRegistryInternal.clearAll();
    cleanupAgents(["lead", "researcher"]);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("duplicate flat and directory agent ids report a discovery error", async () => {
  const root = await Deno.makeTempDir();
  skillRegistryInternal.clearAll();
  try {
    const agentsDir = `${root}/agents`;
    await Deno.mkdir(`${agentsDir}/writer`, { recursive: true });
    await Deno.writeTextFile(`${agentsDir}/writer.md`, `---\nname: Writer Flat\n---\nA.\n`);
    await Deno.writeTextFile(
      `${agentsDir}/writer/AGENT.md`,
      `---\nname: Writer Dir\n---\nB.\n`,
    );

    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(agentsDir, result, context);

    assertEquals(result.agents.size, 1);
    assertEquals(result.errors.length, 1);
    assertEquals(String(result.errors[0]?.error).includes('Duplicate agent id "writer"'), true);
  } finally {
    skillRegistryInternal.clearAll();
    cleanupAgents(["writer"]);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("owned short name shadowing a global skill id reports a diagnostic", async () => {
  const root = await Deno.makeTempDir();
  skillRegistryInternal.clearAll();
  try {
    // Pre-existing global skill with the id "cite".
    registerSkill("cite", {
      id: "cite",
      metadata: { name: "cite", description: "Global cite skill" },
      rootPath: "/nonexistent/cite",
    });

    const agentsDir = await writeFixtureProject(root);
    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(agentsDir, result, context);

    const shadowing = result.errors.filter((entry) =>
      String(entry.error).includes('shadows the global skill id "cite"')
    );
    assertEquals(shadowing.length, 1);

    // Both skills remain registered; resolution stays owner-aware.
    const own = skillRegistry.resolveForAgent(["cite"], { agentId: "researcher" });
    assertEquals([...own.keys()], ["researcher--cite"]);
    const other = skillRegistry.resolveForAgent(["cite"], { agentId: "lead" });
    assertEquals([...other.keys()], ["cite"]);
  } finally {
    skillRegistryInternal.clearAll();
    cleanupAgents(["lead", "researcher"]);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("agent ids that sanitize to the same namespace report a collision error", async () => {
  const root = await Deno.makeTempDir();
  skillRegistryInternal.clearAll();
  try {
    const agentsDir = `${root}/agents`;
    await Deno.mkdir(`${agentsDir}/a.b`, { recursive: true });
    await Deno.mkdir(`${agentsDir}/a_b`, { recursive: true });
    await Deno.writeTextFile(`${agentsDir}/a.b/AGENT.md`, `---\nname: AB1\n---\nOne.\n`);
    await Deno.writeTextFile(
      `${agentsDir}/a.b/SKILL.md`,
      `---\nname: ab\ndescription: d\n---\nX.\n`,
    );
    await Deno.writeTextFile(`${agentsDir}/a_b/AGENT.md`, `---\nname: AB2\n---\nTwo.\n`);

    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(agentsDir, result, context);

    const collisions = result.errors.filter((entry) =>
      String(entry.error).includes("shares the sanitized capability namespace")
    );
    assertEquals(collisions.length, 1);
  } finally {
    skillRegistryInternal.clearAll();
    cleanupAgents(["a.b", "a_b"]);
    await Deno.remove(root, { recursive: true });
  }
});

// ── Full-pipeline regression (review finding: discoverAll wiped colocated skills) ──

import { discoverAll as discoverAllRaw } from "./index.ts";

function discoverAll(config: import("./types.ts").DiscoveryConfig) {
  return discoverAllRaw({ ...config, allowHostProjectCodeExecution: true });
}

Deno.test("discoverAll preserves directory-agent colocated skills through the skill-registry clear", async () => {
  const root = await Deno.makeTempDir();
  skillRegistryInternal.clearAll();
  try {
    await writeFixtureProject(root);
    // A global skill whose id shadows researcher's "cite" short name —
    // discovered through the real pipeline (skills before agents), so the
    // shadow diagnostic must fire without manual pre-registration.
    await Deno.mkdir(`${root}/skills/cite`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/skills/cite/SKILL.md`,
      `---\nname: cite\ndescription: Global cite skill\n---\nGlobal citing.\n`,
    );

    const result = await discoverAll({ baseDir: root });

    // Colocated skills survive the registry clear and surface in the result.
    assertEquals(skillRegistry.get("researcher")?.ownerAgentId, "researcher");
    assertEquals(skillRegistry.get("researcher--cite")?.ownerAgentId, "researcher");
    assertEquals(result.skills.has("researcher"), true);
    assertEquals(result.skills.has("researcher--cite"), true);
    assertEquals(result.skills.has("cite"), true);

    // The agent sees its own skills plus the unowned global one.
    assertEquals(
      [...skillRegistry.resolveForAgent(true, { agentId: "researcher" }).keys()].sort(),
      ["cite", "researcher", "researcher--cite"],
    );
    // Other agents see only the global skill.
    assertEquals(
      [...skillRegistry.resolveForAgent(true, { agentId: "lead" }).keys()],
      ["cite"],
    );

    // Shadow diagnostic fires through the natural pipeline ordering.
    const shadowing = result.errors.filter((entry) =>
      String(entry.error).includes('shadows the global skill id "cite"')
    );
    assertEquals(shadowing.length, 1);
  } finally {
    skillRegistryInternal.clearAll();
    cleanupAgents(["lead", "researcher"]);
    await Deno.remove(root, { recursive: true });
  }
});

// ── Colocated tool loading through the real transpiler (esbuild) ─────────

import { clearMCPRegistry } from "#veryfront/mcp";
import { toolRegistry } from "#veryfront/tool";
import { executeTool } from "#veryfront/tool";

Deno.test({
  name: "discoverAll loads colocated tools/*.ts with owner metadata and gates execution",
  // importModule transpiles via esbuild, which keeps a warm child process
  // alive across tests and trips Deno's op/resource sanitizers — same reason
  // src/discovery/transpiler.test.ts opts out (tracked in the lint baseline).
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const root = await Deno.makeTempDir();
    skillRegistryInternal.clearAll();
    clearMCPRegistry();
    try {
      await Deno.mkdir(`${root}/agents/researcher/tools`, { recursive: true });
      await Deno.writeTextFile(
        `${root}/agents/researcher/AGENT.md`,
        `---\nname: Researcher\ntools: [fetch-paper, summarize]\n---\nResearch.\n`,
      );
      await Deno.writeTextFile(
        `${root}/agents/researcher/tools/fetch-paper.ts`,
        `export const fetchPaper = {
  id: "fetch-paper",
  type: "function",
  description: "Fetch a paper by id",
  inputSchema: { type: "object", properties: {} },
  execute: () => Promise.resolve({ ok: true, paper: "attention-is-all-you-need" }),
};
`,
      );
      // A second module exporting the same explicit short name — must be
      // reported at discovery instead of silently dropped (sorted after
      // fetch-paper.ts, so the first registration wins).
      await Deno.writeTextFile(
        `${root}/agents/researcher/tools/zz-dupe.ts`,
        `export const dupe = {
  id: "fetch-paper",
  type: "function",
  description: "Conflicting duplicate",
  inputSchema: { type: "object", properties: {} },
  execute: () => Promise.resolve({ ok: false, dupe: true }),
};
`,
      );
      // Authored the idiomatic way: `tool()` with no explicit id, so the
      // factory stamps a generated `tool_<epoch>_<n>` id that must not become
      // the agent-facing short name.
      await Deno.writeTextFile(
        `${root}/agents/researcher/tools/summarize.ts`,
        `import { tool } from "veryfront/tool";

export default tool({
  description: "Summarize a paper",
  inputSchema: { type: "object", properties: {} },
  execute: () => Promise.resolve({ ok: true }),
});
`,
      );
      // A module whose explicit id namespaces into a provider-unsafe tool
      // name is rejected at registration instead of reaching the registry.
      await Deno.writeTextFile(
        `${root}/agents/researcher/tools/aa-unsafe.ts`,
        `export const unsafe = {
  id: "fetch.paper",
  type: "function",
  description: "Dotted id is not provider safe",
  inputSchema: { type: "object", properties: {} },
  execute: () => Promise.resolve({ ok: false, unsafe: true }),
};
`,
      );

      const result = await discoverAll({ baseDir: root });
      const duplicateErrors = result.errors.filter((entry) =>
        String(entry.error).includes('Duplicate colocated tool "fetch-paper"')
      );
      assertEquals(duplicateErrors.length, 1);
      const unsafeErrors = result.errors.filter((entry) =>
        String(entry.error).includes('invalid tool name "researcher--fetch.paper"')
      );
      assertEquals(
        unsafeErrors.length,
        1,
        "an unsafe namespaced tool name must be reported at discovery",
      );
      assertEquals(
        toolRegistry.get("researcher--fetch.paper"),
        undefined,
        "a provider-unsafe tool name must not reach the registry",
      );
      assertEquals(
        result.errors.filter((entry) =>
          !duplicateErrors.includes(entry) && !unsafeErrors.includes(entry)
        ),
        [],
      );

      // Registered under the namespaced id with owner metadata.
      const registered = toolRegistry.get("researcher--fetch-paper");
      assertEquals(registered?.ownerAgentId, "researcher");
      assertEquals(registered?.shortName, "fetch-paper");

      // Owner executes (by full id through the registry gate)...
      const ok = await executeTool("researcher--fetch-paper", {}, { agentId: "researcher" });
      assertEquals(ok, { ok: true, paper: "attention-is-all-you-need" });

      // ...other agents and external callers cannot.
      let rejected = false;
      try {
        await executeTool("researcher--fetch-paper", {}, { agentId: "writer" });
      } catch (error) {
        rejected = true;
        assertEquals(String(error).includes("not found"), true);
      }
      assertEquals(rejected, true);

      // A tool authored without an explicit id falls back to its filename for
      // the agent-facing short name instead of leaking the generated id.
      const generated = toolRegistry.get("researcher--summarize");
      assertEquals(
        generated?.shortName,
        "summarize",
        "a generated tool id must fall back to the filename short name",
      );
      assertEquals(
        generated?.ownerAgentId,
        "researcher",
        "colocated tools must carry owner metadata",
      );
      assertEquals(
        await executeTool("researcher--summarize", {}, { agentId: "researcher" }),
        { ok: true },
        "the owner must be able to execute its filename-named tool",
      );
    } finally {
      skillRegistryInternal.clearAll();
      clearMCPRegistry();
      cleanupAgents(["researcher"]);
      await Deno.remove(root, { recursive: true });
    }
  },
});
