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

  it("skips tool loading for local models", async () => {
    const prepared = await prepareAgentRuntimeStep({
      agentId: "agent_1",
      activeSkillPolicy: undefined,
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
});
