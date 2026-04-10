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

export const ClientToolNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9._:-]*$/,
    "Tool names must start with a letter and use a valid client-tool format",
  );

export const RuntimeInjectedToolSchema = z.object({
  name: ClientToolNameSchema,
  description: z.string().max(1024).optional(),
  parameters: z.record(z.string(), z.unknown()).optional().refine(
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

export const RuntimeAgentSourceContextSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("branch"),
    branch: z.string().min(1).max(255),
  }),
  z.object({
    type: z.literal("environment"),
    environmentName: z.string().min(1).max(255),
    releaseId: z.string().min(1).max(255).optional(),
  }),
  z.object({
    type: z.literal("release"),
    releaseId: z.string().min(1).max(255),
  }),
]);

const RuntimeMessageExtensionFieldsSchema = {
  name: z.string().max(256).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
} as const;

export const RuntimeToolFunctionCallSchema = z.object({
  name: ClientToolNameSchema,
  arguments: z.string().max(MAX_TOOL_PARAMETERS_BYTES),
}).strict();

export const RuntimeToolCallSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("function"),
  function: RuntimeToolFunctionCallSchema,
}).strict();

export const RuntimeSystemMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("system"),
  content: z.string(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const RuntimeUserMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("user"),
  content: z.string(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const RuntimeAssistantMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("assistant"),
  content: z.string().optional(),
  toolCalls: z.array(RuntimeToolCallSchema).optional(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const RuntimeToolMessageSchema = z.object({
  id: z.string().min(1),
  role: z.literal("tool"),
  toolCallId: z.string().min(1).max(128),
  content: z.string(),
  error: z.string().optional(),
  ...RuntimeMessageExtensionFieldsSchema,
}).strict();

export const RuntimeMessageSchema = z.discriminatedUnion("role", [
  RuntimeSystemMessageSchema,
  RuntimeUserMessageSchema,
  RuntimeAssistantMessageSchema,
  RuntimeToolMessageSchema,
]);

export const RuntimeContextSchema = z.union([
  z.object({
    description: z.string().max(1024),
    value: z.string().max(MAX_CONTEXT_ITEM_BYTES),
  }),
  RuntimeContextItemSchema,
]);

export const RuntimeRunAgentInputSchema = z.object({
  threadId: z.string().uuid(),
  runId: RunIdSchema,
  parentRunId: RunIdSchema.optional(),
  state: z.unknown().optional(),
  messages: z.array(RuntimeMessageSchema).max(MAX_RUNTIME_MESSAGES),
  tools: z.array(RuntimeInjectedToolSchema).max(50).default([]),
  context: z.array(RuntimeContextSchema).max(10).default([]).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
    { message: "context must be less than 64 KB total" },
  ),
  forwardedProps: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
    { message: "forwardedProps must be less than 64 KB" },
  ),
});

export const InternalAgentCompatibilityMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(z.object({ type: z.string().min(1) }).passthrough()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
});

export const InternalAgentStreamRequestSchema = z.object({
  agentId: AgentIdSchema,
  threadId: z.string().uuid(),
  runId: RunIdSchema,
  parentRunId: RunIdSchema.optional(),
  state: z.unknown().optional(),
  messages: z.array(z.union([RuntimeMessageSchema, InternalAgentCompatibilityMessageSchema])).max(
    MAX_RUNTIME_MESSAGES,
  ),
  tools: z.array(RuntimeInjectedToolSchema).max(50).default([]),
  context: z.array(RuntimeContextSchema).max(10).default([]).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
    { message: "context must be less than 64 KB total" },
  ),
  agentSource: RuntimeAgentSourceContextSchema.optional(),
  forwardedProps: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
    { message: "forwardedProps must be less than 64 KB" },
  ),
});

type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;
type InternalAgentCompatibilityMessage = z.infer<typeof InternalAgentCompatibilityMessageSchema>;

