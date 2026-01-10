import type { Provider, ProvidersConfig } from "../types/provider.ts";
import { OpenAIProvider } from "./openai.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GoogleProvider } from "./google.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import { getEnv } from "../../platform/compat/process.ts";

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

    const openaiKey = getEnv("OPENAI_API_KEY");
    if (openaiKey && !this.providers.has("openai")) {
      this.registerProvider("openai", () =>
        new OpenAIProvider({
          apiKey: openaiKey,
          baseURL: getEnv("OPENAI_BASE_URL"),
          organizationId: getEnv("OPENAI_ORGANIZATION_ID"),
        }), true);
    }

    const anthropicKey = getEnv("ANTHROPIC_API_KEY");
    if (anthropicKey && !this.providers.has("anthropic")) {
      this.registerProvider("anthropic", () =>
        new AnthropicProvider({
          apiKey: anthropicKey,
          baseURL: getEnv("ANTHROPIC_BASE_URL"),
        }), true);
    }

    const googleKey = getEnv("GOOGLE_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY");
    if (googleKey && !this.providers.has("google")) {
      this.registerProvider("google", () => new GoogleProvider({ apiKey: googleKey }), true);
    }
  }

  initialize(config: ProvidersConfig): void {
    this.config = config;

    if (config.openai) {
      this.registerProvider("openai", () => new OpenAIProvider(config.openai!));
    }
    if (config.anthropic) {
      this.registerProvider("anthropic", () => new AnthropicProvider(config.anthropic!));
    }
    if (config.google) {
      this.registerProvider("google", () => new GoogleProvider(config.google!));
    }
  }

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

  getDefaultProvider(): Provider {
    const defaultName = this.config.default || "openai";
    return this.getProvider(defaultName);
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
