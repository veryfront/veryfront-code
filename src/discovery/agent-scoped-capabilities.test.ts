import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import {
  isSafePathSegment,
  loadAgentColocatedTools,
  namespaceAgentCapability,
  registerAgentColocatedSkills,
  sanitizeCapabilityNamespace,
} from "./agent-scoped-capabilities.ts";
import { getSkill } from "#veryfront/skill/registry.ts";
import type { DiscoveryResult, FileDiscoveryContext } from "./types.ts";

const context: FileDiscoveryContext = { platform: "node" };

function validSkill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill for tests\n---\n${body}\n`;
}

function toolModule(id: string): string {
  return `export const ${id.replace(/[^a-z0-9]/gi, "_")} = {\n` +
    `  id: ${JSON.stringify(id)},\n` +
    `  type: "function",\n` +
    `  description: ${JSON.stringify(`${id} tool`)},\n` +
    `  inputSchema: { type: "object", properties: {} },\n` +
    `  execute: async () => ({ ok: true }),\n` +
    `};\n`;
}

Deno.test("isSafePathSegment rejects traversal segments before path joining", () => {
  assertEquals(isSafePathSegment("cite"), true);
  assertEquals(isSafePathSegment("my.skill_v2"), true);
  assertEquals(isSafePathSegment("."), false);
  assertEquals(isSafePathSegment(".."), false);
  assertEquals(isSafePathSegment("a/b"), false);
  assertEquals(isSafePathSegment(""), false);
});

Deno.test("namespace helpers sanitize agent ids for provider-safe tool names", () => {
  assertEquals(sanitizeCapabilityNamespace("team.lead-1"), "team_lead-1");
  assertEquals(namespaceAgentCapability("team.lead", "fetch"), "team_lead__fetch");
});

Deno.test("loadAgentColocatedTools namespaces tools and honors the selector", async () => {
  const rootPath = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(resolve(rootPath, "tools"), { recursive: true });
    Deno.writeTextFileSync(resolve(rootPath, "tools", "fetch-paper.ts"), toolModule("fetch-paper"));
    Deno.writeTextFileSync(resolve(rootPath, "tools", "rank.ts"), toolModule("rank"));

    const all = await loadAgentColocatedTools({ agentId: "researcher", rootPath, context });
    assertEquals(Object.keys(all).sort(), ["researcher__fetch-paper", "researcher__rank"]);
    assertEquals(all["researcher__fetch-paper"].id, "researcher__fetch-paper");

    const selected = await loadAgentColocatedTools({
      agentId: "researcher",
      rootPath,
      selector: ["rank"],
      context,
    });
    assertEquals(Object.keys(selected), ["researcher__rank"]);
  } finally {
    Deno.removeSync(rootPath, { recursive: true });
  }
});

Deno.test("loadAgentColocatedTools skips tools whose namespaced name is not provider-safe", async () => {
  const rootPath = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(resolve(rootPath, "tools"), { recursive: true });
    // Explicit tool id contains ':' -> namespaced name violates the provider charset.
    Deno.writeTextFileSync(resolve(rootPath, "tools", "bad.ts"), toolModule("fetch:v2"));
    Deno.writeTextFileSync(resolve(rootPath, "tools", "ok.ts"), toolModule("rank"));

    const result: DiscoveryResult = {
      tools: new Map(),
      agents: new Map(),
      skills: new Map(),
      resources: new Map(),
      prompts: new Map(),
      workflows: new Map(),
      tasks: new Map(),
      errors: [],
    };
    const tools = await loadAgentColocatedTools({ agentId: "r", rootPath, context, result });

    assertEquals(Object.keys(tools), ["r__rank"]);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0].error.message.includes("invalid tool name"), true);
  } finally {
    Deno.removeSync(rootPath, { recursive: true });
  }
});

Deno.test("loadAgentColocatedTools returns empty when there is no tools dir", async () => {
  const rootPath = Deno.makeTempDirSync();
  try {
    assertEquals(await loadAgentColocatedTools({ agentId: "writer", rootPath, context }), {});
  } finally {
    Deno.removeSync(rootPath, { recursive: true });
  }
});

Deno.test("registerAgentColocatedSkills registers own + nested skills with namespaced ids", async () => {
  const rootPath = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(resolve(rootPath, "SKILL.md"), validSkill("cap-own", "Own."));
    Deno.mkdirSync(resolve(rootPath, "skills", "cite"), { recursive: true });
    Deno.writeTextFileSync(
      resolve(rootPath, "skills", "cite", "SKILL.md"),
      validSkill("cap-cite", "Cite."),
    );

    const ids = await registerAgentColocatedSkills({
      agentId: "cap-agent",
      rootPath,
      context,
    });

    assertEquals(ids.sort(), ["cap-agent", "cap-agent__cite"]);
    assertEquals(getSkill("cap-agent")?.rootPath, rootPath);
    assertEquals(getSkill("cap-agent__cite")?.rootPath, resolve(rootPath, "skills", "cite"));
  } finally {
    Deno.removeSync(rootPath, { recursive: true });
  }
});

Deno.test("registerAgentColocatedSkills filters by selector (own skill = agent id)", async () => {
  const rootPath = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(resolve(rootPath, "SKILL.md"), validSkill("sel-own", "Own."));
    Deno.mkdirSync(resolve(rootPath, "skills", "extra"), { recursive: true });
    Deno.writeTextFileSync(
      resolve(rootPath, "skills", "extra", "SKILL.md"),
      validSkill("sel-extra", "Extra."),
    );

    const ids = await registerAgentColocatedSkills({
      agentId: "sel-agent",
      rootPath,
      selector: ["sel-agent"],
      context,
    });

    assertEquals(ids, ["sel-agent"]);
  } finally {
    Deno.removeSync(rootPath, { recursive: true });
  }
});
