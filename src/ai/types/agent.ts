
import type { Tool } from "./tool.ts";
import type { Platform } from "../runtime/platform.ts";
import type { Memory } from "../agent/memory.ts";

export type ModelProvider = "openai" | "anthropic" | "google" | "local";

export type ModelString = string;

export interface MemoryConfig {
  type: "conversation" | "buffer" | "summary";

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

export interface Message {
  id?: string;

  role: "user" | "assistant" | "system" | "tool";

  content: string;

  toolCalls?: StreamToolCall[];

  toolCallId?: string;

  toolCall?: ToolCall;

  toolResult?: unknown;

  timestamp?: number;

  metadata?: Record<string, unknown>;
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

  getMemory(): Memory;

  getMemoryStats(): Promise<{
    totalMessages: number;
    estimatedTokens: number;
    type: string;
  }>;

  clearMemory(): Promise<void>;
}
