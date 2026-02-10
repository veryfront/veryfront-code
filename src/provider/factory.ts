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

interface ProviderConfigFactory {
  name: "openai" | "anthropic" | "google";
  fromConfig: (config: ProvidersConfig) => (() => Provider) | undefined;
  fromEnv: () => (() => Provider) | undefined;
}

const providerConfigFactories: ProviderConfigFactory[] = [
  {
    name: "openai",
    fromConfig(config) {
      const openaiConfig = config.openai;
      if (!openaiConfig) return undefined;
      return () => new OpenAIProvider(openaiConfig);
    },
    fromEnv() {
      if (!getOpenAIEnvConfig().apiKey) return undefined;
      return () => {
        const { apiKey, baseURL } = getOpenAIEnvConfig();
        return new OpenAIProvider({ apiKey: apiKey!, baseURL });
      };
    },
  },
  {
    name: "anthropic",
    fromConfig(config) {
      const anthropicConfig = config.anthropic;
      if (!anthropicConfig) return undefined;
      return () => new AnthropicProvider(anthropicConfig);
    },
    fromEnv() {
      if (!getAnthropicEnvConfig().apiKey) return undefined;
      return () => {
        const { apiKey, baseURL } = getAnthropicEnvConfig();
        return new AnthropicProvider({ apiKey: apiKey!, baseURL });
      };
    },
  },
  {
    name: "google",
    fromConfig(config) {
      const googleConfig = config.google;
      if (!googleConfig) return undefined;
      return () => new GoogleProvider(googleConfig);
    },
    fromEnv() {
      if (!getGoogleGenAIEnvConfig().apiKey) return undefined;
      return () => {
        const { apiKey } = getGoogleGenAIEnvConfig();
        return new GoogleProvider({ apiKey: apiKey! });
      };
    },
  },
];

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
    for (const factory of providerConfigFactories) {
      if (providerManager.has(factory.name)) continue;

      const createProvider = factory.fromEnv();
      if (createProvider) {
        this.registerProvider(factory.name, createProvider, true);
      }
    }
  }

  initialize(config: ProvidersConfig): void {
    if (config.default) defaultProviderName = config.default;

    for (const factory of providerConfigFactories) {
      const createProvider = factory.fromConfig(config);
      if (createProvider) {
        this.registerProvider(factory.name, createProvider);
      }
    }
  }

  /**
   * Initialize shared providers from environment variables.
   * These will be available to all projects as fallback.
   */
  initializeSharedFromEnv(): void {
    for (const factory of providerConfigFactories) {
      const createProvider = factory.fromEnv();
      if (createProvider) {
        this.registerProviderShared(factory.name, createProvider);
      }
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
