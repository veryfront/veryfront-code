import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createHostedAgentRunSpanController,
  createHostedRootRunLifecycleRuntimeAdapter,
  type HostedAgentRunSpan,
} from "./agent-run-lifecycle.ts";
import { createConversationHostedTerminalAdapter } from "../conversation/hosted-terminal.ts";
import type { ConversationHostedTerminalAdapter } from "../conversation/hosted-terminal.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";

type TerminalAdapterOptions = Parameters<
  typeof createConversationHostedTerminalAdapter
>[0];

class RecordingSpan implements HostedAgentRunSpan {
  attributes: Record<string, unknown> = {};
  finished = 0;
  withContextCalls = 0;

  setAttributes(attributes: Record<string, unknown>): void {
    this.attributes = { ...this.attributes, ...attributes };
  }

  finish(): void {
    this.finished += 1;
  }

  withContext<T>(fn: () => T): T {
    this.withContextCalls += 1;
    return fn();
  }
}

function createRecordingTerminalAdapter(
  input: TerminalAdapterOptions,
): ConversationHostedTerminalAdapter {
  const toTerminalState = (state: {
    status: HostedLifecycleTerminalState["status"];
    metadata?: HostedLifecycleTerminalState["metadata"];
    terminalErrorCode?: string | null;
    terminalErrorMessage?: string | null;
  }): HostedLifecycleTerminalState => ({
    status: state.status,
    ...(state.metadata ? { metadata: state.metadata } : {}),
    ...(state.terminalErrorCode !== undefined
      ? { terminalErrorCode: state.terminalErrorCode }
      : {}),
    ...(state.terminalErrorMessage !== undefined
      ? { terminalErrorMessage: state.terminalErrorMessage }
      : {}),
  });

  return {
    toTerminalState,
    finalizeRun: async () => {},
    cancelRun: async () => {},
    onTerminalState: async (terminalState) => {
      await input.onTerminalState?.(terminalState);
    },
    dispatch: async (state) => {
      const terminalState = toTerminalState(state);
      await input.onTerminalState?.(terminalState);
      return terminalState;
    },
  };
}