function extractToolArgs(
  part: Record<string, unknown>,
): Record<string, unknown> {
  const args = part.args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }

  const input = part.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

function serializeToolArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return "{}";
  }
}

function getPartString(
  part: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = part[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function isLegacyToolCallPart(part: Record<string, unknown>): boolean {
  return getPartString(part, "type") === "tool_call";
}

function isCanonicalToolCallPart(part: Record<string, unknown>): boolean {
  const type = getPartString(part, "type");

  return type === "tool-call" ||
    (typeof type === "string" && type.startsWith("tool-") && type !== "tool-result" &&
      type !== "tool_result");
}

function getToolCallShape(
  part: Record<string, unknown>,
): z.infer<typeof RuntimeToolCallSchema> | null {
  const id = getPartString(part, "toolCallId", "tool_call_id", "id");
  const name = getPartString(part, "toolName", "tool_name", "name");

  if (!id || !name) {
    return null;
  }

  return {
    id,
    type: "function",
    function: {
      name,
      arguments: serializeToolArguments(extractToolArgs(part)),
    },
  };
}

function isToolResultPart(part: Record<string, unknown>): boolean {
  const type = getPartString(part, "type");
  return type === "tool-result" || type === "tool_result";
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function toRuntimeMessage(
  message: RuntimeMessage | InternalAgentCompatibilityMessage,
): RuntimeMessage {
  if (!("parts" in message)) {
    return message;
  }

  const textContent = message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

  const sharedFields = {
    ...(message.metadata ? { metadata: message.metadata } : {}),
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
  };

  switch (message.role) {
    case "system":
      return {
        id: message.id,
        role: "system",
        content: textContent,
        ...sharedFields,
      };
    case "user":
      return {
        id: message.id,
        role: "user",
        content: textContent,
        ...sharedFields,
      };
    case "assistant": {
      const toolCalls = message.parts.flatMap((part) => {
        if (!isCanonicalToolCallPart(part) && !isLegacyToolCallPart(part)) {
          return [];
        }

        const toolCall = getToolCallShape(part);
        return toolCall ? [toolCall] : [];
      });

      return {
        id: message.id,
        role: "assistant",
        ...(textContent ? { content: textContent } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
        ...sharedFields,
      };
    }
    case "tool": {
      const toolResultPart = message.parts.find(
        (part) =>
          isToolResultPart(part) && getPartString(part, "toolCallId", "tool_call_id") !== null,
      );
      const toolCallId = toolResultPart
        ? getPartString(toolResultPart, "toolCallId", "tool_call_id")
        : null;
      const toolResult = toolResultPart && "result" in toolResultPart
        ? toolResultPart.result
        : toolResultPart && "output" in toolResultPart
        ? toolResultPart.output
        : undefined;
      const toolError = toolResultPart ? getPartString(toolResultPart, "error") : null;

      return {
        id: message.id,
        role: "tool",
        toolCallId: toolCallId ?? message.id,
        content: toolResult !== undefined ? stringifyToolResult(toolResult) : textContent,
        ...(toolError ? { error: toolError } : {}),
        ...sharedFields,
      };
    }
  }
}

export function toRuntimeRunAgentInput(
  input: z.infer<typeof InternalAgentStreamRequestSchema>,
): z.infer<typeof RuntimeRunAgentInputSchema> {
  return {
    threadId: input.threadId,
    runId: input.runId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    messages: input.messages.map(toRuntimeMessage),
    tools: input.tools,
    context: input.context,
    ...(input.forwardedProps ? { forwardedProps: input.forwardedProps } : {}),
  };
}

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
export type RuntimeAgentSourceContext = z.infer<typeof RuntimeAgentSourceContextSchema>;
export type RuntimeRunAgentInput = z.infer<typeof RuntimeRunAgentInputSchema>;
export type InternalAgentStreamRequest = z.infer<typeof InternalAgentStreamRequestSchema>;
export type ResumeSignal = z.infer<typeof ResumeSignalSchema>;
