/**
 * Provider Registry
 *
 * Project-scoped registry for AI providers. Each project can have its own
 * provider configuration with different API keys.
 *
 * @module
 */

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
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";

const providerManager = new ProjectScopedRegistryManager<Provider>("provider");
let defaultProviderName = "openai";

class ProviderRegistry {
  private registerProvider(
    name: string,
    createProvider: () => Provider,
    fromEnv = false,
  ): void {
    try {
      providerManager.register(name, createProvider());
      if (fromEnv) {
        agentLogger.debug(`Auto-initialized ${name} provider from environment`);
      }
    } catch (error) {
      const source = fromEnv ? "auto-initialize" : "initialize";
      agentLogger.warn(`Failed to ${source} ${name} provider:`, error);
    }
  }

  private registerProviderShared(
    name: string,
    createProvider: () => Provider,
  ): void {
    try {
      providerManager.registerShared(name, createProvider());
      agentLogger.debug(`Registered shared ${name} provider`);
    } catch (error) {
      agentLogger.warn(`Failed to register shared ${name} provider:`, error);
    }
  }

  private autoInitializeFromEnv(): void {
    const openaiEnv = getOpenAIEnvConfig();
    if (openaiEnv.apiKey && !providerManager.has("openai")) {
      const apiKey = openaiEnv.apiKey;
      this.registerProvider(
        "openai",
        () =>
          new OpenAIProvider({
            apiKey,
            baseURL: openaiEnv.baseURL,
            organizationId: openaiEnv.organizationId,
          }),
        true,
      );
    }

    const anthropicEnv = getAnthropicEnvConfig();
    if (anthropicEnv.apiKey && !providerManager.has("anthropic")) {
      const apiKey = anthropicEnv.apiKey;
      this.registerProvider(
        "anthropic",
        () =>
          new AnthropicProvider({
            apiKey,
            baseURL: anthropicEnv.baseURL,
          }),
        true,
      );
    }

    const googleEnv = getGoogleGenAIEnvConfig();
    if (googleEnv.apiKey && !providerManager.has("google")) {
      const apiKey = googleEnv.apiKey;
      this.registerProvider(
        "google",
        () => new GoogleProvider({ apiKey }),
        true,
      );
    }
  }

  initialize(config: ProvidersConfig): void {
    if (config.default) defaultProviderName = config.default;

    if (config.openai) {
      const openaiConfig = config.openai;
      this.registerProvider("openai", () => new OpenAIProvider(openaiConfig));
    }

    if (config.anthropic) {
      const anthropicConfig = config.anthropic;
      this.registerProvider(
        "anthropic",
        () => new AnthropicProvider(anthropicConfig),
      );
    }

    if (config.google) {
      const googleConfig = config.google;
      this.registerProvider("google", () => new GoogleProvider(googleConfig));
    }
  }

  /**
   * Initialize shared providers from environment variables.
   * These will be available to all projects as fallback.
   */
  initializeSharedFromEnv(): void {
    const openaiEnv = getOpenAIEnvConfig();
    if (openaiEnv.apiKey) {
      const apiKey = openaiEnv.apiKey;
      this.registerProviderShared(
        "openai",
        () =>
          new OpenAIProvider({
            apiKey,
            baseURL: openaiEnv.baseURL,
            organizationId: openaiEnv.organizationId,
          }),
      );
    }

    const anthropicEnv = getAnthropicEnvConfig();
    if (anthropicEnv.apiKey) {
      const apiKey = anthropicEnv.apiKey;
      this.registerProviderShared(
        "anthropic",
        () =>
          new AnthropicProvider({
            apiKey,
            baseURL: anthropicEnv.baseURL,
          }),
      );
    }

    const googleEnv = getGoogleGenAIEnvConfig();
    if (googleEnv.apiKey) {
      const apiKey = googleEnv.apiKey;
      this.registerProviderShared(
        "google",
        () => new GoogleProvider({ apiKey }),
      );
    }
  }

  getProvider(name: string): Provider {
    this.autoInitializeFromEnv();

    const provider = providerManager.get(name);
    if (provider) return provider;

    throw toError(
      createError({
        type: "agent",
        message: `Provider "${name}" not found. Available providers: ${
          providerManager
            .getAllIds()
            .join(", ")
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
    return this.getProvider(defaultProviderName);
  }

  hasProvider(name: string): boolean {
    this.autoInitializeFromEnv();
    return providerManager.has(name);
  }

  getAvailableProviders(): string[] {
    this.autoInitializeFromEnv();
    return providerManager.getAllIds();
  }

  clear(): void {
    providerManager.clear();
  }

  /**
   * Clear everything (for testing).
   */
  clearAll(): void {
    providerManager.clearAll();
  }

  getStats(): ReturnType<typeof providerManager.getStats> {
    return providerManager.getStats();
  }
}

export const providerRegistry = new ProviderRegistry();

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
