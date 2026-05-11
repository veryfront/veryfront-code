import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildAgentRunTraceAttributes,
  buildExecuteToolTraceAttributes,
  buildFinalizedAgentRunTraceAttributes,
  buildInvokeAgentTraceAttributes,
  filterAgentTraceAttributes,
  isAgentTraceAttributeValue,
} from "./index.ts";

describe("agent/agent-trace-attributes", () => {
  it("filters unknown values to valid trace attributes", () => {
    assertEquals(isAgentTraceAttributeValue(["a", 1, true]), true);
    assertEquals(isAgentTraceAttributeValue(["a", { invalid: true }]), false);
    assertEquals(
      filterAgentTraceAttributes({
        string: "value",
        number: 1,
        boolean: true,
        array: ["a", 2, false],
        nullValue: null,
        undefinedValue: undefined,
        object: { nested: true },
      }),
      {
        string: "value",
        number: 1,
        boolean: true,
        array: ["a", 2, false],
        nullValue: null,
        undefinedValue: undefined,
      },
    );
  });

  it("builds core agent run lineage attributes", () => {
    assertEquals(
      buildAgentRunTraceAttributes({
        operationName: "chat",
        conversationId: "conversation-1",
        projectId: "project-1",
        userId: "user-1",
        agentId: "builder",
        runId: "run-1",
        parentRunId: "run-parent",
        parentConversationId: "conversation-parent",
        messageId: "message-1",
        toolCallId: "tool-call-1",
      }),
      {
        "conversation.id": "conversation-1",
        "project.id": "project-1",
        "user.id": "user-1",
        "agent.id": "builder",
        "run.id": "run-1",
        "parent.run.id": "run-parent",
        "parent.conversation.id": "conversation-parent",
        "message.id": "message-1",
        "tool.call.id": "tool-call-1",
        "gen_ai.operation.name": "chat",
        "gen_ai.conversation.id": "conversation-1",
        "gen_ai.agent.id": "builder",
      },
    );
  });

  it("builds generic tool execution attributes", () => {
    assertEquals(
      buildExecuteToolTraceAttributes({
        toolName: "bash",
        toolCallId: "tool-call-1",
      }),
      {
        "tool.name": "bash",
        "tool.call.id": "tool-call-1",
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "bash",
        "gen_ai.tool.type": "function",
        "gen_ai.tool.call.id": "tool-call-1",
      },
    );
  });

  it("builds invoke_agent child lineage and usage attributes", () => {
    assertEquals(
      buildInvokeAgentTraceAttributes({
        conversationId: "conversation-1",
        projectId: "project-1",
        runId: "run-parent",
        toolCallId: "tool-call-1",
        childAgentId: "plan",
        childConversationId: "conversation-child",
        childRunId: "run-child",
        childMessageId: "message-child",
        sourceTargetKind: "project",
        runtimeTargetKind: "production",
        status: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
      }),
      {
        "conversation.id": "conversation-1",
        "project.id": "project-1",
        "run.id": "run-parent",
        "child.agent.id": "plan",
        "child.conversation.id": "conversation-child",
        "child.run.id": "run-child",
        "child.message.id": "message-child",
        "source.target.kind": "project",
        "runtime.target.kind": "production",
        "agent.run.final_status": "completed",
        "tool.name": "invoke_agent",
        "tool.call.id": "tool-call-1",
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "invoke_agent",
        "gen_ai.tool.type": "function",
        "gen_ai.tool.call.id": "tool-call-1",
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 5,
      },
    );
  });

  it("builds final run status attributes with provider and usage", () => {
    assertEquals(
      buildFinalizedAgentRunTraceAttributes({
        status: "completed",
        modelId: "anthropic/claude-opus-4-6",
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cachedInputTokens: 3,
        },
      }),
      {
        "agent.run.final_status": "completed",
        "gen_ai.provider.name": "anthropic",
        "gen_ai.response.model": "anthropic/claude-opus-4-6",
        "gen_ai.response.finish_reasons": ["stop"],
        "gen_ai.usage.input_tokens": 11,
        "gen_ai.usage.output_tokens": 7,
        "gen_ai.usage.cache_read.input_tokens": 3,
      },
    );
  });
});
