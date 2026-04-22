import { z } from "zod";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 65_536;
const MAX_RUNTIME_MESSAGES = 100;

const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

export const AgUiRuntimeRunIdSchema = z.string().min(1).max(128).regex(AGENT_ID_PATTERN);

export const AgUiRuntimeInjectedToolSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9._:-]*$/,
      "Tool names must start with a letter and use a valid client-tool format",
    ),
  description: z.string().max(1024).optional(),
  parameters: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool parameters must be less than 16 KB" },
  ),
});

export const AgUiRuntimeContextItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    title: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES),
  }),
  z.object({
    type: z.literal("json"),
    title: z.string().max(256).optional(),
    data: z.record(z.string(), z.unknown()).refine(
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

const RuntimeMessageExtensionFieldsSchema = {
  name: z.string().max(256).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
} as const;

export const AgUiRuntimeToolFunctionCallSchema = z.object({
  name: AgUiRuntimeInjectedToolSchema.shape.name,
  arguments: z.string().max(MAX_TOOL_PARAMETERS_BYTES),
}).strict();

export const AgUiRuntimeToolCallSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("function"),
  function: AgUiRuntimeToolFunctionCallSchema,
}).strict();

export const AgUiRuntimeSystemMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("system"),
  content: z.string(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const AgUiRuntimeUserMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("user"),
  content: z.string(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const AgUiRuntimeAssistantMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("assistant"),
  content: z.string().optional(),
  toolCalls: z.array(AgUiRuntimeToolCallSchema).optional(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const AgUiRuntimeToolMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("tool"),
  toolCallId: z.string().min(1).max(128),
  content: z.string(),
  error: z.string().optional(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const AgUiRuntimeMessageSchema = z.discriminatedUnion("role", [
  AgUiRuntimeSystemMessageSchema,
  AgUiRuntimeUserMessageSchema,
  AgUiRuntimeAssistantMessageSchema,
  AgUiRuntimeToolMessageSchema,
]);

export const AgUiRuntimeContextSchema = z.union([
  z.object({
    description: z.string().max(1024),
    value: z.string().max(MAX_CONTEXT_ITEM_BYTES),
  }),
  AgUiRuntimeContextItemSchema,
]);

export const AgUiRuntimeRequestSchema = z.object({
  threadId: z.string().uuid(),
  runId: AgUiRuntimeRunIdSchema,
  parentRunId: AgUiRuntimeRunIdSchema.optional(),
  state: z.unknown().optional(),
  messages: z.array(AgUiRuntimeMessageSchema).max(MAX_RUNTIME_MESSAGES),
  tools: z.array(AgUiRuntimeInjectedToolSchema).max(50).default([]),
  context: z.array(AgUiRuntimeContextSchema).max(10).default([]).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
    { message: "context must be less than 64 KB total" },
  ),
  forwardedProps: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
    { message: "forwardedProps must be less than 64 KB" },
  ),
});

export type AgUiRuntimeInjectedTool = z.infer<typeof AgUiRuntimeInjectedToolSchema>;
export type AgUiRuntimeContextItem = z.infer<typeof AgUiRuntimeContextItemSchema>;
export type AgUiRuntimeMessage = z.infer<typeof AgUiRuntimeMessageSchema>;
export type AgUiRuntimeRequest = z.infer<typeof AgUiRuntimeRequestSchema>;

export function normalizeAgUiBrowserRuntimeRequest(
  input: AgUiRuntimeRequest,
  defaults?: {
    threadId?: string;
    runId?: string;
  },
): AgUiRuntimeRequest {
  const { state, ...rest } = input;

  return {
    ...rest,
    threadId: defaults?.threadId ?? input.threadId,
    runId: defaults?.runId ?? input.runId,
    messages: input.messages,
    ...(isRecord(state) ? { state } : {}),
  };
}

export async function parseAgUiRuntimeRequest(request: Request): Promise<AgUiRuntimeRequest> {
  return AgUiRuntimeRequestSchema.parse(await request.json());
}

export async function parseAgUiRuntimeRequestOrError(
  request: Request,
): Promise<AgUiRuntimeRequest | Response> {
  try {
    return await parseAgUiRuntimeRequest(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "Invalid AG-UI runtime request",
          details: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    if (error instanceof SyntaxError || error instanceof TypeError) {
      return Response.json(
        {
          error: "Invalid AG-UI runtime request",
          details: [{ path: [], message: "Malformed JSON request body" }],
        },
        { status: 400 },
      );
    }

    throw error;
  }
}
