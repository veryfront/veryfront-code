import type { Tool } from "#veryfront/tool";
import { isRecord } from "../chat/conversation.ts";
import { safeJsonParse } from "../chat/provider-errors.ts";
import { runWithVeryfrontCloudContextAsync } from "../provider/veryfront-cloud/context.ts";
import type { AgUiRuntimeStreamEvent } from "./ag-ui-browser-encoder.ts";
import {
  mergeToolInputDelta,
  parseToolInputObject,
  stripLeadingEmptyObjectPlaceholder,
} from "./data-stream.ts";
import {
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  resolveHostedChildPromiseWithTimeout,
} from "./hosted-child-stream-watchdog.ts";
import { AgentRuntime } from "./runtime/index.ts";
import type { AgentResponse, Message as AgentMessage } from "./schemas/index.ts";

interface ForkStreamPart {
  type: "reasoning-delta" | "text-delta";
  text: string;
}

interface ForkToolInputStartPart {
  type: "tool-input-start";
  toolCallId: string;
  toolName: string;
}

interface ForkToolInputDeltaPart {
  type: "tool-input-delta";
  toolCallId: string;
  delta: string;
}

interface ForkToolCallPart {
  type: "tool-call";
  toolName: string;
  toolCallId: string;
  input: unknown;
}

interface ForkToolResultPart {
  type: "tool-result";
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

interface ForkToolErrorPart {
  type: "tool-error";
  toolName: string;
  toolCallId: string;
  input: unknown;
  error: Error;
}

interface ForkErrorPart {
  type: "error";
  error: Error;
}

export interface ForkRuntimeStep {
  text: string;
  messages: unknown[];
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  }>;
  finishReason: string | null;
}

interface RecoveredToolObservation {
  sawInputStart: boolean;
  sawInputDelta: boolean;
  sawInputAvailable: boolean;
  sawOutputAvailable: boolean;
  sawOutputError: boolean;
}

export interface ForkRecoveredPartsState {
  toolCalls: Map<string, RecoveredToolObservation>;
  emittedToolCallIds: Set<string>;
  emittedToolResultIds: Set<string>;
  logger?: ForkRuntimeStreamLogger;
}

type FrameworkToolCallState = RecoveredToolObservation & {
  toolName: string;
  inputText: string;
  input: Record<string, unknown>;
};

type StreamedToolCallState = {
  toolCallId: string;
  toolName: string;
  inputText: string;
  input: unknown;
  status: "pending" | "completed" | "error";
  output?: unknown;
  errorText?: string;
};

type StreamedMessage = {
  role: "assistant" | "tool";
  parts: AgentMessage["parts"];
};

type StreamedStepState = {
  text: string;
  toolCalls: Map<string, StreamedToolCallState>;
  messages: StreamedMessage[];
};

export type FrameworkStreamState = {
  toolCalls: Map<string, FrameworkToolCallState>;
  emittedToolCallIds: Set<string>;
  emittedToolResultIds: Set<string>;
  logger?: ForkRuntimeStreamLogger;
};

export type ForkPart =
  | ForkStreamPart
  | ForkToolInputStartPart
  | ForkToolInputDeltaPart
  | ForkToolCallPart
  | ForkToolResultPart
  | ForkToolErrorPart
  | ForkErrorPart;

export type ForkRuntimeStreamLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
};

export interface ForkRuntimeStreamResult {
  fullStream: AsyncIterable<ForkPart>;
  steps: PromiseLike<readonly ForkRuntimeStep[]>;
  totalUsage: PromiseLike<
    | {
      inputTokens?: number;
      outputTokens?: number;
    }
    | undefined
  >;
}

export const DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS = 1_000;

function createFrameworkForkAbortError(abortSignal?: AbortSignal): Error {
  if (abortSignal?.reason instanceof Error) {
    return abortSignal.reason;
  }

  return new DOMException("Framework fork aborted before completion.", "AbortError");
}

