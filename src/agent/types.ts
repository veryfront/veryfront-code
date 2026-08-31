/**************************
 * Agent type definitions
 **************************/

import type { ModelRuntime } from "#veryfront/provider/types.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { Memory } from "./memory/memory-interface.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";

// Re-export schema-based types
export type {
  AgentContext,
  AgentResponse,
  AgentStatus,
  BaseAgentResponse,
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
import type { RuntimeAgentThinkingConfig } from "./runtime/agent-definition.ts";

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

/** Source configuration accepted for one suggestion. */
export type SuggestionConfig =
  | string
  | Suggestion
  | {
    type?: "prompt";
    title: string;
    prompt: string;
  };

/** Source configuration accepted for an agent's suggestions. */
export type SuggestionsConfig = Suggestions | SuggestionConfig[];

/** Policy for tools exposed by one MCP server. */
export interface AgentMcpToolPolicy {
  allow?: string[];
  deny?: string[];
  approval?: "never";
}

/** HTTP transport configuration for one MCP server. */
export interface AgentMcpHttpTransport {
  type: "http";
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
  kind: AgentVeryfrontMcpServerKind;
  id?: string;
  toolPolicy?: AgentMcpToolPolicy;
}

/** HTTP MCP server available to an agent. */
export interface AgentHttpMcpServerConfig {
  id: string;
  kind?: "http";
  transport: AgentMcpHttpTransport;
  auth?: AgentMcpServerAuth;
  toolPolicy?: AgentMcpToolPolicy;
}

/** MCP server available to an agent. */
export type AgentMcpServerConfig = AgentHttpMcpServerConfig | AgentVeryfrontMcpServerConfig;

/** System instructions accepted by an agent runtime. */
export type AgentSystem = string | ChatSystemMessage[];

/**
 * Schema accepted by `outputSchema`, in either supported form.
 *
 * Erased over the schema's output type so a per-call override can be handed to
 * an agent of any configured output type.
 */
// deno-lint-ignore no-explicit-any -- generic erasure: accepts any concrete Schema<T>
export type AgentOutputSchema = Schema<any> | JsonSchema;

/** Output type inferred from a request-scoped `outputSchema`. */
export type InferAgentOutputSchema<TSchema> = TSchema extends Schema<infer TOutput> ? TOutput
  : TSchema extends JsonSchema ? unknown
  : never;

/** Configuration used by agent. */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete AgentConfig instantiation
export interface AgentConfig<TOutput = any> {
  id?: string;
  /** Human-readable display name for registry and control-plane listings. */
  name?: string;
  /** Absolute avatar URL for registry, Studio, and chat identity surfaces. */
  avatarUrl?: string;
  /** @deprecated Use `avatarUrl`. Serialized wire payloads use `avatar_url`. */
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
  /**
   * System instructions as text or structured messages. Structured messages
   * preserve provider-specific metadata such as prompt-cache breakpoints.
   */
  system: AgentSystem | (() => AgentSystem) | (() => Promise<AgentSystem>);
  /**
   * Project this agent runs against. Rendered as a `<project_context>` block so
   * the agent knows the project reference and branch instead of asking for
   * them. Hosts that already compose a full call context (the hosted chat
   * runtime, project-runtime agent runs) supply it at that layer instead.
   */
  projectContext?: {
    projectId: string;
    branchId?: string | null;
  };
  /**
   * Use this property for host-supplied browser display facts rendered in an
   * `<environment_context>` block. It cannot replace the server-authored UTC
   * `<runtime_context>` snapshot for a run.
   */
  environmentContext?: string;
  /**
   * Project tools available to this agent.
   *
   * Omit to expose no project tools. `true` authorizes the current scoped
   * catalog behind `tool_search`; an explicit map exposes only those selected
   * schemas immediately.
   */
  tools?: true | Record<string, Tool | boolean>;
  /**
   * Exact registered agent ids this agent may call through scoped
   * `agent_<id>` tools. Each delegate keeps its own model, skills, and tools.
   */
  delegates?: string[];
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
  maxSteps?: number;
  /**
   * Constrain every response to a schema, produced via `defineSchema((v) => …)`
   * (or any `SchemaValidator`-backed builder), or a raw JSON Schema object.
   *
   * The schema is mapped to the selected provider's native structured-output
   * field, and the model's text is parsed back into `response.object`. A model
   * runtime that does not support structured output rejects the request rather
   * than dropping the schema. Raw JSON Schema is validated locally only when
   * the registered validator extension can compile JSON Schema.
   */
  outputSchema?: Schema<TOutput> | JsonSchema;
  /** Sampling temperature for model generation. Defaults to 0. */
  temperature?: number;
  /** Provider-neutral reasoning / thinking configuration for hosted runtimes. */
  thinking?: RuntimeAgentThinkingConfig;
  streaming?: boolean;
  /**
   * Conversation memory persisted across `stream()` / `generate()` calls on this
   * instance. Omit for the stateless default: every call runs in isolation,
   * which keeps concurrent fan-out on a shared instance correct. When set, the
   * instance accumulates one shared conversation, so reuse it sequentially, not
   * across concurrent independent runs (use a separate instance per run for
   * that). Set `enabled: false` to force the stateless behavior explicitly.
   */
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
   * Select visible skill IDs or this agent's own skill short names advertised
   * in this agent's system prompt and authorized for `load_skill`.
   * - omitted or true: include every discovered skill visible to this agent
   * - string[]: include and authorize only listed visible skill IDs or this
   *   agent's own skill short names
   * - [] or false: advertise no skills and do not authorize project or
   *   configured skills for `load_skill`
   *
   * Discovery happens at startup via discoverAll().
   */
  skills?: true | false | string[];
  /**
   * Prompt starters shown on an empty chat.
   *
   * Use a flat array for source and Studio compatibility. The wrapped
   * `{ welcomeMessage, suggestions }` form remains supported.
   */
  suggestions?: SuggestionsConfig;
  /** Set to false to disable the default security middleware */
  security?: false;
}

/** Configuration used by resolved agent. */
// deno-lint-ignore no-explicit-any -- generic erasure: mirrors AgentConfig
export type ResolvedAgentConfig<TOutput = any> = AgentConfig<TOutput> & { model: ModelString };

/** Request payload for model transport. */
export interface ModelTransportRequest {
  agentId: string;
  requestedModel: ModelString;
  resolvedModel: ModelString;
  context?: Record<string, unknown>;
  mode: "generate" | "stream";
}

/** Provider-neutral reasoning / thinking option for model transport. */
export type RuntimeReasoningOption = {
  enabled?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  budgetTokens?: number;
};

/** Public API contract for resolved model transport. */
export interface ResolvedModelTransport {
  model?: ModelRuntime;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
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
  /** Flattened system instructions kept for backward-compatible text transforms. */
  system: string;
  /** Structured system instructions, when the runtime has provider-specific metadata. */
  structuredSystem?: ChatSystemMessage[];
  messages: Message[];
  context?: Record<string, unknown>;
}

/** State for resolved runtime. */
export interface ResolvedRuntimeState {
  /** Replacement system instructions as text. */
  system?: string;
  /** Replacement structured system instructions with provider-specific metadata. */
  structuredSystem?: ChatSystemMessage[];
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

/** Tool map that replaces an agent's configured tools for one generate request. */
export type AgentGenerateToolReplacements = Record<string, Tool>;

// Import for use in AgentMiddleware
import type { AgentContext, AgentResponse } from "./schemas/index.ts";

/**
 * Public API contract for agent middleware. Call `next` at most once during one
 * middleware invocation. The continuation becomes invalid when the middleware's
 * returned promise settles. Calling it again or after settlement rejects with
 * the registered `middleware-error`.
 */
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

/** Request payload accepted by `Agent.generate`. */
export interface AgentGenerateInput<
  TOutputSchema extends AgentOutputSchema | undefined = undefined,
> {
  input: string | Message[];
  context?: Record<string, unknown>;
  /** Override the agent's default model for this request. Must be in `allowedModels` if configured. */
  model?: ModelString;
  /** Override the maximum model output tokens for this request. */
  maxOutputTokens?: number;
  /**
   * Replace this agent's configured tools for this generate request only.
   * When present, only these tools are advertised and executable.
   */
  tools?: AgentGenerateToolReplacements;
  /**
   * @internal Retain framework skill loader tools while replacement tools are active.
   */
  retainSkillLoaderTools?: boolean;
  /**
   * Constrain this request to a schema, overriding `config.outputSchema`.
   * Omit to apply the configured schema, when there is one. When present, the
   * response type follows this override schema.
   */
  outputSchema?: TOutputSchema;
  /** Abort signal for cooperative cancellation. */
  abortSignal?: AbortSignal;
}

/** Request payload accepted by `Agent.stream`. */
export interface AgentStreamInput {
  input?: string;
  messages?: Message[];
  context?: Record<string, unknown>;
  /** Override the agent's default model for this request. Must be in `allowedModels` if configured. */
  model?: ModelString;
  /** Override the maximum model output tokens for this request. */
  maxOutputTokens?: number;
  onToolCall?: (toolCall: ToolCall) => void;
  onChunk?: (chunk: string) => void;
  /**
   * Receives the completed response, including the parsed `object` when an
   * `outputSchema` applies. The payload is the erased response type; use
   * `generate()` when the parsed value needs to arrive typed.
   */
  onFinish?: (response: AgentResponse) => void;
  /**
   * Constrain this request to a schema, overriding `config.outputSchema`.
   * Omit to apply the configured schema, when there is one.
   */
  outputSchema?: AgentOutputSchema;
  abortSignal?: AbortSignal;
}

/** Public API contract for agent. */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete Agent instantiation
export interface Agent<TOutput = any> {
  id: string;
  config: ResolvedAgentConfig<TOutput>;

  generate<TOutputSchema extends AgentOutputSchema>(
    input: AgentGenerateInput<TOutputSchema> & { outputSchema: TOutputSchema },
  ): Promise<AgentResponse<InferAgentOutputSchema<TOutputSchema>>>;
  generate(input: AgentGenerateInput): Promise<AgentResponse<TOutput>>;

  stream(input: AgentStreamInput): Promise<AgentStreamResult>;

  /** Convert an HTTP request into an AG-UI streaming response for route handlers. */
  respond(request: Request): Promise<Response>;

  getMemory(): Memory<Message>;

  getMemoryStats(): Promise<{
    totalMessages: number;
    estimatedTokens: number;
    type: string;
  }>;

  clearMemory(): Promise<void>;
}
