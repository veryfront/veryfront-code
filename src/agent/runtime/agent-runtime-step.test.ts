import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { AgentConfig, Message } from "../types.ts";
import type { AgentRuntimeStepState } from "./agent-runtime-step.ts";
import { prepareAgentRuntimeStep } from "./agent-runtime-step.ts";

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
  it("resolves runtime state, merges tool context, and applies active skill policy", async () => {
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
      skills: true,
    } as AgentConfig;
    const capturedContexts: ToolExecutionContext[] = [];
    const remoteSource = remoteToolSource("remote_source");

    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillPolicy: ["allowed_tool"],
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: ["remote_allowed"],
      config,
      forwardedRemoteToolDefinitions: [toolDefinition("forwarded_remote")],
      isLocalModel: false,
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
    assertEquals(prepared.tools.map((tool) => tool.name), ["allowed_tool"]);
  });

  it("passes active skill state to tool execution context", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillId: "support-escalation",
      activeSkillPolicy: ["search_knowledge"],
      activeSkillToolAvailability: {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: ["scripts/run.sh"],
      },
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      isLocalModel: false,
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

  it("stamps the validated source policy into child-visible tool context", async () => {
    const sourceIntegrationPolicy = {
      schemaVersion: 1 as const,
      mode: "allowlist" as const,
      integrations: { gmail: { allowedToolIds: ["list_emails"] } },
    };
    const prepared = await prepareAgentRuntimeStep({
      agentId: "root-agent",
      activeSkillPolicy: undefined,
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "system", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      getAvailableTools: async () => [],
      isLocalModel: false,
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

  it("skips tool loading for local models", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillPolicy: undefined,
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "local/test", system: "Local", tools: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      isLocalModel: true,
      messages: [],
      mode: "stream",
      remoteToolSources: [],
      runtimeContext: undefined,
      step: 0,
      systemPrompt: "Local",
      toolContextBase: undefined,
      getAvailableTools: async () => {
        throw new Error("local model should not load tools");
      },
      resolveRuntimeState: async () => ({ systemPrompt: "Local", context: undefined }),
    });

    assertEquals(prepared.tools, []);
    assertEquals(prepared.toolContext, {});
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
      activeSkillPolicy: undefined,
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true, skills: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      isLocalModel: false,
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

  it("hides intake tools but keeps delegation tools when hosted context records submitted form input", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillPolicy: undefined,
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true, skills: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      isLocalModel: false,
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
      activeSkillPolicy: undefined,
      activeSkillToolAvailability: undefined,
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true, skills: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      isLocalModel: false,
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
      activeSkillPolicy: ["search_knowledge"],
      activeSkillToolAvailability: {
        hasActiveSkill: true,
        references: [],
        scripts: [],
      },
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true, skills: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      isLocalModel: false,
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
      activeSkillPolicy: undefined,
      activeSkillToolAvailability: {
        hasActiveSkill: false,
        references: [],
        scripts: [],
      },
      allowedRemoteToolNames: undefined,
      config: { model: "auto", system: "Base", tools: true, skills: true } as AgentConfig,
      forwardedRemoteToolDefinitions: undefined,
      isLocalModel: false,
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
