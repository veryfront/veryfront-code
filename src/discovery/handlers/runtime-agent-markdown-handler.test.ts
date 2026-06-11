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

Deno.test("discoverRuntimeAgentMarkdownDefinitions discovers flat and directory agents", async () => {
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
    write(resolve(agentDir, "SKILL.md"), "---\nname: mad-researcher\ndescription: own\n---\nOwn.");
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
