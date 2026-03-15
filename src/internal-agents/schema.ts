import { z } from "zod";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 65_536;
const MAX_TOOL_RESULT_BYTES = 65_536;
const MAX_RUNTIME_MESSAGES = 100;

const encoder = new TextEncoder();

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

export const RunIdSchema = z.string().min(1).max(128).regex(AGENT_ID_PATTERN);

export const AgentIdSchema = z.string().min(1).max(128).regex(AGENT_ID_PATTERN);

export const StudioToolNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^studio_[a-zA-Z0-9_]+$/, "Tool names must use the studio_ prefix");

export const RuntimeInjectedToolSchema = z.object({
  name: StudioToolNameSchema,
  description: z.string().max(1024).optional(),
  parameters: z.record(z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool parameters must be less than 16 KB" },
  ),
});

export const RuntimeContextItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    title: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES),
  }),
  z.object({
    type: z.literal("json"),
    title: z.string().max(256).optional(),
    data: z.record(z.unknown()).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_ITEM_BYTES),
      { message: "JSON context item must be less than 16 KB" },
    ),
  }),
  z.object({
    type: z.literal("resource"),
    title: z.string().max(256).optional(),
    uri: z.string().max(2048),
    mimeType: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES).optional(),
  }),
]);

export const RuntimeRunAgentInputSchema = z.object({
  agentId: AgentIdSchema,
  threadId: z.string().uuid(),
  runId: RunIdSchema,
  messages: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(["user", "assistant", "system", "tool"]),
      parts: z.array(z.object({ type: z.string().min(1) }).passthrough()).default([]),
      metadata: z.record(z.unknown()).optional(),
      createdAt: z.string().optional(),
    }),
  ).max(MAX_RUNTIME_MESSAGES),
  tools: z.array(RuntimeInjectedToolSchema).max(50).default([]),
  context: z.array(RuntimeContextItemSchema).max(10).default([]).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
    { message: "context must be less than 64 KB total" },
  ),
  forwardedProps: z.record(z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
    { message: "forwardedProps must be less than 64 KB" },
  ),
});

export const ResumeSignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string().min(1).max(128),
    result: z.unknown().refine(
      (value) => isWithinJsonSizeLimit(value, MAX_TOOL_RESULT_BYTES),
      { message: "Tool result must be less than 64 KB" },
    ),
    isError: z.boolean().optional().default(false),
  }),
]);

export type RuntimeInjectedTool = z.infer<typeof RuntimeInjectedToolSchema>;
export type RuntimeContextItem = z.infer<typeof RuntimeContextItemSchema>;
export type RuntimeRunAgentInput = z.infer<typeof RuntimeRunAgentInputSchema>;
export type ResumeSignal = z.infer<typeof ResumeSignalSchema>;
