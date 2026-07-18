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
import { createError, toError } from "#veryfront/errors";
import { importTransformers } from "#veryfront/compat/opaque-deps.ts";
import { DEFAULT_LOCAL_MODEL, type ModelInfo, resolveLocalModel } from "./model-catalog.ts";
import {
  getLocalAIDevice,
  getLocalAIThinkingEnabled,
  type LocalAIDevice,
  throwIfLocalAIDisabled,
} from "./env.ts";
import { createPipelineCache } from "./pipeline-cache.ts";

const logger = serverLogger.component("local-llm");

/** Default maximum new tokens for local model generation */
const DEFAULT_MAX_NEW_TOKENS = 512;

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
 * Transformers.js (>=3.x) does not expose a `stop_strings` generate option,
 * so we decode the running sequence with the tokenizer and match the stop
 * strings against the suffix through the documented `stopping_criteria` mechanism.
 *
 * Transformers.js passes the full sequence (prompt + generated tokens) to
 * `_call` on every step. We must scan only the generated suffix: if a system
 * or user message contains a configured stop string (e.g. an instruction that
 * mentions "END"), scanning the whole sequence would return `true` on the very
 * first generation step and truncate the response to empty.
 *
 * The prompt token length is not cheaply known where this list is built (the
 * pipeline tokenizes `messages` internally), so per batch item we self-calibrate
 * on the first `_call`: the sequence length seen on the first invocation is
 * recorded as the prompt boundary, and only tokens at or after that boundary are
 * decoded and matched on subsequent steps.
 */
function buildStopStringCriteria(
  transformers: Pick<TransformersModule, "StoppingCriteria" | "StoppingCriteriaList">,
  tokenizer: DecodingTokenizer,
  stopSequences: string[],
): StoppingCriteriaListInstance {
  const list = new transformers.StoppingCriteriaList();
  const base = new transformers.StoppingCriteria();
  const criterion = base as StoppingCriteriaInstance;
  // Per-batch-item prompt token length, captured on the first invocation.
  const promptLengths: number[] = [];
  criterion._call = (inputIds: number[][]): boolean[] =>
    inputIds.map((ids, item) => {
      if (promptLengths[item] === undefined) {
        // First step for this item: everything seen so far is prompt. Record the
        // boundary and never trip on the prompt itself.
        promptLengths[item] = ids.length;
        return false;
      }
      const generated = ids.slice(promptLengths[item]);
      if (generated.length === 0) return false;
      const text = tokenizer.decode(generated);
      return stopSequences.some((stop) => stop.length > 0 && text.includes(stop));
    });
  list.push(criterion);
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
  tokenizer: DecodingTokenizer,
  streamer: unknown,
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

  if (stopSequences && stopSequences.length > 0) {
    pipeOptions.stopping_criteria = buildStopStringCriteria(
      transformers,
      tokenizer,
      stopSequences,
    );
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
  mod.env.cacheDir = "./.cache/models";
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
 * failure patterns. These substrings are heuristic — ONNX Runtime does not
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
      // Convert ONNX / native-addon errors to no_ai_available so they propagate
      // correctly through the chat handler (503) instead of being swallowed as
      // in-band SSE errors inside a 200 response stream.
      const msg = error instanceof Error ? error.message : String(error);
      if (isOnnxUnavailableError(msg)) {
        transformersModule = null;
        throw toError(
          createError({
            type: "no_ai_available",
            message:
              "Local AI model unavailable. Native ONNX Runtime is not supported in this environment " +
              "(e.g. compiled binaries). Run veryfront login, set VERYFRONT_API_TOKEN, or " +
              "configure OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY to use a cloud provider.",
          }),
        );
      }
      throw error;
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
      const msg = error instanceof Error ? error.message : String(error);
      if (isOnnxUnavailableError(msg)) {
        transformersModule = null;
        throw toError(
          createError({
            type: "no_ai_available",
            message:
              "Local AI model unavailable. Native ONNX Runtime is not supported in this environment " +
              "(e.g. compiled binaries). Run veryfront login, set VERYFRONT_API_TOKEN, or " +
              "configure OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY to use a cloud provider.",
          }),
        );
      }
      throw error;
    }
  },
);

