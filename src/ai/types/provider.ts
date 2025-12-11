import type { ToolDefinition } from "./tool.ts";

export interface ProviderConfig {
  apiKey?: string;

  baseURL?: string;

  organizationId?: string;

  options?: Record<string, unknown>;
}

export interface OpenAIConfig extends ProviderConfig {
  apiKey: string;

  baseURL?: string;

  organizationId?: string;
}

export interface AnthropicConfig extends ProviderConfig {
  apiKey: string;

  baseURL?: string;
}

export interface GoogleConfig extends ProviderConfig {
  apiKey: string;

  baseURL?: string;
}

export interface ProvidersConfig {
  default?: string;

  openai?: OpenAIConfig;

  anthropic?: AnthropicConfig;

  google?: GoogleConfig;
}

export interface CompletionRequest {
  model: string;

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

  system?: string;

  maxTokens?: number;

  temperature?: number;

  topP?: number;

  stream?: boolean;

  tools?: ToolDefinition[];
}

export interface CompletionResponse {
  text: string;

  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;

  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  finishReason: "stop" | "length" | "tool_calls" | "content_filter";
}

export interface Provider {
  name: string;

  complete(request: CompletionRequest): Promise<CompletionResponse>;

  stream(request: CompletionRequest): Promise<ReadableStream>;
}
