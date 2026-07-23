import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";

/** Model providers supported by the built-in agent schema. */
export type ModelProvider = "openai" | "anthropic" | "google" | "local";

/** Runtime lifecycle states reported by an agent. */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "tool_execution"
  | "streaming"
  | "completed"
  | "error";

/** Built-in in-memory conversation retention configuration. */
export interface MemoryConfig {
  /** Retention strategy. */
  type: "conversation" | "buffer" | "summary";
  /** Approximate token capacity before older context is trimmed. */
  maxTokens?: number;
  /** Message capacity before older context is trimmed or summarized. */
  maxMessages?: number;
  /** Whether history persists across calls on this agent instance. */
  enabled?: boolean;
}

/** Edge-execution settings for an agent. */
export interface EdgeConfig {
  /** Whether edge execution is enabled. */
  enabled: boolean;
  /** Maximum model steps. */
  maxSteps?: number;
  /** Execution timeout in milliseconds. */
  timeoutMs?: number;
  /** Whether responses stream incrementally. */
  streaming?: boolean;
}

/** Tool-call message part that stores arguments. */
export interface ToolCallPartWithArgs {
  /** Provider-specific tool part type. */
  type: string;
  /** Tool call identifier. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Parsed tool arguments. */
  args: Record<string, unknown>;
  /** Serialized tool input, when available. */
  inputText?: string;
  /** Whether the provider executed the tool. */
  providerExecuted?: boolean;
}

/** Tool-call message part that stores input. */
export interface ToolCallPartWithInput {
  /** Provider-specific tool part type. */
  type: string;
  /** Tool call identifier. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Parsed tool input. */
  input: Record<string, unknown>;
  /** Serialized tool input, when available. */
  inputText?: string;
  /** Whether the provider executed the tool. */
  providerExecuted?: boolean;
}

/** Agent message part for a tool call. */
export type ToolCallPart = ToolCallPartWithArgs | ToolCallPartWithInput;

/** Agent message part for a tool result. */
export interface ToolResultPart {
  /** Part discriminator. */
  type: "tool-result";
  /** Tool call identifier. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
  /** Tool result value, when present. */
  result?: unknown;
  /** Whether the provider executed the tool. */
  providerExecuted?: boolean;
}

/** Message part accepted by the agent runtime. */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text?: string; signature?: string; redactedData?: string }
  | ToolCallPart
  | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | ToolResultPart
  | { type: "image"; url: string; mediaType: string }
  | { type: "file"; url: string; mediaType: string };

/** Message exchanged with an agent. */
export interface Message {
  /** Message identifier. */
  id: string;
  /** Message author role. */
  role: "user" | "assistant" | "system" | "tool";
  /** Ordered message content. */
  parts: MessagePart[];
  /** Optional numeric timestamp. */
  timestamp?: number;
  /** Additional message metadata. */
  metadata?: Record<string, unknown>;
}

/** Tool call emitted by a streaming provider transport. */
export interface StreamToolCall {
  /** Tool call identifier. */
  id: string;
  /** Tool name. */
  name: string;
  /** Parsed tool arguments. */
  arguments: Record<string, unknown>;
}

/** Tool call tracked in a finalized agent response. */
export interface ToolCall {
  /** Tool call identifier. */
  id: string;
  /** Tool name. */
  name: string;
  /** Parsed tool arguments. */
  args: Record<string, unknown>;
  /** Serialized tool input, when available. */
  inputText?: string;
  /** Current execution status. */
  status: "pending" | "executing" | "completed" | "error";
  /** Tool result value. */
  result?: unknown;
  /** Tool error message. */
  error?: string;
  /** Tool execution duration in milliseconds. */
  executionTime?: number;
}

/** Token and billing usage attached to an agent response. */
export interface AgentResponseUsage {
  /** Provider prompt tokens. */
  promptTokens: number;
  /** Provider completion tokens. */
  completionTokens: number;
  /** Total provider tokens. */
  totalTokens: number;
  /** Cached provider input tokens. */
  cachedInputTokens?: number;
  /** Provider cache-creation input tokens. */
  cacheCreationInputTokens?: number;
  /** Provider cache-read input tokens. */
  cacheReadInputTokens?: number;
  /** Provider reasoning tokens. */
  reasoningTokens?: number;
  /** Billable input tokens. */
  billableInputTokens?: number;
  /** Billable output tokens. */
  billableOutputTokens?: number;
  /** Total cost in US dollars. */
  costUsd?: number;
  /** Provider input cost in US dollars. */
  providerInputCostUsd?: number;
  /** Provider output cost in US dollars. */
  providerOutputCostUsd?: number;
  /** Total provider cost in US dollars. */
  providerCostUsd?: number;
  /** Veryfront input charge in US dollars. */
  veryfrontInputChargeUsd?: number;
  /** Veryfront output charge in US dollars. */
  veryfrontOutputChargeUsd?: number;
  /** Total Veryfront charge in US dollars. */
  veryfrontChargeUsd?: number;
  /** Amount billed by Veryfront in US dollars. */
  veryfrontBilledUsd?: number;
  /** Usage cost in credits. */
  costCredits?: number;
  /** Source and completeness of cost data. */
  costSource?: "gateway" | "missing" | "partial";
  /** Billing settlement mode. */
  billingMode?: "direct" | "deferred";
  /** Completeness of captured token usage. */
  usageCaptureStatus?: "complete" | "partial" | "missing";
}

