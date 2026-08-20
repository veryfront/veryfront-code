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
import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getMistralEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { tryGetRegistryScopeId } from "#veryfront/cache/cache-key-builder.ts";
import { DEFAULT_GOOGLE_BASE_URL } from "#veryfront/provider/runtime-loader/provider-endpoints.ts";
import { createOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { createLocalModel } from "./local/model-runtime-adapter.ts";
import { createVeryfrontCloudModel } from "./veryfront-cloud/provider.ts";
import type { ModelRuntime } from "./types.ts";

/** Public API contract for model provider factory. */
export type ModelProviderFactory = (modelId: string) => ModelRuntime;
export type ModelProviderRegistrationDisposer = () => void;

const manager = new ProjectScopedRegistryManager<ModelProviderFactory>(
  "model-provider",
);
const bootstrapProviders = new Map<string, ModelProviderFactory>();
let autoInitialized = false;

function normalizeProviderName(name: string): string {
  if (typeof name !== "string") {
    throw new TypeError("Model provider name must be a non-empty string without slashes");
  }

  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.includes("/")) {
    throw new TypeError("Model provider name must be a non-empty string without slashes");
  }
  return normalizedName;
}

function requireModelRuntime(value: unknown, modelString: string): ModelRuntime {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    throw new TypeError(
      `Model provider for "${modelString}" returned an invalid runtime: expected an object`,
    );
  }

  let doGenerate: unknown;
  let doStream: unknown;
  try {
    doGenerate = Reflect.get(value, "doGenerate");
    doStream = Reflect.get(value, "doStream");
  } catch (cause) {
    throw new TypeError(
      `Model provider for "${modelString}" returned an unreadable runtime`,
      { cause },
    );
  }

  if (typeof doGenerate !== "function" || typeof doStream !== "function") {
    throw new TypeError(
      `Model provider for "${modelString}" returned an invalid runtime: ` +
        "doGenerate and doStream must be functions",
    );
  }

  return value as ModelRuntime;
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
 * Register a custom model provider factory for the active project scope or
 * application bootstrap.
 *
 * Registration inside a project source context is isolated to that context.
 * Registration during application bootstrap, outside a project context, is a
 * default visible to every project unless the project registers an override.
 *
 * @example
 * ```ts
 * const unregister = registerModelProvider(
 *   "custom",
 *   (id) => createCustomRuntime(id),
 * );
 *
 * // Call during teardown when the registration is no longer needed.
 * unregister();
 * ```
 */
export function registerModelProvider(
  name: string,
  factory: ModelProviderFactory,
): ModelProviderRegistrationDisposer {
  const normalizedName = normalizeProviderName(name);
  if (typeof factory !== "function") {
    throw new TypeError("Model provider factory must be a function");
  }

  const ownedFactory: ModelProviderFactory = (modelId) => factory(modelId);
  if (tryGetRegistryScopeId() !== null) {
    return manager.registerOwned(normalizedName, ownedFactory);
  }

  bootstrapProviders.set(normalizedName, ownedFactory);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (bootstrapProviders.get(normalizedName) === ownedFactory) {
      bootstrapProviders.delete(normalizedName);
    }
  };
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
        fetch: createOriginBoundOutboundFetch(
          config.baseURL ?? "https://api.openai.com/v1",
        ),
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
        fetch: createOriginBoundOutboundFetch(
          config.baseURL ?? "https://api.anthropic.com/v1",
        ),
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
        baseURL: config.baseURL,
        // The outbound fetch is origin-bound, so it has to track the same base
        // URL the request builders use. Pinning it to the default would reject
        // every request to a custom endpoint.
        fetch: createOriginBoundOutboundFetch(config.baseURL ?? DEFAULT_GOOGLE_BASE_URL),
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
        fetch: createOriginBoundOutboundFetch(
          config.baseURL ?? "https://api.mistral.ai/v1",
        ),
        name: "mistral",
        providerName: "mistral",
      });
    }
    throw toError(createError({
      type: "config",
      message:
        "OpenAI-compatible provider not installed. Add @veryfront/ext-llm-openai to use mistral/* models " +
        "(Mistral uses the OpenAI-compatible wire format and is routed through the openai extension).",
    }));
  });

  // The local provider is always available and needs no API key.
  // createLocalModel is a lightweight synchronous constructor — the actual
  // @huggingface/transformers import and model loading happen lazily on the
  // first prepare/doGenerate/doStream call, so this adds no startup overhead.
  manager.registerShared("local", (id) => {
    return createLocalModel(id);
  });

  manager.registerShared("veryfront-cloud", (id) => {
    return createVeryfrontCloudModel(id);
  });
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
  if (typeof modelString !== "string") {
    throw new TypeError('Model must be a string in "provider/model" format');
  }

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

  if (
    !providerName ||
    !modelId ||
    providerName !== providerName.trim() ||
    modelId !== modelId.trim()
  ) {
    throw toError(
      createError({
        type: "config",
        message:
          `Invalid model string: "${modelString}". Both provider and model name are required.`,
      }),
    );
  }

  autoInitializeFromEnv();
  const factory = manager.getOwn(providerName) ??
    bootstrapProviders.get(providerName) ??
    manager.get(providerName);
  if (!factory) {
    const available = getRegisteredModelProviders().join(", ") || "none";
    throw toError(
      createError({
        type: "agent",
        message:
          `Model provider "${providerName}" not registered. Register it during application ` +
          `composition with registerModelProvider() before resolving models. Available: ${available}`,
      }),
    );
  }

  return requireModelRuntime(factory(modelId), modelString);
}

/**
 * Check whether a model provider is available in the current scope.
 *
 * Project overrides, application bootstrap defaults, and framework-provided
 * shared providers are all considered.
 */
export function hasModelProvider(name: string): boolean {
  const normalizedName = normalizeProviderName(name);
  autoInitializeFromEnv();
  return manager.getOwn(normalizedName) !== undefined ||
    bootstrapProviders.has(normalizedName) ||
    manager.has(normalizedName);
}

/**
 * Get provider names available in the current scope.
 *
 * The result includes project overrides, application bootstrap defaults, and
 * framework-provided shared providers without duplicates.
 */
export function getRegisteredModelProviders(): string[] {
  autoInitializeFromEnv();
  return Array.from(new Set([...manager.getAllIds(), ...bootstrapProviders.keys()]));
}

/**
 * Eagerly verify that the resolved model's runtime is available.
 *
 * Provider runtimes can expose an idempotent `prepare()` hook to perform work
 * that must fail before an HTTP response stream is created. Runtimes without a
 * preparation phase require no action.
 */
export async function ensureModelReady(
  model: ModelRuntime,
  abortSignal?: AbortSignal,
): Promise<void> {
  const prepare = model.prepare;
  if (prepare === undefined) return;
  if (typeof prepare !== "function") {
    throw new TypeError("Model runtime prepare hook must be a function");
  }
  await prepare.call(model, abortSignal);
}

/** Clear all registered model providers and reset lazy built-ins (for testing). */
export function clearModelProviders(): void {
  manager.clearAll();
  bootstrapProviders.clear();
  autoInitialized = false;
}
