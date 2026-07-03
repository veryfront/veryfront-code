/**
 * Model Registry - Provider Adapter Layer
 *
 * Maps "provider/model" strings to framework-compatible model runtimes.
 * The current implementation delegates to provider adapters while maintaining
 * control over the public API surface.
 *
 * Project-scoped: each project gets its own provider namespace.
 * Auto-initialized providers from env vars are shared across all projects
 * but resolve credentials lazily per-request via AsyncLocalStorage so each
 * project uses its own API keys.
 *
 * @module
 */

import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getMistralEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { createLocalModel } from "./local/model-runtime-adapter.ts";
import { verifyLocalRuntime } from "./local/local-engine.ts";
import { createVeryfrontCloudModel } from "./veryfront-cloud/provider.ts";
import { getModelRuntimeId, hasLocalModelRuntimeMarker } from "./runtime-inspection.ts";
import type { ModelRuntime } from "./types.ts";

/** Public API contract for model provider factory. */
export type ModelProviderFactory = (modelId: string) => ModelRuntime;

const manager = new ProjectScopedRegistryManager<ModelProviderFactory>(
  "model-provider",
);
let autoInitialized = false;

/**
 * Register a custom model provider factory for the current project.
 *
 * @example
 * ```ts
 * registerModelProvider("custom", (id) => createCustomRuntime(id));
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
      const registry = ensureBuiltinLLMProviders();
      const provider = registry.get("openai");
      if (provider) {
        return provider.createModel(id, {
          credential: config.apiKey,
          baseURL: config.baseURL,
          providerName: "openai-compatible",
        });
      }
      throw toError(createError({
        type: "config",
        message:
          "OpenAI provider not installed. Add @veryfront/ext-llm-openai to use openai/* models.",
      }));
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
      const registry = ensureBuiltinLLMProviders();
      const provider = registry.get("anthropic");
      if (provider) {
        return provider.createModel(id, {
          credential: config.apiKey,
          baseURL: config.baseURL,
        });
      }
      throw toError(createError({
        type: "config",
        message:
          "Anthropic provider not installed. Add @veryfront/ext-llm-anthropic to use anthropic/* models.",
      }));
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
      const registry = ensureBuiltinLLMProviders();
      const provider = registry.get("google");
      if (provider) {
        return provider.createModel(id, {
          credential: config.apiKey,
        });
      }
      throw toError(
        createError({
          type: "config",
          message:
            "Google provider not installed. Add @veryfront/ext-llm-google to use google/* models.",
        }),
      );
    });
  }

  if (!manager.has("mistral")) {
    manager.registerShared("mistral", (id) => {
      const config = getMistralEnvConfig();
      if (!config.apiKey) {
        throw toError(
          createError({
            type: "config",
            message:
              "MISTRAL_API_KEY not set. Set the environment variable or register a custom provider with registerModelProvider().",
          }),
        );
      }
      const registry = ensureBuiltinLLMProviders();
      const provider = registry.get("openai");
      if (provider) {
        return provider.createModel(id, {
          credential: config.apiKey,
          baseURL: config.baseURL,
        });
      }
      throw toError(createError({
        type: "config",
        message:
          "OpenAI-compatible provider not installed. Add @veryfront/ext-llm-openai to use mistral/* models.",
      }));
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

  if (!manager.has("veryfront-cloud")) {
    manager.registerShared("veryfront-cloud", (id) => {
      return createVeryfrontCloudModel(id);
    });
  }
}

/**
 * Resolve a "provider/model" string to a framework-compatible model runtime.
 *
 * Auto-initializes providers from environment on first call.
 *
 * @example
 * ```ts
 * const model = resolveModel("openai/gpt-4o");
 * ```
 */
export function resolveModel(modelString: string): ModelRuntime {
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

  return factory(modelId);
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
 * ReadableStream so the chat handler can return a proper 503 rather than a
 * 200 with an in-band SSE error.
 *
 * Uses the `_isVfLocalModel` marker set by `createLocalModel()` to
 * distinguish real local-engine models from mock/custom providers that
 * happen to use `provider: "local"`.
 */
export async function ensureModelReady(
  model: ModelRuntime,
): Promise<void> {
  if (!hasLocalModelRuntimeMarker(model)) return;
  // modelId is "local/<id>" — strip the prefix to get the catalog id.
  const catalogId = getModelRuntimeId(model)?.replace(/^local\//, "");
  await verifyLocalRuntime(catalogId);
}

/**
 * Clear all registered model providers (for testing).
 */
export function clearModelProviders(): void {
  manager.clearAll();
  autoInitialized = false;
}
