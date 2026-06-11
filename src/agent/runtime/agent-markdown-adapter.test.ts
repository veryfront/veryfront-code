import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createRuntimeAgentFromMarkdownDefinition,
  getRuntimeAgentMarkdownDefinition,
  getRuntimeAgentMarkdownMeta,
  getRuntimeAgentMarkdownRootPath,
  isRuntimeAgentMarkdownAgent,
} from "./agent-markdown-adapter.ts";
import { agent } from "../factory.ts";
import type { Tool } from "#veryfront/tool";

function fakeTool(id: string): Tool {
  return {
    id,
    type: "function",
    description: `${id} tool`,
    inputSchema: { type: "object", properties: {} },
    execute: () => Promise.resolve({ ok: true }),
  } as unknown as Tool;
}

Deno.test("createRuntimeAgentFromMarkdownDefinition preserves provider-native tools", () => {
  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "support",
    name: "Support",
    description: "Helps users",
    instructions: "Use the configured tools.",
    model: "anthropic/claude-sonnet-4-6",
    providerTools: ["web_search", "web_fetch"],
  });

  assertEquals(runtimeAgent.config.providerTools, ["web_search", "web_fetch"]);
});

Deno.test("markdown metadata accessors expose definition + root path; code agents return null", () => {
  const md = createRuntimeAgentFromMarkdownDefinition(
    { id: "researcher", name: "Researcher", description: "", instructions: "Research." },
    { rootPath: "/agents/researcher" },
  );

  assertEquals(isRuntimeAgentMarkdownAgent(md), true);
  assertEquals(getRuntimeAgentMarkdownDefinition(md)?.id, "researcher");
  assertEquals(getRuntimeAgentMarkdownMeta(md)?.rootPath, "/agents/researcher");
  assertEquals(getRuntimeAgentMarkdownRootPath(md), "/agents/researcher");

  // A code-defined agent carries no markdown metadata.
  const code = agent({ id: "code-agent", system: "Help." });
  assertEquals(isRuntimeAgentMarkdownAgent(code), false);
  assertEquals(getRuntimeAgentMarkdownDefinition(code), null);
  assertEquals(getRuntimeAgentMarkdownMeta(code), null);
  assertEquals(getRuntimeAgentMarkdownRootPath(code), null);
});

Deno.test("colocated tools survive factory normalization with their namespaced id", () => {
  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition(
    { id: "researcher", name: "Researcher", description: "", instructions: "Research." },
    { tools: { "researcher__fetch": fakeTool("fetch") } },
  );

  const tools = runtimeAgent.config.tools as Record<string, Tool>;
  // Factory normalizes each object tool's id to its record key — this is what
  // lets getAvailableTools/registerTool resolve the namespaced colocated tool.
  assertEquals(tools["researcher__fetch"].id, "researcher__fetch");
});

Deno.test("resolvedSkillIds override definition.skills; empty list never falls back to true", () => {
  const withIds = createRuntimeAgentFromMarkdownDefinition(
    { id: "a", name: "A", description: "", instructions: "x", skills: true },
    { resolvedSkillIds: ["a", "a__cite"] },
  );
  assertEquals(withIds.config.skills, ["a", "a__cite"]);

  // A colocated agent whose skills resolved to nothing must NOT inherit the
  // registry-wide `true` (which would surface other agents' skills).
  const emptyResolved = createRuntimeAgentFromMarkdownDefinition(
    { id: "b", name: "B", description: "", instructions: "x", skills: true },
    { resolvedSkillIds: [] },
  );
  assertEquals(emptyResolved.config.skills, undefined);

  // A flat agent (no colocated resolution) keeps its declared selector.
  const flat = createRuntimeAgentFromMarkdownDefinition({
    id: "c",
    name: "C",
    description: "",
    instructions: "x",
    skills: true,
  });
  assertEquals(flat.config.skills, true);
});
