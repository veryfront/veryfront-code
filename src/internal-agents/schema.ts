import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
export type {
  InferSchema,
  InferShape,
  RefinementCtx,
  Schema,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "#veryfront/extensions/schema/index.ts";
import {
  type AgUiRuntimeContextItem,
  type AgUiRuntimeInjectedTool,
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
export type {
  AgUiRuntimeContextItem,
  AgUiRuntimeInjectedTool,
  AgUiRuntimeMessage,
  AgUiRuntimeRequest,
} from "#veryfront/agent/runtime/ag-ui-contract.ts";
import { stripLeadingEmptyObjectPlaceholder } from "#veryfront/agent/streaming/data-stream.ts";
import { getRuntimeAgentMarkdownDefinitionSchema } from "#veryfront/agent/runtime/agent-definition.ts";
import type { RuntimeAgentMarkdownDefinition } from "#veryfront/agent/runtime/agent-definition.ts";
export type {
  RuntimeAgentMarkdownDefinition,
  RuntimeAgentThinkingConfig,
} from "#veryfront/agent/runtime/agent-definition.ts";
import {
  getRuntimeAgentCredentialsSchema,
  getRuntimeAgentSourceContextSchema,
  type RuntimeAgentSourceContext,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import { INTERNAL_AGENT_STREAM_MAX_BODY_BYTES } from "./request-body.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_AGENT_CONFIG_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 196_608;
const MAX_TOOL_RESULT_BYTES = 65_536;
const MAX_RUNTIME_MESSAGES = 100;
const MAX_COMPATIBILITY_MESSAGE_PARTS = 100;

const encoder = new TextEncoder();

/** Legacy parts-based message accepted by the internal stream endpoint. */
export interface InternalAgentCompatibilityMessage {
  /** Message identifier. */
  id: string;
  /** Message role. */
  role: "user" | "assistant" | "system" | "tool";
  /** Message parts preserved during compatibility conversion. */
  parts: Array<{ type: string } & Record<string, unknown>>;
  /** Optional message metadata. */
  metadata?: Record<string, unknown>;
  /** Optional creation timestamp. */
  createdAt?: string;
}

/** Validated request accepted by the internal agent stream endpoint. */
export interface InternalAgentStreamRequest extends Omit<AgUiRuntimeRequest, "messages"> {
  /** Agent identifier resolved by the runtime. */
  agentId: string;
  /** Canonical or compatibility messages supplied to the run. */
  messages: Array<AgUiRuntimeMessage | InternalAgentCompatibilityMessage>;
  /** Source revision used to load the agent. */
  agentSource: RuntimeAgentSourceContext;
  /** Optional inline agent definition. */
  agentConfig?: RuntimeAgentMarkdownDefinition;
  /** Optional request-scoped runtime credential. */
  credentials?: { authToken: string };
}

/** Validated signal that resumes a run waiting for a tool result. */
export interface ResumeSignal {
  /** Signal discriminator. */
  type: "tool_result";
  /** Tool call receiving the result. */
  toolCallId: string;
  /** JSON-compatible tool result. */
  result: unknown;
  /** Whether the tool result represents a failure. */
  isError: boolean;
}

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

/** Returns the schema for an internal run identifier. */
export const getRunIdSchema: () => Schema<string> = getAgUiRuntimeRunIdSchema;

/** Returns the schema for an internal agent identifier. */
export const getAgentIdSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1).max(128).regex(AGENT_ID_PATTERN)
);

/** Returns the schema for a caller-injected runtime tool. */
export const getRuntimeInjectedToolSchema: () => Schema<AgUiRuntimeInjectedTool> =
  getAgUiRuntimeInjectedToolSchema;
/** Returns the schema for a structured runtime context item. */
export const getRuntimeContextItemSchema: () => Schema<AgUiRuntimeContextItem> =
  getAgUiRuntimeContextItemSchema;
/** Returns the schema for a canonical runtime message. */
export const getRuntimeMessageSchema: () => Schema<AgUiRuntimeMessage> =
  getAgUiRuntimeMessageSchema;
/** Returns the schema for a legacy or structured runtime context item. */
export const getRuntimeContextSchema: () => Schema<
  { description: string; value: string } | AgUiRuntimeContextItem
> = getAgUiRuntimeContextSchema;
/** Returns the schema for the provider-neutral runtime run input. */
export const getRuntimeRunAgentInputSchema: () => Schema<AgUiRuntimeRequest> =
  getAgUiRuntimeRequestSchema;

/** Returns the schema for a legacy parts-based internal message. */
export const getInternalAgentCompatibilityMessageSchema: () => Schema<
  InternalAgentCompatibilityMessage
> = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(128),
    role: v.enum(["user", "assistant", "system", "tool"] as const),
    parts: v.array(v.object({ type: v.string().min(1).max(128) }).passthrough()).max(
      MAX_COMPATIBILITY_MESSAGE_PARTS,
    ).default([]),
    metadata: v.record(v.string(), v.unknown()).optional(),
    createdAt: v.string().max(128).optional(),
  })
);

/** Returns the schema for a signed internal agent stream request. */
export const getInternalAgentControlPlaneStreamRequestSchema: () => Schema<
  InternalAgentStreamRequest
> = defineSchema((v) =>
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
  }).strict().refine(
    (input) => isWithinJsonSizeLimit(input, INTERNAL_AGENT_STREAM_MAX_BODY_BYTES),
    { message: "Internal agent stream request must be less than 1 MB" },
  ).superRefine((input, ctx) => {
    if (input.agentConfig && input.agentConfig.id !== input.agentId) {
      ctx.addIssue({
        code: "custom",
        message: "agentConfig.id must match agentId",
        path: ["agentConfig", "id"],
      });
    }
    const toolNames = new Set<string>();
    for (const [index, tool] of input.tools.entries()) {
      if (toolNames.has(tool.name)) {
        ctx.addIssue({
          code: "custom",
          message: "Tool names must be unique",
          path: ["tools", index, "name"],
        });
      }
      toolNames.add(tool.name);
    }
  })
);

/** Alias for the internal agent stream request schema factory. */
export const getInternalAgentStreamRequestSchema: () => Schema<InternalAgentStreamRequest> =
  getInternalAgentControlPlaneStreamRequestSchema;

type RuntimeMessage = AgUiRuntimeMessage;
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

/** Converts a validated stream request into provider-neutral runtime input. */
export function toRuntimeRunAgentInput(
  input: InternalAgentStreamRequest,
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

/** Returns the schema for an external tool-result resume signal. */
export const getResumeSignalSchema: () => Schema<ResumeSignal> = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("tool_result"),
      toolCallId: v.string().min(1).max(128),
      result: v.unknown().refine(
        (value) => value !== undefined && isWithinJsonSizeLimit(value, MAX_TOOL_RESULT_BYTES),
        { message: "Tool result must be present and less than 64 KB" },
      ),
      isError: v.boolean().optional().default(false),
    }),
  ]).transform((signal): ResumeSignal => ({
    type: signal.type,
    toolCallId: signal.toolCallId,
    result: signal.result,
    isError: signal.isError,
  }))
);

export { getRuntimeAgentSourceContextSchema };
export type { RuntimeAgentSourceContext };
/** Caller-injected tool definition accepted by an internal run. */
export type RuntimeInjectedTool = AgUiRuntimeInjectedTool;
/** Structured context item accepted by an internal run. */
export type RuntimeContextItem = AgUiRuntimeContextItem;
/** Provider-neutral input passed to the agent runtime. */
export type RuntimeRunAgentInput = AgUiRuntimeRequest;
