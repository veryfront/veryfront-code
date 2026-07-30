/**
 * Local Model Engine
 *
 * Singleton wrapper around `@huggingface/transformers` for server-side
 * local LLM inference. Provides lazy model loading and streaming text
 * generation via async generators.
 *
 * Uses ONNX Runtime for inference with q4 quantization, not q4f16,
 * due to a known ONNX bug with f16 LayerNorm on CPU.
 *
 * @module extensions/ext-llm-transformers
 */

import { serverLogger } from "veryfront/utils";
import { createError, toError } from "veryfront/errors";
import { DEFAULT_LOCAL_MODEL, type ModelInfo, resolveLocalModel } from "./model-catalog.ts";
import {
  getLocalAIDevice,
  getLocalAIModelLoadTimeoutMs,
  getLocalAIThinkingEnabled,
  type LocalAIDevice,
  throwIfLocalAIDisabled,
} from "./env.ts";
import { createPipelineCache } from "./pipeline-cache.ts";

const logger = serverLogger.component("local-llm");

/** Default maximum new tokens for local model generation */
const DEFAULT_MAX_NEW_TOKENS = 512;

/** Safety bounds applied before any model is loaded. */
const MAX_NEW_TOKENS = 32_768;
const MAX_TOP_K = 2_048;
const MAX_STOP_SEQUENCE_COUNT = 16;
const MAX_STOP_SEQUENCE_LENGTH = 256;
const MAX_STOP_SEQUENCE_TOTAL_LENGTH = 1_024;

/** Bounds the callback-to-consumer bridge while native generation is running. */
export const LOCAL_GENERATION_STREAM_MAX_BUFFERED_CHUNKS = 256;
export const LOCAL_GENERATION_STREAM_MAX_BUFFERED_CHARACTERS = 1_048_576;

/** Chat message format expected by Transformers.js */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Options for text generation */
export interface GenerateOptions {
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
}

export type LocalGenerationFinishReason = "stop" | "length";

export interface LocalGenerationResult {
  readonly text: string;
  readonly finishReason: LocalGenerationFinishReason;
}

/** Internal provenance for a primary generation failure plus cleanup failures. */
export class LocalGenerationCleanupError extends AggregateError {
  readonly primaryError: unknown;
  readonly cleanupErrors: readonly unknown[];

  constructor(primaryError: unknown, cleanupErrors: readonly unknown[]) {
    super(
      [primaryError, ...cleanupErrors],
      "Local generation and resource cleanup both failed",
    );
    this.name = "LocalGenerationCleanupError";
    this.primaryError = primaryError;
    this.cleanupErrors = [...cleanupErrors];
  }
}

interface GenerationTerminationState {
  finishReason?: LocalGenerationFinishReason;
}

export interface BoundedTextQueue {
  /** Fixed backing-slot count; never grows after construction. */
  readonly capacity: number;
  readonly size: number;
  readonly bufferedCharacters: number;
  enqueue(value: string): boolean;
  dequeue(): string | undefined;
}

/**
 * Create a fixed-capacity ring queue for streamer callbacks.
 */
export function createBoundedTextQueue(
  maxChunks = LOCAL_GENERATION_STREAM_MAX_BUFFERED_CHUNKS,
  maxCharacters = LOCAL_GENERATION_STREAM_MAX_BUFFERED_CHARACTERS,
): BoundedTextQueue {
  if (
    !Number.isSafeInteger(maxChunks) || maxChunks <= 0 ||
    maxChunks > LOCAL_GENERATION_STREAM_MAX_BUFFERED_CHUNKS
  ) {
    throw new RangeError(
      `maxChunks must be a positive safe integer no greater than ${LOCAL_GENERATION_STREAM_MAX_BUFFERED_CHUNKS}`,
    );
  }
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters <= 0) {
    throw new RangeError("maxCharacters must be a positive safe integer");
  }

  const values = new Array<string | undefined>(maxChunks);
  let readIndex = 0;
  let writeIndex = 0;
  let size = 0;
  let bufferedCharacters = 0;

  return {
    get capacity() {
      return values.length;
    },
    get size() {
      return size;
    },
    get bufferedCharacters() {
      return bufferedCharacters;
    },
    enqueue(value: string): boolean {
      if (value.length === 0) return true;
      if (
        size >= maxChunks ||
        bufferedCharacters + value.length > maxCharacters
      ) {
        return false;
      }
      values[writeIndex] = value;
      writeIndex = (writeIndex + 1) % maxChunks;
      size += 1;
      bufferedCharacters += value.length;
      return true;
    },
    dequeue(): string | undefined {
      if (size === 0) return undefined;
      const value = values[readIndex]!;
      values[readIndex] = undefined;
      readIndex = (readIndex + 1) % maxChunks;
      size -= 1;
      bufferedCharacters -= value.length;
      return value;
    },
  };
}

function createStreamBackpressureError(): Error {
  const error = new Error(
    "Local generation stopped because the output consumer could not keep up",
  );
  error.name = "BackpressureError";
  return error;
}

function assertFiniteNumberInRange(
  name: string,
  value: number | undefined,
  minimum: number,
  maximum: number,
): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value < minimum || value > maximum)
  ) {
    throw new RangeError(`${name} must be a finite number between ${minimum} and ${maximum}`);
  }
}

/**
 * Validate and snapshot generation settings before acquiring native resources.
 * The returned object cannot observe later mutation of the caller's stop list.
 */