export async function runFrameworkForkStep(input: {
  apiUrl: string;
  authToken: string;
  projectId: string | null;
  model: string;
  messages: AgentMessage[];
  system: string;
  abortSignal?: AbortSignal;
  forkToolNames: string[];
  frameworkTools: Record<string, Tool | boolean>;
  providerOptions?: Record<string, unknown>;
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  responsePromise: Promise<AgentResponse>;
}> {
  let resolveResponsePromise: (response: AgentResponse) => void;
  let rejectResponsePromise: (error: Error) => void;
  const responsePromise = new Promise<AgentResponse>((resolve, reject) => {
    resolveResponsePromise = resolve;
    rejectResponsePromise = reject;
  });
  const abortHandler = () => {
    rejectResponsePromise(createFrameworkForkAbortError(input.abortSignal));
  };

  if (input.abortSignal) {
    if (input.abortSignal.aborted) {
      abortHandler();
    } else {
      input.abortSignal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  const runtimeConfig = {
    model: input.model,
    system: input.system,
    tools: input.frameworkTools,
    maxSteps: 1,
    ...(input.providerOptions
      ? { resolveModelTransport: () => ({ providerOptions: input.providerOptions }) }
      : {}),
    __vfAllowedRemoteTools: input.forkToolNames,
  };
  const runtime = new AgentRuntime("invoke-agent-child-framework", runtimeConfig);

  const stream = await runWithVeryfrontCloudContextAsync(
    {
      apiBaseUrl: input.apiUrl,
      apiToken: input.authToken,
      serviceLayer: "cloud",
    },
    () =>
      runtime.stream(
        input.messages,
        input.projectId ? { projectId: input.projectId } : undefined,
        {
          onFinish: (response) => {
            input.abortSignal?.removeEventListener("abort", abortHandler);
            resolveResponsePromise(response);
          },
        },
        input.model,
        undefined,
        input.abortSignal,
      ),
  );

  return {
    stream,
    responsePromise,
  };
}

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
    default:
      break;
  }
}

function buildFallbackFrameworkMessages(
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
    messages: buildFallbackFrameworkMessages(input.baseMessages, input.state),
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
    throw createFrameworkForkAbortError(input.abortSignal);
  }

  const fallbackState = hasFallbackStepContent(input.streamedStepState)
    ? input.streamedStepState
    : buildRecoverablePriorWorkState(input.currentMessages);

  if (!fallbackState) {
    throw new Error("Framework fork stream ended without onFinish and without recoverable output.");
  }

  return buildFallbackAgentResponse({
    baseMessages: input.currentMessages,
    state: fallbackState,
  });
}

function warnForkRuntimeStream(
  logger: ForkRuntimeStreamLogger | undefined,
  message: string,
  metadata: Record<string, unknown>,
): void {
  logger?.warn(message, metadata);
}

export function buildRecoveredStepParts(
  step: ForkRuntimeStep,
  state: ForkRecoveredPartsState,
): Array<ForkToolCallPart | ForkToolResultPart> {
  const recoveredParts: Array<ForkToolCallPart | ForkToolResultPart> = [];

  for (const toolCall of step.toolCalls) {
    if (state.emittedToolCallIds.has(toolCall.toolCallId)) {
      continue;
    }

    const streamedCall = state.toolCalls.get(toolCall.toolCallId);
    warnForkRuntimeStream(state.logger, "Child fork recovered missing tool-call from final step", {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      sawInputStart: streamedCall?.sawInputStart ?? false,
      sawInputDelta: streamedCall?.sawInputDelta ?? false,
      sawInputAvailable: streamedCall?.sawInputAvailable ?? false,
      sawOutputAvailable: streamedCall?.sawOutputAvailable ?? false,
      sawOutputError: streamedCall?.sawOutputError ?? false,
    });
    state.emittedToolCallIds.add(toolCall.toolCallId);
    recoveredParts.push({
      type: "tool-call",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input,
    });
  }

  for (const toolResult of step.toolResults) {
    if (state.emittedToolResultIds.has(toolResult.toolCallId)) {
      continue;
    }

    const streamedCall = state.toolCalls.get(toolResult.toolCallId);
    warnForkRuntimeStream(
      state.logger,
      "Child fork recovered missing tool-result from final step",
      {
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        sawInputStart: streamedCall?.sawInputStart ?? false,
        sawInputDelta: streamedCall?.sawInputDelta ?? false,
        sawInputAvailable: streamedCall?.sawInputAvailable ?? false,
        sawOutputAvailable: streamedCall?.sawOutputAvailable ?? false,
        sawOutputError: streamedCall?.sawOutputError ?? false,
      },
    );
    state.emittedToolResultIds.add(toolResult.toolCallId);
    recoveredParts.push({
      type: "tool-result",
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      input: toolResult.input,
      output: toolResult.output,
    });
  }

  return recoveredParts;
}

