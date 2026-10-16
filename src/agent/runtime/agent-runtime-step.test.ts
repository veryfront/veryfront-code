import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig, AgentSystem, Message, ToolResultPart } from "../types.ts";
import type { AgentRuntimeStepState, RuntimeStepToolLoader } from "./agent-runtime-step.ts";
import {
  prepareAgentRuntimeStep,
  withIntegrationToolDiscoveryStatus,
} from "./agent-runtime-step.ts";
import {
  markTrustedPlatformPolicyToolDefinition,
  markTrustedPlatformPolicyToolResultPart,
} from "./skill-policy-enforcement.ts";
import { createToolExposureState, searchToolExposure } from "./tool-exposure.ts";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { flattenSystemInstructions } from "./tool-inventory.ts";

function systemText(system: AgentSystem): string {
  return typeof system === "string" ? system : flattenSystemInstructions(system);
}

function toolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {} },
  };
}

function platformToolDefinition(name: string): ToolDefinition {
  return markTrustedPlatformPolicyToolDefinition(toolDefinition(name));
}

function markTrustedFormResultMessages<T extends Message[]>(messages: T): T {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-result" && part.toolName.includes("form_input")) {
        markTrustedPlatformPolicyToolResultPart(part as ToolResultPart);
      }
    }
  }
  return messages;
}

function remoteToolSource(id: string): RemoteToolSource {
  return {
    id,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve(undefined),
  };
}