export function validateGenerateOptions(options: GenerateOptions): GenerateOptions {
  const maxNewTokens = options.maxNewTokens;
  if (
    maxNewTokens !== undefined &&
    (!Number.isSafeInteger(maxNewTokens) || maxNewTokens <= 0 || maxNewTokens > MAX_NEW_TOKENS)
  ) {
    throw new RangeError(
      `maxNewTokens must be a positive safe integer no greater than ${MAX_NEW_TOKENS}`,
    );
  }
  assertFiniteNumberInRange("temperature", options.temperature, 0, 2);
  assertFiniteNumberInRange("topP", options.topP, Number.MIN_VALUE, 1);

  const topK = options.topK;
  if (
    topK !== undefined &&
    (!Number.isSafeInteger(topK) || topK < 0 || topK > MAX_TOP_K)
  ) {
    throw new RangeError(
      `topK must be a safe integer between 0 and ${MAX_TOP_K}`,
    );
  }

  const stopSequences = options.stopSequences;
  if (stopSequences !== undefined) {
    if (!Array.isArray(stopSequences)) {
      throw new TypeError("stopSequences must be an array of strings");
    }
    if (stopSequences.length > MAX_STOP_SEQUENCE_COUNT) {
      throw new RangeError(
        `stopSequences must contain no more than ${MAX_STOP_SEQUENCE_COUNT} entries`,
      );
    }
    let totalLength = 0;
    for (const stop of stopSequences) {
      if (typeof stop !== "string" || stop.length === 0) {
        throw new TypeError("stopSequences entries must be non-empty strings");
      }
      if (stop.length > MAX_STOP_SEQUENCE_LENGTH) {
        throw new RangeError(
          `stopSequences entries must contain no more than ${MAX_STOP_SEQUENCE_LENGTH} characters`,
        );
      }
      totalLength += stop.length;
      if (totalLength > MAX_STOP_SEQUENCE_TOTAL_LENGTH) {
        throw new RangeError(
          `stopSequences must contain no more than ${MAX_STOP_SEQUENCE_TOTAL_LENGTH} characters in total`,
        );
      }
    }
  }

  return {
    ...(maxNewTokens === undefined ? {} : { maxNewTokens }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.topP === undefined ? {} : { topP: options.topP }),
    ...(topK === undefined ? {} : { topK }),
    ...(stopSequences === undefined ? {} : { stopSequences: [...stopSequences] }),
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
  };
}

interface TransformersEnv {
  cacheDir: string;
  useBrowserCache: boolean;
}

interface TransformersOnnxBackend {
  webgpu?: {
    powerPreference?: string;
  };
}

interface TransformersBackendConfig {
  onnx?: TransformersOnnxBackend;
}

/** Minimal Transformers.js stopping-criteria contract (see generation/stopping_criteria.js). */
interface StoppingCriteriaInstance {
  _call(inputIds: number[][], scores: unknown): boolean[];
}

interface StoppingCriteriaListInstance extends StoppingCriteriaInstance {
  push(item: StoppingCriteriaInstance): void;
  extend(items: StoppingCriteriaInstance[]): void;
}

interface TransformersModule {
  env: TransformersEnv;
  backends?: TransformersBackendConfig;
  pipeline: (
    task: string,
    model: string,
    options: { dtype: ModelInfo["dtype"]; device: LocalAIDevice },
  ) => Promise<unknown>;
  AutoProcessor: {
    from_pretrained(model: string): Promise<ConditionalProcessor>;
  };
  Gemma4ForConditionalGeneration: ConditionalModelConstructor;
  Qwen3_5ForConditionalGeneration: ConditionalModelConstructor;
  TextStreamer: new (
    tokenizer: unknown,
    options: {
      skip_prompt: boolean;
      skip_special_tokens: boolean;
      callback_function: (text: string) => void;
      decode_kwargs?: {
        clean_up_tokenization_spaces: boolean;
      };
    },
  ) => unknown;
  // Transformers.js 3.x has no `stop_strings` generate option; string-based
  // stopping is implemented by passing a custom StoppingCriteria via the
  // documented `stopping_criteria` generate parameter.
  StoppingCriteria: new () => StoppingCriteriaInstance;
  StoppingCriteriaList: new () => StoppingCriteriaListInstance;
}

interface ConditionalProcessor {
  tokenizer: unknown;
  apply_chat_template(messages: unknown[], options: Record<string, unknown>): string;
  batch_decode(outputs: unknown, options: Record<string, unknown>): string[];
  (...args: unknown[]): Promise<Record<string, unknown>>;
}

interface ConditionalModel {
  generate(options: Record<string, unknown>): Promise<unknown>;
  dispose(): void | Promise<void>;
  config?: Record<string, unknown>;
  generation_config?: Record<string, unknown>;
}

interface ConditionalModelConstructor {
  from_pretrained(
    model: string,
    options: { dtype: ModelInfo["dtype"]; device: LocalAIDevice },
  ): Promise<ConditionalModel>;
}

interface ConditionalGenerationRuntime {
  processor: ConditionalProcessor;
  model: ConditionalModel;
}

type LocalModelLoadInfo = ModelInfo & {
  device: LocalAIDevice;
};

type GenerationTokenId = number | bigint;

