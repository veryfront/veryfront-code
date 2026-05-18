import {
  createToolsFromHostDefinitions,
  type HostToolSet,
  type HostToolTraceAttributes,
  type Tool,
  traceHostTools,
  type TraceHostToolsOptions,
} from "#veryfront/tool";
import { isRecord } from "#veryfront/chat/conversation.ts";
import { safeJsonParse } from "#veryfront/chat/provider-errors.ts";
import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";
import type { AgUiRuntimeStreamEvent } from "../ag-ui/browser-encoder.ts";
import {
  mergeToolInputDelta,
  parseToolInputObject,
  streamDataStreamEvents,
  stripLeadingEmptyObjectPlaceholder,
} from "./data-stream.ts";
import {
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  resolveHostedChildPromiseWithTimeout,
} from "../hosted/child-stream-watchdog.ts";
import { getForkRuntimeAllowedToolNames } from "../runtime/provider-native-tool-inventory.ts";
import { AgentRuntime } from "../runtime/index.ts";
import type { AgentResponse, Message as AgentMessage } from "../schemas/index.ts";

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

/** Public API contract for fork runtime step. */
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

/** State for fork recovered parts. */
export interface ForkRecoveredPartsState {
  toolCalls: Map<string, RecoveredToolObservation>;
  emittedToolCallIds: Set<string>;
  emittedToolResultIds: Set<string>;
  logger?: ForkRuntimeStreamLogger;
}

type ForkRuntimeToolCallState = RecoveredToolObservation & {
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

/** State for fork runtime stream mapping. */
export type ForkRuntimeStreamMappingState = {
  toolCalls: Map<string, ForkRuntimeToolCallState>;
  emittedToolCallIds: Set<string>;
  emittedToolResultIds: Set<string>;
  logger?: ForkRuntimeStreamLogger;
};

/** State for framework stream.
 * @deprecated Use ForkRuntimeStreamMappingState.
 */
export type FrameworkStreamState = ForkRuntimeStreamMappingState;

/** Public API contract for fork part. */
export type ForkPart =
  | ForkStreamPart
  | ForkToolInputStartPart
  | ForkToolInputDeltaPart
  | ForkToolCallPart
  | ForkToolResultPart
  | ForkToolErrorPart
  | ForkErrorPart;

/** Public API contract for fork runtime stream logger. */
export type ForkRuntimeStreamLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Result returned from fork runtime stream. */
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

/** Default value for fork response promise timeout ms. */
export const DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS = 1_000;

type ForkRuntimeStepPreparationInput = {
  messages: AgentMessage[];
  buildInstructions: () => string;
  forkToolNames: readonly string[];
};

type ForkRuntimeStepPreparation = {
  messages: AgentMessage[];
  system: string;
};

/** Public API contract for fork runtime step preparer. */
export type ForkRuntimeStepPreparer = (
  input: ForkRuntimeStepPreparationInput,
) => ForkRuntimeStepPreparation | Promise<ForkRuntimeStepPreparation>;

/** Public API contract for agent runtime fork step runner. */
export type AgentRuntimeForkStepRunner = (
  input: RunAgentRuntimeForkStepInput,
) => Promise<{
  stream: ReadableStream<Uint8Array>;
  responsePromise: Promise<AgentResponse>;
}>;

/** Input payload for start agent runtime fork. */
export type StartAgentRuntimeForkInput = {
  apiUrl: string;
  authToken: string;
  projectId: string | null;
  model: string;
  maxSteps: number;
  prompt?: string;
  maxContinuationSteps?: number;
  abortSignal?: AbortSignal;
  forkToolNames: string[];
  runtimeTools: Record<string, Tool | boolean>;
  providerOptions?: Record<string, unknown>;
  buildInstructions: () => string;
  onBeforeStop?: ForkRuntimeContinuationPromptResolver;
  initialMessages?: readonly AgentMessage[];
  responseTimeoutMs?: number;
  logger?: ForkRuntimeStreamLogger;
  prepareStep?: ForkRuntimeStepPreparer;
  runStep?: AgentRuntimeForkStepRunner;
};

/** Input payload for start agent runtime fork with host tools. */
export type StartAgentRuntimeForkWithHostToolsInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> =
  & Omit<
    StartAgentRuntimeForkInput,
    "forkToolNames" | "model" | "runtimeTools"
  >
  & {
    provider: string;
    forkModel: string;
    forkTools: HostToolSet;
    traceTools?: TraceHostToolsOptions<TAttributes>;
  };

/** Starts agent runtime fork with host tools. */
export function startAgentRuntimeForkWithHostTools<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: StartAgentRuntimeForkWithHostToolsInput<TAttributes>,
): {
  streamResult: ForkRuntimeStreamResult;
  forkToolNames: string[];
} {
  const forkTools = input.traceTools
    ? traceHostTools(input.forkTools, input.traceTools)
    : input.forkTools;
  const runtimeTools = createToolsFromHostDefinitions(forkTools);
  const forkToolNames = getForkRuntimeAllowedToolNames({
    provider: input.provider,
    forkModel: input.forkModel,
    forkTools: input.forkTools,
  });

  return {
    streamResult: startAgentRuntimeFork({
      apiUrl: input.apiUrl,
      authToken: input.authToken,
      projectId: input.projectId,
      model: input.forkModel,
      maxSteps: input.maxSteps,
      prompt: input.prompt,
      maxContinuationSteps: input.maxContinuationSteps,
      abortSignal: input.abortSignal,
      forkToolNames,
      runtimeTools,
      providerOptions: input.providerOptions,
      buildInstructions: input.buildInstructions,
      onBeforeStop: input.onBeforeStop,
      initialMessages: input.initialMessages,
      responseTimeoutMs: input.responseTimeoutMs,
      logger: input.logger,
      prepareStep: input.prepareStep,
      runStep: input.runStep,
    }),
    forkToolNames,
  };
}

function createForkRuntimeDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  // These deferreds are side-channel results for consumers that need final
  // steps/usage. The fork stream itself may fail before callers await them; keep
  // their original rejection semantics while marking the rejection as observed.
  promise.catch(() => {});

  return { promise, resolve, reject };
}

async function prepareForkRuntimeStep(input: {
  prepareStep?: ForkRuntimeStepPreparer;
  messages: AgentMessage[];
  buildInstructions: () => string;
  forkToolNames: string[];
}): Promise<ForkRuntimeStepPreparation> {
  if (input.prepareStep) {
    return input.prepareStep({
      messages: input.messages,
      buildInstructions: input.buildInstructions,
      forkToolNames: input.forkToolNames,
    });
  }

  return {
    messages: input.messages,
    system: input.buildInstructions(),
  };
}

function createAgentRuntimeForkAbortError(abortSignal?: AbortSignal): Error {
  if (abortSignal?.reason instanceof Error) {
    return abortSignal.reason;
  }

  return new DOMException("Agent runtime fork aborted before completion.", "AbortError");
}

/** Input payload for run agent runtime fork step. */
export type RunAgentRuntimeForkStepInput = {
  apiUrl: string;
  authToken: string;
  projectId: string | null;
  model: string;
  messages: AgentMessage[];
  system: string;
  abortSignal?: AbortSignal;
  forkToolNames: string[];
  runtimeTools: Record<string, Tool | boolean>;
  providerOptions?: Record<string, unknown>;
};

/** Input payload for run framework fork step. */
export type RunFrameworkForkStepInput = Omit<RunAgentRuntimeForkStepInput, "runtimeTools"> & {
  frameworkTools: Record<string, Tool | boolean>;
};

/** Run agent runtime fork step. */
export async function runAgentRuntimeForkStep(input: RunAgentRuntimeForkStepInput): Promise<{
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
    rejectResponsePromise(createAgentRuntimeForkAbortError(input.abortSignal));
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
    tools: input.runtimeTools,
    maxSteps: 1,
    ...(input.providerOptions
      ? { resolveModelTransport: () => ({ providerOptions: input.providerOptions }) }
      : {}),
    allowedRemoteTools: input.forkToolNames,
  };
  const runtime = new AgentRuntime("invoke-agent-child-runtime", runtimeConfig);

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

/** Handles run framework fork step.
 * @deprecated Use runAgentRuntimeForkStep with runtimeTools.
 */
export function runFrameworkForkStep(input: RunFrameworkForkStepInput): Promise<{
  stream: ReadableStream<Uint8Array>;
  responsePromise: Promise<AgentResponse>;
}> {
  return runAgentRuntimeForkStep({
    apiUrl: input.apiUrl,
    authToken: input.authToken,
    projectId: input.projectId,
    model: input.model,
    messages: input.messages,
    system: input.system,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    forkToolNames: input.forkToolNames,
    runtimeTools: input.frameworkTools,
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
  });
}

