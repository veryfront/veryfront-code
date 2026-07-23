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

import { createError, toError } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
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

const MAX_PROVIDER_NAME_LENGTH = 128;
const MAX_MODEL_STRING_LENGTH = 4_096;

const manager = new ProjectScopedRegistryManager<ModelProviderFactory>(
  "model-provider",
);
let autoInitialized = false;

function throwConfigError(message: string): never {
  throw toError(createError({ type: "config", message }));
}

function hasControlOrWhitespace(value: string): boolean {
  return /\s/u.test(value) || hasUnsafeControlCharacters(value);
}

function assertProviderName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" || name.length === 0 || name.length > MAX_PROVIDER_NAME_LENGTH ||
    hasControlOrWhitespace(name) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)
  ) {
    throwConfigError("Model provider name is invalid.");
  }
}

function assertProviderFactory(factory: unknown): asserts factory is ModelProviderFactory {
  if (typeof factory !== "function") {
    throwConfigError("Model provider factory must be a function.");
  }
}

function parseModelString(value: unknown): { providerName: string; modelId: string } {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_MODEL_STRING_LENGTH ||
    hasControlOrWhitespace(value)
  ) {
    throwConfigError('Model string must use the "provider/model" format.');
  }

  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    throwConfigError('Model string must use the "provider/model" format.');
  }
  const providerName = value.slice(0, slashIndex);
  const modelId = value.slice(slashIndex + 1);
  assertProviderName(providerName);
  if (modelId.length > MAX_MODEL_STRING_LENGTH - providerName.length - 1) {
    throwConfigError('Model string must use the "provider/model" format.');
  }

  return { providerName, modelId };
}

function assertModelRuntime(value: unknown): asserts value is ModelRuntime {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throwConfigError("Model provider returned an invalid runtime.");
  }

  let doGenerate: unknown;
  let doStream: unknown;
  try {
    doGenerate = Reflect.get(value, "doGenerate");
    doStream = Reflect.get(value, "doStream");
  } catch {
    throwConfigError("Model provider returned an unreadable runtime.");
  }
  if (typeof doGenerate !== "function" || typeof doStream !== "function") {
    throwConfigError("Model provider returned an invalid runtime.");
  }
}

function isOpenAIBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) return true;
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    return hostname === "api.openai.com" || hostname.endsWith(".api.openai.com");
  } catch {
    return false;
  }
}

function getOpenAIEnvProviderName(baseURL: string | undefined): "openai" | "openai-compatible" {
  return isOpenAIBaseURL(baseURL) ? "openai" : "openai-compatible";
}

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
  assertProviderName(name);
  assertProviderFactory(factory);
  manager.register(name, factory);
}

/**
 * Auto-initialize model providers from environment variables.
 *
 * Factories are registered as shared (available to all projects) but read
 * env vars lazily at call time via getEnv() / AsyncLocalStorage so each
 * request resolves the **current project's** API key - not whichever key
 * happened to be active when the factory was first created.
 *
 * Called once; subsequent calls are no-ops.
 */
function autoInitializeFromEnv(): void {
  if (autoInitialized) return;

  // Register lazy factories that resolve credentials per-request.
  // createOpenAI/createAnthropic/createGoogleGenerativeAI are lightweight
  // constructors (no network calls), so instantiating per-resolution is fine.

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
        providerName: getOpenAIEnvProviderName(config.baseURL),
      });
    }
    throw toError(createError({
      type: "config",
      message:
        "OpenAI provider not installed. Add @veryfront/ext-llm-openai to use openai/* models.",
    }));
  });

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
        "OpenAI-compatible provider not installed. Add @veryfront/ext-llm-openai to use mistral/* models " +
        "(Mistral uses the OpenAI-compatible wire format and is routed through the openai extension).",
    }));
  });

  // Register the local provider (always available, no API key needed).
  // createLocalModel is a lightweight synchronous constructor - the actual
  // @huggingface/transformers import and model loading happen lazily on
  // the first doGenerate/doStream call, so this doesn't add startup overhead.
  manager.registerShared("local", (id) => {
    return createLocalModel(id);
  });

  manager.registerShared("veryfront-cloud", (id) => {
    return createVeryfrontCloudModel(id);
  });
  autoInitialized = true;
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
  const { providerName, modelId } = parseModelString(modelString);

  const factory = manager.get(providerName);
  if (!factory) {
    throw toError(createError({ type: "agent", message: "Model provider is not registered." }));
  }

  const runtime = factory(modelId);
  assertModelRuntime(runtime);
  return runtime;
}

/**
 * Check if a model provider is registered (project-scoped or shared).
 */
export function hasModelProvider(name: string): boolean {
  autoInitializeFromEnv();
  assertProviderName(name);
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
  const runtimeId = getModelRuntimeId(model);
  if (!runtimeId?.startsWith("local/") || runtimeId.length === "local/".length) {
    throwConfigError("Marked local model runtime has an invalid model ID.");
  }
  // modelId is "local/<id>" - strip the prefix to get the catalog id.
  const catalogId = runtimeId.slice("local/".length);
  await verifyLocalRuntime(catalogId);
}

/**
 * Clear all registered model providers (for testing).
 */
export function clearModelProviders(): void {
  manager.clearAll();
  autoInitialized = false;
}
