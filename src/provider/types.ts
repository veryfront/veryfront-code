// Re-export schema-based types
export type {
  AnthropicConfig,
  CompletionRequest,
  CompletionResponse,
  GoogleConfig,
  OpenAIConfig,
  ProviderConfig,
  ProvidersConfig,
} from "./schemas/index.ts";

// Import types for use in interface definition
import type { CompletionRequest, CompletionResponse } from "./schemas/index.ts";

export interface Provider {
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): Promise<ReadableStream<Uint8Array>>;
}
