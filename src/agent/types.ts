/**************************
 * Agent type definitions
 **************************/

import type { ModelRuntime } from "#veryfront/provider/types.ts";
import type { RemoteToolSource, Tool, ToolExecutionContext } from "#veryfront/tool";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry.ts";
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

/** Public API contract for suggestion. */
export type Suggestion =
  | {
    type: "prompt";
    id?: never;
    title: string;
    prompt: string;
    description?: never;
    task?: never;
  }
  | {
    id: string;
    type: "prompt";
    title?: never;
    prompt?: never;
    description?: never;
    task?: never;
  }
  | {
    id: string;
    type: "task";
    title?: never;
    prompt?: never;
    description?: never;
    task?: never;
  };

/** Public API contract for suggestions. */
export interface Suggestions {
  welcomeMessage?: string;
  suggestions: Suggestion[];
}

/** Configuration used by agent. */
export interface AgentConfig {
  id?: string;
  /** Human-readable display name for registry and control-plane listings. */
  name?: string;
  /** Optional summary shown in registry and control-plane listings. */
  description?: string;
  /**
   * Optional model string in "provider/model" format.
   *
   * When omitted or set to `"auto"`, Veryfront chooses the runtime default:
   * local inference by default, automatically upgrading to an available cloud
   * provider when bootstrap credentials are present.
   */
  model?: ModelString;
  system: string | (() => string) | (() => Promise<string>);
  tools?: true | Record<string, Tool | boolean>;
  remoteTools?: RemoteToolSource[];
  /**
   * Optional remote tool name allowlist. When set, only matching tools from
   * `remoteTools` are exposed to the model and executable at runtime.
   */
  allowedRemoteTools?: string[];
  maxSteps?: number;
  streaming?: boolean;
  memory?: MemoryConfig;
  middleware?: AgentMiddleware[];
  edge?: EdgeConfig;
  multimodal?: {
    vision?: boolean;
    audio?: boolean;
  };
  /** Restrict runtime model overrides to these "provider/model" strings. */
  allowedModels?: ModelString[];
  /**
   * Optional request-aware hook for overriding the resolved model runtime and
   * provider transport options on a per-call basis.
   */
  resolveModelTransport?: ModelTransportResolver;
  /**
   * Optional step-boundary hook for refreshing the runtime system prompt and
   * host-owned context during a long-lived run.
   */
  resolveRuntimeState?: RuntimeStateResolver;
  /**
   * Optional hook invoked after the runtime executes a configured local,
   * registry, integration, or remote tool and before the tool result is
   * persisted or streamed back to callers.
   */
  onToolResult?: ToolExecutionResultHandler;
  /**
   * Enable skills for this agent.
   * - true: include all discovered skills from skills/ directory
   * - string[]: include only specific skill IDs
   *
   * Discovery happens at startup via discoverAll().
   * This controls which skills appear in the agent's prompt
   * and registers the skill tools.
   */
  skills?: true | string[];
  suggestions?: Suggestions;
  /** Set to false to disable the default security middleware */
  security?: false;
}

/** Configuration used by resolved agent. */
export type ResolvedAgentConfig = AgentConfig & { model: ModelString };

/** Request payload for model transport. */
export interface ModelTransportRequest {
  agentId: string;
  requestedModel: ModelString;
  resolvedModel: ModelString;
  context?: Record<string, unknown>;
  mode: "generate" | "stream";
}

/** Public API contract for resolved model transport. */
export interface ResolvedModelTransport {
  model?: ModelRuntime;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
}

/** Public API contract for model transport resolver. */
export type ModelTransportResolver = (
  request: ModelTransportRequest,
) => ResolvedModelTransport | Promise<ResolvedModelTransport>;

/** Request payload for runtime state. */
export interface RuntimeStateRequest {
  agentId: string;
  mode: "generate" | "stream";
  step: number;
  system: string;
  messages: Message[];
  context?: Record<string, unknown>;
}

/** State for resolved runtime. */
export interface ResolvedRuntimeState {
  system?: string;
  context?: Record<string, unknown>;
}

/** Public API contract for runtime state resolver. */
export type RuntimeStateResolver = (
  request: RuntimeStateRequest,
) => ResolvedRuntimeState | undefined | Promise<ResolvedRuntimeState | undefined>;

export interface ToolExecutionResultRequest {
  agentId: string;
  mode: "generate" | "stream";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  result: unknown;
  context?: ToolExecutionContext;
}

export type ToolExecutionResultHandler = (
  request: ToolExecutionResultRequest,
) => void | Promise<void>;

// Import for use in AgentMiddleware
import type { AgentContext, AgentResponse } from "./schemas/index.ts";

/** Public API contract for agent middleware. */
export type AgentMiddleware = (
  context: AgentContext,
  next: () => Promise<AgentResponse>,
) => Promise<AgentResponse>;

// Utility functions for working with message parts and tool calls
/** Return text from parts. */
export function getTextFromParts(parts: MessagePart[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Check whether args is present. */
export function hasArgs(part: ToolCallPart): part is ToolCallPartWithArgs {
  return "args" in part && part.args !== undefined;
}

/** Input payload for has. */
export function hasInput(part: ToolCallPart): part is ToolCallPartWithInput {
  return "input" in part && part.input !== undefined;
}

/** Return tool arguments. */
export function getToolArguments(part: ToolCallPart): Record<string, unknown> {
  if (hasArgs(part)) return part.args;
  if (hasInput(part)) return part.input;

  const basePart = part as ToolCallPart;
  throw INVALID_ARGUMENT.create({
    detail:
      `Tool call part for "${basePart.toolName}" (${basePart.toolCallId}) missing both 'args' and 'input' fields`,
  });
}

/** Result returned from agent stream. */
export interface AgentStreamResult {
  toDataStreamResponse(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response;
}

/** Public API contract for agent. */
export interface Agent {
  id: string;
  config: ResolvedAgentConfig;

  generate(input: {
    input: string | Message[];
    context?: Record<string, unknown>;
    /** Override the agent's default model for this request. Must be in `allowedModels` if configured. */
    model?: ModelString;
    /** Override the maximum model output tokens for this request. */
    maxOutputTokens?: number;
  }): Promise<AgentResponse>;

  stream(input: {
    input?: string;
    messages?: Message[];
    context?: Record<string, unknown>;
    /** Override the agent's default model for this request. Must be in `allowedModels` if configured. */
    model?: ModelString;
    /** Override the maximum model output tokens for this request. */
    maxOutputTokens?: number;
    onToolCall?: (toolCall: ToolCall) => void;
    onChunk?: (chunk: string) => void;
    onFinish?: (response: AgentResponse) => void;
    abortSignal?: AbortSignal;
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
