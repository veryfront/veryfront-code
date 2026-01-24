/**
 * Base LLM Client
 *
 * Abstract base class for all LLM provider implementations
 */

import type {
  ClientBackend,
  ConversationMessage,
  LLMClient,
  LLMClientConfig,
  LLMCompletion,
  TokenUsage,
} from "../types.ts";

export abstract class BaseLLMClient implements LLMClient {
  abstract readonly backend: ClientBackend;
  readonly model: string;
  protected config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = config;
    this.model = config.model;
  }

  abstract complete(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): Promise<LLMCompletion>;

  abstract stream(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): AsyncIterable<string>;

  /**
   * Estimate token count for text
   * Uses simple approximation: ~4 chars per token for English
   * Override in subclasses for accurate counting
   */
  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Merge config with overrides
   */
  protected mergeConfig(overrides?: Partial<LLMClientConfig>): LLMClientConfig {
    return { ...this.config, ...overrides };
  }

  /**
   * Retry logic for API calls
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = this.config.retries ?? 3,
    delayMs: number = this.config.retryDelay ?? 1000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = delayMs * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if error should not be retried
   */
  protected isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("invalid api key") ||
        message.includes("authentication") ||
        message.includes("unauthorized") ||
        message.includes("invalid_api_key")
      );
    }
    return false;
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create zero usage object
   */
  protected zeroUsage(): TokenUsage {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }
}

/**
 * Factory function to create LLM client
 */
export async function createLLMClient(
  backend: ClientBackend,
  config: LLMClientConfig
): Promise<LLMClient> {
  switch (backend) {
    case "openai":
    case "openrouter":
    case "groq":
    case "together":
    case "fireworks": {
      const { OpenAIClient } = await import("./openai.ts");
      return new OpenAIClient(config, backend);
    }
    case "anthropic": {
      const { AnthropicClient } = await import("./anthropic.ts");
      return new AnthropicClient(config);
    }
    case "azure_openai": {
      const { AzureOpenAIClient } = await import("./azure.ts");
      // Azure requires additional config (resourceName, deploymentName) - let constructor validate
      // deno-lint-ignore no-explicit-any
      return new AzureOpenAIClient(config as any);
    }
    case "gemini": {
      const { GeminiClient } = await import("./gemini.ts");
      return new GeminiClient(config);
    }
    case "ollama": {
      const { OllamaClient } = await import("./ollama.ts");
      return new OllamaClient(config);
    }
    default:
      throw new Error(`Unsupported backend: ${backend}`);
  }
}
