/**
 * Agent type definitions
 */

import type { Tool } from "#veryfront/tool";
import type { Platform } from "../platform/core-platform.ts";
import type { Memory } from "./memory/index.ts";

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
  type: "conversation" | "buffer" | "summary" | "redis";

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

  /** Tools available to the agent. Use `true` to enable all discovered tools, or specify individual tools. */
  tools?: true | Record<string, Tool | boolean>;

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
 * Tool call part with args (runtime/server format)
 * Uses `tool-${toolName}` pattern (e.g., "tool-weather")
 */
export interface ToolCallPartWithArgs {
  type: `tool-${string}`;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Tool call part with input (useChat/client format)
 * Uses `tool-${toolName}` pattern (e.g., "tool-weather")
 */
export interface ToolCallPartWithInput {
  type: `tool-${string}`;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Tool call part (AI SDK v5 format)
 * Supports both 'args' (runtime) and 'input' (useChat) field names
 */
export type ToolCallPart = ToolCallPartWithArgs | ToolCallPartWithInput;

/**
 * Tool result part (AI SDK v5 format)
 */
export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
}

/**
 * Message part types (AI SDK v5 format)
 * Tool calls use `tool-${toolName}` pattern (e.g., "tool-weather")
 * Legacy "tool-call" type also supported for backwards compatibility
 */
export type MessagePart =
  | { type: "text"; text: string }
  | ToolCallPart
  | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | ToolResultPart;

/**
 * Message in a conversation (AI SDK v5 format)
 */
export interface Message {
  /** Message ID */
  id: string;

  /** Message role */
  role: "user" | "assistant" | "system" | "tool";

  /** Message parts (v5 format) */
  parts: MessagePart[];

  /** Timestamp */
  timestamp?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Helper to extract text content from message parts
 */
export function getTextFromParts(parts: MessagePart[]): string {
  return parts
    .filter((p): p is MessagePart & { type: "text" } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Type guard to check if a tool call part has 'args' field
 */
export function hasArgs(part: ToolCallPart): part is ToolCallPartWithArgs {
  return "args" in part && part.args !== undefined;
}

/**
 * Type guard to check if a tool call part has 'input' field
 */
export function hasInput(part: ToolCallPart): part is ToolCallPartWithInput {
  return "input" in part && part.input !== undefined;
}

/**
 * Extract tool arguments from a tool call part.
 * Supports both 'args' (runtime/server) and 'input' (useChat/client) formats.
 * Throws if neither field is present.
 */
export function getToolArguments(part: ToolCallPart): Record<string, unknown> {
  if (hasArgs(part)) return part.args;
  if (hasInput(part)) return part.input;
  // After type guards, TypeScript narrows to never, so cast to access properties
  const { toolName, toolCallId } = part as ToolCallPartWithArgs;
  throw new Error(
    `Tool call part for "${toolName}" (${toolCallId}) missing both 'args' and 'input' fields`,
  );
}

/**
 * Tool call emitted during streaming responses.
 * Matches provider streaming payload shape and is parsed into arguments.
 */
export interface StreamToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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
 * Result object returned by agent.stream()
 * Provides toDataStreamResponse() for Vercel AI SDK compatible streaming
 */
export interface AgentStreamResult {
  /**
   * Convert the stream to a Response object for streaming responses
   * Compatible with Vercel AI SDK's toDataStreamResponse()
   */
  toDataStreamResponse(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response;
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
   * Returns an AgentStreamResult which extends ReadableStream and adds toDataStreamResponse()
   */
  stream(input: {
    input?: string;
    messages?: Message[];
    context?: Record<string, unknown>;
    onToolCall?: (toolCall: ToolCall) => void;
    onChunk?: (chunk: string) => void;
  }): Promise<AgentStreamResult>;

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