/** Public API contract for fork runtime continuation prompt resolver. */
export type ForkRuntimeContinuationPromptResolver = (input: {
  step: ForkRuntimeStep;
  stepIndex: number;
}) => Promise<string | null> | string | null;

/** Response payload for build fork runtime step from. */
export function buildForkRuntimeStepFromResponse(response: AgentResponse): ForkRuntimeStep {
  const toolCalls = response.toolCalls.map((toolCall) => ({
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input: toolCall.args,
  }));
  const toolResults = response.toolCalls.flatMap((toolCall) =>
    toolCall.status === "completed"
      ? [
        {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.args,
          output: toolCall.result,
        },
      ]
      : []
  );
  const finishReasonValue = response.metadata?.finishReason;

  return {
    text: response.text,
    messages: structuredClone(response.messages),
    toolCalls,
    toolResults,
    finishReason: typeof finishReasonValue === "string" ? finishReasonValue : null,
  };
}

/** Should continue fork runtime step helper. */
export function shouldContinueForkRuntimeStep(
  step: ForkRuntimeStep,
  response: AgentResponse,
): boolean {
  return step.finishReason === "tool-calls" &&
    response.toolCalls.some((toolCall) => toolCall.status !== "error");
}

/** Message shape for create fork runtime user. */
export function createForkRuntimeUserMessage(input: {
  text: string;
  id?: string;
  timestamp?: number;
}): AgentMessage {
  return {
    id: input.id ?? crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: input.text }],
    timestamp: input.timestamp ?? Date.now(),
  };
}

/** Create initial fork runtime messages. */
export function createInitialForkRuntimeMessages(input: {
  initialMessages?: readonly AgentMessage[];
  prompt?: string;
}): AgentMessage[] {
  const currentMessages = input.initialMessages?.map((message) => ({
    ...message,
    parts: [...message.parts],
  })) ?? [];

  if (typeof input.prompt !== "string") {
    return currentMessages;
  }

  return [...currentMessages, createForkRuntimeUserMessage({ text: input.prompt })];
}

/** Return max fork runtime step count. */
export function getMaxForkRuntimeStepCount(input: {
  maxSteps: number;
  maxContinuationSteps?: number;
}): number {
  return input.maxSteps + (input.maxContinuationSteps ?? 0);
}

/** State for resolve fork runtime continuation. */
export async function resolveForkRuntimeContinuationState(input: {
  continuationStepsRemaining: number;
  onBeforeStop?: ForkRuntimeContinuationPromptResolver;
  step: ForkRuntimeStep;
  currentMessages: AgentMessage[];
  stepIndex: number;
}): Promise<{ continuationStepsRemaining: number; currentMessages: AgentMessage[] } | null> {
  if (input.continuationStepsRemaining <= 0 || !input.onBeforeStop) {
    return null;
  }

  const continuationPrompt = await input.onBeforeStop({
    step: input.step,
    stepIndex: input.stepIndex,
  });
  if (typeof continuationPrompt !== "string" || continuationPrompt.trim().length === 0) {
    return null;
  }

  return {
    continuationStepsRemaining: input.continuationStepsRemaining - 1,
    currentMessages: [
      ...input.currentMessages,
      createForkRuntimeUserMessage({ text: continuationPrompt }),
    ],
  };
}

