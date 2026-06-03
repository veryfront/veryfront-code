import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";

export const getModelProviderSchema = defineSchema((v) =>
  v.enum(["openai", "anthropic", "google", "local"] as const)
);

export const getAgentStatusSchema = defineSchema((v) =>
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

export const getMemoryConfigSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["conversation", "buffer", "summary", "redis"] as const),
    maxTokens: v.number().int().positive().optional(),
    maxMessages: v.number().int().positive().optional(),
  })
);

export const getEdgeConfigSchema = defineSchema((v) =>
  v.object({
    enabled: v.boolean(),
    maxSteps: v.number().int().positive().optional(),
    timeoutMs: v.number().int().positive().optional(),
    streaming: v.boolean().optional(),
  })
);

export const getToolCallPartWithArgsSchema = defineSchema((v) =>
  v.object({
    type: v.string().regex(/^tool-.+$/),
    toolCallId: v.string(),
    toolName: v.string(),
    args: v.record(v.string(), v.unknown()),
    inputText: v.string().optional(),
    providerExecuted: v.boolean().optional(),
  })
);

export const getToolCallPartWithInputSchema = defineSchema((v) =>
  v.object({
    type: v.string().regex(/^tool-.+$/),
    toolCallId: v.string(),
    toolName: v.string(),
    input: v.record(v.string(), v.unknown()),
    inputText: v.string().optional(),
    providerExecuted: v.boolean().optional(),
  })
);

export const getToolCallPartSchema = defineSchema((v) =>
  v.union([
    getToolCallPartWithArgsSchema(),
    getToolCallPartWithInputSchema(),
  ])
);

export const getToolResultPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("tool-result"),
    toolCallId: v.string(),
    toolName: v.string(),
    result: v.unknown(),
    providerExecuted: v.boolean().optional(),
  })
);

// Helper for the inline tool-call alternative within MessagePartSchema —
// matches the legacy `{ type: "tool-call", ... }` shape distinct from the
// top-level ToolCallPart variants above.
const inlineToolCallPartShape = (v: SchemaValidator) =>
  v.object({
    type: v.literal("tool-call"),
    toolCallId: v.string(),
    toolName: v.string(),
    args: v.record(v.string(), v.unknown()),
  });

export const getMessagePartSchema = defineSchema((v) =>
  v.union([
    v.object({
      type: v.literal("text"),
      text: v.string(),
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

export const getMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    role: v.enum(["user", "assistant", "system", "tool"] as const),
    parts: v.array(getMessagePartSchema()),
    timestamp: v.number().int().nonnegative().optional(),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

export const getStreamToolCallSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    name: v.string(),
    arguments: v.record(v.string(), v.unknown()),
  })
);

export const getToolCallSchema = defineSchema((v) =>
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

export const getAgentResponseSchema = defineSchema((v) =>
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
      })
      .optional(),
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

export const getAgentContextSchema = defineSchema((v) =>
  v.object({
    agentId: v.string(),
    model: v.string().optional(),
    input: v.union([v.string(), v.array(getMessageSchema())]),
    data: v.record(v.string(), v.unknown()).optional(),
    platform: v.any(), // Platform type is complex
    metadata: v.record(v.string(), v.unknown()).optional(),
  })
);

// Inferred types
/** Public API contract for model provider. */
export type ModelProvider = InferSchema<ReturnType<typeof getModelProviderSchema>>;
/** Public API contract for agent status. */
export type AgentStatus = InferSchema<ReturnType<typeof getAgentStatusSchema>>;
/** Configuration used by memory. */
export type MemoryConfig = InferSchema<ReturnType<typeof getMemoryConfigSchema>>;
/** Configuration used by edge. */
export type EdgeConfig = InferSchema<ReturnType<typeof getEdgeConfigSchema>>;
/** Tool-call message part that stores arguments. */
export type ToolCallPartWithArgs = InferSchema<ReturnType<typeof getToolCallPartWithArgsSchema>>;
/** Tool-call message part that stores input. */
export type ToolCallPartWithInput = InferSchema<ReturnType<typeof getToolCallPartWithInputSchema>>;
/** Agent message part for a tool call. */
export type ToolCallPart = InferSchema<ReturnType<typeof getToolCallPartSchema>>;
/** Agent message part for a tool result. */
export type ToolResultPart = InferSchema<ReturnType<typeof getToolResultPartSchema>>;
/** Public API contract for message part. */
export type MessagePart = InferSchema<ReturnType<typeof getMessagePartSchema>>;
/** Message exchanged with an agent. */
export type Message = InferSchema<ReturnType<typeof getMessageSchema>>;
/** Public API contract for stream tool call. */
export type StreamToolCall = InferSchema<ReturnType<typeof getStreamToolCallSchema>>;
/** Public API contract for tool call. */
export type ToolCall = InferSchema<ReturnType<typeof getToolCallSchema>>;
/** Response payload for agent. */
export type AgentResponse = InferSchema<ReturnType<typeof getAgentResponseSchema>>;
/** Context for agent. */
export type AgentContext = InferSchema<ReturnType<typeof getAgentContextSchema>>;
