import {
  createToolsFromHostDefinitions,
  type HostToolSet,
  type HostToolTraceAttributes,
  type Tool,
  traceHostTools,
  type TraceHostToolsOptions,
} from "#veryfront/tool";
import { runWithVeryfrontCloudContextAsync } from "#veryfront/provider/veryfront-cloud/context.ts";
import { streamDataStreamEvents } from "./data-stream.ts";
import {
  buildRecoveredStepParts,
  createForkRuntimeStreamMappingState,
  mapAgUiRuntimeEventToForkParts,
} from "./fork-runtime-part-mapper.ts";
import {
  applyPartToStreamedStepState,
  createAgentRuntimeForkAbortError,
  createStreamedStepState,
  resolveForkStepResponse,
} from "./fork-runtime-step-state.ts";
import {
  getForkRuntimeAllowedToolNames,
  getProviderNativeToolNames,
} from "../runtime/provider-native-tool-inventory.ts";
import { AgentRuntime } from "../runtime/index.ts";
import type { AgentResponse, Message as AgentMessage } from "../schemas/index.ts";
import type { RuntimeReasoningOption } from "../types.ts";
import {
  commitForkRuntimeStep,
  createForkRuntimeProgress,
  getForkRuntimeProgressUsage,
  shouldContinueForkRuntimeStep,
} from "./fork-runtime-step-progress.ts";

export {
  buildRecoveredStepParts,
  createForkRuntimeStreamMappingState,
  createFrameworkStreamState,
  mapAgUiRuntimeEventToForkParts,
  mapFrameworkEventToForkParts,
} from "./fork-runtime-part-mapper.ts";
export {
  applyPartToStreamedStepState,
  createStreamedStepState,
  resolveForkStepResponse,
} from "./fork-runtime-step-state.ts";
export type {
  ForkRecoveredPartsState,
  ForkRuntimeStreamMappingState,
  FrameworkStreamState,
  RecoveredToolObservation,
} from "./fork-runtime-part-mapper.ts";
export type { StreamedStepState } from "./fork-runtime-step-state.ts";
export {
  buildForkRuntimeStepFromResponse,
  shouldContinueForkRuntimeStep,
} from "./fork-runtime-step-progress.ts";

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
  reasoning?: RuntimeReasoningOption;
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
      reasoning: input.reasoning,
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
  reasoning?: RuntimeReasoningOption;
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
    ...(input.providerOptions || input.reasoning
      ? {
        resolveModelTransport: () => ({
          providerOptions: input.providerOptions,
          reasoning: input.reasoning,
        }),
      }
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
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
  });
}

/** Public API contract for fork runtime continuation prompt resolver. */
export type ForkRuntimeContinuationPromptResolver = (input: {
  step: ForkRuntimeStep;
  stepIndex: number;
}) => Promise<string | null> | string | null;

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
  const runStep = input.runStep ?? runAgentRuntimeForkStep;

  return {
    fullStream: (async function* (): AsyncGenerator<ForkPart> {
      if (!input.initialMessages?.length && typeof input.prompt !== "string") {
        throw new Error(
          "startAgentRuntimeFork requires a prompt when no initialMessages are provided.",
        );
      }

      const progress = createForkRuntimeProgress(createInitialForkRuntimeMessages({
        initialMessages: input.initialMessages,
        prompt: input.prompt,
      }));
      let continuationStepsRemaining = input.maxContinuationSteps ?? 0;

      try {
        while (progress.steps.length < getMaxForkRuntimeStepCount(input)) {
          const prepared = await prepareForkRuntimeStep({
            prepareStep: input.prepareStep,
            messages: progress.currentMessages,
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
            ...(input.reasoning ? { reasoning: input.reasoning } : {}),
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
            currentMessages: progress.currentMessages,
            streamedStepState,
          });
          const step = commitForkRuntimeStep(progress, response);
          for (const recoveredPart of buildRecoveredStepParts(step, state)) {
            yield recoveredPart;
          }

          if (!shouldContinueForkRuntimeStep(step, response)) {
            const followUpState = await resolveForkRuntimeContinuationState({
              continuationStepsRemaining,
              onBeforeStop: input.onBeforeStop,
              step,
              currentMessages: progress.currentMessages,
              stepIndex: progress.steps.length - 1,
            });
            if (followUpState) {
              continuationStepsRemaining = followUpState.continuationStepsRemaining;
              progress.currentMessages = followUpState.currentMessages;
              continue;
            }
            break;
          }
        }

        stepsDeferred.resolve(progress.steps);
        totalUsageDeferred.resolve(getForkRuntimeProgressUsage(progress));
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
