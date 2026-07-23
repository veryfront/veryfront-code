/**************************
 * Agent type definitions
 **************************/

import type { ModelRuntime } from "#veryfront/provider/types.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { INVALID_ARGUMENT } from "#veryfront/errors";
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

/** Suggested prompts or tasks shown before an agent conversation starts. */
export interface Suggestions {
  /** Optional message displayed above the suggestions. */
  welcomeMessage?: string;
  /** Ordered prompts or tasks to present to the user. */
  suggestions: Suggestion[];
}

/** Policy for tools exposed by one MCP server. */
export interface AgentMcpToolPolicy {
  /** Tool names that may be exposed. Omit to allow every non-denied tool. */
  allow?: string[];
  /** Tool names that must not be exposed. */
  deny?: string[];
  /** Approval policy for tools from this server. */
  approval?: "never";
}

/** HTTP transport configuration for one MCP server. */
export interface AgentMcpHttpTransport {
  /** Selects the HTTP MCP transport. */
  type: "http";
  /** Server URL or a request-aware URL resolver. */
  url: string | ((context?: ToolExecutionContext) => string | Promise<string>);
}

/** Authentication configuration for one MCP server. */
export type AgentMcpServerAuth =
  | {
    type: "bearer";
    token: string | ((context?: ToolExecutionContext) => string | Promise<string>);
  }
  | {
    type: "headers";
    headers: HeadersInit | ((context?: ToolExecutionContext) => HeadersInit | Promise<HeadersInit>);
  };

/** Veryfront-owned MCP server kind. */
export type AgentVeryfrontMcpServerKind = "veryfront-api" | "veryfront-studio";

/** Veryfront-owned MCP server available to an agent. */
export interface AgentVeryfrontMcpServerConfig {
  /** Veryfront-owned MCP server kind. */
  kind: AgentVeryfrontMcpServerKind;
  /** Optional stable source identifier. */
  id?: string;
  /** Tool allow, deny, and approval policy. */
  toolPolicy?: AgentMcpToolPolicy;
}

/** HTTP MCP server available to an agent. */
export interface AgentHttpMcpServerConfig {
  /** Stable source identifier. */
  id: string;
  /** Optional HTTP server discriminator. */
  kind?: "http";
  /** HTTP transport used to reach the MCP server. */
  transport: AgentMcpHttpTransport;
  /** Optional request authentication. */
  auth?: AgentMcpServerAuth;
  /** Tool allow, deny, and approval policy. */
  toolPolicy?: AgentMcpToolPolicy;
  /** Optional fetch implementation used for MCP requests. */
  fetch?: typeof fetch;
}

/** MCP server available to an agent. */
export type AgentMcpServerConfig = AgentHttpMcpServerConfig | AgentVeryfrontMcpServerConfig;

/** Configuration accepted by the public agent factory. */
export interface AgentConfig {
  /** Resource identifier. */
  id?: string;
  /** Human-readable display name for registry and control-plane listings. */
  name?: string;
  /** Absolute avatar URL for registry, Studio, and chat identity surfaces. */
  avatarUrl?: string;
  /**
   * Deprecated serialized avatar URL retained for compatibility.
   *
   * @deprecated Use `avatarUrl`. Serialized wire payloads use `avatar_url`.
   */
  avatar_url?: string;
  /** Optional summary shown in registry and control-plane listings. */
  description?: string;
  /**
   * Optional model string in "provider/model" format.
   *
   * When omitted, Veryfront uses `openai/gpt-5.4-nano`. Set `"auto"` to choose
   * Veryfront Cloud when bootstrap credentials are present, otherwise a
   * configured direct provider key when one exists.
   */
  model?: ModelString;
  /** System prompt or a lazy system-prompt resolver. */
  system: string | (() => string) | (() => Promise<string>);
  /** Enable registered tools or provide inline tool definitions by name. */
  tools?: true | Record<string, Tool | boolean>;
  /**
   * Optional sandbox selection for runtime-owned sandbox tools such as `bash`.
   * `id` attaches to an existing sandbox session and detaches on run cleanup.
   * When omitted, sandbox tools lazily create a request/project-scoped session.
   */
  sandbox?: {
    id?: string;
    sandboxId?: string;
    sessionId?: string;
    projectId?: string;
  };
  /**
   * Provider-native tools executed by the selected model provider, such as
   * Anthropic `web_search` and `web_fetch`.
   */
  providerTools?: string[];
  /** Remote MCP servers available to this agent. */
  mcpServers?: AgentMcpServerConfig[];
  /** Maximum number of model and tool-execution steps per invocation. */
  maxSteps?: number;
  /** Sampling temperature for model generation. Defaults to 0. */
  temperature?: number;
  /** Whether the agent prefers streaming responses. */
  streaming?: boolean;
  /**
   * Conversation memory used by `stream()` and `generate()`. Omit it for
   * stateless operation. Provide a built-in configuration to persist history
   * in memory, or provide a `Memory` implementation such as the value returned
   * by `createRedisMemory()` to attach an external store. Set `enabled: false`
   * on a built-in configuration to force stateless behavior explicitly.
   */
  memory?: MemoryConfig | Memory<Message>;
  /** Middleware applied in declaration order around generation. */
  middleware?: AgentMiddleware[];
  /** Edge-runtime limits and streaming settings. */
  edge?: EdgeConfig;
  /** Multimodal capabilities advertised by the agent. */
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
  /** Conversation starters shown by compatible clients. */
  suggestions?: Suggestions;
  /** Set to false to disable the default security middleware */
  security?: false;
}

