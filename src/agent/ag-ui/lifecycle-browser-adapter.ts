import type {
  StreamLifecycleFrame,
  StreamOutcome,
  StreamUsage,
} from "#veryfront/agent/streaming/lifecycle/index.ts";
import { StreamProjectionInvariantError } from "#veryfront/agent/conversation/lifecycle-run-event-adapter.ts";
import type { AgUiBrowserEncodedEvent, AgUiBrowserRunFinishedMetadata } from "./browser-encoder.ts";

/** Formatting-only state kept by the lifecycle AG-UI adapter. */
export interface LifecycleAgUiBrowserState {
  messageId: string;
  activeStepName: string | null;
  stepCount: number;
  streamedToolInputIds: Set<string>;
  sawVisibleOutput: boolean;
  sawTerminalError: boolean;
  metadata: AgUiBrowserRunFinishedMetadata;
}

/** Canonical-frame AG-UI projection with explicit terminal handling. */
export interface LifecycleAgUiBrowserAdapter {
  encode(frame: StreamLifecycleFrame): AgUiBrowserEncodedEvent[];
  finalize(
    input:
      | { outcome: StreamOutcome; terminalStatus?: never }
      | {
        outcome?: never;
        terminalStatus: "completed" | "failed" | "cancelled";
      },
  ): AgUiBrowserEncodedEvent[];
  getState(): Readonly<LifecycleAgUiBrowserState>;
}

function safeJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

function mergeUsageMetadata(
  metadata: AgUiBrowserRunFinishedMetadata,
  usage: StreamUsage,
): AgUiBrowserRunFinishedMetadata {
  return {
    ...metadata,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    ...(usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: usage.cachedInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.billableInputTokens !== undefined
      ? { billableInputTokens: usage.billableInputTokens }
      : {}),
    ...(usage.billableOutputTokens !== undefined
      ? { billableOutputTokens: usage.billableOutputTokens }
      : {}),
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    ...(usage.providerCostUsd !== undefined ? { providerCostUsd: usage.providerCostUsd } : {}),
    ...(usage.veryfrontChargeUsd !== undefined
      ? { veryfrontChargeUsd: usage.veryfrontChargeUsd }
      : {}),
    ...(usage.veryfrontBilledUsd !== undefined
      ? { veryfrontBilledUsd: usage.veryfrontBilledUsd }
      : {}),
    ...(usage.costCredits !== undefined ? { costCredits: usage.costCredits } : {}),
    ...(usage.costSource !== undefined ? { costSource: usage.costSource } : {}),
    ...(usage.billingMode !== undefined ? { billingMode: usage.billingMode } : {}),
    ...(usage.usageCaptureStatus !== undefined
      ? { usageCaptureStatus: usage.usageCaptureStatus }
      : {}),
  };
}

