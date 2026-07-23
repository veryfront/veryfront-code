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
 * @module provider/local
 */

import { serverLogger } from "#veryfront/utils";
import { createError, fromError, toError } from "#veryfront/errors";
import { importTransformers } from "#veryfront/compat/opaque-deps.ts";
import { DEFAULT_LOCAL_MODEL, type ModelInfo, resolveLocalModel } from "./model-catalog.ts";
import {
  getLocalAIDevice,
  getLocalAIThinkingEnabled,
  type LocalAIDevice,
  throwIfLocalAIDisabled,
} from "./env.ts";
import { createPipelineCache, type PipelineLease } from "./pipeline-cache.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { join } from "#veryfront/compat/path/index.ts";

const logger = serverLogger.component("local-llm");

/** Default maximum new tokens for local model generation */
const DEFAULT_MAX_NEW_TOKENS = 512;
const MAX_NEW_TOKENS = 32_768;
const MAX_CHAT_MESSAGES = 1_024;
const MAX_CHAT_MESSAGE_CHARACTERS = 4 * 1_024 * 1_024;
const MAX_STOP_SEQUENCES = 16;
const MAX_STOP_SEQUENCE_LENGTH = 1_024;
const LOCAL_MODEL_CACHE_DIR = join(getCacheBaseDir(), "models");

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

/** Validate direct local-engine messages before model loading or inference. */
export function assertValidChatMessages(value: unknown): asserts value is ChatMessage[] {
  if (!Array.isArray(value) || value.length > MAX_CHAT_MESSAGES) {
    throw new RangeError(`Local model prompt must contain at most ${MAX_CHAT_MESSAGES} messages`);
  }
  if (value.length === 0) {
    throw new RangeError("Local model prompt must contain at least one message");
  }

  let totalCharacters = 0;
  for (const message of value) {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      throw new TypeError("Local model prompt contains an invalid message");
    }
    const candidate = message as { role?: unknown; content?: unknown };
    if (
      candidate.role !== "system" && candidate.role !== "user" &&
      candidate.role !== "assistant"
    ) {
      throw new TypeError("Local model prompt contains an invalid role");
    }
    if (typeof candidate.content !== "string") {
      throw new TypeError("Local model prompt content must be text");
    }
    totalCharacters += candidate.content.length;
    if (totalCharacters > MAX_CHAT_MESSAGE_CHARACTERS) {
      throw new RangeError("Local model prompt exceeded the supported size");
    }
  }
}

/** Validate local generation options before loading a model. */
export function assertValidGenerateOptions(options: GenerateOptions): void {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("Local generation options must be an object");
  }
  if (
    options.maxNewTokens !== undefined &&
    (!Number.isSafeInteger(options.maxNewTokens) || options.maxNewTokens < 1 ||
      options.maxNewTokens > MAX_NEW_TOKENS)
  ) {
    throw new RangeError(`maxNewTokens must be an integer from 1 to ${MAX_NEW_TOKENS}`);
  }
  if (
    options.temperature !== undefined &&
    (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)
  ) {
    throw new RangeError("temperature must be a finite number from 0 to 2");
  }
  if (
    options.topP !== undefined &&
    (!Number.isFinite(options.topP) || options.topP < 0 || options.topP > 1)
  ) {
    throw new RangeError("topP must be a finite number from 0 to 1");
  }
  if (
    options.topK !== undefined &&
    (!Number.isSafeInteger(options.topK) || options.topK < 1 || options.topK > 10_000)
  ) {
    throw new RangeError("topK must be an integer from 1 to 10000");
  }
  if (options.stopSequences !== undefined) {
    if (
      !Array.isArray(options.stopSequences) || options.stopSequences.length > MAX_STOP_SEQUENCES ||
      options.stopSequences.some((value) =>
        typeof value !== "string" || value.length === 0 || value.length > MAX_STOP_SEQUENCE_LENGTH
      )
    ) {
      throw new RangeError(
        `stopSequences must contain at most ${MAX_STOP_SEQUENCES} non-empty strings of at most ${MAX_STOP_SEQUENCE_LENGTH} characters`,
      );
    }
  }
  if (options.abortSignal !== undefined && !(options.abortSignal instanceof AbortSignal)) {
    throw new TypeError("abortSignal must be an AbortSignal");
  }
}

function throwIfGenerationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Local model generation was aborted", "AbortError");
  }
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

/** Tokenizer surface used to decode generated token ids back to text. */
interface DecodingTokenizer {
  decode(tokens: number[]): string;
}

/** Bounded state shared by the text streamer and generation stopping criterion. */
export interface StopSequenceController {
  readonly stopped: boolean;
  push(text: string): string;
  finish(): string;
}

/** Create a bounded filter that removes the first configured stop sequence. */
export function createStopSequenceController(
  stopSequences: readonly string[],
): StopSequenceController {
  if (
    !Array.isArray(stopSequences) || stopSequences.length === 0 ||
    stopSequences.length > MAX_STOP_SEQUENCES ||
    stopSequences.some((value) =>
      typeof value !== "string" || value.length === 0 || value.length > MAX_STOP_SEQUENCE_LENGTH
    )
  ) {
    throw new RangeError("Stop sequence configuration is invalid");
  }
  const sequences = [...stopSequences];
  const retainedSuffixLength = Math.max(...sequences.map((value) => value.length)) - 1;
  let pending = "";
  let stopped = false;

  return {
    get stopped() {
      return stopped;
    },
    push(text: string): string {
      if (stopped || text.length === 0) return "";
      pending += text;
      let firstMatch = -1;
      for (const sequence of sequences) {
        const index = pending.indexOf(sequence);
        if (index >= 0 && (firstMatch < 0 || index < firstMatch)) firstMatch = index;
      }
      if (firstMatch >= 0) {
        const output = pending.slice(0, firstMatch);
        pending = "";
        stopped = true;
        return output;
      }
      if (pending.length <= retainedSuffixLength) return "";
      const outputLength = pending.length - retainedSuffixLength;
      const output = pending.slice(0, outputLength);
      pending = pending.slice(outputLength);
      return output;
    },
    finish(): string {
      if (stopped) return "";
      const output = pending;
      pending = "";
      return output;
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

function buildStoppingCriteria(
  options: GenerateOptions,
  transformers: Pick<TransformersModule, "StoppingCriteria" | "StoppingCriteriaList">,
  stopController: StopSequenceController | undefined,
): StoppingCriteriaListInstance | undefined {
  let list: StoppingCriteriaListInstance | undefined;
  if (options.stopSequences && options.stopSequences.length > 0) {
    if (!stopController) {
      throw new TypeError("Stop sequence controller is required");
    }
    list = new transformers.StoppingCriteriaList();
    const stopCriterion = new transformers.StoppingCriteria();
    stopCriterion._call = (inputIds: number[][]): boolean[] =>
      inputIds.map(() => stopController.stopped);
    list.push(stopCriterion);
  }
  if (options.abortSignal) {
    list ??= new transformers.StoppingCriteriaList();
    const abortCriterion = new transformers.StoppingCriteria();
    abortCriterion._call = (inputIds: number[][]): boolean[] =>
      inputIds.map(() => options.abortSignal?.aborted === true);
    list.push(abortCriterion);
  }
  return list;
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
  _tokenizer: DecodingTokenizer,
  streamer: unknown,
  stopController?: StopSequenceController,
): PipeOptions {
  assertValidGenerateOptions(options);
  const {
    maxNewTokens = DEFAULT_MAX_NEW_TOKENS,
    temperature = 0.7,
    topP,
    topK,
  } = options;

  const pipeOptions: PipeOptions = {
    max_new_tokens: maxNewTokens,
    temperature,
    top_p: topP,
    top_k: topK,
    do_sample: temperature > 0,
    streamer,
  };

  const stoppingCriteria = buildStoppingCriteria(options, transformers, stopController);
  if (stoppingCriteria) {
    pipeOptions.stopping_criteria = stoppingCriteria;
  }

  return pipeOptions;
}

interface TextGenerationPipeline {
  tokenizer: unknown;
  (
    messages: ChatMessage[],
    options: PipeOptions,
  ): Promise<void>;
}

let transformersModule: TransformersModule | null = null;

/**
 * Lazily import @huggingface/transformers.
 * Only loads when actually needed, keeping startup fast when API keys are present.
 */
export async function getTransformers(): Promise<TransformersModule> {
  if (transformersModule) return transformersModule;

  throwIfLocalAIDisabled();

  logger.info("Loading @huggingface/transformers...");

  let mod: TransformersModule;
  try {
    mod = await importTransformers();
  } catch (_) {
    // expected: @huggingface/transformers is an optional peer that npm installs
    // do not pull automatically, and native ONNX Runtime is not available in
    // some environments (e.g. compiled binaries)
    throw toError(
      createError({
        type: "no_ai_available",
        message:
          "Local AI model unavailable. Install @huggingface/transformers alongside veryfront " +
          "(npm installs), or run veryfront login, set VERYFRONT_API_TOKEN, or configure " +
          "OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY to use a cloud provider. " +
          "Native ONNX Runtime is not supported in compiled binaries.",
      }),
    );
  }

  // Configure cache directory for model files
  mod.env.cacheDir = LOCAL_MODEL_CACHE_DIR;
  // Disable browser-specific features in Node/Deno
  mod.env.useBrowserCache = false;

  transformersModule = mod;
  return mod;
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

async function getLocalInferenceDevice(): Promise<LocalAIDevice> {
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
 * Returns true when an error message matches known ONNX Runtime / native-addon
 * failure patterns. These substrings are heuristic - ONNX Runtime does not
 * expose a structured error type, so message scanning is the only viable
 * approach. Fail-safe: unrecognized errors are NOT matched and propagate as-is.
 */
function isOnnxUnavailableError(msg: string): boolean {
  return (
    msg.includes("onnx") || msg.includes("ONNX") ||
    msg.includes("dlopen") || msg.includes("dynamic linking") ||
    msg.includes("native module") || msg.includes("SharedArrayBuffer")
  );
}

function toSafeLocalLoadError(error: unknown): Error {
  if (fromError(error)) return error instanceof Error ? error : new Error("Local AI model failed");
  const message = error instanceof Error && typeof error.message === "string" ? error.message : "";
  const nativeRuntimeUnavailable = isOnnxUnavailableError(message);
  return toError(
    createError({
      type: "no_ai_available",
      message: nativeRuntimeUnavailable
        ? "Local AI model unavailable. Native ONNX Runtime is not supported in this environment. " +
          "Use a supported runtime or configure a cloud provider."
        : "Local AI model could not be loaded. Check network access and the model cache, then retry.",
    }),
  );
}

function toSafeLocalGenerationError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (fromError(error)) {
    return error instanceof Error ? error : new Error("Local AI request failed");
  }
  return toError(createError({ type: "agent", message: "Local AI generation failed." }));
}

/**
 * Bounded, dedup-aware cache of text-generation pipelines keyed by HuggingFace
 * model id. Only loads a model on a cold cache miss; concurrent loads of the
 * same model share a single promise.
 */
const textGenerationPipelines = createPipelineCache<TextGenerationPipeline, LocalModelLoadInfo>(
  async (modelInfo) => {
    try {
      const transformers = await getTransformers();

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
    } catch (error) {
      if (
        !fromError(error) &&
        isOnnxUnavailableError(
          error instanceof Error && typeof error.message === "string" ? error.message : "",
        )
      ) {
        transformersModule = null;
      }
      throw toSafeLocalLoadError(error);
    }
  },
);

const conditionalGenerationRuntimes = createPipelineCache<
  ConditionalGenerationRuntime,
  LocalModelLoadInfo
>(
  async (modelInfo) => {
    try {
      const transformers = await getTransformers();
      const ModelClass = getConditionalModelConstructor(transformers, modelInfo);

      logger.info(
        `Loading local model: ${modelInfo.hfId} (${
          formatDType(modelInfo.dtype)
        }, ${modelInfo.device}, ~${modelInfo.sizeMB}MB)...`,
      );

      const [processor, model] = await Promise.all([
        transformers.AutoProcessor.from_pretrained(modelInfo.hfId),
        ModelClass.from_pretrained(modelInfo.hfId, {
          dtype: modelInfo.dtype,
          device: modelInfo.device,
        }),
      ]);

      logger.info(`Model loaded: ${modelInfo.hfId}`);
      return { processor, model };
    } catch (error) {
      if (
        !fromError(error) &&
        isOnnxUnavailableError(
          error instanceof Error && typeof error.message === "string" ? error.message : "",
        )
      ) {
        transformersModule = null;
      }
      throw toSafeLocalLoadError(error);
    }
  },
);

function getModelCacheKey(modelInfo: ModelInfo, device: LocalAIDevice): string {
  return `${modelInfo.hfId}:${device}`;
}

async function loadLocalRuntime(modelInfo: ModelInfo): Promise<unknown> {
  throwIfLocalAIDisabled();
  const device = await getLocalInferenceDevice();
  const loadInfo: LocalModelLoadInfo = { ...modelInfo, device };
  const cacheKey = getModelCacheKey(modelInfo, device);
  return modelInfo.engine === "conditional-generation"
    ? conditionalGenerationRuntimes.load(cacheKey, loadInfo)
    : textGenerationPipelines.load(cacheKey, loadInfo);
}

async function acquireConditionalRuntime(
  modelInfo: ModelInfo,
): Promise<PipelineLease<ConditionalGenerationRuntime>> {
  throwIfLocalAIDisabled();
  const device = await getLocalInferenceDevice();
  const loadInfo: LocalModelLoadInfo = { ...modelInfo, device };
  return await conditionalGenerationRuntimes.acquire(
    getModelCacheKey(modelInfo, device),
    loadInfo,
  );
}

async function acquireTextGenerationPipeline(
  modelInfo: ModelInfo,
): Promise<PipelineLease<TextGenerationPipeline>> {
  throwIfLocalAIDisabled();
  const device = await getLocalInferenceDevice();
  const loadInfo: LocalModelLoadInfo = { ...modelInfo, device };
  return await textGenerationPipelines.acquire(
    getModelCacheKey(modelInfo, device),
    loadInfo,
  );
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
  _tokenizer: DecodingTokenizer,
  streamer: unknown,
  stopController?: StopSequenceController,
): PipeOptions {
  assertValidGenerateOptions(options);
  const {
    maxNewTokens = DEFAULT_MAX_NEW_TOKENS,
    temperature = 0.7,
    topP,
    topK,
  } = options;

  const generateOptions: PipeOptions = {
    max_new_tokens: maxNewTokens,
    temperature,
    top_p: topP,
    top_k: topK,
    do_sample: temperature > 0,
    streamer,
  };

  const stoppingCriteria = buildStoppingCriteria(options, transformers, stopController);
  if (stoppingCriteria) {
    generateOptions.stopping_criteria = stoppingCriteria;
  }

  return generateOptions;
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
): AsyncGenerator<string, void, undefined> {
  const lease = await acquireConditionalRuntime(modelInfo);
  let releaseOnGenerationCompletion = false;
  try {
    throwIfGenerationAborted(options.abortSignal);
    const runtime = lease.value;
    const transformers = await getTransformers();
    throwIfGenerationAborted(options.abortSignal);
    const inputs = await prepareConditionalInputs(runtime, modelInfo, messages);
    throwIfGenerationAborted(options.abortSignal);

    const tokenQueue: string[] = [];
    let tokenQueueIndex = 0;
    const stopController = options.stopSequences?.length
      ? createStopSequenceController(options.stopSequences)
      : undefined;
    let resolveWaiting: (() => void) | null = null;
    let done = false;
    let generationError: unknown;
    let generationFailed = false;

    const flushWaiting = (): void => {
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    const streamer = new transformers.TextStreamer(runtime.processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        const output = stopController?.push(text) ?? text;
        if (output) {
          tokenQueue.push(output);
          flushWaiting();
        }
      },
    });

    const generatePromise = (async () => {
      await runtime.model.generate({
        ...inputs,
        ...buildConditionalGenerateOptions(
          options,
          transformers,
          runtime.processor.tokenizer as DecodingTokenizer,
          streamer,
          stopController,
        ),
      });
      const trailing = stopController?.finish();
      if (trailing) tokenQueue.push(trailing);
    })().catch((error) => {
      generationFailed = true;
      generationError = error;
    }).finally(() => {
      done = true;
      lease.release();
      flushWaiting();
    });
    releaseOnGenerationCompletion = true;

    while (true) {
      while (tokenQueueIndex < tokenQueue.length) {
        yield tokenQueue[tokenQueueIndex++]!;
      }
      if (tokenQueueIndex > 0) {
        tokenQueue.length = 0;
        tokenQueueIndex = 0;
      }

      if (done) break;

      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    await generatePromise;
    if (generationFailed) throw toSafeLocalGenerationError(generationError);
    throwIfGenerationAborted(options.abortSignal);
  } finally {
    if (!releaseOnGenerationCompletion) lease.release();
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
export async function verifyLocalRuntime(modelId?: string): Promise<void> {
  const modelInfo = resolveLocalModel(modelId === undefined ? DEFAULT_LOCAL_MODEL : modelId);
  await loadLocalRuntime(modelInfo);
}

/**
 * Generate text in a streaming fashion using an async generator.
 *
 * Yields individual tokens as they are generated by the model.
 */
async function* generateStreamWithLifecycle(
  modelId: string,
  messages: ChatMessage[],
  options: GenerateOptions,
): AsyncGenerator<string, void, undefined> {
  throwIfGenerationAborted(options.abortSignal);
  throwIfLocalAIDisabled();
  const modelInfo = resolveLocalModel(modelId);
  if (modelInfo.engine === "conditional-generation") {
    yield* generateConditionalStream(modelInfo, messages, options);
    return;
  }

  const lease = await acquireTextGenerationPipeline(modelInfo);
  let releaseOnGenerationCompletion = false;
  try {
    throwIfGenerationAborted(options.abortSignal);
    const pipe = lease.value;
    const transformers = await getTransformers();
    throwIfGenerationAborted(options.abortSignal);

    // Use a queue to bridge TextStreamer callbacks to an async generator.
    const tokenQueue: string[] = [];
    let tokenQueueIndex = 0;
    const stopController = options.stopSequences?.length
      ? createStopSequenceController(options.stopSequences)
      : undefined;
    let resolveWaiting: (() => void) | null = null;
    let done = false;
    let generationError: unknown;
    let generationFailed = false;

    const flushWaiting = (): void => {
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    };

    const streamer = new transformers.TextStreamer(pipe.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        const output = stopController?.push(text) ?? text;
        if (output) {
          tokenQueue.push(output);
          flushWaiting();
        }
      },
    });

    const pipeOptions = buildPipeOptions(
      options,
      transformers,
      pipe.tokenizer as DecodingTokenizer,
      streamer,
      stopController,
    );

    // Start generation in the background.
    const generatePromise = (async () => {
      await pipe(messages, pipeOptions);
      const trailing = stopController?.finish();
      if (trailing) tokenQueue.push(trailing);
    })().catch((error) => {
      generationFailed = true;
      generationError = error;
    }).finally(() => {
      done = true;
      lease.release();
      flushWaiting();
    });
    releaseOnGenerationCompletion = true;

    // Yield tokens as they arrive.
    while (true) {
      while (tokenQueueIndex < tokenQueue.length) {
        yield tokenQueue[tokenQueueIndex++]!;
      }
      if (tokenQueueIndex > 0) {
        tokenQueue.length = 0;
        tokenQueueIndex = 0;
      }

      if (done) break;

      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }

    await generatePromise;
    if (generationFailed) throw toSafeLocalGenerationError(generationError);
    throwIfGenerationAborted(options.abortSignal);
  } finally {
    if (!releaseOnGenerationCompletion) lease.release();
  }
}

export async function* generateStream(
  modelId: string,
  messages: ChatMessage[],
  options: GenerateOptions = {},
): AsyncGenerator<string, void, undefined> {
  assertValidChatMessages(messages);
  assertValidGenerateOptions(options);
  throwIfGenerationAborted(options.abortSignal);
  const lifecycleController = new AbortController();
  const abortSignal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, lifecycleController.signal])
    : lifecycleController.signal;

  try {
    yield* generateStreamWithLifecycle(modelId, messages, { ...options, abortSignal });
  } finally {
    lifecycleController.abort();
  }
}

/**
 * Generate text without streaming (full completion).
 */
export async function generate(
  modelId: string,
  messages: ChatMessage[],
  options: GenerateOptions = {},
): Promise<string> {
  const chunks: string[] = [];
  for await (const token of generateStream(modelId, messages, options)) {
    chunks.push(token);
  }
  return chunks.join("");
}

/**
 * Preload a model into memory. Useful for warming up on server start.
 */
export async function preloadModel(modelId: string): Promise<void> {
  const modelInfo = resolveLocalModel(modelId);
  await loadLocalRuntime(modelInfo);
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