function getModelCacheKey(modelInfo: ModelInfo, device: LocalAIDevice): string {
  return `${modelInfo.hfId}:${device}`;
}

async function loadLocalRuntime(modelInfo: ModelInfo): Promise<unknown> {
  const device = await getLocalInferenceDevice();
  const loadInfo: LocalModelLoadInfo = { ...modelInfo, device };
  const cacheKey = getModelCacheKey(modelInfo, device);
  return modelInfo.engine === "conditional-generation"
    ? conditionalGenerationRuntimes.load(cacheKey, loadInfo)
    : textGenerationPipelines.load(cacheKey, loadInfo);
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
  tokenizer: DecodingTokenizer,
  streamer: unknown,
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

  if (stopSequences && stopSequences.length > 0) {
    generateOptions.stopping_criteria = buildStopStringCriteria(
      transformers,
      tokenizer,
      stopSequences,
    );
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
  const runtime = await loadLocalRuntime(modelInfo) as ConditionalGenerationRuntime;
  const transformers = await getTransformers();
  const inputs = await prepareConditionalInputs(runtime, modelInfo, messages);

  const tokenQueue: string[] = [];
  let resolveWaiting: (() => void) | null = null;
  let done = false;

  function flushWaiting(): void {
    if (resolveWaiting) {
      resolveWaiting();
      resolveWaiting = null;
    }
  }

  const streamer = new transformers.TextStreamer(runtime.processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      tokenQueue.push(text);
      flushWaiting();
    },
  });

  const generatePromise = (async () => {
    try {
      await runtime.model.generate({
        ...inputs,
        ...buildConditionalGenerateOptions(
          options,
          transformers,
          runtime.processor.tokenizer as DecodingTokenizer,
          streamer,
        ),
      });
    } finally {
      done = true;
      flushWaiting();
    }
  })();

  while (true) {
    while (tokenQueue.length > 0) {
      yield tokenQueue.shift()!;
    }

    if (done) break;

    await new Promise<void>((resolve) => {
      resolveWaiting = resolve;
    });
  }

  await generatePromise;
}

/**
 * Load a text-generation pipeline for the given model.
 * Returns a cached pipeline if already loaded.
 */
async function loadPipeline(modelInfo: ModelInfo): Promise<TextGenerationPipeline> {
  return await loadLocalRuntime(modelInfo) as TextGenerationPipeline;
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
  const modelInfo = resolveLocalModel(modelId || DEFAULT_LOCAL_MODEL);
  await loadLocalRuntime(modelInfo);
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
): AsyncGenerator<string, void, undefined> {
  const modelInfo = resolveLocalModel(modelId);
  if (modelInfo.engine === "conditional-generation") {
    yield* generateConditionalStream(modelInfo, messages, options);
    return;
  }

  const pipe = await loadPipeline(modelInfo);
  const transformers = await getTransformers();

  // Use a queue to bridge TextStreamer callbacks to an async generator.
  const tokenQueue: string[] = [];
  let resolveWaiting: (() => void) | null = null;
  let done = false;

  function flushWaiting(): void {
    if (resolveWaiting) {
      resolveWaiting();
      resolveWaiting = null;
    }
  }

  const streamer = new transformers.TextStreamer(pipe.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      tokenQueue.push(text);
      flushWaiting();
    },
  });

  const pipeOptions = buildPipeOptions(
    options,
    transformers,
    pipe.tokenizer as DecodingTokenizer,
    streamer,
  );

  // Start generation in the background
  const generatePromise = (async () => {
    try {
      await pipe(messages, pipeOptions);
    } finally {
      done = true;
      flushWaiting();
    }
  })();

  // Yield tokens as they arrive
  while (true) {
    while (tokenQueue.length > 0) {
      yield tokenQueue.shift()!;
    }

    if (done) break;

    // Wait for more tokens
    await new Promise<void>((resolve) => {
      resolveWaiting = resolve;
    });
  }

  // Ensure generation has completed
  await generatePromise;
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
