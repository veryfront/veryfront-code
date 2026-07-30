import { createError, toError } from "#veryfront/errors";
import { getGoogleGenAIEnvConfig, getOpenAIEnvConfig } from "#veryfront/config/env.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { tryGetRegistryScopeId } from "#veryfront/cache/cache-key-builder.ts";
import { createVeryfrontCloudEmbeddingModel } from "./veryfront-cloud/provider.ts";

export type EmbeddingProviderFactory = (modelId: string) => EmbeddingRuntime;
export type EmbeddingProviderRegistrationDisposer = () => void;

const providers = new ProjectScopedRegistryManager<EmbeddingProviderFactory>(
  "embedding-provider",
);
const bootstrapProviders = new Map<string, EmbeddingProviderFactory>();
let autoInitialized = false;

function normalizeEmbeddingProviderName(name: string): string {
  if (typeof name !== "string") {
    throw new TypeError(
      "Embedding provider name must be a non-empty string without slashes",
    );
  }
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.includes("/")) {
    throw new TypeError(
      "Embedding provider name must be a non-empty string without slashes",
    );
  }
  return normalizedName;
}

/**
 * Register an embedding provider factory.
 *
 * Registrations made inside a project context are isolated to that project
 * source. Registrations made during process bootstrap, before a project
 * context exists, remain available as application-wide defaults.
 *
 * @example
 * ```ts
 * registerEmbeddingProvider("openai", (id) => createOpenAIEmbeddingRuntime({ apiKey }, id));
 * ```
 */
export function registerEmbeddingProvider(
  name: string,
  factory: EmbeddingProviderFactory,
): EmbeddingProviderRegistrationDisposer {
  const normalizedName = normalizeEmbeddingProviderName(name);
  if (typeof factory !== "function") {
    throw new TypeError("Embedding provider factory must be a function");
  }
  const ownedFactory: EmbeddingProviderFactory = (modelId) => factory(modelId);
  if (tryGetRegistryScopeId() !== null) {
    return providers.registerOwned(normalizedName, ownedFactory);
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

function autoInitializeFromEnv(): void {
  if (autoInitialized) return;
  autoInitialized = true;

  providers.registerShared("openai", (id) => {
    const config = getOpenAIEnvConfig();
    if (!config.apiKey) {
      throw toError(
        createError({
          type: "config",
          message:
            "OPENAI_API_KEY not set. Set the environment variable or register a custom provider with registerEmbeddingProvider().",
        }),
      );
    }
    const provider = ensureBuiltinLLMProviders().get("openai");
    if (provider?.createEmbedding) {
      return provider.createEmbedding(id, {
        credential: config.apiKey,
        baseURL: config.baseURL,
      });
    }
    throw toError(
      createError({
        type: "config",
        message:
          "OpenAI provider not installed. Add @veryfront/ext-llm-openai to use openai/* embedding models.",
      }),
    );
  });

  providers.registerShared("google", (id) => {
    const config = getGoogleGenAIEnvConfig();
    if (!config.apiKey) {
      throw toError(
        createError({
          type: "config",
          message:
            "GOOGLE_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) not set. Set the environment variable or register a custom provider with registerEmbeddingProvider().",
        }),
      );
    }
    const provider = ensureBuiltinLLMProviders().get("google");
    if (provider?.createEmbedding) {
      return provider.createEmbedding(id, {
        credential: config.apiKey,
      });
    }
    throw toError(
      createError({
        type: "config",
        message:
          "Google provider not installed. Add @veryfront/ext-llm-google to use google/* embedding models.",
      }),
    );
  });

  providers.registerShared("veryfront-cloud", createVeryfrontCloudEmbeddingModel);
}

/**
 * Resolve a "provider/model" string to an embedding runtime instance.
 *
 * @example
 * ```ts
 * const model = resolveEmbeddingModel("openai/text-embedding-3-small");
 * ```
 */
export function resolveEmbeddingModel(modelString: string): EmbeddingRuntime {
  if (typeof modelString !== "string") {
    throw new TypeError(
      'Embedding model must be a string in "provider/model" format',
    );
  }
  autoInitializeFromEnv();
  const slashIndex = modelString.indexOf("/");
  if (slashIndex === -1) {
    throw toError(
      createError({
        type: "config",
        message:
          `Invalid model string: "${modelString}". Expected "provider/model" (e.g. "openai/text-embedding-3-small").`,
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

  const factory = providers.getOwn(providerName) ??
    bootstrapProviders.get(providerName) ??
    providers.get(providerName);
  if (!factory) {
    const available = Array.from(
      new Set([...providers.getAllIds(), ...bootstrapProviders.keys()]),
    ).join(", ") || "none";
    throw toError(
      createError({
        type: "config",
        message:
          `Embedding provider "${providerName}" not registered. Register it during application ` +
          `composition with registerEmbeddingProvider() before resolving embeddings. Available: ${available}`,
      }),
    );
  }

  return factory(modelId);
}

/** Whether an embedding provider is available in the current scope. */
export function hasEmbeddingProvider(name: string): boolean {
  const normalizedName = normalizeEmbeddingProviderName(name);
  autoInitializeFromEnv();
  return providers.getOwn(normalizedName) !== undefined ||
    bootstrapProviders.has(normalizedName) ||
    providers.has(normalizedName);
}

/**
 * Clear embedding providers registered in the current project source scope.
 *
 * Outside a project context, clears application bootstrap registrations.
 * Framework-provided shared providers remain available.
 */
export function clearEmbeddingProviders(): void {
  providers.clear();
  if (tryGetRegistryScopeId() === null) bootstrapProviders.clear();
}
