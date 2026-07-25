import { createError, toError } from "#veryfront/errors";
import { getGoogleGenAIEnvConfig, getOpenAIEnvConfig } from "#veryfront/config/env.ts";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { createLocalEmbeddingModel } from "#veryfront/provider/local/embedding-runtime-adapter.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { tryGetRegistryScopeId } from "#veryfront/cache/cache-key-builder.ts";
import { createVeryfrontCloudEmbeddingModel } from "./veryfront-cloud/provider.ts";

type EmbeddingProviderFactory = (modelId: string) => EmbeddingRuntime;

const providers = new ProjectScopedRegistryManager<EmbeddingProviderFactory>(
  "embedding-provider",
);
const bootstrapProviders = new Map<string, EmbeddingProviderFactory>();
let autoInitialized = false;

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
): void {
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
  if (typeof factory !== "function") {
    throw new TypeError("Embedding provider factory must be a function");
  }
  if (tryGetRegistryScopeId() === null) {
    bootstrapProviders.set(normalizedName, factory);
  } else {
    providers.register(normalizedName, factory);
  }
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

  providers.registerShared("local", createLocalEmbeddingModel);

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
        message: `Embedding provider "${providerName}" not registered. Available: ${available}`,
      }),
    );
  }

  return factory(modelId);
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
