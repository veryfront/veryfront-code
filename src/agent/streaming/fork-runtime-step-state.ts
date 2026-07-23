import { isRecord } from "#veryfront/chat/conversation.ts";
import type { AgentResponse, Message as AgentMessage } from "../schemas/index.ts";
import { AGENT_ERROR } from "#veryfront/errors";
import {
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  resolveHostedChildPromiseWithTimeout,
} from "../hosted/child-stream-watchdog.ts";
import { mergeToolInputDelta, parseToolInputObject } from "./data-stream.ts";
import { getParsedStreamedToolInput } from "./fork-runtime-part-mapper.ts";
import type { ForkPart } from "./fork-runtime-types.ts";

/** Tool-call state accumulated while a fork step streams. */
export type StreamedToolCallState = {
  /** Tool call identifier. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Serialized input accumulated from deltas. */
  inputText: string;
  /** Parsed tool input. */
  input: unknown;
  /** Current tool-call state. */
  status: "pending" | "completed" | "error";
  /** Tool output, when completed. */
  output?: unknown;
  /** Tool error text, when failed. */
  errorText?: string;
};

/** Message reconstructed from a streamed fork step. */
export type StreamedMessage = {
  /** Message author role. */
  role: "assistant" | "tool";
  /** Reconstructed message parts. */
  parts: AgentMessage["parts"];
};

/** State reconstructed while a fork runtime step streams. */
export type StreamedStepState = {
  text: string;
  toolCalls: Map<string, StreamedToolCallState>;
  messages: StreamedMessage[];
  streamError?: Error;
};

export function createAgentRuntimeForkAbortError(abortSignal?: AbortSignal): Error {
  if (abortSignal?.reason instanceof Error) {
    return abortSignal.reason;
  }

  return new DOMException("Agent runtime fork aborted before completion.", "AbortError");
}

/** State for create streamed step. */
export function createStreamedStepState(): StreamedStepState {
  return {
    text: "",
    toolCalls: new Map(),
    messages: [],
  };
}

function appendStreamedMessagePart(
  state: StreamedStepState,
  role: "assistant" | "tool",
  part: AgentMessage["parts"][number],
): void {
  const lastMessage = state.messages.at(-1);
  if (lastMessage?.role === role) {
    lastMessage.parts.push(part);
    return;
  }

  state.messages.push({
    role,
    parts: [part],
  });
}

function isFrameworkTextPart(
  part: AgentMessage["parts"][number],
): part is Extract<AgentMessage["parts"][number], { type: "text" }> {
  return part.type === "text";
}

/** State for apply part to streamed step. */
export function applyPartToStreamedStepState(state: StreamedStepState, part: ForkPart) {
  switch (part.type) {
    case "tool-input-start": {
      const existing = state.toolCalls.get(part.toolCallId);
      state.toolCalls.set(part.toolCallId, {
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        inputText: existing?.inputText ?? "",
        input: existing?.input ?? {},
        status: existing?.status ?? "pending",
        ...(existing?.output !== undefined ? { output: existing.output } : {}),
        ...(existing?.errorText ? { errorText: existing.errorText } : {}),
      });
      break;
    }
    case "text-delta": {
      state.text += part.text;
      const lastAssistantMessage = state.messages.at(-1);
      const lastAssistantPart = lastAssistantMessage?.role === "assistant"
        ? lastAssistantMessage.parts.at(-1)
        : null;
      if (lastAssistantMessage && lastAssistantPart && isFrameworkTextPart(lastAssistantPart)) {
        lastAssistantPart.text += part.text;
      } else {
        appendStreamedMessagePart(state, "assistant", {
          type: "text",
          text: part.text,
        });
      }
      break;
    }
    case "tool-input-delta": {
      const existing = state.toolCalls.get(part.toolCallId);
      if (!existing) {
        break;
      }

      existing.inputText = mergeToolInputDelta(existing.inputText, part.delta);
      const parsedInput = getParsedStreamedToolInput(existing.inputText);
      if (parsedInput) {
        existing.input = parsedInput;
      }
      break;
    }
    case "tool-call": {
      const existing = state.toolCalls.get(part.toolCallId);
      state.toolCalls.set(part.toolCallId, {
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        inputText: existing?.inputText ?? "",
        status: "pending",
        ...(existing?.output !== undefined ? { output: existing.output } : {}),
        ...(existing?.errorText ? { errorText: existing.errorText } : {}),
      });
      appendStreamedMessagePart(state, "assistant", {
        type: `tool-${part.toolName}`,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: parseToolInputObject(part.input),
      });
      break;
    }
    case "tool-result": {
      const existing = state.toolCalls.get(part.toolCallId);
      state.toolCalls.set(part.toolCallId, {
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        inputText: existing?.inputText ?? "",
        status: "completed",
        output: part.output,
        ...(existing?.errorText ? { errorText: existing.errorText } : {}),
      });
      appendStreamedMessagePart(state, "tool", {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: part.output,
      });
      break;
    }
    case "tool-error": {
      const existing = state.toolCalls.get(part.toolCallId);
      state.toolCalls.set(part.toolCallId, {
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        inputText: existing?.inputText ?? "",
        status: "error",
        ...(existing?.output !== undefined ? { output: existing.output } : {}),
        errorText: part.error.message,
      });
      break;
    }
    case "error": {
      state.streamError = part.error;
      break;
    }
    default:
      break;
  }
}