/** Configuration used by resolved agent. */
export type ResolvedAgentConfig = AgentConfig & { model: ModelString };

/** Request payload for model transport. */
export interface ModelTransportRequest {
  /** Agent requesting the transport. */
  agentId: string;
  /** Model requested by configuration or the invocation override. */
  requestedModel: ModelString;
  /** Model selected after aliases and runtime policy are applied. */
  resolvedModel: ModelString;
  /** Context supplied to the operation. */
  context?: Record<string, unknown>;
  /** Invocation mode that needs the transport. */
  mode: "generate" | "stream";
}

/** Provider-neutral reasoning / thinking option for model transport. */
export type RuntimeReasoningOption = {
  enabled?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  budgetTokens?: number;
};

/** Provider runtime and transport options selected for one invocation. */
export interface ResolvedModelTransport {
  /** Optional provider runtime override. */
  model?: ModelRuntime;
  /** Additional provider request headers. */
  headers?: HeadersInit;
  /** Provider-specific request options. */
  providerOptions?: Record<string, unknown>;
  /** Provider-neutral reasoning settings. */
  reasoning?: RuntimeReasoningOption;
}

/** Public API contract for model transport resolver. */
export type ModelTransportResolver = (
  request: ModelTransportRequest,
) => ResolvedModelTransport | Promise<ResolvedModelTransport>;

/** Request payload for runtime state. */
export interface RuntimeStateRequest {
  /** Agent whose state is being refreshed. */
  agentId: string;
  /** Active invocation mode. */
  mode: "generate" | "stream";
  /** Zero-based execution step. */
  step: number;
  /** Current system prompt. */
  system: string;
  /** Messages associated with the operation. */
  messages: Message[];
  /** Context supplied to the operation. */
  context?: Record<string, unknown>;
}

/** State for resolved runtime. */
export interface ResolvedRuntimeState {
  /** Replacement system prompt for the next step. */
  system?: string;
  /** Context supplied to the operation. */
  context?: Record<string, unknown>;
}

/** Public API contract for runtime state resolver. */
export type RuntimeStateResolver = (
  request: RuntimeStateRequest,
) => ResolvedRuntimeState | undefined | Promise<ResolvedRuntimeState | undefined>;

/** Input passed to the tool result hook after a tool finishes. */
export interface ToolExecutionResultRequest {
  /** Agent that executed the tool. */
  agentId: string;
  /** Agent execution mode. */
  mode: "generate" | "stream";
  /** Executed tool name. */
  toolName: string;
  /** Provider-assigned tool call identifier. */
  toolCallId: string;
  /** Parsed tool input. */
  input: Record<string, unknown>;
  /** Tool output, or the error value reported for a failed tool. */
  result: unknown;
  /** Optional execution context supplied by the runtime. */
  context?: ToolExecutionContext;
}

/** Callback invoked after a configured tool finishes. */
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

/** Check whether a tool-call part stores its parsed input in `input`. */
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
  /** Convert the agent event stream to an HTTP response. */
  toDataStreamResponse(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response;
}

/** Executable agent returned by {@link agent}. */
export interface Agent {
  /** Stable agent identifier. */
  id: string;
  /** Resolved public configuration. */
  config: ResolvedAgentConfig;

  /** Generate a complete response. */
  generate(input: {
    input: string | Message[];
    context?: Record<string, unknown>;
    /** Override the agent's default model for this request. Must be in `allowedModels` if configured. */
    model?: ModelString;
    /** Override the maximum model output tokens for this request. */
    maxOutputTokens?: number;
    /** Abort signal for cooperative cancellation. */
    abortSignal?: AbortSignal;
    /**
     * Memory behavior for this invocation. `configured` uses the agent's
     * configured persistent memory. `isolated` uses only the supplied input
     * and never reads from or writes to shared memory.
     */
    memoryMode?: AgentInvocationMemoryMode;
  }): Promise<AgentResponse>;

  /** Stream a response and optional tool lifecycle callbacks. */
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
    /**
     * Memory behavior for this invocation. `configured` uses the agent's
     * configured persistent memory. `isolated` uses only the supplied messages
     * and never reads from or writes to shared memory.
     */
    memoryMode?: AgentInvocationMemoryMode;
  }): Promise<AgentStreamResult>;

  /** Convert an HTTP request into an AG-UI streaming response for route handlers. */
  respond(request: Request): Promise<Response>;

  /** Return the configured memory store. */
  getMemory(): Memory<Message>;

  /** Return current memory usage statistics. */
  getMemoryStats(): Promise<{
    totalMessages: number;
    estimatedTokens: number;
    type: string;
  }>;

  /** Clears memory. */
  clearMemory(): Promise<void>;
}

/** Memory behavior selected for one agent invocation. */
export type AgentInvocationMemoryMode = "configured" | "isolated";