/** Final response returned by an agent. */
export interface AgentResponse {
  /** Final assistant text. */
  text: string;
  /** Messages produced during execution. */
  messages: Message[];
  /** Tool calls observed during execution. */
  toolCalls: ToolCall[];
  /** Final agent status. */
  status: AgentStatus;
  /** Optional reasoning summary. */
  thinking?: string;
  /** Optional token and billing usage. */
  usage?: AgentResponseUsage;
  /** Additional response metadata. */
  metadata?: Record<string, unknown>;
}

/** Context passed through agent middleware. */
export interface AgentContext {
  /** Additional context fields supplied by middleware integrations. */
  [key: string]: unknown;
  /** Agent identifier. */
  agentId: string;
  /** Resolved model identifier. */
  model?: string;
  /** User input or normalized message history. */
  input: string | Message[];
  /** Request-scoped data. */
  data?: Record<string, unknown>;
  /** Platform adapter used for execution. */
  platform?: any;
  /** Additional context metadata. */
  metadata?: Record<string, unknown>;
}

/** Returns the model provider schema. */
export const getModelProviderSchema: () => Schema<ModelProvider> = defineSchema((v) =>
  v.enum(["openai", "anthropic", "google", "local"] as const)
);

/** Returns the agent status schema. */
export const getAgentStatusSchema: () => Schema<AgentStatus> = defineSchema((v) =>
  v.enum(
    [
      "idle",
      "thinking",
      "tool_execution",
      "streaming",
      "completed",
      "error",
    ] as const,
  )
);

/** Returns the memory configuration schema. */
export const getMemoryConfigSchema: () => Schema<MemoryConfig> = defineSchema((v) =>
  v.object({
    type: v.enum(["conversation", "buffer", "summary"] as const),
    maxTokens: v.number().int().positive().optional(),
    maxMessages: v.number().int().positive().optional(),
    // Persist history across calls on the agent instance. Defaults to true when
    // a memory config is provided; set false to keep every call isolated.
    enabled: v.boolean().optional(),
  })
);

/** Returns the edge configuration schema. */
export const getEdgeConfigSchema: () => Schema<EdgeConfig> = defineSchema((v) =>
  v.object({
    enabled: v.boolean(),
    maxSteps: v.number().int().positive().optional(),
    timeoutMs: v.number().int().positive().optional(),
    streaming: v.boolean().optional(),
  })
);

/** Returns the argument-based tool-call part schema. */
export const getToolCallPartWithArgsSchema: () => Schema<ToolCallPartWithArgs> = defineSchema((v) =>
  v.object({
    type: v.string().regex(/^tool-.+$/),
    toolCallId: v.string(),
    toolName: v.string(),
    args: v.record(v.string(), v.unknown()),
    inputText: v.string().optional(),
    providerExecuted: v.boolean().optional(),
  })
);

/** Returns the input-based tool-call part schema. */
export const getToolCallPartWithInputSchema: () => Schema<ToolCallPartWithInput> = defineSchema((
  v,
) =>
  v.object({
    type: v.string().regex(/^tool-.+$/),
    toolCallId: v.string(),
    toolName: v.string(),
    input: v.record(v.string(), v.unknown()),
    inputText: v.string().optional(),
    providerExecuted: v.boolean().optional(),
  })
);

/** Returns the tool-call part schema. */
export const getToolCallPartSchema: () => Schema<ToolCallPart> = defineSchema((v) =>
  v.union([
    getToolCallPartWithArgsSchema(),
    getToolCallPartWithInputSchema(),
  ])
);

/** Returns the tool-result part schema. */
export const getToolResultPartSchema: () => Schema<ToolResultPart> = defineSchema((v) =>
  v.object({
    type: v.literal("tool-result"),
    toolCallId: v.string(),
    toolName: v.string(),
    result: v.unknown(),
    providerExecuted: v.boolean().optional(),
  })
);

