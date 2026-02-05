/**************************
 * Agent type definitions
 **************************/

import type { Tool } from "#veryfront/tool";
import type { Memory } from "./memory/memory-interface.ts";

// Re-export schema-based types
export type {
  AgentContext,
  AgentResponse,
  AgentStatus,
  EdgeConfig,
  MemoryConfig,
  Message,
  MessagePart,
  ModelProvider,
  StreamToolCall,
  ToolCall,
  ToolCallPart,
  ToolCallPartWithArgs,
  ToolCallPartWithInput,
  ToolResultPart,
} from "./schemas/index.ts";

// Import for use in interfaces and functions
import type {
  Message,
  MessagePart,
  ToolCall,
  ToolCallPart,
  ToolCallPartWithArgs,
  ToolCallPartWithInput,
} from "./schemas/index.ts";

/**
 * Model configuration string format: "provider/model-name"
 * Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet"
 */
export type ModelString = string;

// Import for use in AgentConfig
import type { EdgeConfig, MemoryConfig } from "./schemas/index.ts";

export interface AgentConfig {
  id?: string;
  model: ModelString;
  system: string | (() => string) | (() => Promise<string>);
  tools?: true | Record<string, Tool | boolean>;
  maxSteps?: number;
  streaming?: boolean;
  memory?: MemoryConfig;
  middleware?: AgentMiddleware[];
  edge?: EdgeConfig;
  multimodal?: {
    vision?: boolean;
    audio?: boolean;
  };
}

// Import for use in AgentMiddleware
import type { AgentContext, AgentResponse } from "./schemas/index.ts";

export type AgentMiddleware = (
  context: AgentContext,
  next: () => Promise<AgentResponse>,
) => Promise<AgentResponse>;

// Utility functions for working with message parts and tool calls
export function getTextFromParts(parts: MessagePart[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function hasArgs(part: ToolCallPart): part is ToolCallPartWithArgs {
  return "args" in part && part.args !== undefined;
}

export function hasInput(part: ToolCallPart): part is ToolCallPartWithInput {
  return "input" in part && part.input !== undefined;
}

export function getToolArguments(part: ToolCallPart): Record<string, unknown> {
  if (hasArgs(part)) return part.args;
  if (hasInput(part)) return part.input;

  const basePart = part as ToolCallPart;
  throw new Error(
    `Tool call part for "${basePart.toolName}" (${basePart.toolCallId}) missing both 'args' and 'input' fields`,
  );
}

export interface AgentStreamResult {
  toDataStreamResponse(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response;
}

export interface Agent {
  id: string;
  config: AgentConfig;

  generate(input: {
    input: string | Message[];
    context?: Record<string, unknown>;
  }): Promise<AgentResponse>;

  stream(input: {
    input?: string;
    messages?: Message[];
    context?: Record<string, unknown>;
    onToolCall?: (toolCall: ToolCall) => void;
    onChunk?: (chunk: string) => void;
  }): Promise<AgentStreamResult>;

  respond(request: Request): Promise<Response>;

  getMemory(): Memory<Message>;

  getMemoryStats(): Promise<{
    totalMessages: number;
    estimatedTokens: number;
    type: string;
  }>;

  clearMemory(): Promise<void>;
}
