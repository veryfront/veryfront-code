import type { ToolDefinition } from "#veryfront/tool";

export interface ProviderConfig {
  /** API key */
  apiKey?: string;

  /** Base URL (for custom endpoints) */
  baseURL?: string;

  /** Organization ID (provider-specific) */
  organizationId?: string;

  /** Additional provider-specific options */
  options?: Record<string, unknown>;
}

/**
 * OpenAI provider configuration
 */
export interface OpenAIConfig extends ProviderConfig {
  /** OpenAI API key */
  apiKey: string;

  /** Base URL (default: https://api.openai.com/v1) */
  baseURL?: string;

  /** Organization ID */
  organizationId?: string;
}

/**
 * Anthropic provider configuration
 */
export interface AnthropicConfig extends ProviderConfig {
  /** Anthropic API key */
  apiKey: string;

  /** Base URL (default: https://api.anthropic.com) */
  baseURL?: string;
}

/**
 * Google AI provider configuration
 */
export interface GoogleConfig extends ProviderConfig {
  /** Google AI API key */
  apiKey: string;

  /** Base URL */
  baseURL?: string;
}

/**
 * Provider registry configuration
 */
export interface ProvidersConfig {
  /** Default provider */
  default?: string;

  /** OpenAI configuration */
  openai?: OpenAIConfig;

  /** Anthropic configuration */
  anthropic?: AnthropicConfig;

  /** Google configuration */
  google?: GoogleConfig;
}

/**
 * Model completion request
 */
export interface CompletionRequest {
  /** Model to use */
  model: string;

  /** Messages or prompt */
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: Array<{
      id: string;
      type?: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
  }>;

  /** System prompt */
  system?: string;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Temperature (0-2) */
  temperature?: number;

  /** Top P sampling */
  topP?: number;

  /** Enable streaming */
  stream?: boolean;

  /** Tools available */
  tools?: ToolDefinition[];

  /**
   * Reasoning configuration for o-series models (o1, o3)
   */
  reasoning?: {
    /**
     * Reasoning effort level.
     * - "low": Faster responses, less reasoning
     * - "medium": Balanced (default)
     * - "high": More thorough reasoning, slower
     */
    effort?: "low" | "medium" | "high";
  };
}

/**
 * Model completion response
 */
export interface CompletionResponse {
  /** Generated text */
  text: string;

  /** Tool calls */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;

  /** Usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** Finish reason */
  finishReason: "stop" | "length" | "tool_calls" | "content_filter";
}

/**
 * Provider interface
 */
export interface Provider {
  /** Provider name */
  name: string;

  /**
   * Complete a prompt
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Stream a completion
   */
  stream(request: CompletionRequest): Promise<ReadableStream>;
}
