import type { Provider, ProvidersConfig } from "./types.ts";
import { OpenAIProvider } from "./openai.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GoogleProvider } from "./google.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";

class ProviderRegistry {
  private providers = new Map<string, Provider>();
  private config: ProvidersConfig = {};
  private autoInitialized = false;

  private registerProvider(
    name: string,
    createProvider: () => Provider,
    fromEnv = false,
  ): void {
    try {
      this.providers.set(name, createProvider());
      if (fromEnv) {
        agentLogger.debug(`Auto-initialized ${name} provider from environment`);
      }
    } catch (error) {
      const source = fromEnv ? "auto-initialize" : "initialize";
      agentLogger.warn(`Failed to ${source} ${name} provider:`, error);
    }
  }

  private autoInitializeFromEnv(): void {
    if (this.autoInitialized) return;
    this.autoInitialized = true;

    const openaiEnv = getOpenAIEnvConfig();
    const openaiApiKey = openaiEnv.apiKey;
    if (openaiApiKey && !this.providers.has("openai")) {
      this.registerProvider(
        "openai",
        () =>
          new OpenAIProvider({
            apiKey: openaiApiKey,
            baseURL: openaiEnv.baseURL,
            organizationId: openaiEnv.organizationId,
          }),
        true,
      );
    }

    const anthropicEnv = getAnthropicEnvConfig();
    const anthropicApiKey = anthropicEnv.apiKey;
    if (anthropicApiKey && !this.providers.has("anthropic")) {
      this.registerProvider(
        "anthropic",
        () =>
          new AnthropicProvider({
            apiKey: anthropicApiKey,
            baseURL: anthropicEnv.baseURL,
          }),
        true,
      );
    }

    const googleEnv = getGoogleGenAIEnvConfig();
    const googleApiKey = googleEnv.apiKey;
    if (googleApiKey && !this.providers.has("google")) {
      this.registerProvider(
        "google",
        () => new GoogleProvider({ apiKey: googleApiKey }),
        true,
      );
    }
  }

  initialize(config: ProvidersConfig): void {
    this.config = config;

    const openaiConfig = config.openai;
    if (openaiConfig) {
      this.registerProvider("openai", () => new OpenAIProvider(openaiConfig));
    }

    const anthropicConfig = config.anthropic;
    if (anthropicConfig) {
      this.registerProvider(
        "anthropic",
        () => new AnthropicProvider(anthropicConfig),
      );
    }

    const googleConfig = config.google;
    if (googleConfig) {
      this.registerProvider("google", () => new GoogleProvider(googleConfig));
    }
  }

  getProvider(name: string): Provider {
    this.autoInitializeFromEnv();

    const provider = this.providers.get(name);
    if (provider) return provider;

    throw toError(
      createError({
        type: "agent",
        message: `Provider "${name}" not found. Available providers: ${
          Array.from(
            this.providers.keys(),
          ).join(", ")
        }`,
      }),
    );
  }

  getProviderFromModel(modelString: string): { provider: Provider; model: string } {
    const parts = modelString.split("/");
    if (parts.length !== 2) {
      throw toError(
        createError({
          type: "config",
          message:
            `Invalid model string format: "${modelString}". Expected format: "provider/model-name" (e.g., "openai/gpt-4")`,
        }),
      );
    }

    const [providerName, modelName] = parts;

    if (!providerName || !modelName) {
      throw toError(
        createError({
          type: "config",
          message:
            `Invalid model string format: "${modelString}". Both provider and model name are required.`,
        }),
      );
    }

    return { provider: this.getProvider(providerName), model: modelName };
  }

  getDefaultProvider(): Provider {
    return this.getProvider(this.config.default ?? "openai");
  }

  hasProvider(name: string): boolean {
    this.autoInitializeFromEnv();
    return this.providers.has(name);
  }

  getAvailableProviders(): string[] {
    this.autoInitializeFromEnv();
    return Array.from(this.providers.keys());
  }

  clear(): void {
    this.providers.clear();
    this.config = {};
  }
}

const PROVIDER_REGISTRY_KEY = "__veryfront_provider_registry__";
// deno-lint-ignore no-explicit-any
const _globalProvider = globalThis as any;

export const providerRegistry: ProviderRegistry = _globalProvider[PROVIDER_REGISTRY_KEY] ||=
  new ProviderRegistry();

export function initializeProviders(config: ProvidersConfig): void {
  providerRegistry.initialize(config);
}

export function getProvider(name: string): Provider {
  return providerRegistry.getProvider(name);
}

export function getProviderFromModel(modelString: string): {
  provider: Provider;
  model: string;
} {
  return providerRegistry.getProviderFromModel(modelString);
}
