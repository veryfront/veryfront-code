/**
 * Agent type definitions
 */

import type { Tool } from "./tool.ts";
import type { Platform } from "../runtime/platform.ts";
import type { Memory } from "../agent/memory.ts";

/**
 * Supported AI model providers
 */
export type ModelProvider = "openai" | "anthropic" | "google" | "local";

/**
 * Model configuration string format: "provider/model-name"
 * Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet"
 */
export type ModelString = string;

/**
 * Agent memory configuration
 */
export interface MemoryConfig {
  /** Memory type */
  type: "conversation" | "buffer" | "summary";

  /** Maximum tokens to store in memory */
  maxTokens?: number;

  /** Maximum messages to store */
  maxMessages?: number;
}

/**
 * Agent execution status
 */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "tool_execution"
  | "streaming"
  | "completed"
  | "error";

/**
 * Agent configuration options
 */
export interface AgentConfig {
  /** Unique agent identifier (optional, inferred from filename) */
  id?: string;

  /** Model to use (format: "provider/model-name") */
  model: ModelString;

  /** System prompt or prompt template ID */
  system: string | (() => string) | (() => Promise<string>);

  /** Tools available to the agent */
  tools?: Record<string, Tool | boolean>;

  /** Maximum agent steps before stopping */
  maxSteps?: number;

  /** Enable streaming responses */
  streaming?: boolean;

  /** Memory configuration */
  memory?: MemoryConfig;

  /** Middleware functions */
  middleware?: AgentMiddleware[];

  /** Edge-specific configuration */
  edge?: EdgeConfig;

  /** Multi-modal support */
  multimodal?: {
    vision?: boolean;
    audio?: boolean;
  };
}

/**
 * Edge deployment configuration
 */
export interface EdgeConfig {
  /** Enable edge optimizations */
  enabled: boolean;

  /** Maximum steps for edge (overrides maxSteps) */
  maxSteps?: number;

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Force streaming */
  streaming?: boolean;
}

/**
 * Agent middleware function
 */
export type AgentMiddleware = (
  context: AgentContext,
  next: () => Promise<AgentResponse>,
) => Promise<AgentResponse>;

/**
 * Agent execution context
 */
export interface AgentContext {
  /** Agent ID */
  agentId: string;

  /** Model used */
  model?: string;

  /** Input messages or prompt */
  input: string | Message[];

  /** Additional context data */
  data?: Record<string, unknown>;

  /** Current platform */
  platform: Platform;

  /** Request metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Message in a conversation
 */
export interface Message {
  /** Message ID */
  id?: string;

  /** Message role */
  role: "user" | "assistant" | "system" | "tool";

  /** Message content */
  content: string;

  /** Tool calls made by assistant (for assistant messages) */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;

  /** Tool call ID (for tool result messages) */
  toolCallId?: string;

  /** Tool call information (for tool messages) */
  toolCall?: ToolCall;

  /** Tool result (for tool response messages) */
  toolResult?: unknown;

  /** Timestamp */
  timestamp?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Tool invocation during agent execution
 */
export interface ToolCall {
  /** Tool call ID */
  id: string;

  /** Tool name */
  name: string;

  /** Tool arguments */
  args: Record<string, unknown>;

  /** Tool execution status */
  status: "pending" | "executing" | "completed" | "error";

  /** Tool result */
  result?: unknown;

  /** Error if tool execution failed */
  error?: string;

  /** Execution time in milliseconds */
  executionTime?: number;
}

/**
 * Agent response
 */
export interface AgentResponse {
  /** Generated text */
  text: string;

  /** Messages in the conversation */
  messages: Message[];

  /** Tool calls made during execution */
  toolCalls: ToolCall[];

  /** Agent status */
  status: AgentStatus;

  /** Thinking/reasoning text (if available) */
  thinking?: string;

  /** Usage statistics */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent instance (returned by agent() function)
 */
export interface Agent {
  /** Agent ID */
  id: string;

  /** Agent configuration */
  config: AgentConfig;

  /**
   * Generate a response (non-streaming)
   */
  generate(input: {
    input: string | Message[];
    context?: Record<string, unknown>;
  }): Promise<AgentResponse>;

  /**
   * Stream a response
   */
  stream(input: {
    input?: string;
    messages?: Message[];
    context?: Record<string, unknown>;
    onToolCall?: (toolCall: ToolCall) => void;
    onChunk?: (chunk: string) => void;
  }): Promise<ReadableStream>;

  /**
   * Respond to an HTTP request
   */
  respond(request: Request): Promise<Response>;

  /**
   * Get memory instance
   */
  getMemory(): Memory;

  /**
   * Get memory statistics
   */
  getMemoryStats(): Promise<{
    totalMessages: number;
    estimatedTokens: number;
    type: string;
  }>;

  /**
   * Clear agent memory
   */
  clearMemory(): Promise<void>;
}
