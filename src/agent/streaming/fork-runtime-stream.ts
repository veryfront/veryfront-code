import {
  createToolsFromHostDefinitions,
  type HostToolSet,
  type HostToolTraceAttributes,
  type Tool,
  traceHostTools,
  type TraceHostToolsOptions,
} from "#veryfront/tool";
import { isRecord } from "#veryfront/chat/conversation.ts";
import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  mergeToolInputDelta,
  parseToolInputObject,
  streamDataStreamEvents,
} from "./data-stream.ts";
import {
  buildRecoveredStepParts,
  createForkRuntimeStreamMappingState,
  getParsedStreamedToolInput,
  mapAgUiRuntimeEventToForkParts,
} from "./fork-runtime-part-mapper.ts";
import {
  HOSTED_CHILD_STREAM_TIMEOUT_TOKEN,
  resolveHostedChildPromiseWithTimeout,
} from "../hosted/child-stream-watchdog.ts";
import {
  getForkRuntimeAllowedToolNames,
  getProviderNativeToolNames,
} from "../runtime/provider-native-tool-inventory.ts";
import { AgentRuntime } from "../runtime/index.ts";
import type { AgentResponse, Message as AgentMessage } from "../schemas/index.ts";

export {
  buildRecoveredStepParts,
  createForkRuntimeStreamMappingState,
  createFrameworkStreamState,
  mapAgUiRuntimeEventToForkParts,
  mapFrameworkEventToForkParts,
} from "./fork-runtime-part-mapper.ts";
export type {
  ForkRecoveredPartsState,
  ForkRuntimeStreamMappingState,
  FrameworkStreamState,
  RecoveredToolObservation,
} from "./fork-runtime-part-mapper.ts";

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
  streamError?: Error;
};

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
  providerToolNames?: string[];
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
    forkToolNames?: readonly string[];
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
  const forkToolNames = input.forkToolNames
    ? [...input.forkToolNames]
    : getForkRuntimeAllowedToolNames({
      provider: input.provider,
      forkModel: input.forkModel,
      forkTools: input.forkTools,
    });
  const providerNativeToolNames = new Set(
    getProviderNativeToolNames({
      provider: input.provider,
      model: input.forkModel,
    }),
  );
  const providerToolNames = forkToolNames.filter((toolName) =>
    providerNativeToolNames.has(toolName)
  );

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
      providerToolNames,
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
  providerToolNames?: string[];
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
    providerTools: input.providerToolNames ?? [],
    maxSteps: 1,
    ...(input.providerOptions
      ? { resolveModelTransport: () => ({ providerOptions: input.providerOptions }) }
      : {}),
    __vfAllowedRemoteTools: input.forkToolNames,
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
    ...(input.providerToolNames ? { providerToolNames: input.providerToolNames } : {}),
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
            ...(input.providerToolNames ? { providerToolNames: input.providerToolNames } : {}),
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
    throw new Error(
      "Agent runtime fork stream ended without onFinish and without recoverable output.",
    );
  }

  return buildFallbackAgentResponse({
    baseMessages: input.currentMessages,
    state: fallbackState,
  });
}
