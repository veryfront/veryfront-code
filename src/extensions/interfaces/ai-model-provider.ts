/**
 * Contract interface for AI/LLM model providers.
 *
 * Default implementation: `@veryfront/ext-openai`
 *
 * @module extensions/interfaces/ai-model-provider
 */

/** A single part of a multi-modal message (text or image). */
export interface ContentPart {
  /** Part type. */
  type: "text" | "image";
  /** Text content (when `type` is `"text"`). */
  text?: string;
  /** Image URL or base64 data (when `type` is `"image"`). */
  imageUrl?: string;
}

/** A chat message in a conversation. */
export interface ChatMessage {
  /** Message role. */
  role: "system" | "user" | "assistant" | "tool";
  /** Simple text content. */
  content?: string;
  /** Multi-modal content parts (used instead of `content`). */
  parts?: ContentPart[];
  /** Tool call ID this message responds to (for `tool` role). */
  toolCallId?: string;
}

/** Definition of a tool the model may invoke. */
export interface ToolDefinition {
  /** Tool name. */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /** JSON Schema describing the tool's parameters. */
  parameters: Record<string, unknown>;
}

/** Options passed to {@link AIModelProvider.complete} and {@link AIModelProvider.stream}. */
export interface CompletionOptions {
  /** Model identifier (e.g. `"gpt-4o"`, `"claude-sonnet-4-20250514"`). */
  model: string;
  /** Conversation messages. */
  messages: ChatMessage[];
  /** Sampling temperature. */
  temperature?: number;
  /** Maximum tokens to generate. */
  maxTokens?: number;
  /** Available tools for function calling. */
  tools?: ToolDefinition[];
  /** Additional provider-specific options. */
  [key: string]: unknown;
}

/** Result returned from {@link AIModelProvider.complete}. */
export interface CompletionResult {
  /** Generated text content. */
  content: string;
  /** Tool calls requested by the model, if any. */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  /** Token usage statistics. */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** A chunk emitted during streaming completion. */
export interface StreamChunk {
  /** Incremental text delta. */
  content?: string;
  /** Incremental tool call delta. */
  toolCallDelta?: {
    id?: string;
    name?: string;
    arguments?: string;
  };
  /** Whether this is the final chunk. */
  done: boolean;
}

/**
 * AIModelProvider contract interface.
 *
 * Implementations provide chat completion and streaming capabilities
 * against large language models.
 */
export interface AIModelProvider {
  /** Generate a complete response for the given conversation. */
  complete(options: CompletionOptions): Promise<CompletionResult>;
  /** Stream a response token-by-token. */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk>;
}
