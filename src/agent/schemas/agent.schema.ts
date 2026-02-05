import { z } from "zod";

export const modelProviderSchema = z.enum(["openai", "anthropic", "google", "local"]);

export const agentStatusSchema = z.enum([
  "idle",
  "thinking",
  "tool_execution",
  "streaming",
  "completed",
  "error",
]);

export const MemoryConfigSchema = z.object({
  type: z.enum(["conversation", "buffer", "summary", "redis"]),
  maxTokens: z.number().int().positive().optional(),
  maxMessages: z.number().int().positive().optional(),
});

export const EdgeConfigSchema = z.object({
  enabled: z.boolean(),
  maxSteps: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  streaming: z.boolean().optional(),
});

export const ToolCallPartWithArgsSchema = z.object({
  type: z.string().regex(/^tool-.+$/),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.unknown()),
});

export const ToolCallPartWithInputSchema = z.object({
  type: z.string().regex(/^tool-.+$/),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.record(z.unknown()),
});

export const ToolCallPartSchema = z.union([
  ToolCallPartWithArgsSchema,
  ToolCallPartWithInputSchema,
]);

export const ToolResultPartSchema = z.object({
  type: z.literal("tool-result"),
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
});

export const MessagePartSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  ToolCallPartSchema,
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.unknown()),
  }),
  ToolResultPartSchema,
]);

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(MessagePartSchema),
  timestamp: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const StreamToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.unknown()),
  status: z.enum(["pending", "executing", "completed", "error"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
  executionTime: z.number().nonnegative().optional(),
});

export const AgentResponseSchema = z.object({
  text: z.string(),
  messages: z.array(MessageSchema),
  toolCalls: z.array(ToolCallSchema),
  status: agentStatusSchema,
  thinking: z.string().optional(),
  usage: z
    .object({
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const AgentContextSchema = z.object({
  agentId: z.string(),
  model: z.string().optional(),
  input: z.union([z.string(), z.array(MessageSchema)]),
  data: z.record(z.unknown()).optional(),
  platform: z.any(), // Platform type is complex
  metadata: z.record(z.unknown()).optional(),
});

// Inferred types
export type ModelProvider = z.infer<typeof modelProviderSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type EdgeConfig = z.infer<typeof EdgeConfigSchema>;
export type ToolCallPartWithArgs = z.infer<typeof ToolCallPartWithArgsSchema>;
export type ToolCallPartWithInput = z.infer<typeof ToolCallPartWithInputSchema>;
export type ToolCallPart = z.infer<typeof ToolCallPartSchema>;
export type ToolResultPart = z.infer<typeof ToolResultPartSchema>;
export type MessagePart = z.infer<typeof MessagePartSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type StreamToolCall = z.infer<typeof StreamToolCallSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
export type AgentContext = z.infer<typeof AgentContextSchema>;
