import { createError, toError } from "#veryfront/errors";
import { getGoogleGenAIEnvConfig, getOpenAIEnvConfig } from "#veryfront/config/env.ts";
import { createLocalEmbeddingModel } from "#veryfront/provider/local/embedding-runtime-adapter.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { LLMProviderRegistry } from "#veryfront/extensions/llm/index.ts";
import { LLMProviderRegistryName } from "#veryfront/extensions/llm/index.ts";
import { createVeryfrontCloudEmbeddingModel } from "./veryfront-cloud/provider.ts";
import { CONFIG_INVALID, INVALID_ARGUMENT } from "#veryfront/errors";
import { MAX_IDENTIFIER_LENGTH } from "./validation.ts";

/** Factory used to construct an embedding runtime for a provider model ID. */
export type EmbeddingProviderFactory = (modelId: string) => EmbeddingRuntime;

const providers = new Map<string, EmbeddingProviderFactory>();
let autoInitialized = false;

/**
 * Register an embedding provider factory.
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
  if (typeof name !== "string" || !name.trim()) {
    throw INVALID_ARGUMENT.create({ detail: "Embedding provider name must not be empty" });
  }
  if (name !== name.trim()) {
    throw INVALID_ARGUMENT.create({
      detail: "Embedding provider name must not contain surrounding whitespace",
    });
  }
  if (name.length > 64) {
    throw INVALID_ARGUMENT.create({
      detail: "Embedding provider name must not exceed 64 characters",
    });
  }
  if (name.includes("/")) {
    throw INVALID_ARGUMENT.create({ detail: "Embedding provider name must not contain '/'" });
  }
  if (/\p{C}/u.test(name)) {
    throw INVALID_ARGUMENT.create({
      detail: "Embedding provider name contains invalid characters",
    });
  }
  if (typeof factory !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Embedding provider factory must be a function" });
  }
  providers.set(name, factory);
}

function autoInitializeFromEnv(): void {
  if (autoInitialized) return;
  autoInitialized = true;

  if (!providers.has("openai")) {
    providers.set("openai", (id) => {
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
      const registry = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
      const provider = registry?.get("openai");
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
  }

  if (!providers.has("google")) {
    providers.set("google", (id) => {
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
      const registry = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
      const provider = registry?.get("google");
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
  }

  if (!providers.has("local")) {
    providers.set("local", createLocalEmbeddingModel);
  }

  if (!providers.has("veryfront-cloud")) {
    providers.set("veryfront-cloud", createVeryfrontCloudEmbeddingModel);
  }
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
  autoInitializeFromEnv();

  if (typeof modelString !== "string" || !modelString.trim()) {
    throw CONFIG_INVALID.create({ detail: "Embedding model identifier must not be empty" });
  }
  if (modelString.length > MAX_IDENTIFIER_LENGTH) {
    throw CONFIG_INVALID.create({
      detail: `Embedding model identifier exceeds ${MAX_IDENTIFIER_LENGTH} characters`,
    });
  }
  if (modelString !== modelString.trim() || /\p{C}/u.test(modelString)) {
    throw CONFIG_INVALID.create({ detail: "Embedding model identifier is malformed" });
  }

  const slashIndex = modelString.indexOf("/");
  if (slashIndex === -1) {
    throw CONFIG_INVALID.create({
      detail: 'Embedding model identifier must use "provider/model" format',
    });
  }

  const providerName = modelString.slice(0, slashIndex);
  const modelId = modelString.slice(slashIndex + 1);

  if (!providerName || !modelId) {
    throw CONFIG_INVALID.create({
      detail: "Embedding model identifier requires both provider and model names",
    });
  }

  const factory = providers.get(providerName);
  if (!factory) {
    throw toError(
      createError({
        type: "config",
        message: "The requested embedding provider is not registered.",
      }),
    );
  }

  const runtime = factory(modelId);
  if (
    typeof runtime !== "object" || runtime === null ||
    typeof runtime.doEmbed !== "function"
  ) {
    throw CONFIG_INVALID.create({
      detail: "Embedding provider returned an invalid runtime",
    });
  }
  return runtime;
}

/**
 * Clear all registered embedding providers (for testing).
 */
export function clearEmbeddingProviders(): void {
  providers.clear();
  autoInitialized = false;
}
