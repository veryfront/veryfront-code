import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { discoverRuntimeAgentMarkdownDefinitions } from "./runtime-agent-markdown-handler.ts";
import { getRuntimeAgentMarkdownRootPath } from "../../agent/runtime/agent-markdown-adapter.ts";
import type { DiscoveryResult, FileDiscoveryContext } from "../types.ts";

const context: FileDiscoveryContext = { platform: "node" };

function emptyResult(): DiscoveryResult {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    errors: [],
  };
}

function write(path: string, content: string): void {
  Deno.writeTextFileSync(path, content);
}

// Agents with colocated tools/*.ts trigger importModule (esbuild child process),
// so sanitizers are disabled here (matches src/discovery/transpiler.test.ts).
Deno.test({
  name: "discoverRuntimeAgentMarkdownDefinitions discovers flat and directory agents",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = Deno.makeTempDirSync();
    try {
      write(resolve(dir, "mad-lead.md"), "---\nname: Lead\n---\nCoordinate.");

      const agentDir = resolve(dir, "mad-researcher");
      Deno.mkdirSync(resolve(agentDir, "skills", "cite"), { recursive: true });
      Deno.mkdirSync(resolve(agentDir, "tools"), { recursive: true });
      write(
        resolve(agentDir, "AGENT.md"),
        "---\nname: Researcher\nskills: true\ntools: true\n---\nResearch.",
      );
      write(
        resolve(agentDir, "SKILL.md"),
        "---\nname: mad-researcher\ndescription: own\n---\nOwn.",
      );
      write(
        resolve(agentDir, "skills", "cite", "SKILL.md"),
        "---\nname: mad-cite\ndescription: cite\n---\nCite.",
      );
      write(
        resolve(agentDir, "tools", "fetch.ts"),
        'export const fetch = { id: "fetch", type: "function", description: "f",' +
          ' inputSchema: { type: "object", properties: {} }, execute: async () => ({}) };\n',
      );
      // Non-agent markdown inside the agent dir must be ignored.
      write(resolve(agentDir, "notes.md"), "# scratch notes");

      const result = emptyResult();
      await discoverRuntimeAgentMarkdownDefinitions(dir, result, context);

      assertEquals([...result.agents.keys()].sort(), ["mad-lead", "mad-researcher"]);
      assertEquals(result.errors, []);

      const researcher = result.agents.get("mad-researcher");
      assertEquals(getRuntimeAgentMarkdownRootPath(researcher!), agentDir);
      // Colocated skills resolve to namespaced ids (own skill = agent id).
      assertEquals(researcher!.config.skills, ["mad-researcher", "mad-researcher__cite"]);
      // Colocated tools are namespaced and attached to the agent config.
      const toolNames = Object.keys(
        (researcher!.config.tools as Record<string, unknown>) ?? {},
      );
      assertEquals(toolNames.includes("mad-researcher__fetch"), true);

      const lead = result.agents.get("mad-lead");
      assertEquals(getRuntimeAgentMarkdownRootPath(lead!), null);
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});

Deno.test("discoverRuntimeAgentMarkdownDefinitions ignores directories without AGENT.md", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    const skillOnlyDir = resolve(dir, "mad-skillonly");
    Deno.mkdirSync(skillOnlyDir, { recursive: true });
    write(resolve(skillOnlyDir, "SKILL.md"), "---\nname: Stray\n---\nNot an agent.");

    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(dir, result, context);

    assertEquals([...result.agents.keys()], []);
    assertEquals(result.errors, []);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("flat agents keep their declared skills selector (global-registry back-compat)", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    write(resolve(dir, "mad-flat.md"), "---\nname: Flat\nskills: true\n---\nUse global skills.");

    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(dir, result, context);

    const flat = result.agents.get("mad-flat");
    assertEquals(getRuntimeAgentMarkdownRootPath(flat!), null);
    // No colocated resolution -> `skills: true` passes through to the global registry.
    assertEquals(flat!.config.skills, true);
    assertEquals(result.errors, []);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("invalid colocated SKILL.md is recorded as an error but the agent still registers", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    const agentDir = resolve(dir, "mad-badskill");
    Deno.mkdirSync(agentDir, { recursive: true });
    write(resolve(agentDir, "AGENT.md"), "---\nname: Bad\nskills: true\n---\nResearch.");
    // Uppercase name + missing description -> validateSkillMetadata throws.
    write(resolve(agentDir, "SKILL.md"), "---\nname: NotValid\n---\nOwn.");

    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(dir, result, context);

    assertEquals(result.agents.has("mad-badskill"), true);
    assertEquals(result.errors.length, 1);
    // The bad skill did not register, so the agent has no resolved skill ids.
    assertEquals(result.agents.get("mad-badskill")!.config.skills, undefined);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("duplicate agent id (flat + directory) is recorded as an error", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    write(resolve(dir, "mad-dup.md"), "---\nname: DupFlat\n---\nFlat.");
    const agentDir = resolve(dir, "mad-dup");
    Deno.mkdirSync(agentDir, { recursive: true });
    write(resolve(agentDir, "AGENT.md"), "---\nname: DupDir\n---\nDirectory.");

    const result = emptyResult();
    await discoverRuntimeAgentMarkdownDefinitions(dir, result, context);

    assertEquals([...result.agents.keys()], ["mad-dup"]);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].error.message.includes("Duplicate agent id"), true);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test({
  name: "agents whose ids sanitize to the same namespace are reported, not silently merged",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = Deno.makeTempDirSync();
    try {
      for (const id of ["mad.ns", "mad_ns"]) {
        const agentDir = resolve(dir, id);
        Deno.mkdirSync(resolve(agentDir, "tools"), { recursive: true });
        write(resolve(agentDir, "AGENT.md"), `---\nname: ${id}\ntools: true\n---\nWork.`);
        write(
          resolve(agentDir, "tools", "fetch.ts"),
          'export const fetch = { id: "fetch", type: "function", description: "f",' +
            ' inputSchema: { type: "object", properties: {} }, execute: async () => ({}) };\n',
        );
      }

      const result = emptyResult();
      await discoverRuntimeAgentMarkdownDefinitions(dir, result, context);

      // Both agents still register (distinct ids), but the namespace clash is reported.
      assertEquals([...result.agents.keys()].sort(), ["mad.ns", "mad_ns"]);
      const clash = result.errors.find((e) =>
        e.error.message.includes("sanitized capability namespace")
      );
      assertEquals(clash !== undefined, true);
    } finally {
      Deno.removeSync(dir, { recursive: true });
    }
  },
});
