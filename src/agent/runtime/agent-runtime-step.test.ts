import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig, Message } from "../types.ts";
import type { AgentRuntimeStepState, RuntimeStepToolLoader } from "./agent-runtime-step.ts";
import {
  prepareAgentRuntimeStep,
  withIntegrationToolDiscoveryStatus,
} from "./agent-runtime-step.ts";
import { createToolExposureState } from "./tool-exposure.ts";

function toolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {} },
  };
}

function remoteToolSource(id: string): RemoteToolSource {
  return {
    id,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve(undefined),
  };
}

describe("agent/runtime-step", () => {
  it("exposes only bootstrap and loaded schemas in deferred mode", async () => {
    const state = createToolExposureState(["get_release"]);
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: {
        model: "auto",
        system: "Base",
        tools: true,
      } as AgentConfig,
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
      ["get_release", "load_skill", "tool_search"],
    );
    assertEquals(
      prepared.toolExposurePlan.deferred.map((tool) => tool.name),
      ["create_release", "form_input"],
    );
  });

  it("keeps provider-native tools authorized but deferred until tool_search loads them", async () => {
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
          'Base\n\nCurrent run tool inventory:\n\n- tool_search\n\nOnly treat the tools listed above as actually available in this run.\nIf the list is "- none", say plainly that no tools are available.\nDo NOT infer tool availability from examples, skills, or the base prompt.\nWhen tool_search is listed, additional authorized tools may be deferred. You MUST call tool_search before declaring a requested or required tool unavailable. Query with one exact tool name when known, or one short capability phrase; do not combine alternatives in one query. A loaded match becomes callable on the next model step.',
      }),
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Base",
      toolContextBase: undefined,
      toolExposureState: state,
    });

    assertEquals(prepared.systemPrompt.includes("- web_search"), true);
    assertEquals(prepared.tools.map((tool) => tool.name), ["tool_search"]);
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
    assertEquals(loaded.tools.map((tool) => tool.name), ["tool_search", "web_search"]);
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
      second.systemPrompt,
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
    const messages: Message[] = [{
      id: "tool_result_1",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "call_form",
        toolName: "form_input",
        result: { submitted: true, values: { brief: "make me an outlook agent" } },
      }],
      timestamp: 1,
    }];

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
    const messages: Message[] = [{
      id: "tool_result_1",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "call_form",
        toolName: "form_input",
        result: { submitted: true, values: { brief: "plan" } },
      }],
    }];
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
        toolDefinition("form_input"),
        toolDefinition("load_skill"),
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
        toolDefinition("form_input"),
        toolDefinition("load_skill"),
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
