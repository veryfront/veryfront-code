/**************************
 * Agent type definitions
 **************************/

import type { Tool } from "#veryfront/tool";
import type { Platform } from "../platform/core-platform.ts";
import type { Memory } from "./memory/memory-interface.ts";

export type ModelProvider = "openai" | "anthropic" | "google" | "local";

/**
 * Model configuration string format: "provider/model-name"
 * Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet"
 */
export type ModelString = string;

export interface MemoryConfig {
  type: "conversation" | "buffer" | "summary" | "redis";
  maxTokens?: number;
  maxMessages?: number;
}

export type AgentStatus =
  | "idle"
  | "thinking"
  | "tool_execution"
  | "streaming"
  | "completed"
  | "error";

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

export interface EdgeConfig {
  enabled: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  streaming?: boolean;
}

export type AgentMiddleware = (
  context: AgentContext,
  next: () => Promise<AgentResponse>,
) => Promise<AgentResponse>;

export interface AgentContext {
  agentId: string;
  model?: string;
  input: string | Message[];
  data?: Record<string, unknown>;
  platform: Platform;
  metadata?: Record<string, unknown>;
}

export interface ToolCallPartWithArgs {
  type: `tool-${string}`;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolCallPartWithInput {
  type: `tool-${string}`;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type ToolCallPart = ToolCallPartWithArgs | ToolCallPartWithInput;

export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
}

export type MessagePart =
  | { type: "text"; text: string }
  | ToolCallPart
  | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | ToolResultPart;

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: MessagePart[];
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

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

  const p = part as ToolCallPart;
  throw new Error(
    `Tool call part for "${p.toolName}" (${p.toolCallId}) missing both 'args' and 'input' fields`,
  );
}

export interface StreamToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "error";
  result?: unknown;
  error?: string;
  executionTime?: number;
}

export interface AgentResponse {
  text: string;
  messages: Message[];
  toolCalls: ToolCall[];
  status: AgentStatus;
  thinking?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, unknown>;
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