function readEosTokenIds(model: ConditionalModel): GenerationTokenId[] {
  const textConfig = model.config?.text_config;
  const sources = [
    model.generation_config,
    typeof textConfig === "object" && textConfig !== null
      ? textConfig as Record<string, unknown>
      : undefined,
    model.config,
  ];

  for (const source of sources) {
    const candidate = source?.eos_token_id;
    const values = Array.isArray(candidate) ? candidate : [candidate];
    const tokenIds = values.filter((value): value is GenerationTokenId =>
      typeof value === "bigint" ||
      (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    );
    if (tokenIds.length > 0) return tokenIds;
  }
  return [];
}

function tokenIdsEqual(left: GenerationTokenId | undefined, right: GenerationTokenId): boolean {
  if (left === undefined) return false;
  if (typeof left === typeof right) return left === right;
  return String(left) === String(right);
}

function recordFinishReason(
  state: GenerationTerminationState | undefined,
  finishReason: LocalGenerationFinishReason,
): void {
  if (!state) return;
  if (finishReason === "stop" || state.finishReason === undefined) {
    state.finishReason = finishReason;
  }
}

function resolveFinishReason(
  state: GenerationTerminationState,
): LocalGenerationFinishReason {
  // Successful generation that did not reach the configured token limit ended
  // through EOS or another model-owned stopping criterion.
  return state.finishReason ?? "stop";
}

interface StopSequenceFilter {
  /** Consume a streamer chunk and return the portion safe to emit. */
  push(chunk: string): string;
  /** Flush buffered text after normal model completion. */
  finish(): string;
}

interface StopAutomatonNode {
  readonly transitions: Map<string, number>;
  failure: number;
  matched: boolean;
}

interface StopAutomaton {
  scan(
    text: string,
    initialState: number,
  ): { state: number; matched: boolean; processedCharacters: number };
}

/**
 * Incrementally matches stop strings against tokenizer-decoded streamer text.
 * Each batch item owns one automaton state, so chunks can be split arbitrarily
 * without retaining or rescanning prior output.
 */
export interface StopSequenceMatcher {
  /** Number of UTF-16 code units examined, exposed as linear-work evidence. */
  readonly processedCharacters: number;
  push(item: number, text: string): boolean;
  hasMatched(item: number): boolean;
}

function createStopAutomaton(stopSequences: readonly string[]): StopAutomaton {
  const nodes: StopAutomatonNode[] = [{
    transitions: new Map(),
    failure: 0,
    matched: false,
  }];

  for (const stop of stopSequences) {
    let state = 0;
    for (let index = 0; index < stop.length; index++) {
      const character = stop[index]!;
      let next = nodes[state]!.transitions.get(character);
      if (next === undefined) {
        next = nodes.length;
        nodes[state]!.transitions.set(character, next);
        nodes.push({ transitions: new Map(), failure: 0, matched: false });
      }
      state = next;
    }
    nodes[state]!.matched = true;
  }

  const pendingStates: number[] = [];
  for (const next of nodes[0]!.transitions.values()) pendingStates.push(next);
  for (let readIndex = 0; readIndex < pendingStates.length; readIndex++) {
    const state = pendingStates[readIndex]!;
    for (const [character, next] of nodes[state]!.transitions) {
      let fallback = nodes[state]!.failure;
      while (fallback !== 0 && !nodes[fallback]!.transitions.has(character)) {
        fallback = nodes[fallback]!.failure;
      }
      const fallbackTransition = nodes[fallback]!.transitions.get(character);
      if (fallbackTransition !== undefined && fallbackTransition !== next) {
        fallback = fallbackTransition;
      }
      nodes[next]!.failure = fallback;
      nodes[next]!.matched ||= nodes[fallback]!.matched;
      pendingStates.push(next);
    }
  }

  return {
    scan(text, initialState) {
      let state = initialState;
      let processedCharacters = 0;
      for (let index = 0; index < text.length; index++) {
        const character = text[index]!;
        processedCharacters += 1;
        while (state !== 0 && !nodes[state]!.transitions.has(character)) {
          state = nodes[state]!.failure;
        }
        state = nodes[state]!.transitions.get(character) ?? 0;
        if (nodes[state]!.matched) {
          return { state, matched: true, processedCharacters };
        }
      }
      return { state, matched: false, processedCharacters };
    },
  };
}

export function createStopSequenceMatcher(
  stopSequences: readonly string[],
): StopSequenceMatcher {
  const validatedStops = validateGenerateOptions({
    stopSequences: [...stopSequences],
  }).stopSequences ?? [];
  const automaton = createStopAutomaton(validatedStops);
  const automatonStates = new Map<number, number>();
  const matchedItems = new Set<number>();
  let processedCharacters = 0;

  function assertBatchItem(item: number): void {
    if (!Number.isSafeInteger(item) || item < 0) {
      throw new RangeError("stop matcher batch item must be a non-negative safe integer");
    }
  }

  return {
    get processedCharacters() {
      return processedCharacters;
    },
    push(item, text) {
      assertBatchItem(item);
      if (matchedItems.has(item)) return true;

      const result = automaton.scan(text, automatonStates.get(item) ?? 0);
      processedCharacters += result.processedCharacters;
      automatonStates.set(item, result.state);
      if (result.matched) matchedItems.add(item);
      return matchedItems.has(item);
    },
    hasMatched(item) {
      assertBatchItem(item);
      return matchedItems.has(item);
    },
  };
}

/** Options object forwarded to the Transformers.js text-generation pipeline. */
export interface PipeOptions {
  max_new_tokens: number;
  temperature: number;
  top_p?: number;
  top_k?: number;
  do_sample: boolean;
  streamer: unknown;
  stopping_criteria?: StoppingCriteriaListInstance;
}

/**
 * Build a StoppingCriteriaList that halts generation as soon as any of the
 * provided stop strings appears in the *newly generated* output.
 *
 * Transformers.js invokes TextStreamer before stopping criteria on each
 * generation step. Matching the streamer's finalized decoded chunks preserves
 * tokenizer semantics (including leading-space BPE tokens) and lets this
 * criterion stop without decoding or rescanning the growing token sequence.
 */
function buildStopStringCriteria(
  transformers: Pick<TransformersModule, "StoppingCriteria" | "StoppingCriteriaList">,
  maxNewTokens: number,
  abortSignal?: AbortSignal,
  knownPromptLengths?: readonly number[],
  terminationState?: GenerationTerminationState,
  eosTokenIds: readonly GenerationTokenId[] = [],
  stopMatcher?: StopSequenceMatcher,
): StoppingCriteriaListInstance {
  const list = new transformers.StoppingCriteriaList();
  const base = new transformers.StoppingCriteria();
  const criterion = base as StoppingCriteriaInstance;
  // Transformers.js evaluates stopping criteria only after appending the first
  // generated token. For pipelines that tokenize internally, infer the prompt
  // boundary by excluding that token on the first invocation. Conditional
  // generation passes exact prompt lengths when they are already available.
  const promptLengths: Array<number | undefined> = [...(knownPromptLengths ?? [])];
  criterion._call = (inputIds: number[][]): boolean[] =>
    inputIds.map((ids, item) => {
      if (abortSignal?.aborted) return true;

      if (promptLengths[item] === undefined) {
        promptLengths[item] = Math.max(0, ids.length - 1);
      }
      const promptLength = promptLengths[item]!;
      const generatedLength = Math.max(0, ids.length - promptLength);
      if (generatedLength === 0) return false;

      if (stopMatcher?.hasMatched(item)) {
        recordFinishReason(terminationState, "stop");
        return true;
      }

      if (eosTokenIds.some((id) => tokenIdsEqual(ids.at(-1), id))) {
        recordFinishReason(terminationState, "stop");
      } else if (generatedLength >= maxNewTokens) {
        recordFinishReason(terminationState, "length");
      }
      return false;
    });
  list.push(criterion);
  return list;
}

/**
 * Buffer enough output to recognize stop strings split across streamer chunks.
 * Text before a stop sequence is returned immediately; the stop sequence and
 * anything after it are suppressed.
 */
export function createStopSequenceFilter(stopSequences: readonly string[]): StopSequenceFilter {
  const stops = [...new Set(stopSequences.filter((stop) => stop.length > 0))];
  let pending = "";
  let stopped = false;

  function longestPossibleStopPrefixSuffix(text: string): number {
    let retained = 0;
    for (const stop of stops) {
      const maxCandidate = Math.min(text.length, stop.length - 1);
      for (let length = maxCandidate; length > retained; length--) {
        if (text.endsWith(stop.slice(0, length))) {
          retained = length;
          break;
        }
      }
    }
    return retained;
  }

  return {
    push(chunk: string): string {
      if (stopped || chunk.length === 0) return "";
      if (stops.length === 0) return chunk;

      pending += chunk;
      let stopIndex = -1;
      for (const stop of stops) {
        const candidate = pending.indexOf(stop);
        if (candidate >= 0 && (stopIndex < 0 || candidate < stopIndex)) {
          stopIndex = candidate;
        }
      }

      if (stopIndex >= 0) {
        const safe = pending.slice(0, stopIndex);
        pending = "";
        stopped = true;
        return safe;
      }

      const retained = longestPossibleStopPrefixSuffix(pending);
      const safeLength = pending.length - retained;
      const safe = pending.slice(0, safeLength);
      pending = pending.slice(safeLength);
      return safe;
    },

    finish(): string {
      if (stopped) return "";
      const safe = pending;
      pending = "";
      return safe;
    },
  };
}

/**
 * Translate engine-level {@link GenerateOptions} into the options object passed
 * to the Transformers.js text-generation pipeline.
 *
 * Exported for unit testing the option-forwarding seam (notably that
 * `stopSequences` is not silently dropped) without downloading a model.
 */
export function buildPipeOptions(
  options: GenerateOptions,
  transformers: Pick<TransformersModule, "StoppingCriteria" | "StoppingCriteriaList">,
  _tokenizer: unknown,
  streamer: unknown,
  knownPromptLengths?: readonly number[],
  terminationState?: GenerationTerminationState,
  eosTokenIds: readonly GenerationTokenId[] = [],
  stopMatcher?: StopSequenceMatcher,
): PipeOptions {
  const {
    maxNewTokens = DEFAULT_MAX_NEW_TOKENS,
    temperature = 0.7,
    topP,
    topK,
    stopSequences,
  } = options;

  const pipeOptions: PipeOptions = {
    max_new_tokens: maxNewTokens,
    temperature,
    top_p: topP,
    top_k: topK,
    do_sample: temperature > 0,
    streamer,
  };

  const hasStopSequences = stopSequences?.some((stop) => stop.length > 0) ?? false;
  if (hasStopSequences && !stopMatcher) {
    throw new TypeError("stopSequences require a decoded-stream stop matcher");
  }

  if (
    hasStopSequences ||
    options.abortSignal ||
    terminationState
  ) {
    pipeOptions.stopping_criteria = buildStopStringCriteria(
      transformers,
      maxNewTokens,
      options.abortSignal,
      knownPromptLengths,
      terminationState,
      eosTokenIds,
      stopMatcher,
    );
  }

  return pipeOptions;
}

interface TextGenerationPipeline {
  tokenizer: unknown;
  model: ConditionalModel;
  dispose(): void | Promise<void>;
  (
    messages: ChatMessage[],
    options: PipeOptions,
  ): Promise<void>;
}

let transformersModule: TransformersModule | null = null;
let transformersModuleLoad:
  | { readonly generation: number; readonly promise: Promise<TransformersModule> }
  | undefined;
let transformersModuleGeneration = 0;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function createLinkedAbortController(upstream?: AbortSignal): {
  controller: AbortController;
  cleanup(): void;
} {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(abortReason(upstream!));

  if (upstream?.aborted) {
    forwardAbort();
  } else {
    upstream?.addEventListener("abort", forwardAbort, { once: true });
  }

  return {
    controller,
    cleanup() {
      upstream?.removeEventListener("abort", forwardAbort);
    },
  };
}

interface PrimaryGenerationFailure {
  readonly error: unknown;
}

async function cleanupGenerationResources(
  linkedAbort: ReturnType<typeof createLinkedAbortController>,
  generatePromise: Promise<void> | undefined,
  lease: { release(): Promise<void> } | undefined,
  primaryFailure: PrimaryGenerationFailure | undefined,
): Promise<void> {
  if (!linkedAbort.controller.signal.aborted) {
    linkedAbort.controller.abort(
      new DOMException("The generation consumer closed.", "AbortError"),
    );
  }

  const cleanupErrors: unknown[] = [];
  if (generatePromise) {
    try {
      await generatePromise;
    } catch (error) {
      // The generator body already surfaces its own generation failure. Only
      // retain a distinct late failure so AggregateError does not duplicate it.
      if (!primaryFailure || error !== primaryFailure.error) cleanupErrors.push(error);
    }
  }
  if (lease) {
    try {
      await lease.release();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  linkedAbort.cleanup();

  if (cleanupErrors.length === 0) return;
  if (primaryFailure) {
    throw new LocalGenerationCleanupError(primaryFailure.error, cleanupErrors);
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  throw new AggregateError(cleanupErrors, "Local generation resource cleanup failed");
}

function createRuntimeUnavailableError(message: string, cause: unknown): Error {
  const error = toError(createError({ type: "no_ai_available", message }));
  Object.defineProperty(error, "cause", {
    configurable: true,
    value: cause,
    writable: true,
  });
  return error;
}

/** Lazily load the extension-owned inference dependency. */
export async function getTransformers(): Promise<TransformersModule> {
  throwIfLocalAIDisabled();
  if (transformersModule) return transformersModule;

  const generation = transformersModuleGeneration;
  let load = transformersModuleLoad;
  if (!load || load.generation !== generation) {
    logger.info("Loading @huggingface/transformers...");
    const promise = (async (): Promise<TransformersModule> => {
      let mod: TransformersModule;
      try {
        mod = await import("@huggingface/transformers") as unknown as TransformersModule;
      } catch (cause) {
        throw createRuntimeUnavailableError(
          "The Transformers inference dependency could not be loaded. Install " +
            "@veryfront/ext-llm-transformers with its declared dependencies and use a " +
            "runtime supported by its native inference backend.",
          cause,
        );
      }

      // Configure the extension-owned model cache for server runtimes.
      mod.env.cacheDir = "./.cache/models";
      mod.env.useBrowserCache = false;
      return mod;
    })();
    load = { generation, promise };
    transformersModuleLoad = load;
  }

  try {
    const mod = await load.promise;
    if (generation !== transformersModuleGeneration) {
      throw new DOMException(
        "The Transformers runtime was disposed during initialization.",
        "AbortError",
      );
    }
    transformersModule = mod;
    return mod;
  } finally {
    if (transformersModuleLoad === load) transformersModuleLoad = undefined;
  }
}

async function ensureWebGpuAvailable(): Promise<void> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    throw toError(
      createError({
        type: "no_ai_available",
        message: "Local AI WebGPU unavailable. This runtime does not expose navigator.gpu. " +
          "Use VERYFRONT_LOCAL_AI_DEVICE=cpu or run in a runtime with WebGPU support.",
      }),
    );
  }

  const gpu = (navigator as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
  const adapter = await gpu?.requestAdapter?.();
  if (!adapter) {
    throw toError(
      createError({
        type: "no_ai_available",
        message: "Local AI WebGPU unavailable. No WebGPU adapter was found. " +
          "Use VERYFRONT_LOCAL_AI_DEVICE=cpu or run on a machine with a supported GPU.",
      }),
    );
  }
}

export async function getLocalInferenceDevice(): Promise<LocalAIDevice> {
  const device = getLocalAIDevice();
  if (device === "webgpu") {
    await ensureWebGpuAvailable();
  }
  return device;
}

function formatDType(dtype: ModelInfo["dtype"]): string {
  return typeof dtype === "string" ? dtype : JSON.stringify(dtype);
}

function getConditionalModelConstructor(
  transformers: TransformersModule,
  modelInfo: ModelInfo,
): ConditionalModelConstructor {
  switch (modelInfo.modelClass) {
    case "gemma4":
      return transformers.Gemma4ForConditionalGeneration;
    case "qwen3_5":
      return transformers.Qwen3_5ForConditionalGeneration;
    default:
      throw toError(
        createError({
          type: "config",
          message:
            `Local model "${modelInfo.hfId}" requires a supported conditional-generation model class.`,
        }),
      );
  }
}

/**
 * Bounded, dedup-aware cache of text-generation pipelines keyed by HuggingFace
 * model id. Only loads a model on a cold cache miss; concurrent loads of the
 * same model share a single promise.
 */
const textGenerationPipelines = createPipelineCache<TextGenerationPipeline, LocalModelLoadInfo>(
  async (modelInfo, abortSignal) => {
    throwIfAborted(abortSignal);
    const transformers = await getTransformers();
    throwIfAborted(abortSignal);

    logger.info(
      `Loading local model: ${modelInfo.hfId} (${
        formatDType(modelInfo.dtype)
      }, ${modelInfo.device}, ~${modelInfo.sizeMB}MB)...`,
    );

    const pipe = (await transformers.pipeline(
      "text-generation",
      modelInfo.hfId,
      {
        dtype: modelInfo.dtype,
        device: modelInfo.device,
      },
    )) as TextGenerationPipeline;

    logger.info(`Model loaded: ${modelInfo.hfId}`);
    return pipe;
  },
  {
    loadTimeoutMs: getLocalAIModelLoadTimeoutMs,
    dispose: async (pipeline) => {
      await pipeline.dispose();
    },
  },
);

const conditionalGenerationRuntimes = createPipelineCache<
  ConditionalGenerationRuntime,
  LocalModelLoadInfo
>(
  async (modelInfo, abortSignal) => {
    throwIfAborted(abortSignal);
    const transformers = await getTransformers();
    throwIfAborted(abortSignal);
    const ModelClass = getConditionalModelConstructor(transformers, modelInfo);

    logger.info(
      `Loading local model: ${modelInfo.hfId} (${
        formatDType(modelInfo.dtype)
      }, ${modelInfo.device}, ~${modelInfo.sizeMB}MB)...`,
    );

    // Load the lightweight processor first. If it fails, do not start a
    // multi-GB native model load that would continue after Promise.all rejects
    // and become unreachable without an explicit dispose().
    const processor = await transformers.AutoProcessor.from_pretrained(modelInfo.hfId);
    throwIfAborted(abortSignal);
    const model = await ModelClass.from_pretrained(modelInfo.hfId, {
      dtype: modelInfo.dtype,
      device: modelInfo.device,
    });

    logger.info(`Model loaded: ${modelInfo.hfId}`);
    return { processor, model };
  },
  {
    loadTimeoutMs: getLocalAIModelLoadTimeoutMs,
    dispose: async (runtime) => {
      await runtime.model.dispose();
    },
  },
);

function getModelCacheKey(modelInfo: ModelInfo, device: LocalAIDevice): string {
  return `${modelInfo.hfId}:${device}`;
}

async function preloadLocalRuntime(
  modelInfo: ModelInfo,
  abortSignal?: AbortSignal,
): Promise<void> {
  throwIfLocalAIDisabled();
  throwIfAborted(abortSignal);
  const device = await getLocalInferenceDevice();
  throwIfAborted(abortSignal);
  const loadInfo: LocalModelLoadInfo = { ...modelInfo, device };
  const cacheKey = getModelCacheKey(modelInfo, device);
  const cache = modelInfo.engine === "conditional-generation"
    ? conditionalGenerationRuntimes
    : textGenerationPipelines;
  if (!abortSignal) return await cache.preload(cacheKey, loadInfo);
  const lease = await cache.acquire(cacheKey, loadInfo, abortSignal);
  await lease.release();
}

async function acquireLocalRuntime(modelInfo: ModelInfo, abortSignal?: AbortSignal): Promise<{
  value: unknown;
  release(): Promise<void>;
}> {
  throwIfLocalAIDisabled();
  throwIfAborted(abortSignal);
  const device = await getLocalInferenceDevice();
  throwIfAborted(abortSignal);
  const loadInfo: LocalModelLoadInfo = { ...modelInfo, device };
  const cacheKey = getModelCacheKey(modelInfo, device);
  return modelInfo.engine === "conditional-generation"
    ? conditionalGenerationRuntimes.acquire(cacheKey, loadInfo, abortSignal)
    : textGenerationPipelines.acquire(cacheKey, loadInfo, abortSignal);
}

function toConditionalMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    role: message.role,
    content: [{ type: "text", text: message.content }],
  }));
}

