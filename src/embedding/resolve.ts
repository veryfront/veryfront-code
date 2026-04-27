import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { getGoogleGenAIEnvConfig, getOpenAIEnvConfig } from "#veryfront/config/env.ts";
import { createLocalEmbeddingModel } from "#veryfront/provider/local/embedding-runtime-adapter.ts";
import { createGoogleEmbeddingRuntime } from "../../extensions/ext-google/src/google-provider.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { createVeryfrontCloudEmbeddingModel } from "./veryfront-cloud/provider.ts";

type EmbeddingProviderFactory = (modelId: string) => EmbeddingRuntime;

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
  providers.set(name, factory);
}

function autoInitializeFromEnv(): void {
  if (autoInitialized) return;
  autoInitialized = true;

  if (!providers.has("openai")) {
    providers.set("openai", (_id) => {
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
      throw toError(
        createError({
          type: "config",
          message:
            "OpenAI provider not installed. Add @veryfront/ext-openai to use openai/* embedding models.",
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
      return createGoogleEmbeddingRuntime({ apiKey: config.apiKey }, id);
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

  const factory = providers.get(providerName);
  if (!factory) {
    const available = [...providers.keys()].join(", ") || "none";
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
 * Clear all registered embedding providers (for testing).
 */
export function clearEmbeddingProviders(): void {
  providers.clear();
  autoInitialized = false;
}
