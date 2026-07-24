import type {
  ChatStreamState,
  StreamingToolResult,
} from "#veryfront/agent/runtime/chat-stream-handler.ts";
import type { ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import type {
  StreamLifecycleFrame,
  StreamSnapshot,
  StreamToolSnapshot,
  StreamUsage,
} from "./types.ts";

interface LiveAdapterToolState {
  toolName: string;
  dynamic?: boolean;
  deltas: string[];
  announced: boolean;
}

export function createStreamLifecycleLiveAdapter(
  input: { textPartId?: string },
) {
  const tools = new Map<string, LiveAdapterToolState>();
  return {
    encode(frame: StreamLifecycleFrame): ChatStreamEvent[] {
      if (frame.class === "diagnostic") return [];
      if (frame.class === "telemetry") {
        return frame.event.type === "tool_input_status"
          ? [{
            type: "data-tool-call-status",
            data: {
              toolCallId: frame.event.toolCallId,
              status: frame.event.status,
            },
          } as ChatStreamEvent]
          : [];
      }
      const event = frame.event;
      switch (event.type) {
        case "text_start":
          return [{
            type: "text-start",
            id: input.textPartId ?? event.id ?? "text",
          }];
        case "text_content":
          return [{
            type: "text-delta",
            id: input.textPartId ?? event.id ?? "text",
            delta: event.delta,
          }];
        case "text_end":
          return [{
            type: "text-end",
            id: input.textPartId ?? event.id ?? "text",
          }];
        case "reasoning_start":
          return [{ type: "reasoning-start", id: event.id }];
        case "reasoning_content":
          return [{ type: "reasoning-delta", id: event.id, delta: event.delta }];
        case "reasoning_end":
          return [{
            type: "reasoning-end",
            id: event.id,
            ...(event.signature ? { signature: event.signature } : {}),
            ...(event.redactedData ? { redactedData: event.redactedData } : {}),
          }];
        case "tool_input_start": {
          // The legacy stream defers tool announcement until the input
          // commits, then replays buffered deltas before the available event.
          tools.set(event.toolCallId, {
            toolName: event.toolName,
            ...(event.dynamic ? { dynamic: true } : {}),
            deltas: [],
            announced: false,
          });
          return [];
        }
        case "tool_input_content": {
          const tool = tools.get(event.toolCallId);
          if (tool) tool.deltas.push(event.delta);
          return [];
        }
        case "tool_input_ready": {
          const tool = tools.get(event.toolCallId);
          const dynamic = event.dynamic ?? tool?.dynamic;
          const events: ChatStreamEvent[] = [];
          if (!tool?.announced && event.announced !== true) {
            events.push({
              type: "tool-input-start",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              ...(dynamic ? { dynamic: true } : {}),
            });
            for (const delta of tool?.deltas ?? []) {
              events.push({
                type: "tool-input-delta",
                toolCallId: event.toolCallId,
                inputTextDelta: delta,
              });
            }
            if (tool) tool.announced = true;
            else {
              tools.set(event.toolCallId, {
                toolName: event.toolName,
                ...(dynamic ? { dynamic: true } : {}),
                deltas: [],
                announced: true,
              });
            }
          }
          events.push({
            type: "tool-input-available",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
            ...(event.providerExecuted !== undefined
              ? { providerExecuted: event.providerExecuted }
              : {}),
            ...(dynamic ? { dynamic: true } : {}),
          });
          tools.delete(event.toolCallId);
          return events;
        }
        case "tool_input_rejected":
          return event.reason === "unavailable" ? [] : [{
            type: "tool-input-error",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: null,
            errorText: "Tool input was rejected before handoff",
          }];
        case "provider_tool_start":
          return [];
        case "provider_tool_result":
          return event.isError
            ? [{
              type: "tool-output-error",
              toolCallId: event.toolCallId,
              errorText: "Provider tool execution failed",
              providerExecuted: true,
            }]
            : [{
              type: "tool-output-available",
              toolCallId: event.toolCallId,
              output: event.output,
              providerExecuted: true,
              ...(event.dynamic ? { dynamic: true } : {}),
              ...(event.preliminary !== undefined ? { preliminary: event.preliminary } : {}),
            }];
        case "provider_tool_denied":
          return [{ type: "tool-output-denied", toolCallId: event.toolCallId }];
        case "provider_tool_cancelled":
          return [{
            type: "tool-output-error",
            toolCallId: event.toolCallId,
            errorText: "Provider tool execution was cancelled",
            providerExecuted: true,
          }];
        case "custom":
          return [{
            type: `data-${event.name}`,
            data: event.data,
          } as ChatStreamEvent];
        case "message_start":
        case "step_start":
        case "step_finish":
        case "usage":
          return [];
      }
    },
  };
}

export function toLegacyRuntimeUsage(
  usage: StreamUsage,
): ChatStreamState["usage"] {
  const { inputTokens, outputTokens, ...rest } = usage;
  return {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    ...rest,
  };
}

function isAvailableTool(tool: StreamToolSnapshot): boolean {
  return tool.rejectionReason !== "unavailable";
}

function isInputAvailable(tool: StreamToolSnapshot): boolean {
  return tool.phase !== "input_open" &&
    tool.phase !== "input_streaming" &&
    tool.phase !== "input_rejected";
}

function isProviderToolTerminal(tool: StreamToolSnapshot): boolean {
  return tool.providerExecuted === true && (
    tool.phase === "succeeded" ||
    tool.phase === "failed" ||
    tool.phase === "denied" ||
    tool.phase === "cancelled"
  );
}

export function applyLifecycleSnapshotToChatStreamState(
  state: ChatStreamState,
  snapshot: Readonly<StreamSnapshot>,
): void {
  state.accumulatedText = snapshot.accumulatedText;
  state.reasoningParts = snapshot.reasoning.map((part) => ({ ...part }));
  state.finishReason = snapshot.finishReason;
  state.toolCalls = new Map(
    snapshot.tools.filter(isAvailableTool).map((tool) => [
      tool.id,
      {
        id: tool.id,
        name: tool.name,
        arguments: tool.inputText,
        inputDeltas: [...tool.inputDeltas],
        inputAnnounced: true,
        inputAvailable: isInputAvailable(tool),
        ...(tool.providerExecuted !== undefined ? { providerExecuted: tool.providerExecuted } : {}),
        ...(tool.dynamic !== undefined ? { dynamic: tool.dynamic } : {}),
      },
    ]),
  );
  state.toolResults = snapshot.tools.filter(isProviderToolTerminal).map(
    (tool): StreamingToolResult => ({
      toolCallId: tool.id,
      toolName: tool.name,
      ...(tool.output !== undefined ? { output: tool.output } : {}),
      ...(tool.error !== undefined ? { error: tool.error } : {}),
      providerExecuted: true,
      ...(tool.dynamic !== undefined ? { dynamic: tool.dynamic } : {}),
      ...(tool.preliminary !== undefined ? { preliminary: tool.preliminary } : {}),
    }),
  );
  state.suppressedToolCalls = snapshot.tools
    .filter((tool) => tool.rejectionReason === "unavailable")
    .map((tool) => ({ id: tool.id, name: tool.name }));
  state.usage = toLegacyRuntimeUsage(snapshot.usage);
}