export function buildConditionalGenerateOptions(
  options: GenerateOptions,
  transformers: Pick<TransformersModule, "StoppingCriteria" | "StoppingCriteriaList">,
  _tokenizer: unknown,
  streamer: unknown,
  knownPromptLengths?: readonly number[],
  terminationState?: GenerationTerminationState,
  eosTokenIds: readonly GenerationTokenId[] = [],
  stopMatcher?: StopSequenceMatcher,
): PipeOptions {
  const {
    maxNewTokens = DEFAULT_MAX_NEW_TOKENS,
    temperature = 0.7,
    topP,
    topK,
    stopSequences,
  } = options;

  const generateOptions: PipeOptions = {
    max_new_tokens: maxNewTokens,
    temperature,
    top_p: topP,
    top_k: topK,
    do_sample: temperature > 0,
    streamer,
  };

  const hasStopSequences = stopSequences?.some((stop) => stop.length > 0) ?? false;
  if (hasStopSequences && !stopMatcher) {
    throw new TypeError("stopSequences require a decoded-stream stop matcher");
  }

  if (
    hasStopSequences ||
    options.abortSignal ||
    terminationState
  ) {
    generateOptions.stopping_criteria = buildStopStringCriteria(
      transformers,
      maxNewTokens,
      options.abortSignal,
      knownPromptLengths,
      terminationState,
      eosTokenIds,
      stopMatcher,
    );
  }

  return generateOptions;
}

