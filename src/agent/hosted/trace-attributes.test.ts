import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildAgentRunTraceAttributes,
  buildExecuteToolTraceAttributes,
  buildFinalizedAgentRunTraceAttributes,
  buildInvokeAgentTraceAttributes,
  buildScheduleTraceAttributes,
  filterAgentTraceAttributes,
  isAgentTraceAttributeValue,
} from "../index.ts";

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
        agentName: "Builder",
        modelId: "anthropic/claude-sonnet-4-6",
        runId: "run-1",
        parentRunId: "run-parent",
        parentConversationId: "conversation-parent",
        messageId: "message-1",
        toolCallId: "tool-call-1",
        scheduleId: "schedule-1",
        scheduleName: "Triage sweep",
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
        "schedule.id": "schedule-1",
        "schedule.name": "Triage sweep",
        "run.trigger.kind": "schedule",
        "run.trigger.id": "schedule-1",
        "gen_ai.operation.name": "chat",
        "gen_ai.conversation.id": "conversation-1",
        "gen_ai.agent.id": "builder",
        "gen_ai.agent.name": "Builder",
        "gen_ai.request.model": "anthropic/claude-sonnet-4-6",
      },
    );
  });

  it("builds schedule trigger attributes from forwarded props", () => {
    assertEquals(
      buildScheduleTraceAttributes({
        schedule_id: "schedule-1",
        schedule_name: "Triage sweep",
        unrelated: { nested: true },
      }),
      {
        "schedule.id": "schedule-1",
        "schedule.name": "Triage sweep",
        "run.trigger.kind": "schedule",
        "run.trigger.id": "schedule-1",
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
        runtimeTargetKind: "main_branch",
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
        "runtime.target.kind": "main_branch",
        "agent.run.final_status": "completed",
        "tool.name": "invoke_agent",
        "tool.call.id": "tool-call-1",
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "invoke_agent",
        "gen_ai.tool.type": "function",
        "gen_ai.tool.call.id": "tool-call-1",
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 5,
        "gen_ai.usage.total_tokens": 15,
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
          cacheCreationInputTokens: 1,
          cacheReadInputTokens: 2,
          reasoningTokens: 4,
        },
      }),
      {
        "agent.run.final_status": "completed",
        "gen_ai.provider.name": "anthropic",
        "gen_ai.response.model": "anthropic/claude-opus-4-6",
        "gen_ai.response.finish_reasons": ["stop"],
        "gen_ai.usage.input_tokens": 11,
        "gen_ai.usage.output_tokens": 7,
        "gen_ai.usage.total_tokens": 18,
        "gen_ai.usage.cache_creation.input_tokens": 1,
        "gen_ai.usage.cache_read.input_tokens": 2,
        "gen_ai.usage.reasoning.output_tokens": 4,
      },
    );
  });
});