function isEmptyRecord(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

function getParsedStreamedToolInput(inputText: string): Record<string, unknown> | null {
  const strippedInputText = stripLeadingEmptyObjectPlaceholder(inputText).trim();
  const normalizedInputText = strippedInputText.startsWith('"')
    ? `{${strippedInputText}`
    : strippedInputText;
  if (normalizedInputText.length === 0) {
    return {};
  }

  const parsed = safeJsonParse(normalizedInputText);
  if (!parsed.ok) {
    return null;
  }

  return isRecord(parsed.value) ? Object.fromEntries(Object.entries(parsed.value)) : {};
}

function buildToolCallPartIfNeeded(
  toolCallId: string,
  state: FrameworkStreamState,
): ForkToolCallPart[] {
  const toolCall = state.toolCalls.get(toolCallId);
  if (!toolCall || state.emittedToolCallIds.has(toolCallId)) {
    return [];
  }

  state.emittedToolCallIds.add(toolCallId);
  return [
    {
      type: "tool-call",
      toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input,
    },
  ];
}

export function createFrameworkStreamState(
  input: { logger?: ForkRuntimeStreamLogger } = {},
): FrameworkStreamState {
  return {
    toolCalls: new Map(),
    emittedToolCallIds: new Set(),
    emittedToolResultIds: new Set(),
    ...(input.logger ? { logger: input.logger } : {}),
  };
}

export function mapFrameworkEventToForkParts(
  event: AgUiRuntimeStreamEvent,
  state: FrameworkStreamState,
): ForkPart[] {
  switch (event.type) {
    case "reasoning-delta":
      return typeof event.delta === "string"
        ? [{ type: "reasoning-delta", text: event.delta }]
        : [];

    case "text-delta":
      return typeof event.delta === "string" ? [{ type: "text-delta", text: event.delta }] : [];

    case "tool-input-start": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      const toolName = typeof event.toolName === "string" ? event.toolName : null;
      if (!toolCallId || !toolName) {
        return [];
      }

      const existing = state.toolCalls.get(toolCallId);
      state.toolCalls.set(toolCallId, {
        toolName,
        inputText: existing?.inputText ?? "",
        input: existing?.input ?? {},
        sawInputStart: true,
        sawInputDelta: existing?.sawInputDelta ?? false,
        sawInputAvailable: existing?.sawInputAvailable ?? false,
        sawOutputAvailable: existing?.sawOutputAvailable ?? false,
        sawOutputError: existing?.sawOutputError ?? false,
      });
      return [{ type: "tool-input-start", toolCallId, toolName }];
    }

    case "tool-input-delta": {
      const inputToolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      const inputDelta = typeof event.inputTextDelta === "string" ? event.inputTextDelta : null;
      if (!inputToolCallId || !inputDelta) {
        return [];
      }

      const existing = state.toolCalls.get(inputToolCallId);
      if (existing) {
        existing.inputText = mergeToolInputDelta(existing.inputText, inputDelta);
        existing.sawInputDelta = true;
        const parsedInput = getParsedStreamedToolInput(existing.inputText);
        if (parsedInput) {
          existing.input = parsedInput;
        }
      } else {
        warnForkRuntimeStream(
          state.logger,
          "Child fork received tool-input-delta before tool-input-start",
          {
            toolCallId: inputToolCallId,
            deltaLength: inputDelta.length,
          },
        );
      }

      return [{ type: "tool-input-delta", toolCallId: inputToolCallId, delta: inputDelta }];
    }

    case "tool-input-available": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      const toolName = typeof event.toolName === "string" ? event.toolName : null;
      if (!toolCallId || !toolName) {
        return [];
      }
      const input = parseToolInputObject(event.input);
      const existing = state.toolCalls.get(toolCallId);
      const resolvedInput = existing && isEmptyRecord(input) && !isEmptyRecord(existing.input)
        ? existing.input
        : input;
      state.toolCalls.set(toolCallId, {
        toolName,
        inputText: "",
        input: resolvedInput,
        sawInputStart: existing?.sawInputStart ?? false,
        sawInputDelta: existing?.sawInputDelta ?? false,
        sawInputAvailable: true,
        sawOutputAvailable: existing?.sawOutputAvailable ?? false,
        sawOutputError: existing?.sawOutputError ?? false,
      });
      return buildToolCallPartIfNeeded(toolCallId, state);
    }

    case "tool-output-available": {
      if (event.preliminary === true) {
        return [];
      }
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      if (!toolCallId) {
        return [];
      }
      const call = state.toolCalls.get(toolCallId);
      if (!call) {
        return [];
      }
      call.sawOutputAvailable = true;
      const parts: Array<ForkToolCallPart | ForkToolResultPart> = [
        ...buildToolCallPartIfNeeded(toolCallId, state),
      ];
      state.emittedToolResultIds.add(toolCallId);
      parts.push({
        type: "tool-result",
        toolCallId,
        toolName: call.toolName,
        input: call.input,
        output: Object.hasOwn(event, "output") ? event.output : null,
      });
      return parts;
    }

    case "tool-output-error":
    case "tool-input-error": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      if (!toolCallId) {
        return [];
      }
      const call = state.toolCalls.get(toolCallId);
      const errorText = typeof event.errorText === "string"
        ? event.errorText
        : typeof event.error === "string"
        ? event.error
        : "Tool execution failed";
      if (call) {
        call.sawOutputError = true;
      }
      const parts: Array<ForkToolCallPart | ForkToolErrorPart> = [
        ...buildToolCallPartIfNeeded(toolCallId, state),
      ];
      parts.push({
        type: "tool-error",
        toolCallId,
        toolName: call?.toolName ?? "unknown",
        input: call?.input ?? {},
        error: new Error(errorText),
      });
      return parts;
    }

    case "error": {
      const errorText = typeof event.errorText === "string"
        ? event.errorText
        : "Framework stream failed";
      return [{ type: "error", error: new Error(errorText) }];
    }

    default:
      return [];
  }
}
