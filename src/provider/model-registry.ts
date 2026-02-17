/**
 * Model Registry - AI SDK Provider Adapter Layer
 *
 * Maps "provider/model" strings to AI SDK LanguageModel instances.
 * Thin abstraction that delegates to AI SDK provider packages
 * while maintaining control over the API surface.
 *
 * Project-scoped: each project gets its own provider namespace.
 * Auto-initialized providers from env vars are shared across all projects
 * but resolve credentials lazily per-request via AsyncLocalStorage so each
 * project uses its own API keys.
 *
 * @module
 */

import type { LanguageModel } from "ai";
import { createError, fromError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import { ProjectScopedRegistryManager } from "../ai/registry-manager.ts";
import { serverLogger } from "#veryfront/utils";
import { DEFAULT_LOCAL_MODEL } from "./local/model-catalog.ts";
import { createLocalModel } from "./local/ai-sdk-adapter.ts";
import { isLocalAIDisabled } from "./local/env.ts";
import { verifyLocalRuntime } from "./local/local-engine.ts";

const localLogger = serverLogger.component("local-llm");

export type ModelProviderFactory = (modelId: string) => LanguageModel;

const manager = new ProjectScopedRegistryManager<ModelProviderFactory>(
  "model-provider",
);
let autoInitialized = false;

/**
 * Register an AI SDK model provider factory for the current project.
 *
 * @example
 * ```ts
 * import { createOpenAI } from "@ai-sdk/openai";
 * registerModelProvider("openai", (id) => createOpenAI({ apiKey })(id));
 * ```
 */
export function registerModelProvider(
  name: string,
  factory: ModelProviderFactory,
): void {
  manager.register(name, factory);
}

/**
 * Auto-initialize model providers from environment variables.
 *
 * Factories are registered as shared (available to all projects) but read
 * env vars lazily at call time via getEnv() / AsyncLocalStorage so each
 * request resolves the **current project's** API key — not whichever key
 * happened to be active when the factory was first created.
 *
 * Called once; subsequent calls are no-ops.
 */
function autoInitializeFromEnv(): void {
  if (autoInitialized) return;
  autoInitialized = true;

  // Register lazy factories that resolve credentials per-request.
  // createOpenAI/createAnthropic/createGoogleGenerativeAI are lightweight
  // constructors (no network calls), so instantiating per-resolution is fine.

  if (!manager.has("openai")) {
    manager.registerShared("openai", (id) => {
      const config = getOpenAIEnvConfig();
      if (!config.apiKey) {
        throw toError(
          createError({
            type: "config",
            message:
              "OPENAI_API_KEY not set. Set the environment variable or register a custom provider with registerModelProvider().",
          }),
        );
      }
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })(
        id,
      );
    });
  }

  if (!manager.has("anthropic")) {
    manager.registerShared("anthropic", (id) => {
      const config = getAnthropicEnvConfig();
      if (!config.apiKey) {
        throw toError(
          createError({
            type: "config",
            message:
              "ANTHROPIC_API_KEY not set. Set the environment variable or register a custom provider with registerModelProvider().",
          }),
        );
      }
      return createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      })(id);
    });
  }

  if (!manager.has("google")) {
    manager.registerShared("google", (id) => {
      const config = getGoogleGenAIEnvConfig();
      if (!config.apiKey) {
        throw toError(
          createError({
            type: "config",
            message:
              "GOOGLE_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) not set. Set the environment variable or register a custom provider with registerModelProvider().",
          }),
        );
      }
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(id);
    });
  }

  // Register the local provider (always available, no API key needed).
  // createLocalModel is a lightweight synchronous constructor — the actual
  // @huggingface/transformers import and model loading happen lazily on
  // the first doGenerate/doStream call, so this doesn't add startup overhead.
  if (!manager.has("local")) {
    manager.registerShared("local", (id) => {
      return createLocalModel(id);
    });
  }
}

/**
 * Resolve a "provider/model" string to an AI SDK LanguageModel instance.
 *
 * Auto-initializes providers from environment on first call.
 *
 * @example
 * ```ts
 * const model = resolveModel("openai/gpt-4o");
 * ```
 */
export function resolveModel(modelString: string): LanguageModel {
  autoInitializeFromEnv();

  const slashIndex = modelString.indexOf("/");
  if (slashIndex === -1) {
    throw toError(
      createError({
        type: "config",
        message:
          `Invalid model string: "${modelString}". Expected "provider/model" (e.g. "openai/gpt-4o").`,
      }),
    );
  }

  const providerName = modelString.slice(0, slashIndex);
  const modelId = modelString.slice(slashIndex + 1);

  if (!providerName || !modelId) {
    throw toError(
      createError({
        type: "config",
        message:
          `Invalid model string: "${modelString}". Both provider and model name are required.`,
      }),
    );
  }

  const factory = manager.get(providerName);
  if (!factory) {
    const available = getRegisteredModelProviders().join(", ") || "none";
    throw toError(
      createError({
        type: "agent",
        message: `Model provider "${providerName}" not registered. Available: ${available}`,
      }),
    );
  }

  try {
    return factory(modelId);
  } catch (error) {
    // Auto-fallback: when a cloud provider fails due to missing API key,
    // transparently switch to the local model so chat works out of the box.
    const errorData = fromError(error);
    if (errorData?.type === "config" && providerName !== "local" && manager.has("local")) {
      // Check if local AI is explicitly disabled (e.g., for testing)
      if (isLocalAIDisabled()) {
        throw toError(
          createError({
            type: "no_ai_available",
            message: "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.",
          }),
        );
      }

      localLogger.info(
        `⚡ "${providerName}" unavailable (missing API key). Falling back to local model.`,
      );
      const localFactory = manager.get("local")!;
      return localFactory(DEFAULT_LOCAL_MODEL);
    }
    throw error;
  }
}

/**
 * Check if a model provider is registered (project-scoped or shared).
 */
export function hasModelProvider(name: string): boolean {
  autoInitializeFromEnv();
  return manager.has(name);
}

/**
 * Get list of registered model provider names (project-scoped + shared).
 */
export function getRegisteredModelProviders(): string[] {
  autoInitializeFromEnv();
  return manager.getAllIds();
}

/**
 * Eagerly verify that the resolved model's runtime is available.
 *
 * For real local-engine models (created by `createLocalModel()`) this
 * eagerly loads the ONNX pipeline to surface `no_ai_available` errors
 * **before** the HTTP response stream is created. Must happen before the
 * ReadableStream so the chat handler can return a proper 503 (with
 * browser-fallback info) rather than a 200 with an in-band SSE error.
 *
 * Uses the `_isVfLocalModel` marker set by `createLocalModel()` to
 * distinguish real local-engine models from mock/custom providers that
 * happen to use `provider: "local"`.
 */
export async function ensureModelReady(model: LanguageModel, _requestedModel: string): Promise<void> {
  const m = model as Record<string, unknown>;
  if (!m._isVfLocalModel) return;
  await verifyLocalRuntime();
}

/**
 * Clear all registered model providers (for testing).
 */
export function clearModelProviders(): void {
  manager.clearAll();
  autoInitialized = false;
}
