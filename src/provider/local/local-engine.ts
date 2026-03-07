/**
 * Local Model Engine
 *
 * Singleton wrapper around `@huggingface/transformers` for server-side
 * local LLM inference. Provides lazy model loading and streaming text
 * generation via async generators.
 *
 * Uses ONNX Runtime for inference with q4 quantization — NOT q4f16
 * due to a known ONNX bug with f16 LayerNorm on CPU.
 *
 * @module provider/local
 */

import { serverLogger } from "#veryfront/utils";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { importTransformers } from "#veryfront/compat/opaque-deps.ts";
import { DEFAULT_LOCAL_MODEL, type ModelInfo, resolveLocalModel } from "./model-catalog.ts";
import { isLocalAIDisabled } from "./env.ts";

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

interface TransformersModule {
  env: TransformersEnv;
  pipeline: (
    task: string,
    model: string,
    options: { dtype: string; device: string },
  ) => Promise<unknown>;
  TextStreamer: new (
    tokenizer: unknown,
    options: {
      skip_prompt: boolean;
      skip_special_tokens: boolean;
      callback_function: (text: string) => void;
    },
  ) => unknown;
}

interface Pipeline {
  tokenizer: unknown;
  (
    messages: ChatMessage[],
    options: {
      max_new_tokens: number;
      temperature: number;
      top_p?: number;
      top_k?: number;
      do_sample: boolean;
      streamer: unknown;
    },
  ): Promise<void>;
}

/** Cached pipeline instances keyed by HuggingFace model ID */
const pipelineCache = new Map<string, Pipeline>();

/** Whether a model is currently being loaded (prevents concurrent loads) */
const loadingLocks = new Map<string, Promise<Pipeline>>();

let transformersModule: TransformersModule | null = null;

/**
 * Lazily import @huggingface/transformers.
 * Only loads when actually needed, keeping startup fast when API keys are present.
 */
export async function getTransformers(): Promise<TransformersModule> {
  if (transformersModule) return transformersModule;

  if (isLocalAIDisabled()) {
    throw toError(
      createError({
        type: "no_ai_available",
        message: "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.",
      }),
    );
  }

  logger.info("Loading @huggingface/transformers...");

  let mod: TransformersModule;
  try {
    mod = await importTransformers();
  } catch (_) {
    // expected: ONNX runtime not available in some environments (e.g. compiled binaries)
    throw toError(
      createError({
        type: "no_ai_available",
        message:
          "Local AI model unavailable — native ONNX Runtime is not supported in this environment " +
          "(e.g. compiled binaries). Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY " +
          "in your .env file to use a cloud provider instead.",
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

/**
 * Load a text-generation pipeline for the given model.
 * Returns a cached pipeline if already loaded.
 */
async function loadPipeline(modelInfo: ModelInfo): Promise<Pipeline> {
  const cacheKey = modelInfo.hfId;

  // Return cached pipeline
  const cached = pipelineCache.get(cacheKey);
  if (cached) return cached;

  // Wait for existing load if in progress
  const existingLock = loadingLocks.get(cacheKey);
  if (existingLock) return existingLock;

  // Start loading
  const loadPromise = (async () => {
    const transformers = await getTransformers();

    logger.info(
      `Loading local model: ${modelInfo.hfId} (${modelInfo.dtype}, ~${modelInfo.sizeMB}MB)...`,
    );

    const pipe = (await transformers.pipeline(
      "text-generation",
      modelInfo.hfId,
      {
        dtype: modelInfo.dtype,
        device: "cpu",
      },
    )) as Pipeline;

    logger.info(`Model loaded: ${modelInfo.hfId}`);
    pipelineCache.set(cacheKey, pipe);
    loadingLocks.delete(cacheKey);
    return pipe;
  })();

  loadingLocks.set(cacheKey, loadPromise);

  try {
    return await loadPromise;
  } catch (error) {
    loadingLocks.delete(cacheKey);

    // Convert ONNX / native-addon errors to no_ai_available so they propagate
    // correctly through the chat handler (503) instead of being swallowed as
    // in-band SSE errors inside a 200 response stream.
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg.includes("onnx") || msg.includes("ONNX") ||
      msg.includes("dlopen") || msg.includes("dynamic linking") ||
      msg.includes("native module") || msg.includes("SharedArrayBuffer")
    ) {
      transformersModule = null;
      throw toError(
        createError({
          type: "no_ai_available",
          message:
            "Local AI model unavailable — native ONNX Runtime is not supported in this environment " +
            "(e.g. compiled binaries). Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY " +
            "in your .env file to use a cloud provider instead.",
        }),
      );
    }
    throw error;
  }
}

/**
 * Eagerly verify that the local AI runtime (@huggingface/transformers + ONNX)
 * is available by loading the default model pipeline.
 *
 * Call this *before* creating the HTTP response stream so that failures surface
 * as a thrown error (→ 503) rather than being swallowed inside a ReadableStream
 * (→ 200 with in-band SSE error).
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
  await loadPipeline(modelInfo);
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
  const pipe = await loadPipeline(modelInfo);
  const transformers = await getTransformers();

  const {
    maxNewTokens = DEFAULT_MAX_NEW_TOKENS,
    temperature = 0.7,
    topP,
    topK,
  } = options;

  // Use a queue to bridge TextStreamer callbacks → async generator
  const tokenQueue: string[] = [];
  let resolveWaiting: (() => void) | null = null;
  let done = false;

  const streamer = new transformers.TextStreamer(pipe.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      tokenQueue.push(text);
      if (resolveWaiting) {
        resolveWaiting();
        resolveWaiting = null;
      }
    },
  });

  // Start generation in the background
  const generatePromise = pipe(messages, {
    max_new_tokens: maxNewTokens,
    temperature,
    top_p: topP,
    top_k: topK,
    do_sample: temperature > 0,
    streamer,
  }).then(() => {
    done = true;
    if (resolveWaiting) {
      resolveWaiting();
      resolveWaiting = null;
    }
  }).catch((error: Error) => {
    done = true;
    if (resolveWaiting) {
      resolveWaiting();
      resolveWaiting = null;
    }
    throw error;
  });

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
  await loadPipeline(modelInfo);
}

/**
 * Check if a model is currently loaded in memory.
 */
export function isModelLoaded(modelId: string): boolean {
  const modelInfo = resolveLocalModel(modelId);
  return pipelineCache.has(modelInfo.hfId);
}