function getPromptTokenLengths(inputs: Record<string, unknown>): number[] | undefined {
  const inputIds = inputs.input_ids as { dims?: readonly number[] } | undefined;
  const dimensions = inputIds?.dims;
  if (!dimensions || dimensions.length === 0) return undefined;

  const sequenceLength = Number(dimensions.at(-1));
  if (!Number.isSafeInteger(sequenceLength) || sequenceLength < 0) return undefined;
  const batchSize = Number(dimensions.length > 1 ? dimensions.at(-2) : 1);
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) return undefined;
  return Array(batchSize).fill(sequenceLength);
}

export function buildConditionalChatTemplateOptions(
  modelInfo: Pick<ModelInfo, "modelClass">,
): Record<string, unknown> {
  return {
    add_generation_prompt: true,
    ...(modelInfo.modelClass === "gemma4" ? { enable_thinking: getLocalAIThinkingEnabled() } : {}),
  };
}

async function prepareConditionalInputs(
  runtime: ConditionalGenerationRuntime,
  modelInfo: ModelInfo,
  messages: ChatMessage[],
): Promise<Record<string, unknown>> {
  const prompt = runtime.processor.apply_chat_template(
    toConditionalMessages(messages),
    buildConditionalChatTemplateOptions(modelInfo),
  );

  if (modelInfo.modelClass === "gemma4") {
    return await runtime.processor(prompt, undefined, undefined, {
      add_special_tokens: false,
    });
  }

  return await runtime.processor(prompt);
}

