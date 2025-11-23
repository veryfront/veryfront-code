/**
 * Provider factory and registry
 */

import type { Provider, ProvidersConfig } from "../types/provider.ts";
import { OpenAIProvider } from "./openai.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GoogleProvider } from "./google.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

/**
 * Provider registry
 */
class ProviderRegistry {
  private providers = new Map<string, Provider>();
  private config: ProvidersConfig = {};

  /**
   * Initialize providers from configuration
   */
  initialize(config: ProvidersConfig): void {
    this.config = config;

    // Initialize OpenAI
    if (config.openai) {
      try {
        const provider = new OpenAIProvider(config.openai);
        this.providers.set("openai", provider);
      } catch (error) {
        agentLogger.warn("Failed to initialize OpenAI provider:", error);
      }
    }

    // Initialize Anthropic
    if (config.anthropic) {
      try {
        const provider = new AnthropicProvider(config.anthropic);
        this.providers.set("anthropic", provider);
      } catch (error) {
        agentLogger.warn("Failed to initialize Anthropic provider:", error);
      }
    }

    // Initialize Google
    if (config.google) {
      try {
        const provider = new GoogleProvider(config.google);
        this.providers.set("google", provider);
      } catch (error) {
        agentLogger.warn("Failed to initialize Google provider:", error);
      }
    }
  }

  /**
   * Get a provider by name
   */
  getProvider(name: string): Provider {
    const provider = this.providers.get(name);

    if (!provider) {
      throw toError(createError({
        type: "agent",
        message: `Provider "${name}" not found. Available providers: ${
          Array.from(this.providers.keys()).join(", ")
        }`,
      }));
    }

    return provider;
  }

  /**
   * Get provider from model string (format: "provider/model-name")
   */
  getProviderFromModel(modelString: string): {
    provider: Provider;
    model: string;
  } {
    const parts = modelString.split("/");

    if (parts.length !== 2) {
      throw toError(createError({
        type: "config",
        message:
          `Invalid model string format: "${modelString}". Expected format: "provider/model-name" (e.g., "openai/gpt-4")`,
      }));
    }

    const providerName = parts[0];
    const modelName = parts[1];

    if (!providerName || !modelName) {
      throw toError(createError({
        type: "config",
        message:
          `Invalid model string format: "${modelString}". Both provider and model name are required.`,
      }));
    }

    const provider = this.getProvider(providerName);

    return { provider, model: modelName };
  }

  /**
   * Get default provider
   */
  getDefaultProvider(): Provider {
    const defaultName = this.config.default || "openai";
    return this.getProvider(defaultName);
  }

  /**
   * Check if a provider is available
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get all available provider names
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Clear all providers (for testing)
   */
  clear(): void {
    this.providers.clear();
    this.config = {};
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();

/**
 * Initialize providers with configuration
 */
export function initializeProviders(config: ProvidersConfig): void {
  providerRegistry.initialize(config);
}

/**
 * Get a provider by name
 */
export function getProvider(name: string): Provider {
  return providerRegistry.getProvider(name);
}

/**
 * Get provider from model string
 */
export function getProviderFromModel(modelString: string): {
  provider: Provider;
  model: string;
} {
  return providerRegistry.getProviderFromModel(modelString);
}
