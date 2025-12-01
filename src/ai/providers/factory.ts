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
 * Get environment variable (works in Node.js and Deno)
 */
function getEnv(name: string): string | undefined {
  // Deno
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get(name);
  }
  // Node.js
  // deno-lint-ignore no-explicit-any
  const _global = globalThis as any;
  if (typeof _global.process !== "undefined" && _global.process.env) {
    return _global.process.env[name];
  }
  return undefined;
}

/**
 * Provider registry
 */
class ProviderRegistry {
  private providers = new Map<string, Provider>();
  private config: ProvidersConfig = {};
  private autoInitialized = false;

  /**
   * Auto-initialize providers from environment variables
   * This is called lazily when a provider is first requested
   */
  private autoInitializeFromEnv(): void {
    if (this.autoInitialized) return;
    this.autoInitialized = true;

    // Initialize OpenAI from OPENAI_API_KEY
    const openaiKey = getEnv("OPENAI_API_KEY");
    if (openaiKey && !this.providers.has("openai")) {
      try {
        const provider = new OpenAIProvider({
          apiKey: openaiKey,
          baseURL: getEnv("OPENAI_BASE_URL"),
          organizationId: getEnv("OPENAI_ORGANIZATION_ID"),
        });
        this.providers.set("openai", provider);
        agentLogger.debug("Auto-initialized OpenAI provider from environment");
      } catch (error) {
        agentLogger.warn("Failed to auto-initialize OpenAI provider:", error);
      }
    }

    // Initialize Anthropic from ANTHROPIC_API_KEY
    const anthropicKey = getEnv("ANTHROPIC_API_KEY");
    if (anthropicKey && !this.providers.has("anthropic")) {
      try {
        const provider = new AnthropicProvider({
          apiKey: anthropicKey,
          baseURL: getEnv("ANTHROPIC_BASE_URL"),
        });
        this.providers.set("anthropic", provider);
        agentLogger.debug("Auto-initialized Anthropic provider from environment");
      } catch (error) {
        agentLogger.warn("Failed to auto-initialize Anthropic provider:", error);
      }
    }

    // Initialize Google from GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY
    const googleKey = getEnv("GOOGLE_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    if (googleKey && !this.providers.has("google")) {
      try {
        const provider = new GoogleProvider({
          apiKey: googleKey,
        });
        this.providers.set("google", provider);
        agentLogger.debug("Auto-initialized Google provider from environment");
      } catch (error) {
        agentLogger.warn("Failed to auto-initialize Google provider:", error);
      }
    }
  }

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
    // Auto-initialize from environment variables if not already done
    this.autoInitializeFromEnv();

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
    this.autoInitializeFromEnv();
    return this.providers.has(name);
  }

  /**
   * Get all available provider names
   */
  getAvailableProviders(): string[] {
    this.autoInitializeFromEnv();
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