function buildFallbackAgentRuntimeMessages(
  baseMessages: readonly AgentMessage[],
  state: StreamedStepState,
): AgentMessage[] {
  const messages: AgentMessage[] = baseMessages.map((message) => ({
    ...message,
    parts: [...message.parts],
  }));

  if (state.messages.length > 0) {
    messages.push(
      ...state.messages.map((message) => ({
        id: crypto.randomUUID(),
        role: message.role,
        timestamp: Date.now(),
        parts: structuredClone(message.parts),
      })),
    );
  } else if (state.text.trim().length > 0) {
    messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      timestamp: Date.now(),
      parts: [{ type: "text", text: state.text }],
    });
  }

  return messages;
}

function collectToolResultPaths(messages: readonly AgentMessage[]): string[] {
  const paths = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-result") {
        continue;
      }

      const partResult = "result" in part ? part.result : null;
      const result = isRecord(partResult) ? partResult : null;
      const path = typeof result?.path === "string" ? result.path : null;
      if (path) {
        paths.add(path);
      }
    }
  }

  return [...paths];
}

function buildRecoverablePriorWorkState(
  messages: readonly AgentMessage[],
): StreamedStepState | null {
  const paths = collectToolResultPaths(messages);
  if (paths.length === 0) {
    return null;
  }

  const previewPaths = paths.slice(0, 8);
  const suffix = paths.length > previewPaths.length
    ? ` and ${paths.length - previewPaths.length} more`
    : "";
  const text = `Completed child tool work. Project artifact(s): ${
    previewPaths.join(", ")
  }${suffix}.`;

  return {
    text,
    toolCalls: new Map(),
    messages: [
      {
        role: "assistant",
        parts: [{ type: "text", text }],
      },
    ],
  };
}

function hasFallbackStepContent(state: StreamedStepState): boolean {
  return state.text.trim().length > 0 || state.toolCalls.size > 0;
}

function buildFallbackAgentResponse(input: {
  baseMessages: readonly AgentMessage[];
  state: StreamedStepState;
}): AgentResponse {
  return {
    text: input.state.text,
    messages: buildFallbackAgentRuntimeMessages(input.baseMessages, input.state),
    toolCalls: [...input.state.toolCalls.values()].map((toolCall) => ({
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      args: parseToolInputObject(toolCall.input),
      status: toolCall.status,
      ...(toolCall.status === "completed" ? { result: toolCall.output } : {}),
      ...(toolCall.status === "error" && toolCall.errorText ? { error: toolCall.errorText } : {}),
    })),
    metadata: {},
    status: "completed",
  } satisfies AgentResponse;
}

/** Response payload for resolve fork step. */
export async function resolveForkStepResponse(input: {
  responsePromise: Promise<AgentResponse>;
  responseTimeoutMs: number;
  abortSignal?: AbortSignal;
  currentMessages: readonly AgentMessage[];
  streamedStepState: StreamedStepState;
}): Promise<AgentResponse> {
  const resolvedResponse = await resolveHostedChildPromiseWithTimeout(
    input.responsePromise,
    input.responseTimeoutMs,
  );

  if (resolvedResponse !== HOSTED_CHILD_STREAM_TIMEOUT_TOKEN) {
    return resolvedResponse;
  }

  if (input.abortSignal?.aborted) {
    throw createAgentRuntimeForkAbortError(input.abortSignal);
  }

  if (input.streamedStepState.streamError) {
    throw input.streamedStepState.streamError;
  }

  const fallbackState = hasFallbackStepContent(input.streamedStepState)
    ? input.streamedStepState
    : buildRecoverablePriorWorkState(input.currentMessages);

  if (!fallbackState) {
    throw AGENT_ERROR.create({
      detail: "Agent runtime fork stream ended without onFinish and without recoverable output.",
    });
  }

  return buildFallbackAgentResponse({
    baseMessages: input.currentMessages,
    state: fallbackState,
  });
}