/** Compatibility policy for the legacy inline tool-call message part. */
export const AGENT_SCHEMA_LEGACY_TOOL_CALL_PART_POLICY = {
  status: "compatibility-retained",
  legacyShape: '{ type: "tool-call", toolCallId, toolName, args }',
  canonicalShape: 'tool-prefixed message parts with "args" or "input"',
  removalGate:
    "Remove only in a planned breaking release after migration guidance and stored-message backfill coverage exist.",
} as const;

// Helper for the inline tool-call alternative within MessagePartSchema.
// Keep this branch in sync with AGENT_SCHEMA_LEGACY_TOOL_CALL_PART_POLICY.
const inlineToolCallPartShape = (v: SchemaValidator) =>
  v.object({
    type: v.literal("tool-call"),
    toolCallId: v.string(),
    toolName: v.string(),
    args: v.record(v.string(), v.unknown()),
  });

/** Returns the agent message part schema. */
export const getMessagePartSchema: () => Schema<MessagePart> = defineSchema((v) =>
  v.union([
    v.object({
      type: v.literal("text"),
      text: v.string(),
    }),
    v.object({
      type: v.literal("reasoning"),
      text: v.string().optional(),
      signature: v.string().optional(),
      redactedData: v.string().optional(),
    }),
    getToolCallPartSchema(),
    inlineToolCallPartShape(v),
    getToolResultPartSchema(),
    v.object({
      type: v.literal("image"),
      url: v.string(),
      mediaType: v.string(),
    }),
    v.object({
      type: v.literal("file"),
      url: v.string(),
      mediaType: v.string(),
    }),
  ])
);

/** Returns the agent message schema. */
export const getMessageSchema: () => Schema<Message> = defineSchema((v) =>
  v.object({
    id: v.string(),
    role: v.enum(["user", "assistant", "system", "tool"] as const),
    parts: v.array(getMessagePartSchema()),
    timestamp: v.number().int().nonnegative().optional(),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

/** Returns the streaming tool-call schema. */
export const getStreamToolCallSchema: () => Schema<StreamToolCall> = defineSchema((v) =>
  v.object({
    id: v.string(),
    name: v.string(),
    arguments: v.record(v.string(), v.unknown()),
  })
);

/** Returns the finalized tool-call schema. */
export const getToolCallSchema: () => Schema<ToolCall> = defineSchema((v) =>
  v.object({
    id: v.string(),
    name: v.string(),
    args: v.record(v.string(), v.unknown()),
    inputText: v.string().optional(),
    status: v.enum(["pending", "executing", "completed", "error"] as const),
    result: v.unknown().optional(),
    error: v.string().optional(),
    executionTime: v.number().nonnegative().optional(),
  })
);

/** Returns the agent response schema. */
export const getAgentResponseSchema: () => Schema<AgentResponse> = defineSchema((v) =>
  v.object({
    text: v.string(),
    messages: v.array(getMessageSchema()),
    toolCalls: v.array(getToolCallSchema()),
    status: getAgentStatusSchema(),
    thinking: v.string().optional(),
    usage: v
      .object({
        promptTokens: v.number().int().nonnegative(),
        completionTokens: v.number().int().nonnegative(),
        totalTokens: v.number().int().nonnegative(),
        cachedInputTokens: v.number().int().nonnegative().optional(),
        cacheCreationInputTokens: v.number().int().nonnegative().optional(),
        cacheReadInputTokens: v.number().int().nonnegative().optional(),
        reasoningTokens: v.number().int().nonnegative().optional(),
        billableInputTokens: v.number().int().nonnegative().optional(),
        billableOutputTokens: v.number().int().nonnegative().optional(),
        costUsd: v.number().nonnegative().optional(),
        providerInputCostUsd: v.number().nonnegative().optional(),
        providerOutputCostUsd: v.number().nonnegative().optional(),
        providerCostUsd: v.number().nonnegative().optional(),
        veryfrontInputChargeUsd: v.number().nonnegative().optional(),
        veryfrontOutputChargeUsd: v.number().nonnegative().optional(),
        veryfrontChargeUsd: v.number().nonnegative().optional(),
        veryfrontBilledUsd: v.number().nonnegative().optional(),
        costCredits: v.number().nonnegative().optional(),
        costSource: v.enum(["gateway", "missing", "partial"] as const).optional(),
        billingMode: v.enum(["direct", "deferred"] as const).optional(),
        usageCaptureStatus: v.enum(["complete", "partial", "missing"] as const).optional(),
      })
      .optional(),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

/** Returns the agent middleware context schema. */
export const getAgentContextSchema: () => Schema<AgentContext> = defineSchema((v) =>
  v.object({
    agentId: v.string(),
    model: v.string().optional(),
    input: v.union([v.string(), v.array(getMessageSchema())]),
    data: v.record(v.string(), v.unknown()).optional(),
    platform: v.any(), // Platform type is complex
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);
