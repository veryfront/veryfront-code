import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import {
  type AgUiRuntimeContextItem,
  type AgUiRuntimeMessage,
  type AgUiRuntimeRequest,
  getAgUiRuntimeContextItemSchema,
  getAgUiRuntimeContextSchema,
  getAgUiRuntimeInjectedToolSchema,
  getAgUiRuntimeMessageSchema,
  getAgUiRuntimeRequestSchema,
  getAgUiRuntimeRunIdSchema,
  getAgUiRuntimeToolCallSchema,
} from "#veryfront/agent/runtime/ag-ui-contract.ts";
import { stripLeadingEmptyObjectPlaceholder } from "#veryfront/agent/streaming/data-stream.ts";
import { getRuntimeAgentMarkdownDefinitionSchema } from "#veryfront/agent/runtime/agent-definition.ts";
import {
  getRuntimeAgentCredentialsSchema,
  getRuntimeAgentSourceContextSchema,
  type RuntimeAgentSourceContext,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_AGENT_CONFIG_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 196_608;
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

export const getRunIdSchema = getAgUiRuntimeRunIdSchema;

export const getAgentIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(AGENT_ID_PATTERN)
);

export const getRuntimeInjectedToolSchema = getAgUiRuntimeInjectedToolSchema;
export const getRuntimeContextItemSchema = getAgUiRuntimeContextItemSchema;
export const getRuntimeMessageSchema = getAgUiRuntimeMessageSchema;
export const getRuntimeContextSchema = getAgUiRuntimeContextSchema;
export const getRuntimeRunAgentInputSchema = getAgUiRuntimeRequestSchema;

export const getInternalAgentCompatibilityMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: v.enum(["user", "assistant", "system", "tool"] as const),
    parts: v.array(v.object({ type: v.string().min(1) }).passthrough()).default([]),
    metadata: v.record(v.string(), v.unknown()).optional(),
    createdAt: v.string().optional(),
  })
);

export const getInternalAgentControlPlaneStreamRequestSchema = defineSchema((v) =>
  v.object({
    agentId: getAgentIdSchema(),
    threadId: v.string().uuid(),
    runId: getRunIdSchema(),
    parentRunId: getRunIdSchema().optional(),
    state: v.unknown().optional(),
    messages: v.array(
      v.union([getRuntimeMessageSchema(), getInternalAgentCompatibilityMessageSchema()]),
    ).max(MAX_RUNTIME_MESSAGES),
    tools: v.array(getRuntimeInjectedToolSchema()).max(50).default([]),
    context: v.array(getRuntimeContextSchema()).max(10).default([]).refine(
      (value) => isWithinJsonSizeLimit(value, 65_536),
      { message: "context must be less than 64 KB total" },
    ),
    runtimeTargetEnvironmentId: v.string().uuid().nullable().optional(),
    runtimeTargetBranchId: v.string().uuid().nullable().optional(),
    agentSource: getRuntimeAgentSourceContextSchema(),
    agentConfig: getRuntimeAgentMarkdownDefinitionSchema().optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_AGENT_CONFIG_BYTES),
      { message: "agentConfig must be less than 64 KB" },
    ),
    credentials: getRuntimeAgentCredentialsSchema().optional(),
    forwardedProps: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
      { message: "forwardedProps must be less than 192 KB" },
    ),
  }).strict().superRefine((input, ctx) => {
    if (input.agentConfig && input.agentConfig.id !== input.agentId) {
      ctx.addIssue({
        code: "custom",
        message: "agentConfig.id must match agentId",
        path: ["agentConfig", "id"],
      });
    }
  })
);

export const getInternalAgentStreamRequestSchema = getInternalAgentControlPlaneStreamRequestSchema;

type RuntimeMessage = AgUiRuntimeMessage;
type InternalAgentCompatibilityMessage = InferSchema<
  ReturnType<typeof getInternalAgentCompatibilityMessageSchema>
>;

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyRecordObject(value: unknown): value is Record<string, unknown> {
  return isRecordObject(value) && Object.keys(value).length > 0;
}

function extractToolArgs(
  part: Record<string, unknown>,
): Record<string, unknown> {
  const args = part.args;
  if (isNonEmptyRecordObject(args)) {
    return args;
  }

  const input = part.input;
  if (isNonEmptyRecordObject(input)) {
    return input;
  }

  const inputText = part.inputText;
  if (typeof inputText === "string" && inputText.length > 0) {
    try {
      const normalizedInputText = (() => {
        const stripped = stripLeadingEmptyObjectPlaceholder(inputText);
        return stripped.trimStart().startsWith('"') ? `{${stripped}` : stripped;
      })();
      const parsed = JSON.parse(normalizedInputText);
      if (isRecordObject(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  if (isRecordObject(args)) {
    return args;
  }

  if (isRecordObject(input)) {
    return input;
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

type AgUiRuntimeToolCall = InferSchema<ReturnType<typeof getAgUiRuntimeToolCallSchema>>;

function getToolCallShape(
  part: Record<string, unknown>,
): AgUiRuntimeToolCall | null {
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

  // The compatibility schema's parts use `passthrough()` so unknown fields
  // (like `text`) survive parsing but the inferred TS type only exposes the
  // explicit `{ type }` shape. Cast to a loose record to read those passthrough
  // fields.
  const textContent = (message.parts as ReadonlyArray<Record<string, unknown>>)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");

  // Use the conditional-spread pattern (omitting keys entirely when not
  // present) to preserve the pre-migration runtime semantics. Cast the
  // return literal to `RuntimeMessage` to satisfy the contract DSL's strict
  // object shape (optional fields type as required-key, `T | undefined`).
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
      } as RuntimeMessage;
    case "user":
      return {
        id: message.id,
        role: "user",
        content: textContent,
        ...sharedFields,
      } as RuntimeMessage;
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
      } as RuntimeMessage;
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
      } as RuntimeMessage;
    }
  }
}

export function toRuntimeRunAgentInput(
  input: InferSchema<ReturnType<typeof getInternalAgentStreamRequestSchema>>,
): AgUiRuntimeRequest {
  return {
    threadId: input.threadId,
    runId: input.runId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    messages: input.messages.map(toRuntimeMessage),
    tools: input.tools,
    context: input.context,
    ...(input.forwardedProps ? { forwardedProps: input.forwardedProps } : {}),
  } as AgUiRuntimeRequest;
}

export const getResumeSignalSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("tool_result"),
      toolCallId: v.string().min(1).max(128),
      result: v.unknown().refine(
        (value) => isWithinJsonSizeLimit(value, MAX_TOOL_RESULT_BYTES),
        { message: "Tool result must be less than 64 KB" },
      ),
      isError: v.boolean().optional().default(false),
    }),
  ])
);

export { getRuntimeAgentSourceContextSchema };
export type { RuntimeAgentSourceContext };
export type RuntimeInjectedTool = InferSchema<ReturnType<typeof getRuntimeInjectedToolSchema>>;
export type RuntimeContextItem = AgUiRuntimeContextItem;
export type RuntimeRunAgentInput = AgUiRuntimeRequest;
export type InternalAgentStreamRequest = InferSchema<
  ReturnType<typeof getInternalAgentStreamRequestSchema>
>;
export type ResumeSignal = InferSchema<ReturnType<typeof getResumeSignalSchema>>;

// Convenience local Schema export for downstream consumers.
export type { Schema };
