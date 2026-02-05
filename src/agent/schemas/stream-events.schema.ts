import { z } from "zod";

/** Events emitted during agent execution for real-time updates */
export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_start"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal("tool_call_delta"),
    id: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_complete"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
      arguments: z.string(),
    }),
  }),
  z.object({
    type: z.literal("finish"),
    finishReason: z.string().nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    usage: z.object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    }),
  }),
]);

// Inferred type
export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;