describe("hosted-agent-run-lifecycle", () => {
  it("records start and final span attributes once", () => {
    const span = new RecordingSpan();
    const controller = createHostedAgentRunSpanController({
      tracer: { startSpan: () => span },
      operationName: "chat",
      conversationId: "conversation-1",
      projectId: "project-1",
      userId: "user-1",
      agentId: "agent-1",
      agentName: "Ops Agent",
      modelId: "veryfront-cloud/anthropic/claude-sonnet-4-6",
      rootRun: { runId: "run-1", messageId: "message-1" },
      upstreamParentConversationId: "parent-conversation-1",
      upstreamParentRunId: "parent-run-1",
      spawnedFromToolCallId: "tool-call-1",
      traceAttributes: {
        "project.slug": "veryfront-ops-agent",
        "service.name": "veryfront-ops-agent",
        service: "veryfront-ops-agent",
        "service.version": "0.0.34",
        version: "0.0.34",
        "deployment.environment.name": "production",
        "deployment.environment": "production",
        env: "production",
        "schedule.id": "schedule-1",
        "schedule.name": "Triage sweep",
        "run.trigger.kind": "schedule",
        "run.trigger.id": "schedule-1",
      },
    });

    assertEquals(span.attributes["conversation.id"], "conversation-1");
    assertEquals(span.attributes["project.id"], "project-1");
    assertEquals(span.attributes["run.id"], "run-1");
    assertEquals(span.attributes["message.id"], "message-1");
    assertEquals(span.attributes["parent.conversation.id"], "parent-conversation-1");
    assertEquals(span.attributes["parent.run.id"], "parent-run-1");
    assertEquals(span.attributes["tool.call.id"], "tool-call-1");
    assertEquals(span.attributes["project.slug"], "veryfront-ops-agent");
    assertEquals(span.attributes["service.name"], "veryfront-ops-agent");
    assertEquals(span.attributes["service"], "veryfront-ops-agent");
    assertEquals(span.attributes["service.version"], "0.0.34");
    assertEquals(span.attributes["version"], "0.0.34");
    assertEquals(span.attributes["deployment.environment.name"], "production");
    assertEquals(span.attributes["deployment.environment"], "production");
    assertEquals(span.attributes["env"], "production");
    assertEquals(span.attributes["schedule.id"], "schedule-1");
    assertEquals(span.attributes["schedule.name"], "Triage sweep");
    assertEquals(span.attributes["run.trigger.kind"], "schedule");
    assertEquals(span.attributes["run.trigger.id"], "schedule-1");
    assertEquals(span.attributes["gen_ai.operation.name"], "chat");
    assertEquals(span.attributes["gen_ai.agent.name"], "Ops Agent");
    assertEquals(
      span.attributes["gen_ai.request.model"],
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );

    const value = controller.withContext(() => "ok");
    assertEquals(value, "ok");
    assertEquals(span.withContextCalls, 1);

    controller.setMessageId("message-2");
    controller.finalize({
      status: "completed",
      modelId: "veryfront-cloud/anthropic/claude-sonnet-4-6",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 2,
        cacheReadInputTokens: 2,
        reasoningTokens: 1,
      },
    });
    controller.finalize({ status: "failed", terminalErrorCode: "LATE" });

    assertEquals(span.finished, 1);
    assertEquals(span.attributes["message.id"], "message-2");
    assertEquals(span.attributes["agent.run.final_status"], "completed");
    assertEquals(span.attributes["gen_ai.provider.name"], "anthropic");
    assertEquals(
      span.attributes["gen_ai.response.model"],
      "veryfront-cloud/anthropic/claude-sonnet-4-6",
    );
    assertEquals(span.attributes["gen_ai.usage.input_tokens"], 10);
    assertEquals(span.attributes["gen_ai.usage.output_tokens"], 5);
    assertEquals(span.attributes["gen_ai.usage.total_tokens"], 15);
    assertEquals(span.attributes["gen_ai.usage.cache_read.input_tokens"], 2);
    assertEquals(span.attributes["gen_ai.usage.reasoning.output_tokens"], 1);
  });

  it("creates a terminal adapter and finalizes the span", async () => {
    const finalized: unknown[] = [];
    let terminalOptions: TerminalAdapterOptions | undefined;

    const adapter = createHostedRootRunLifecycleRuntimeAdapter({
      authToken: "token",
      apiUrl: "https://api.example.com",
      modelId: "veryfront-cloud/openai/gpt-5.1",
      durableRootRun: {
        runId: "run-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        latestEventId: 7,
        latestExternalEventSequence: 3,
      },
      durableRunMirror: null,
      resolveProvider: (modelId) => modelId.split("/")[1] ?? "unknown",
      agentRunSpan: {
        finalize: (state) => {
          finalized.push(state);
        },
      },
      createTerminalAdapter: (input) => {
        terminalOptions = input;
        return createRecordingTerminalAdapter(input);
      },
    });

    await adapter.terminal.onTerminalState({
      status: "failed",
      metadata: {
        modelId: "veryfront-cloud/openai/gpt-5.2",
        usage: { inputTokens: 3, outputTokens: 4 },
      },
      terminalErrorCode: "STREAM_ERROR",
      terminalErrorMessage: "stream broke",
    });

    assertEquals(adapter.durableRootRun?.runId, "run-1");
    assertEquals(terminalOptions?.authToken, "token");
    assertEquals(terminalOptions?.apiUrl, "https://api.example.com");
    assertEquals(terminalOptions?.fallbackModelId, "veryfront-cloud/openai/gpt-5.1");
    assertEquals(terminalOptions?.run?.status, "running");
    assertEquals(terminalOptions?.run?.waitingToolCallId, null);
    assertEquals(finalized, [
      {
        status: "failed",
        modelId: "veryfront-cloud/openai/gpt-5.2",
        usage: { inputTokens: 3, outputTokens: 4 },
        terminalErrorCode: "STREAM_ERROR",
        terminalErrorMessage: "stream broke",
      },
    ]);
  });
});