describe("agent/runtime-step", () => {
  function bootstrapStepInput(
    bootstrapTools: string[],
    overrides: Partial<Parameters<typeof prepareAgentRuntimeStep>[0]> = {},
  ): Parameters<typeof prepareAgentRuntimeStep>[0] {
    return {
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: false,
        toolLoading: "deferred",
        bootstrapTools,
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [toolDefinition("read_state"), toolDefinition("write_state")],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
      ...overrides,
    };
  }

  it("exposes authored bootstrap tools immediately and keeps the rest deferred", async () => {
    const prepared = await prepareAgentRuntimeStep(bootstrapStepInput(["read_state"]));
    assertEquals(prepared.tools.map((tool) => tool.name).sort(), [
      "read_state",
      "veryfront__tool_search",
    ]);
    assertEquals(prepared.toolExposurePlan.deferred.map((tool) => tool.name), ["write_state"]);
  });

  it("optional startup schemas intersect the final step catalog and preserve mandatory readers", async () => {
    for (const writable of [false, true]) {
      const input = bootstrapStepInput(["read_state"]);
      const prepared = await prepareAgentRuntimeStep({
        ...input,
        config: {
          ...input.config,
          optionalBootstrapTools: ["write_state", "missing_tool", "write_state"],
        },
        getAvailableTools: async () =>
          writable
            ? [toolDefinition("read_state"), toolDefinition("write_state"), toolDefinition("other")]
            : [toolDefinition("read_state"), toolDefinition("other")],
      });
      assertEquals(
        prepared.tools.map((tool) => tool.name).sort(),
        writable
          ? ["read_state", "veryfront__tool_search", "write_state"]
          : ["read_state", "veryfront__tool_search"],
      );
      assertEquals(
        prepared.toolExposurePlan.authorized.some((tool) => tool.name === "missing_tool"),
        false,
      );
      assertEquals(prepared.configuredBootstrapToolNames, ["read_state"]);
    }
  });

  it("optional hints preserve mandatory schemas when no optional capacity remains", async () => {
    const input = bootstrapStepInput(["read_state", "write_state"]);
    const prepared = await prepareAgentRuntimeStep({
      ...input,
      reservedToolSlots: 126,
      config: { ...input.config, model: "openai/gpt-4.1", optionalBootstrapTools: ["missing"] },
    });
    assertEquals(prepared.tools.map((tool) => tool.name).sort(), ["read_state", "write_state"]);
  });

  it("optional startup schemas leave capacity for a discovered tool", async () => {
    const state = createToolExposureState();
    const input = bootstrapStepInput(["read_state"]);
    const prepared = await prepareAgentRuntimeStep({
      ...input,
      reservedToolSlots: 125,
      toolExposureState: state,
      config: { ...input.config, model: "openai/gpt-4.1", optionalBootstrapTools: ["write_state"] },
      getAvailableTools: async () => [
        toolDefinition("read_state"),
        toolDefinition("write_state"),
        toolDefinition("other"),
      ],
    });
    assertEquals(prepared.tools.map((tool) => tool.name).sort(), [
      "read_state",
      "veryfront__tool_search",
    ]);
    assertEquals(prepared.toolExposurePlan.maxLoadedTools, 2);
    const discovered = searchToolExposure({
      query: "write_state",
      authorized: prepared.toolExposurePlan.authorized,
      state,
      maxLoadedTools: prepared.toolExposurePlan.maxLoadedTools,
    });
    assertEquals(discovered.loadedCount > 0, true);
    assertEquals(state.loadedToolNames.has("write_state"), true);
  });

  it("optional hints do not load a catalog for a model without tool calling", async () => {
    const input = bootstrapStepInput([]);
    let catalogLoads = 0;
    const prepared = await prepareAgentRuntimeStep({
      ...input,
      supportsToolCalling: false,
      config: { ...input.config, optionalBootstrapTools: ["write_state"] },
      getAvailableTools: async () => {
        catalogLoads++;
        throw new Error("Required MCP server unavailable");
      },
    });
    assertEquals(catalogLoads, 0);
    assertEquals(prepared.tools, []);
    assertEquals(prepared.toolExposurePlan.authorized, []);
  });

  it("required bootstrap validation still loads the catalog without model tool calling", async () => {
    const input = bootstrapStepInput(["read_state"]);
    let catalogLoads = 0;
    const prepared = await prepareAgentRuntimeStep({
      ...input,
      supportsToolCalling: false,
      config: { ...input.config, optionalBootstrapTools: ["write_state"] },
      getAvailableTools: async () => {
        catalogLoads++;
        return [toolDefinition("read_state"), toolDefinition("write_state")];
      },
    });
    assertEquals(catalogLoads, 1);
    assertEquals(prepared.tools, []);
    assertEquals(prepared.configuredBootstrapToolNames, ["read_state"]);
  });

  it("reports host-merged startup tools for provider capping to retain", async () => {
    const input = bootstrapStepInput([]);
    const prepared = await prepareAgentRuntimeStep({
      ...input,
      config: {
        ...input.config,
        bootstrapTools: undefined,
        __vfRetainedBootstrapToolNames: ["write_state"],
      } as AgentConfig,
    });
    assertEquals(prepared.configuredBootstrapToolNames, ["write_state"]);
  });

  it("rejects authored bootstrap tools outside the authorized catalog", async () => {
    const error = await assertRejects(
      () => prepareAgentRuntimeStep(bootstrapStepInput(["delete_state"])),
      VeryfrontError,
      "outside the authorized executable catalog",
    );
    assertEquals((error as VeryfrontError).slug, "config-invalid");
  });

  for (const mode of ["generate", "stream"] as const) {
    for (const narrowedBy of ["skill", "exclusion"] as const) {
      it(`keeps ${mode} bootstrap validation separate from ${narrowedBy} restrictions`, async () => {
        const bootstrapName = "execute_skill_script";
        const prepared = await prepareAgentRuntimeStep(bootstrapStepInput([bootstrapName], {
          activeSkillToolAvailability: narrowedBy === "skill"
            ? { hasActiveSkill: true, scripts: [] }
            : undefined,
          excludedToolNames: narrowedBy === "exclusion" ? new Set([bootstrapName]) : undefined,
          getAvailableTools: async () => [
            toolDefinition(bootstrapName),
            toolDefinition("read_state"),
          ],
          mode,
          step: 1,
        }));
        assertEquals(prepared.toolExposurePlan.authorized.map((tool) => tool.name), ["read_state"]);
        assertEquals(prepared.tools.map((tool) => tool.name), ["veryfront__tool_search"]);
      });
    }
  }

  it("accepts an authorized provider-native startup tool", async () => {
    const prepared = await prepareAgentRuntimeStep(bootstrapStepInput(["web_search"], {
      config: {
        model: "anthropic/claude-opus-4-6",
        system: "Base",
        tools: true,
        toolLoading: "deferred",
        bootstrapTools: ["web_search"],
      } as AgentConfig,
      getAvailableTools: async () => [],
      providerToolNames: ["web_search"],
    }));
    assertEquals(prepared.tools.map((tool) => tool.name), ["web_search"]);
  });
  it("validates native bootstrap authorization separately from current-step filtering", async () => {
    const prepared = await prepareAgentRuntimeStep(bootstrapStepInput(["web_search"], {
      config: {
        model: "anthropic/claude-opus-4-6",
        system: "Base",
        tools: true,
        toolLoading: "deferred",
        bootstrapTools: ["web_search"],
      } as AgentConfig,
      getAvailableTools: async () => [],
      providerToolNames: [],
      authorizedProviderToolNames: ["web_search"],
      step: 1,
    }));
    assertEquals(prepared.tools.some((tool) => tool.name === "web_search"), false);
  });
  it("passes the configured provider alias to runtime-state cloning", async () => {
    let providerOptionKey: unknown;
    await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "bedrock/claude-sonnet", system: "Base" } as AgentConfig,
      effectiveModel: "bedrock/claude-sonnet",
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async (...args: unknown[]) => {
        providerOptionKey = args[5];
        return { systemPrompt: "Base" };
      },
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
    });

    assertEquals(providerOptionKey, "bedrock");
  });

  it("derives runtime-state provider keys from the effective runtime", async () => {
    let providerOptionKey: unknown;
    await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "bedrock/claude-sonnet", system: "Base" } as AgentConfig,
      effectiveModel: "bedrock/claude-sonnet",
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      modelRuntime: { provider: "AWS-Anthropic" } as unknown as ModelRuntime,
      remoteToolSources: undefined,
      resolveRuntimeState: async (...args: unknown[]) => {
        providerOptionKey = args[5];
        return { systemPrompt: "Base" };
      },
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
    });

    assertEquals(providerOptionKey, "AWS-Anthropic");
  });

  it("caps loaded schemas by the authenticated wire surface's tool limit", async () => {
    const names = Array.from({ length: 130 }, (_, index) => `tool_${index}`);
    const prepare = (wireSurface?: "openai") =>
      prepareAgentRuntimeStep({
        agentId: "agent_1",
        activeSkillToolAvailability: undefined,
        allowedRemoteToolNames: undefined,
        config: {
          model: "veryfront-cloud/google/local-model",
          system: "Base",
          toolLoading: "deferred",
        } as unknown as AgentConfig,
        effectiveModel: "veryfront-cloud/google/local-model",
        ...(wireSurface ? { wireSurface } : {}),
        forwardedRemoteToolDefinitions: undefined,
        getAvailableTools: async () => names.map(toolDefinition),
        supportsToolCalling: true,
        messages: [],
        mode: "generate",
        remoteToolSources: undefined,
        resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
        runtimeContext: undefined,
        step: 1,
        systemPrompt: "Base",
        toolContextBase: undefined,
        toolExposureState: createToolExposureState(names),
      });

    const publisherOnly = await prepare();
    assertEquals(publisherOnly.tools.length, 130);
    const openaiWire = await prepare("openai");
    assertEquals(openaiWire.tools.length <= 128, true);
    assertEquals(openaiWire.tools.some((tool) => tool.name === "veryfront__tool_search"), true);
    assertEquals(openaiWire.toolExposurePlan.deferred.length > 0, true);
  });

  it("exposes only bootstrap and loaded schemas in deferred mode", async () => {
    const state = createToolExposureState(["get_release"]);
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        toolLoading: "deferred",
        tools: {
          load_skill: markTrustedHostToolProvenance({ id: "load_skill", description: "Loader" }),
        },
      } as unknown as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [
        toolDefinition("create_release"),
        toolDefinition("form_input"),
        toolDefinition("get_release"),
        toolDefinition("load_skill"),
      ],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      toolExposureState: state,
    });

    assertEquals(
      prepared.tools.map((tool) => tool.name),
      ["get_release", "load_skill", "veryfront__tool_search"],
    );
    assertEquals(
      prepared.toolExposurePlan.deferred.map((tool) => tool.name),
      ["create_release", "form_input"],
    );
  });

  it("bootstraps the trusted skill loader, not a project tool with the canonical name", async () => {
    const projectCanonical = { id: "veryfront__load_skill", description: "Project tool" };
    const trustedLoader = markTrustedHostToolProvenance({
      id: "load_skill",
      description: "Framework loader",
    });
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        toolLoading: "deferred",
        tools: { veryfront__load_skill: projectCanonical, load_skill: trustedLoader },
      } as unknown as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [
        toolDefinition("load_skill"),
        toolDefinition("veryfront__load_skill"),
      ],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      toolExposureState: createToolExposureState(),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), ["load_skill", "veryfront__tool_search"]);
    assertEquals(
      prepared.toolExposurePlan.deferred.map((tool) => tool.name),
      ["veryfront__load_skill"],
    );
  });

  it("bootstraps no skill loader when none carries trusted provenance", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        toolLoading: "deferred",
        tools: {
          veryfront__load_skill: { id: "veryfront__load_skill", description: "Project tool" },
          load_skill: false,
        },
      } as unknown as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [toolDefinition("veryfront__load_skill")],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      toolExposureState: createToolExposureState(),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), ["veryfront__tool_search"]);
  });

  it("bootstraps the host-selected loader instead of the provenance default", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        toolLoading: "deferred",
        tools: {
          veryfront__load_skill: markTrustedHostToolProvenance({
            id: "veryfront__load_skill",
            description: "Canonical loader",
          }),
          load_skill: markTrustedHostToolProvenance({ id: "load_skill", description: "Loader" }),
        },
        __vfToolBootstrapNames: ["load_skill"],
      } as unknown as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [
        toolDefinition("load_skill"),
        toolDefinition("veryfront__load_skill"),
      ],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      toolExposureState: createToolExposureState(),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), ["load_skill", "veryfront__tool_search"]);
    assertEquals(
      prepared.toolExposurePlan.deferred.map((tool) => tool.name),
      ["veryfront__load_skill"],
    );
  });

  it("keeps provider-native tools authorized but deferred until veryfront__tool_search loads them", async () => {
    const state = createToolExposureState();
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "anthropic/claude-opus-4-6", system: "Base", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [toolDefinition("create_release")],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      providerToolNames: ["web_search"],
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({
        systemPrompt:
          'Base\n\nCurrent run tool inventory:\n\n- veryfront__tool_search\n\nOnly treat the tools listed above as actually available in this run.\nIf the list is "- none", say plainly that no tools are available.\nDo NOT infer tool availability from examples, skills, or the base prompt.\nAdditional authorized tools may be deferred.',
      }),
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
      toolExposureState: state,
    });

    assertEquals(systemText(prepared.systemPrompt).includes("- web_search"), true);
    assertEquals(prepared.tools.map((tool) => tool.name), ["veryfront__tool_search"]);
    assertEquals(
      prepared.toolExposurePlan.authorized.map((tool) => tool.name),
      ["create_release", "web_search"],
    );
    assertEquals(
      prepared.toolExposurePlan.deferred.map((tool) => tool.name),
      ["create_release", "web_search"],
    );

    state.loadedToolNames.add("web_search");
    const loaded = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "anthropic/claude-opus-4-6", system: "Base", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [toolDefinition("create_release")],
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      providerToolNames: ["web_search"],
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: prepared.systemPrompt }),
      runtimeContext: undefined,
      step: 1,
      systemPrompt: prepared.systemPrompt,
      toolContextBase: undefined,
      toolExposureState: state,
    });
    assertEquals(loaded.tools.map((tool) => tool.name), ["veryfront__tool_search", "web_search"]);
  });

  it("preserves a typed empty integration catalog without adding a warning", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async (_toolsConfig, options) => {
        options?.onIntegrationToolDiscovery?.({ status: "ok", tools: [] });
        return [];
      },
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
    });

    assertEquals(prepared.integrationToolDiscovery, { status: "ok", tools: [] });
    const systemPrompt = withIntegrationToolDiscoveryStatus(
      prepared.systemPrompt,
      prepared.integrationToolDiscovery,
    );
    assertEquals(systemPrompt, "Base");
  });

  it("tells the model once when integration discovery is unavailable", async () => {
    const getAvailableTools: RuntimeStepToolLoader = async (_toolsConfig, options) => {
      options?.onIntegrationToolDiscovery?.({
        status: "unavailable",
        reason: "request_failed",
      });
      return [];
    };
    const input = {
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools,
      supportsToolCalling: true,
      messages: [],
      mode: "generate" as const,
      remoteToolSources: undefined,
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
    };

    const first = await prepareAgentRuntimeStep({
      ...input,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
    });
    const firstSystemPrompt = withIntegrationToolDiscoveryStatus(
      first.systemPrompt,
      first.integrationToolDiscovery,
    );
    const second = await prepareAgentRuntimeStep({
      ...input,
      systemPrompt: firstSystemPrompt,
      resolveRuntimeState: async () => ({ systemPrompt: firstSystemPrompt }),
    });
    const secondSystemPrompt = withIntegrationToolDiscoveryStatus(
      systemText(second.systemPrompt),
      second.integrationToolDiscovery,
    );

    assertEquals(second.integrationToolDiscovery, {
      status: "unavailable",
      reason: "request_failed",
    });
    assertEquals(
      secondSystemPrompt.includes(
        "You must not treat this failure as an empty integration catalog",
      ),
      true,
    );
    assertEquals(
      secondSystemPrompt.split("Integration tool discovery status:").length - 1,
      1,
    );
  });

  it("tells the model once when integration discovery is unavailable with a structured system prompt", async () => {
    const getAvailableTools: RuntimeStepToolLoader = async (_toolsConfig, options) => {
      options?.onIntegrationToolDiscovery?.({
        status: "unavailable",
        reason: "request_failed",
      });
      return [];
    };
    const baseSystemPrompt = [{ role: "system" as const, content: "Base" }];
    const input = {
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: baseSystemPrompt, tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools,
      supportsToolCalling: true,
      messages: [],
      mode: "generate" as const,
      remoteToolSources: undefined,
      runtimeContext: undefined,
      step: 0,
      systemPrompt: baseSystemPrompt,
      toolContextBase: undefined,
    };

    const first = await prepareAgentRuntimeStep({
      ...input,
      resolveRuntimeState: async () => ({ systemPrompt: baseSystemPrompt }),
    });
    const firstSystemPrompt = withIntegrationToolDiscoveryStatus(
      first.systemPrompt,
      first.integrationToolDiscovery,
    );
    const second = await prepareAgentRuntimeStep({
      ...input,
      systemPrompt: firstSystemPrompt,
      resolveRuntimeState: async () => ({ systemPrompt: firstSystemPrompt }),
    });
    const secondSystemPrompt = withIntegrationToolDiscoveryStatus(
      second.systemPrompt,
      second.integrationToolDiscovery,
    );

    if (typeof secondSystemPrompt === "string") {
      throw new Error("Expected a structured system prompt to stay structured");
    }
    assertEquals(
      secondSystemPrompt.map((m) => m.content).join("\n").split(
        "Integration tool discovery status:",
      ).length - 1,
      1,
      "a structured prompt must not accumulate one status block per step",
    );
    assertEquals(
      secondSystemPrompt.length,
      2,
      "stripping must drop the emptied status message rather than keep an empty system message",
    );
    assertEquals(
      secondSystemPrompt[0],
      { role: "system", content: "Base" },
      "the authored system message must survive the strip-and-reappend",
    );
  });

  it("replaces an integration discovery status block before prompt suffix content", () => {
    const unavailable = {
      status: "unavailable" as const,
      reason: "request_failed" as const,
    };
    const firstSystemPrompt = withIntegrationToolDiscoveryStatus("Base", unavailable);
    const secondSystemPrompt = withIntegrationToolDiscoveryStatus(
      `${firstSystemPrompt}\n\nSuffix`,
      unavailable,
    );

    assertEquals(
      secondSystemPrompt.split("Integration tool discovery status:").length - 1,
      1,
    );
    assertEquals(secondSystemPrompt.startsWith("Base\n\nSuffix\n\n"), true);
  });

  it("does not report unavailable discovery when forwarded integration tools remain usable", async () => {
    const forwardedTool = toolDefinition("gmail__list_emails");
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: [forwardedTool.name],
      config: { model: "auto", system: "Base", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: [forwardedTool],
      getAvailableTools: async (_toolsConfig, options) => {
        options?.onIntegrationToolDiscovery?.({
          status: "unavailable",
          reason: "request_failed",
        });
        return [forwardedTool];
      },
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base" }),
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
    });

    assertEquals(prepared.integrationToolDiscovery, {
      status: "ok",
      tools: [forwardedTool],
    });
    assertEquals(
      withIntegrationToolDiscoveryStatus(
        prepared.systemPrompt,
        prepared.integrationToolDiscovery,
      ),
      "Base",
    );
  });

  it("does not let runtime context shadow the trusted abort signal", async () => {
    const trustedAbort = new AbortController();
    const shadowAbort = new AbortController();
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", __vfToolLoadingMode: "eager" } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [],
      supportsToolCalling: false,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({
        systemPrompt: "Base",
        context: { abortSignal: shadowAbort.signal },
      }),
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: { abortSignal: trustedAbort.signal },
    });

    assertStrictEquals(prepared.toolContext.abortSignal, trustedAbort.signal);
  });

  for (const branch of ["verified-preview", null, undefined]) {
    for (const mode of ["generate", "stream"] as const) {
      it(`preserves trusted branch through runtime refresh (${mode}, ${branch})`, async () => {
        const base = { branch };
        const observed: Array<ToolExecutionContext | undefined> = [];
        const prepared = await prepareAgentRuntimeStep(bootstrapStepInput([], {
          mode,
          toolContextBase: base,
          runtimeContext: base,
          resolveRuntimeState: async (_messages, context) => {
            if (context) context.branch = "request-preview";
            return { systemPrompt: "Base", context: { branch: "request-preview", keep: true } };
          },
          getAvailableTools: async (_tools, options) => {
            observed.push(options?.remoteToolContext);
            return [];
          },
        }));
        assertEquals(base.branch, branch);
        assertEquals(observed.length, 1);
        assertEquals(observed[0]?.branch, branch);
        assertEquals(prepared.toolContext.branch, branch);
        assertEquals(prepared.runtimeContext, { branch, keep: true });
      });
    }
  }

  it("does not let runtime context shadow trusted allowed skill ids", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async (_toolsConfig, options) => {
        assertEquals(options?.remoteToolContext?.allowedSkillIds, ["selected"]);
        return [];
      },
      supportsToolCalling: true,
      messages: [],
      mode: "generate",
      remoteToolSources: undefined,
      resolveRuntimeState: async () => ({
        systemPrompt: "Base",
        context: { allowedSkillIds: ["excluded"], keep: true },
      }),
      runtimeContext: { allowedSkillIds: ["selected"], keep: true },
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
    });

    assertEquals(prepared.toolContext.allowedSkillIds, ["selected"]);
    assertEquals(prepared.runtimeContext, { allowedSkillIds: ["selected"], keep: true });
  });

  it("resolves runtime state and merges tool context", async () => {
    const messages: Message[] = [{
      id: "msg_1",
      role: "user",
      parts: [{ type: "text", text: "Run it" }],
      timestamp: 1,
    }];
    const config = {
      model: "auto",
      system: "Base system",
      tools: true,
      // Declared, so the skill tools are expected regardless of what the
      // registry holds in this test.
      skills: true,
      __vfToolLoadingMode: "eager",
    } as AgentConfig;
    const capturedContexts: ToolExecutionContext[] = [];
    const remoteSource = remoteToolSource("remote_source");

    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: ["remote_allowed"],
      config,
      forwardedRemoteToolDefinitions: [toolDefinition("forwarded_remote")],
      supportsToolCalling: true,
      messages,
      mode: "generate",
      remoteToolSources: [remoteSource],
      runtimeContext: { projectId: "old_project", keep: true },
      step: 2,
      systemPrompt: "Base system",
      toolContextBase: { projectId: "base_project", userId: "user_1" },
      getAvailableTools: async (_toolsConfig, options) => {
        capturedContexts.push(options?.remoteToolContext ?? {});
        assertEquals(options?.callerAgentId, "agent_1");
        assertEquals(options?.includeSkillTools, true);
        assertEquals(options?.allowedRemoteToolNames, ["remote_allowed"]);
        assertEquals(options?.forwardedRemoteToolDefinitions, [toolDefinition("forwarded_remote")]);
        assertEquals(options?.remoteToolSources, [remoteSource]);
        return [toolDefinition("allowed_tool"), toolDefinition("blocked_tool")];
      },
      resolveRuntimeState: async (
        receivedMessages,
        receivedContext,
        receivedMode,
        receivedStep,
        receivedSystemPrompt,
      ): Promise<AgentRuntimeStepState> => {
        assertEquals(receivedMessages, messages);
        assertEquals(receivedContext, { projectId: "old_project", keep: true });
        assertEquals(receivedMode, "generate");
        assertEquals(receivedStep, 2);
        assertEquals(receivedSystemPrompt, "Base system");
        return {
          systemPrompt: "Updated system",
          context: { projectId: "runtime_project", keep: true, traceId: "trace_1" },
        };
      },
    });

    assertEquals(prepared.systemPrompt, "Updated system");
    assertEquals(prepared.runtimeContext, {
      projectId: "runtime_project",
      keep: true,
      traceId: "trace_1",
    });
    assertEquals(prepared.toolContext, {
      projectId: "runtime_project",
      userId: "user_1",
      keep: true,
      traceId: "trace_1",
    });
    assertEquals(capturedContexts, [prepared.toolContext]);
    // No skill policy narrows the tool set: `allowed-tools` is spec pre-approval
    // metadata, not an authorization boundary.
    assertEquals(prepared.tools.map((tool) => tool.name), ["allowed_tool", "blocked_tool"]);
  });

  it("passes active skill state to tool execution context", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillId: "support-escalation",
      activeSkillToolAvailability: {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: ["scripts/run.sh"],
      },
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [toolDefinition("search_knowledge")],
      resolveRuntimeState: async () => ({ systemPrompt: "Base", context: undefined }),
    });

    assertEquals(prepared.toolContext.activeSkillId, "support-escalation");
    assertEquals(prepared.toolContext.activeSkillToolAvailability, {
      hasActiveSkill: true,
      references: ["references/guide.md"],
      scripts: ["scripts/run.sh"],
    });
  });

  it("does not include skill tools for the explicit none selector", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: [],
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async (_toolsConfig, options) => {
        assertEquals(options?.includeSkillTools, false);
        return [toolDefinition("ordinary_tool")];
      },
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
      resolveRuntimeState: async () => ({ systemPrompt: "Base", context: undefined }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), ["ordinary_tool"]);
  });

  it("stamps the validated source policy into child-visible tool context", async () => {
    const sourceIntegrationPolicy = {
      schemaVersion: 1 as const,
      mode: "allowlist" as const,
      integrations: { gmail: { allowedToolIds: ["list_emails"] } },
    };
    const prepared = await prepareAgentRuntimeStep({
      agentId: "root-agent",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "system",
        tools: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [],
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: undefined,
      sourceIntegrationPolicy,
      resolveRuntimeState: async () => ({
        systemPrompt: "system",
        context: {
          __vfSourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
        },
      }),
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "system",
      toolContextBase: {
        __vfSourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      },
    });

    assertEquals(prepared.toolContext.__vfSourceIntegrationPolicy, sourceIntegrationPolicy);
  });

  it("does not load tools for runtimes that declare tool calling unsupported", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "local/test", system: "Local", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: false,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Local",
      toolContextBase: undefined,
      getAvailableTools: async () => {
        throw new Error("tool-incompatible runtime should not load tools");
      },
      resolveRuntimeState: async () => ({ systemPrompt: "Local", context: undefined }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), []);
    assertEquals(prepared.toolContext, {});
  });

  it("loads only the startup catalog for runtimes without tool calling", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "local/test", system: "Local", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: false,
      includeStartupAuthorizedTools: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Local",
      toolContextBase: undefined,
      getAvailableTools: async (_tools, options) => {
        options?.onIntegrationToolDiscovery?.({ status: "unavailable", reason: "request_failed" });
        return [toolDefinition("load_skill")];
      },
      resolveRuntimeState: async () => ({ systemPrompt: "Local", context: undefined }),
    });

    assertEquals(prepared.startupAuthorizedTools.map((tool) => tool.name), ["load_skill"]);
    assertEquals(prepared.tools, []);
    assertEquals(prepared.integrationToolDiscovery, undefined);
  });

  it("loads tools for server-local runtimes that declare tool calling support", async () => {
    let loaded = false;
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "local/test", system: "Local", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Local",
      toolContextBase: undefined,
      getAvailableTools: async () => {
        loaded = true;
        return [toolDefinition("local_lookup")];
      },
      resolveRuntimeState: async () => ({ systemPrompt: "Local", context: undefined }),
    });

    assertEquals(loaded, true);
    assertEquals(
      prepared.toolExposurePlan.authorized.map((tool) => tool.name),
      ["local_lookup"],
    );
  });

  it("hides intake tools but keeps delegation tools after submitted form input", async () => {
    const messages: Message[] = markTrustedFormResultMessages([{
      id: "tool_result_1",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "call_form",
        toolName: "form_input",
        result: { submitted: true, values: { brief: "make me an outlook agent" } },
      }],
      timestamp: 1,
    }]);

    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages,
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [
        platformToolDefinition("form_input"),
        platformToolDefinition("load_skill"),
        toolDefinition("invoke_agent"),
        toolDefinition("list_integrations"),
        toolDefinition("create_agent"),
      ],
      resolveRuntimeState: async () => ({ systemPrompt: "Base", context: undefined }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), [
      "invoke_agent",
      "list_integrations",
      "create_agent",
    ]);
  });

  it("keeps only advertised active-skill reference loads after submitted form input", async () => {
    const messages: Message[] = markTrustedFormResultMessages([{
      id: "tool_result_1",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "call_form",
        toolName: "form_input",
        result: { submitted: true, values: { brief: "plan" } },
      }],
    }]);
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillId: "plan",
      activeSkillToolAvailability: {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: [],
      },
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages,
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [
        platformToolDefinition("form_input"),
        platformToolDefinition("load_skill"),
      ],
      resolveRuntimeState: async () => ({ systemPrompt: "Base", context: undefined }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), ["load_skill"]);
    assertEquals(prepared.tools[0]?.parameters, {
      type: "object",
      properties: {
        skillId: { type: "string", enum: ["plan"] },
        file: { type: "string", enum: ["references/guide.md"] },
      },
      required: ["skillId", "file"],
      additionalProperties: false,
    });
  });

  it("hides intake tools but keeps delegation tools when hosted context records submitted form input", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 2,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [
        platformToolDefinition("form_input"),
        platformToolDefinition("load_skill"),
        toolDefinition("invoke_agent"),
        toolDefinition("list_integrations"),
        toolDefinition("create_agent"),
      ],
      resolveRuntimeState: async () => ({
        systemPrompt: "Base",
        context: { hasSubmittedFormInputResult: true },
      }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), [
      "invoke_agent",
      "list_integrations",
      "create_agent",
    ]);
  });

  it("keeps untrusted project tool collisions visible after a submitted platform form", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 2,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [
        toolDefinition("form_input"),
        toolDefinition("load_skill"),
        toolDefinition("invoke_agent"),
      ],
      resolveRuntimeState: async () => ({
        systemPrompt: "Base",
        context: { hasSubmittedFormInputResult: true },
      }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), [
      "form_input",
      "load_skill",
      "invoke_agent",
    ]);
  });

  it("does not treat submitted form input before the latest user message as active intake state", async () => {
    const messages: Message[] = [
      {
        id: "tool_result_old_form",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "old_form_call",
          toolName: "form_input",
          result: { submitted: true, values: { brief: "old brief" } },
        }],
        timestamp: 1,
      },
      {
        id: "user_new_turn",
        role: "user",
        parts: [{ type: "text", text: "Start a new request" }],
        timestamp: 2,
      },
    ];

    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages,
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [
        toolDefinition("form_input"),
        toolDefinition("load_skill"),
        toolDefinition("invoke_agent"),
      ],
      resolveRuntimeState: async () => ({ systemPrompt: "Base", context: undefined }),
    });

    assertEquals(prepared.runtimeContext, undefined);
    assertEquals(prepared.tools.map((tool) => tool.name), [
      "form_input",
      "load_skill",
      "invoke_agent",
    ]);
  });

  it("hides load_skill_reference when the active skill has no references", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: {
        hasActiveSkill: true,
        references: [],
        scripts: [],
      },
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 1,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [
        toolDefinition("search_knowledge"),
        toolDefinition("load_skill"),
        toolDefinition("load_skill_reference"),
        toolDefinition("execute_skill_script"),
      ],
      resolveRuntimeState: async () => ({ systemPrompt: "Base", context: undefined }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), [
      "search_knowledge",
      "load_skill",
    ]);
  });

  it("hides skill file tools before any skill is active", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: {
        hasActiveSkill: false,
        references: [],
        scripts: [],
      },
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
        skills: true,
        __vfToolLoadingMode: "eager",
      } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      supportsToolCalling: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
      getAvailableTools: async () => [
        toolDefinition("read_file"),
        toolDefinition("load_skill"),
        toolDefinition("load_skill_reference"),
        toolDefinition("execute_skill_script"),
      ],
      resolveRuntimeState: async () => ({ systemPrompt: "Base", context: undefined }),
    });

    assertEquals(prepared.tools.map((tool) => tool.name), [
      "read_file",
      "load_skill",
    ]);
  });
});
