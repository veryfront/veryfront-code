import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentConfig } from "../types.ts";
import { createEphemeralAgent } from "../factory.ts";
import { getRuntimeRemoteToolSources } from "../runtime/mcp-server-tool-sources.ts";
import { resolveRuntimeToolLoading } from "../runtime/runtime-tool-config.ts";
import {
  applyAgUiRuntimeRestrictions,
  hasAgUiRuntimeRestrictions,
} from "./runtime-restrictions.ts";

function createConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "researcher",
    system: "Answer directly.",
    model: "anthropic/claude-sonnet-4-6",
    tools: { web_search: true, delete_project: true },
    providerTools: ["web_fetch"],
    delegates: ["writer"],
    skills: true,
    maxSteps: 20,
    mcpServers: [{ kind: "veryfront-api" }],
    ...overrides,
  } as AgentConfig;
}

describe("agent/ag-ui/runtime-restrictions", () => {
  it("reports whether a restriction set narrows anything", () => {
    assertEquals(hasAgUiRuntimeRestrictions(undefined), false);
    assertEquals(hasAgUiRuntimeRestrictions({}), false);
    assertEquals(hasAgUiRuntimeRestrictions({ maxSteps: 2 }), true);
    assertEquals(hasAgUiRuntimeRestrictions({ allowedTools: [] }), true);
  });

  it("keeps only allowlisted configured tools", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig(), {
      allowedTools: ["web_search"],
    });

    assertEquals(restricted.tools, { web_search: true });
    assertEquals(restricted.providerTools, []);
    assertEquals(restricted.delegates, []);
    assertEquals(restricted.mcpServers, []);
    assertEquals(restricted.skills, false);
  });

  it("authorizes no tools for an empty allowlist", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig(), { allowedTools: [] });

    assertEquals(restricted.tools, {});
    assertEquals(restricted.providerTools, []);
    assertEquals(restricted.delegates, []);
    assertEquals(restricted.mcpServers, []);
    assertEquals(restricted.skills, false);
  });

  it("replaces an unrestricted tool catalog with the allowlisted names", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig({ tools: true }), {
      allowedTools: ["web_search", "read_file"],
    });

    assertEquals(restricted.tools, { web_search: true, read_file: true });
  });

  it("preserves deferred tool loading when replacing an unrestricted catalog", () => {
    // Replacing `tools: true` with an explicit map must not flip the run from
    // deferred to eager loading, or a restricted run would send every
    // allowlisted schema on the first provider call instead of exposing
    // `tool_search`.
    const restricted = applyAgUiRuntimeRestrictions(createConfig({ tools: true }), {
      allowedTools: ["web_search", "read_file"],
    });

    assertEquals(resolveRuntimeToolLoading(restricted), {
      mode: "deferred",
      provenance: "host-runtime-binding",
    });
  });

  it("keeps eager loading for an authored explicit tool map", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig(), {
      allowedTools: ["web_search"],
    });

    assertEquals(resolveRuntimeToolLoading(restricted).mode, "eager");
  });

  it("keeps provider-native tool names out of the generated local selector", () => {
    const restricted = applyAgUiRuntimeRestrictions(
      createConfig({ tools: true, providerTools: ["web_fetch"] }),
      { allowedTools: ["web_fetch", "read_file"] },
    );

    // The runtime resolves every `true` entry against the tool registries and
    // throws `Unknown tool reference` for a provider-native name, so the
    // allowed provider tool travels in `providerTools` alone.
    assertEquals(restricted.tools, { read_file: true });
    assertEquals(restricted.providerTools, ["web_fetch"]);
  });

  it("leaves no remote tool source reachable for an allowlisted unresolved tool", () => {
    // An absent `mcpServers` makes `getRuntimeRemoteToolSources` synthesize an
    // implicit Veryfront API server for boolean tool references no local
    // registry resolves, which would hand the run a same-named platform tool it
    // was never configured with.
    const restricted = applyAgUiRuntimeRestrictions(
      createConfig({ tools: true, providerTools: undefined }),
      { allowedTools: ["not_in_any_registry"] },
    );

    assertEquals(restricted.tools, { not_in_any_registry: true });
    assertEquals(getRuntimeRemoteToolSources(restricted), []);
  });

  it("keeps allowlisted provider tools, delegates, and skills", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig(), {
      allowedTools: ["web_fetch", "agent_writer", "load_skill"],
    });

    assertEquals(restricted.providerTools, ["web_fetch"]);
    assertEquals(restricted.delegates, ["writer"]);
    assertEquals(restricted.skills, true);
  });

  it("explicitly disables skill infrastructure tools outside the allowlist", () => {
    // With skills enabled, the factory injects the whole `load_skill` family
    // unless an entry is explicitly `false`, so removing the names from the
    // tool map is not enough to keep them out of the rebuilt agent.
    const restricted = applyAgUiRuntimeRestrictions(createConfig({ tools: true }), {
      allowedTools: ["load_skill"],
    });

    assertEquals(restricted.skills, true);
    assertEquals(restricted.tools, {
      load_skill: true,
      load_skill_reference: false,
      execute_skill_script: false,
    });
  });

  it("keeps the factory from injecting non-allowlisted skill tools into the rebuilt agent", () => {
    // End to end against the factory: `resolveToolsConfiguration` injects the
    // whole skill family for a skills-enabled agent unless an entry is
    // explicitly `false`, so the rebuilt ephemeral agent must carry the
    // stamped denials, not just a narrowed name list.
    const restrictedAgent = createEphemeralAgent(
      applyAgUiRuntimeRestrictions(createConfig({ tools: true }), {
        allowedTools: ["load_skill"],
      }),
    );

    const tools = (restrictedAgent.config.tools ?? {}) as Record<string, unknown>;
    assertEquals(Object.keys(tools).sort(), [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
    assertEquals(typeof tools.load_skill, "object");
    assertEquals(tools.load_skill_reference, false);
    assertEquals(tools.execute_skill_script, false);
  });

  it("disables non-allowlisted skill tools even when the config declares no tools", () => {
    const restricted = applyAgUiRuntimeRestrictions(createConfig({ tools: undefined }), {
      allowedTools: ["load_skill", "load_skill_reference"],
    });

    assertEquals(restricted.skills, true);
    assertEquals(restricted.tools, { execute_skill_script: false });
  });

  it("never raises the configured step bound", () => {
    assertEquals(
      applyAgUiRuntimeRestrictions(createConfig({ maxSteps: 20 }), { maxSteps: 2 }).maxSteps,
      2,
    );
    assertEquals(
      applyAgUiRuntimeRestrictions(createConfig({ maxSteps: 1 }), { maxSteps: 5 }).maxSteps,
      1,
    );
    assertEquals(
      applyAgUiRuntimeRestrictions(createConfig({ maxSteps: undefined }), { maxSteps: 3 }).maxSteps,
      3,
    );
  });

  it("narrows an enabled edge step limit to the ceiling", () => {
    // `computeMaxSteps` prefers an enabled edge limit over the top-level
    // bound, so the ceiling must narrow both.
    const restricted = applyAgUiRuntimeRestrictions(
      createConfig({ maxSteps: 20, edge: { enabled: true, maxSteps: 20 } } as Partial<AgentConfig>),
      { maxSteps: 2 },
    );

    assertEquals(restricted.maxSteps, 2);
    assertEquals(restricted.edge, { enabled: true, maxSteps: 2 });

    const disabledEdge = applyAgUiRuntimeRestrictions(
      createConfig({ edge: { enabled: false, maxSteps: 20 } } as Partial<AgentConfig>),
      { maxSteps: 2 },
    );

    // A disabled edge limit never reaches `computeMaxSteps`, so it stays.
    assertEquals(disabledEdge.edge, { enabled: false, maxSteps: 20 });
  });

  it("leaves the tool surface alone when only the step bound is restricted", () => {
    const config = createConfig();
    const restricted = applyAgUiRuntimeRestrictions(config, { maxSteps: 2 });

    assertEquals(restricted.tools, config.tools);
    assertEquals(restricted.providerTools, config.providerTools);
    assertEquals(restricted.mcpServers, config.mcpServers);
    assertEquals(restricted.skills, true);
  });
});