async function* generateConditionalStream(
  modelInfo: ModelInfo,
  messages: ChatMessage[],
  options: GenerateOptions,
): AsyncGenerator<string, LocalGenerationFinishReason, undefined> {
  const linkedAbort = createLinkedAbortController(options.abortSignal);
  const abortSignal = linkedAbort.controller.signal;
  let lease: Awaited<ReturnType<typeof acquireLocalRuntime>> | undefined;
  let generatePromise: Promise<void> | undefined;
  let finishReason: LocalGenerationFinishReason | undefined;
  let primaryFailure: PrimaryGenerationFailure | undefined;

  try {
    throwIfAborted(abortSignal);
    lease = await acquireLocalRuntime(modelInfo, abortSignal);
    throwIfAborted(abortSignal);

    const runtime = lease.value as ConditionalGenerationRuntime;
    const transformers = await getTransformers();
    const inputs = await prepareConditionalInputs(runtime, modelInfo, messages);
    throwIfAborted(abortSignal);

    const tokenQueue = createBoundedTextQueue();
    let resolveWaiting: (() => void) | null = null;
    let done = false;
    const terminationState: GenerationTerminationState = {};
    const stopMatcher = options.stopSequences?.length
      ? createStopSequenceMatcher(options.stopSequences)
      : undefined;
    const stopFilter = createStopSequenceFilter(options.stopSequences ?? []);

    const flushWaiting = (): void => {
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    const enqueueOutput = (text: string): void => {
      if (abortSignal.aborted) {
        flushWaiting();
        return;
      }
      if (text.length > 0 && !tokenQueue.enqueue(text)) {
        linkedAbort.controller.abort(createStreamBackpressureError());
      }
      flushWaiting();
    };

    const enqueueFiltered = (text: string): void => {
      if (abortSignal.aborted) {
        flushWaiting();
        return;
      }
      if (stopMatcher?.push(0, text)) {
        recordFinishReason(terminationState, "stop");
      }
      const safe = stopFilter.push(text);
      enqueueOutput(safe);
    };

    const streamer = new transformers.TextStreamer(runtime.processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      decode_kwargs: { clean_up_tokenization_spaces: false },
      callback_function: enqueueFiltered,
    });
    const eosTokenIds = readEosTokenIds(runtime.model);

    generatePromise = (async () => {
      try {
        await runtime.model.generate({
          ...inputs,
          ...buildConditionalGenerateOptions(
            { ...options, abortSignal },
            transformers,
            runtime.processor.tokenizer,
            streamer,
            getPromptTokenLengths(inputs),
            terminationState,
            eosTokenIds,
            stopMatcher,
          ),
        });
        finishReason = resolveFinishReason(terminationState);
      } finally {
        const finalText = stopFilter.finish();
        if (!abortSignal.aborted) enqueueOutput(finalText);
        done = true;
        flushWaiting();
      }
    })();
    // Generation may fail while the async generator is paused at a yielded
    // chunk. Observe it immediately; the original promise is still awaited and
    // surfaced below or by cleanupGenerationResources().
    void generatePromise.then(
      () => {},
      () => {},
    );

    while (true) {
      let token: string | undefined;
      while ((token = tokenQueue.dequeue()) !== undefined) {
        throwIfAborted(abortSignal);
        yield token;
      }

      if (done) break;

      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    try {
      await generatePromise;
    } catch (error) {
      throwIfAborted(abortSignal);
      throw error;
    }
    throwIfAborted(abortSignal);
    return finishReason ?? resolveFinishReason(terminationState);
  } catch (error) {
    primaryFailure = { error };
    throw error;
  } finally {
    await cleanupGenerationResources(linkedAbort, generatePromise, lease, primaryFailure);
  }
}

/**
 * Eagerly verify that the local AI runtime (@huggingface/transformers + ONNX)
 * is available by loading the default model pipeline.
 *
 * Call this *before* creating the HTTP response stream so that failures surface
 * as a thrown error (503) rather than being swallowed inside a ReadableStream
 * (200 with in-band SSE error).
 *
 * In compiled binaries, `import("@huggingface/transformers")` itself fails
 * because `onnxruntime-node` eagerly `require()`s a native `.node` addon at
 * import time and the addon isn't embedded in the binary.  In dev mode (Deno)
 * the native addon exists on disk so the import succeeds, but `pipeline()` can
 * still fail if the ONNX model files are missing.  Either way this function
 * surfaces the error before the response stream is created.  The pipeline is
 * cached after the first successful call, so subsequent checks are instant.
 */
export async function verifyLocalRuntime(
  modelId?: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const modelInfo = resolveLocalModel(modelId ?? DEFAULT_LOCAL_MODEL);
  await preloadLocalRuntime(modelInfo, abortSignal);
}

/**
 * Generate text in a streaming fashion using an async generator.
 *
 * Yields individual tokens as they are generated by the model.
 */
export async function* generateStream(
  modelId: string,
  messages: ChatMessage[],
  options: GenerateOptions = {},
): AsyncGenerator<string, LocalGenerationFinishReason, undefined> {
  const validatedOptions = validateGenerateOptions(options);
  throwIfAborted(validatedOptions.abortSignal);
  const modelInfo = resolveLocalModel(modelId);
  if (modelInfo.engine === "conditional-generation") {
    return yield* generateConditionalStream(modelInfo, messages, validatedOptions);
  }

  const linkedAbort = createLinkedAbortController(validatedOptions.abortSignal);
  const abortSignal = linkedAbort.controller.signal;
  let lease: Awaited<ReturnType<typeof acquireLocalRuntime>> | undefined;
  let generatePromise: Promise<void> | undefined;
  let finishReason: LocalGenerationFinishReason | undefined;
  let primaryFailure: PrimaryGenerationFailure | undefined;

  try {
    lease = await acquireLocalRuntime(modelInfo, abortSignal);
    throwIfAborted(abortSignal);

    const pipe = lease.value as TextGenerationPipeline;
    const transformers = await getTransformers();
    throwIfAborted(abortSignal);

    // Use a queue to bridge TextStreamer callbacks to an async generator.
    const tokenQueue = createBoundedTextQueue();
    let resolveWaiting: (() => void) | null = null;
    let done = false;
    const terminationState: GenerationTerminationState = {};
    const stopMatcher = validatedOptions.stopSequences?.length
      ? createStopSequenceMatcher(validatedOptions.stopSequences)
      : undefined;
    const stopFilter = createStopSequenceFilter(validatedOptions.stopSequences ?? []);

    const flushWaiting = (): void => {
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    const enqueueOutput = (text: string): void => {
      if (abortSignal.aborted) {
        flushWaiting();
        return;
      }
      if (text.length > 0 && !tokenQueue.enqueue(text)) {
        linkedAbort.controller.abort(createStreamBackpressureError());
      }
      flushWaiting();
    };

    const enqueueFiltered = (text: string): void => {
      if (abortSignal.aborted) {
        flushWaiting();
        return;
      }
      if (stopMatcher?.push(0, text)) {
        recordFinishReason(terminationState, "stop");
      }
      const safe = stopFilter.push(text);
      enqueueOutput(safe);
    };

    const streamer = new transformers.TextStreamer(pipe.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      decode_kwargs: { clean_up_tokenization_spaces: false },
      callback_function: enqueueFiltered,
    });

    const pipeOptions = buildPipeOptions(
      { ...validatedOptions, abortSignal },
      transformers,
      pipe.tokenizer,
      streamer,
      undefined,
      terminationState,
      readEosTokenIds(pipe.model),
      stopMatcher,
    );

    generatePromise = (async () => {
      try {
        await pipe(messages, pipeOptions);
        finishReason = resolveFinishReason(terminationState);
      } finally {
        const finalText = stopFilter.finish();
        if (!abortSignal.aborted) enqueueOutput(finalText);
        done = true;
        flushWaiting();
      }
    })();
    // Generation may fail while the async generator is paused at a yielded
    // chunk. Observe it immediately; the original promise is still awaited and
    // surfaced below or by cleanupGenerationResources().
    void generatePromise.then(
      () => {},
      () => {},
    );

    while (true) {
      let token: string | undefined;
      while ((token = tokenQueue.dequeue()) !== undefined) {
        throwIfAborted(abortSignal);
        yield token;
      }

      if (done) break;

      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    try {
      await generatePromise;
    } catch (error) {
      throwIfAborted(abortSignal);
      throw error;
    }
    throwIfAborted(abortSignal);
    return finishReason ?? resolveFinishReason(terminationState);
  } catch (error) {
    primaryFailure = { error };
    throw error;
  } finally {
    await cleanupGenerationResources(linkedAbort, generatePromise, lease, primaryFailure);
  }
}

/**
 * Generate text without streaming (full completion).
 */
export async function generate(
  modelId: string,
  messages: ChatMessage[],
  options: GenerateOptions = {},
): Promise<LocalGenerationResult> {
  const chunks: string[] = [];
  const iterator = generateStream(modelId, messages, options);
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return {
        text: chunks.join(""),
        finishReason: next.value,
      };
    }
    chunks.push(next.value);
  }
}

/**
 * Preload a model into memory. Useful for warming up on server start.
 */
export async function preloadModel(modelId: string): Promise<void> {
  const modelInfo = resolveLocalModel(modelId);
  await preloadLocalRuntime(modelInfo);
}

/**
 * Check if a model is currently loaded in memory.
 */
export function isModelLoaded(modelId: string): boolean {
  const modelInfo = resolveLocalModel(modelId);
  const device = getLocalAIDevice();
  const cacheKey = getModelCacheKey(modelInfo, device);
  return modelInfo.engine === "conditional-generation"
    ? conditionalGenerationRuntimes.has(cacheKey)
    : textGenerationPipelines.has(cacheKey);
}

/** Retire all model pipelines and release their native resources. */
export async function disposeLocalModelRuntimes(): Promise<void> {
  const results = await Promise.allSettled([
    textGenerationPipelines.clear(),
    conditionalGenerationRuntimes.clear(),
  ]);
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Failed to dispose local model runtimes");
  }
}

/** Invalidate the shared vendor-module handle after every pipeline cache is drained. */
export function resetTransformersRuntimeDependency(): void {
  transformersModuleGeneration += 1;
  transformersModule = null;
}