/** Starts agent runtime fork. */
export function startAgentRuntimeFork(input: StartAgentRuntimeForkInput): ForkRuntimeStreamResult {
  const stepsDeferred = createForkRuntimeDeferred<readonly ForkRuntimeStep[]>();
  const totalUsageDeferred = createForkRuntimeDeferred<
    | {
      inputTokens?: number;
      outputTokens?: number;
    }
    | undefined
  >();
  const steps: ForkRuntimeStep[] = [];
  let accumulatedInputTokens = 0;
  let accumulatedOutputTokens = 0;
  const runStep = input.runStep ?? runAgentRuntimeForkStep;

  return {
    fullStream: (async function* (): AsyncGenerator<ForkPart> {
      if (!input.initialMessages?.length && typeof input.prompt !== "string") {
        throw new Error(
          "startAgentRuntimeFork requires a prompt when no initialMessages are provided.",
        );
      }

      let currentMessages = createInitialForkRuntimeMessages({
        initialMessages: input.initialMessages,
        prompt: input.prompt,
      });
      let continuationStepsRemaining = input.maxContinuationSteps ?? 0;

      try {
        while (steps.length < getMaxForkRuntimeStepCount(input)) {
          const prepared = await prepareForkRuntimeStep({
            prepareStep: input.prepareStep,
            messages: currentMessages,
            buildInstructions: input.buildInstructions,
            forkToolNames: input.forkToolNames,
          });
          const state = createForkRuntimeStreamMappingState({ logger: input.logger });
          const streamedStepState = createStreamedStepState();
          const { stream, responsePromise } = await runStep({
            apiUrl: input.apiUrl,
            authToken: input.authToken,
            projectId: input.projectId,
            model: input.model,
            messages: prepared.messages,
            system: prepared.system,
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            forkToolNames: input.forkToolNames,
            runtimeTools: input.runtimeTools,
            ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
          });

          for await (const event of streamDataStreamEvents(stream)) {
            const parts = mapAgUiRuntimeEventToForkParts(event, state);
            for (const part of parts) {
              applyPartToStreamedStepState(streamedStepState, part);
              yield part;
            }
          }

          const response = await resolveForkStepResponse({
            responsePromise,
            responseTimeoutMs: input.responseTimeoutMs ?? DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS,
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            currentMessages,
            streamedStepState,
          });
          const step = buildForkRuntimeStepFromResponse(response);
          for (const recoveredPart of buildRecoveredStepParts(step, state)) {
            yield recoveredPart;
          }
          steps.push(step);
          accumulatedInputTokens += response.usage?.promptTokens ?? 0;
          accumulatedOutputTokens += response.usage?.completionTokens ?? 0;
          currentMessages = response.messages;

          if (!shouldContinueForkRuntimeStep(step, response)) {
            const followUpState = await resolveForkRuntimeContinuationState({
              continuationStepsRemaining,
              onBeforeStop: input.onBeforeStop,
              step,
              currentMessages,
              stepIndex: steps.length - 1,
            });
            if (followUpState) {
              continuationStepsRemaining = followUpState.continuationStepsRemaining;
              currentMessages = followUpState.currentMessages;
              continue;
            }
            break;
          }
        }

        stepsDeferred.resolve(steps);
        totalUsageDeferred.resolve({
          inputTokens: accumulatedInputTokens,
          outputTokens: accumulatedOutputTokens,
        });
      } catch (error) {
        stepsDeferred.reject(error);
        totalUsageDeferred.reject(error);
        throw error;
      }
    })(),
    steps: stepsDeferred.promise,
    totalUsage: totalUsageDeferred.promise,
  };
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

  const fallbackState = hasFallbackStepContent(input.streamedStepState)
    ? input.streamedStepState
    : buildRecoverablePriorWorkState(input.currentMessages);

  if (!fallbackState) {
    throw new Error(
      "Agent runtime fork stream ended without onFinish and without recoverable output.",
    );
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

/** Builds recovered step parts. */
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
  state: ForkRuntimeStreamMappingState,
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

/** State for create fork runtime stream mapping. */
export function createForkRuntimeStreamMappingState(
  input: { logger?: ForkRuntimeStreamLogger } = {},
): ForkRuntimeStreamMappingState {
  return {
    toolCalls: new Map(),
    emittedToolCallIds: new Set(),
    emittedToolResultIds: new Set(),
    ...(input.logger ? { logger: input.logger } : {}),
  };
}

/** Map AG-UI runtime event to fork parts. */
export function mapAgUiRuntimeEventToForkParts(
  event: AgUiRuntimeStreamEvent,
  state: ForkRuntimeStreamMappingState,
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

/** State for create framework stream.
 * @deprecated Use createForkRuntimeStreamMappingState.
 */
export function createFrameworkStreamState(
  input: { logger?: ForkRuntimeStreamLogger } = {},
): ForkRuntimeStreamMappingState {
  return createForkRuntimeStreamMappingState(input);
}

/** Handles map framework event to fork parts.
 * @deprecated Use mapAgUiRuntimeEventToForkParts.
 */
export function mapFrameworkEventToForkParts(
  event: AgUiRuntimeStreamEvent,
  state: ForkRuntimeStreamMappingState,
): ForkPart[] {
  return mapAgUiRuntimeEventToForkParts(event, state);
}