/** Create a pure lifecycle-frame AG-UI browser adapter. */
export function createLifecycleAgUiBrowserAdapter(input: {
  messageId: string;
  provider?: string;
  model?: string;
}): LifecycleAgUiBrowserAdapter {
  const state: LifecycleAgUiBrowserState = {
    messageId: input.messageId,
    activeStepName: null,
    stepCount: 0,
    streamedToolInputIds: new Set(),
    sawVisibleOutput: false,
    sawTerminalError: false,
    metadata: {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
    },
  };

  const requireId = (id: string | undefined, what: string): string => {
    if (!id) {
      throw new StreamProjectionInvariantError(
        `${what} frame is missing its required identifier`,
      );
    }
    return id;
  };

  const reasoningMessageId = (id: string) => `${state.messageId}:reasoning:${id}`;

  const encodeSemantic = (
    event: Extract<StreamLifecycleFrame, { class: "semantic" }>["event"],
  ): AgUiBrowserEncodedEvent[] => {
    switch (event.type) {
      case "message_start":
        if (event.messageId) state.messageId = event.messageId;
        return [];
      case "step_start": {
        state.stepCount += 1;
        state.activeStepName = `step-${state.stepCount}`;
        return [{
          event: "StepStarted",
          payload: { stepName: state.activeStepName },
        }];
      }
      case "text_start":
        state.sawVisibleOutput = true;
        return [{
          event: "TextMessageStart",
          payload: {
            messageId: state.messageId,
            contentId: requireId(event.id, "text_start"),
            role: "assistant",
          },
        }];
      case "text_content":
        state.sawVisibleOutput = true;
        return [{
          event: "TextMessageContent",
          payload: {
            messageId: state.messageId,
            contentId: requireId(event.id, "text_content"),
            delta: event.delta,
          },
        }];
      case "text_end":
        return [{
          event: "TextMessageEnd",
          payload: {
            messageId: state.messageId,
            contentId: requireId(event.id, "text_end"),
          },
        }];
      case "reasoning_start":
        state.sawVisibleOutput = true;
        return [{
          event: "ReasoningMessageStart",
          payload: {
            messageId: reasoningMessageId(event.id),
            role: "reasoning",
          },
        }];
      case "reasoning_content":
        state.sawVisibleOutput = true;
        return [{
          event: "ReasoningMessageContent",
          payload: {
            messageId: reasoningMessageId(event.id),
            delta: event.delta,
          },
        }];
      case "reasoning_end":
        return [{
          event: "ReasoningMessageEnd",
          payload: { messageId: reasoningMessageId(event.id) },
        }];
      case "tool_input_start":
        state.sawVisibleOutput = true;
        return [{
          event: "ToolCallStart",
          payload: {
            toolCallId: event.toolCallId,
            toolCallName: event.toolName,
          },
        }];
      case "tool_input_content":
        state.sawVisibleOutput = true;
        state.streamedToolInputIds.add(event.toolCallId);
        return [{
          event: "ToolCallArgs",
          payload: { toolCallId: event.toolCallId, delta: event.delta },
        }];
      case "tool_input_ready": {
        state.sawVisibleOutput = true;
        const events: AgUiBrowserEncodedEvent[] = [];
        if (!state.streamedToolInputIds.has(event.toolCallId)) {
          events.push({
            event: "ToolCallArgs",
            payload: {
              toolCallId: event.toolCallId,
              delta: JSON.stringify(safeJson(event.input) ?? {}),
            },
          });
        }
        events.push({
          event: "ToolCallEnd",
          payload: { toolCallId: event.toolCallId },
        });
        if (event.providerExecuted === true) {
          events.push({
            event: "ToolCallResult",
            payload: { toolCallId: event.toolCallId, result: null },
          });
        }
        return events;
      }
      case "tool_input_rejected":
        if (event.reason === "unavailable") return [];
        state.sawVisibleOutput = true;
        return [
          {
            event: "ToolCallEnd",
            payload: { toolCallId: event.toolCallId },
          },
          {
            event: "ToolCallResult",
            payload: {
              toolCallId: event.toolCallId,
              result: { error: "Tool input was rejected before handoff" },
              isError: true,
            },
          },
        ];
      case "provider_tool_start":
        return [];
      case "provider_tool_result":
        state.sawVisibleOutput = true;
        return [{
          event: "ToolCallResult",
          payload: {
            toolCallId: event.toolCallId,
            result: safeJson(event.output),
            ...(event.isError ? { isError: true } : {}),
          },
        }];
      case "provider_tool_denied":
        state.sawVisibleOutput = true;
        return [{
          event: "ToolCallResult",
          payload: {
            toolCallId: event.toolCallId,
            result: { error: "Tool output denied" },
            isError: true,
          },
        }];
      case "provider_tool_cancelled":
        state.sawVisibleOutput = true;
        return [{
          event: "ToolCallResult",
          payload: {
            toolCallId: event.toolCallId,
            result: { error: "Provider tool execution was cancelled" },
            isError: true,
          },
        }];
      case "step_finish":
        return [{
          event: "StepFinished",
          payload: {
            stepName: state.activeStepName ?? `step-${state.stepCount || 1}`,
          },
        }];
      case "custom":
        state.sawVisibleOutput = true;
        return [{
          event: "Custom",
          payload: { name: event.name, value: safeJson(event.data) },
        }];
      case "usage":
        state.metadata = mergeUsageMetadata(state.metadata, event.usage);
        return [];
    }
  };

  return {
    encode(frame) {
      if (frame.class === "diagnostic") return [];
      if (frame.class === "telemetry") {
        return frame.event.type === "tool_input_status"
          ? [{
            event: "Custom",
            payload: {
              name: "tool-call-status",
              value: {
                toolCallId: frame.event.toolCallId,
                status: frame.event.status,
              },
            },
          }]
          : [];
      }
      return encodeSemantic(frame.event);
    },
    finalize(terminal) {
      if (state.sawTerminalError) return [];
      if (terminal.outcome) {
        const outcome = terminal.outcome;
        if (outcome.status === "failed") {
          state.sawTerminalError = true;
          return [{
            event: "RunError",
            payload: {
              code: outcome.error.code,
              message: outcome.error.publicMessage,
            },
          }];
        }
        if (outcome.status === "cancelled") {
          state.sawTerminalError = true;
          return [{
            event: "RunError",
            payload: {
              code: "STREAM_CANCELLED",
              message: "Stream was cancelled",
            },
          }];
        }
        if (outcome.status === "tool_handoff") {
          // Phase 5 outer-loop delivery owns later local tool execution and
          // the final run status; a provider-attempt boundary never
          // terminates the agent run.
          return [];
        }
        if (!state.sawVisibleOutput) {
          state.sawTerminalError = true;
          return [{
            event: "RunError",
            payload: {
              code: "EMPTY_ASSISTANT_OUTPUT",
              message: "Agent run produced no assistant-visible output",
            },
          }];
        }
        return [{
          event: "RunFinished",
          payload: { metadata: state.metadata },
        }];
      }
      if (terminal.terminalStatus === "cancelled") {
        state.sawTerminalError = true;
        return [{
          event: "RunError",
          payload: {
            code: "STREAM_CANCELLED",
            message: "Stream was cancelled",
          },
        }];
      }
      if (terminal.terminalStatus === "failed") {
        state.sawTerminalError = true;
        return [{
          event: "RunError",
          payload: { code: "RUN_FAILED", message: "Agent run failed" },
        }];
      }
      if (!state.sawVisibleOutput) {
        state.sawTerminalError = true;
        return [{
          event: "RunError",
          payload: {
            code: "EMPTY_ASSISTANT_OUTPUT",
            message: "Agent run produced no assistant-visible output",
          },
        }];
      }
      return [{
        event: "RunFinished",
        payload: { metadata: state.metadata },
      }];
    },
    getState() {
      return state;
    },
  };
}
