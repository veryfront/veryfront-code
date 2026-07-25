import type { ChatRuntimeOverrides, DurableRootRunDescriptor } from "#veryfront/chat/types.ts";
import {
  getChatRequestContextSchema,
  getChatUiMessagePartSchema,
  getChatUiMessageRoleSchema,
} from "#veryfront/chat/types.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { RuntimeAgentRunInvocation } from "../runtime/agent-invocation-contract.ts";
import { getHostedChatUiToolIdentity } from "./chat-request-tool-part.ts";

const getDurableRootRunIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
);

export const getHostedDurableRootRunDescriptorSchema = defineSchema((v) =>
  v.object({
    runId: getDurableRootRunIdSchema(),
    messageId: v.string().uuid(),
    latestEventId: v.number().int().nonnegative().optional(),
    latestExternalEventSequence: v.number().int().nonnegative().optional(),
    parentConversationId: v.string().uuid().optional(),
    parentRunId: getDurableRootRunIdSchema().optional(),
    spawnedFromToolCallId: v.string().min(1).max(256).optional(),
  }).strict()
);

/** Schema for hosted durable root run descriptor.
 * @deprecated Use getHostedDurableRootRunDescriptorSchema()
 */
export const hostedDurableRootRunDescriptorSchema = lazySchema(
  getHostedDurableRootRunDescriptorSchema,
);

export const getHostedChatRuntimeOverridesSchema = defineSchema((v) =>
  v.object({
    allowedTools: v.array(v.string().min(1)).max(100).optional(),
    thinking: v.union([v.literal(false), v.number().int().positive()]).optional(),
    maxSteps: v.number().int().positive().optional(),
    maxOutputTokens: v.number().int().positive().optional(),
  }).strip()
);

/** Schema for hosted chat runtime overrides.
 * @deprecated Use getHostedChatRuntimeOverridesSchema()
 */
export const hostedChatRuntimeOverridesSchema = lazySchema(getHostedChatRuntimeOverridesSchema);

const getHostedChatRawToolCallPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("tool_call"),
    id: v.string().min(1),
    name: v.string().min(1),
    input: v.record(v.string(), v.unknown()),
    state: v.enum(["streaming", "pending", "completed", "error"]),
  }).strip()
);

const getHostedChatRawToolResultPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("tool_result"),
    tool_call_id: v.string().min(1),
    output: v.unknown(),
    is_error: v.boolean().optional(),
    tool_name: v.string().min(1).optional(),
  }).strip()
);

const getHostedChatRequestMessagePartSchema = defineSchema((v) =>
  v.union([
    getChatUiMessagePartSchema(),
    getHostedChatRawToolCallPartSchema(),
    getHostedChatRawToolResultPartSchema(),
  ])
);

const getHostedChatRequestMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: getChatUiMessageRoleSchema(),
    parts: v.array(getHostedChatRequestMessagePartSchema()),
    metadata: v.record(v.string(), v.unknown()).optional(),
  }).strip()
);

const getHostedChatRequestMessagesSchema = defineSchema((v) =>
  v.array(getHostedChatRequestMessageSchema()).superRefine((messages, ctx) => {
    const knownToolNames = new Map<string, string>();
    const knownToolResultIds = new Set<string>();
    const recordToolCall = (
      toolCallId: string,
      toolName: string,
      path: Array<string | number>,
    ) => {
      if (knownToolNames.has(toolCallId)) {
        ctx.addIssue({
          code: "custom",
          message: "tool_call id must be unique",
          path,
        });
        return;
      }

      knownToolNames.set(toolCallId, toolName);
    };
    const validateToolResult = (
      toolCallId: string,
      toolName: string | undefined,
      toolCallIdPath: Array<string | number>,
      toolNamePath: Array<string | number>,
    ) => {
      if (knownToolResultIds.has(toolCallId)) {
        ctx.addIssue({
          code: "custom",
          message: "tool_result for tool_call_id must be unique",
          path: toolCallIdPath,
        });
        return;
      }

      knownToolResultIds.add(toolCallId);
      const knownToolName = knownToolNames.get(toolCallId);
      if (!knownToolName) {
        ctx.addIssue({
          code: "custom",
          message: "tool_result requires a preceding matching tool_call",
          path: toolCallIdPath,
        });
        return;
      }

      if (toolName && toolName !== knownToolName) {
        ctx.addIssue({
          code: "custom",
          message: "tool_result tool_name must match its preceding tool_call",
          path: toolNamePath,
        });
      }
    };

    for (const [messageIndex, message] of messages.entries()) {
      for (const [partIndex, part] of message.parts.entries()) {
        const uiToolIdentity = getHostedChatUiToolIdentity(part);
        const isRawToolCall = part.type === "tool_call" && "id" in part && "name" in part;
        if (isRawToolCall && message.role !== "assistant") {
          ctx.addIssue({
            code: "custom",
            message: "tool_call is only allowed in assistant messages",
            path: [messageIndex, "parts", partIndex, "type"],
          });
          continue;
        }

        if (
          uiToolIdentity && message.role !== "assistant" && message.role !== "tool"
        ) {
          ctx.addIssue({
            code: "custom",
            message: "tool UI parts are only allowed in assistant or tool messages",
            path: [messageIndex, "parts", partIndex, "type"],
          });
          continue;
        }

        if (
          part.type === "tool_result" && message.role !== "assistant" && message.role !== "tool"
        ) {
          ctx.addIssue({
            code: "custom",
            message: "tool_result is only allowed in assistant or tool messages",
            path: [messageIndex, "parts", partIndex, "type"],
          });
          continue;
        }

        if (isRawToolCall) {
          recordToolCall(part.id, part.name, [messageIndex, "parts", partIndex, "id"]);
          continue;
        }

        if (uiToolIdentity) {
          if (message.role === "assistant") {
            recordToolCall(uiToolIdentity.toolCallId, uiToolIdentity.toolName, [
              messageIndex,
              "parts",
              partIndex,
              "toolCallId",
            ]);
          }

          const hasUiToolResult = "state" in part &&
            (part.state === "output-available" || part.state === "output-error" ||
              part.state === "output-denied" || part.state === "error");
          if (message.role === "tool" && !hasUiToolResult) {
            ctx.addIssue({
              code: "custom",
              message: "tool message UI parts require a result-bearing state",
              path: [messageIndex, "parts", partIndex, "state"],
            });
            continue;
          }

          if (hasUiToolResult) {
            validateToolResult(
              uiToolIdentity.toolCallId,
              uiToolIdentity.toolName,
              [messageIndex, "parts", partIndex, "toolCallId"],
              [
                messageIndex,
                "parts",
                partIndex,
                "toolName" in part ? "toolName" : "type",
              ],
            );
          }
          continue;
        }

        if (part.type !== "tool_result") {
          continue;
        }

        validateToolResult(
          part.tool_call_id,
          part.tool_name,
          [messageIndex, "parts", partIndex, "tool_call_id"],
          [messageIndex, "parts", partIndex, "tool_name"],
        );
      }
    }
  })
);

export const getHostedChatRequestSchema = defineSchema((v) =>
  v.object({
    messages: getHostedChatRequestMessagesSchema(),
    context: getChatRequestContextSchema(),
    model: v.string().optional(),
    allowDelegation: v.boolean().optional(),
    forwardedProps: v.record(v.string(), v.unknown()).optional(),
    runtimeOverrides: getHostedChatRuntimeOverridesSchema().optional(),
    durableRootRun: getHostedDurableRootRunDescriptorSchema().optional(),
  })
);

/** Schema for hosted chat request.
 * @deprecated Use getHostedChatRequestSchema()
 */
export const hostedChatRequestSchema = lazySchema(getHostedChatRequestSchema);

/** Request payload for hosted chat. */
export type HostedChatRequest = InferSchema<ReturnType<typeof getHostedChatRequestSchema>>;
/** Input payload for hosted chat request. */
export type HostedChatRequestInput = {
  messages: RuntimeAgentRunInvocation["messages"];
  context: InferSchema<ReturnType<typeof getChatRequestContextSchema>>;
  model?: string;
  allowDelegation?: boolean;
  forwardedProps?: Record<string, unknown>;
  runtimeOverrides?: ChatRuntimeOverrides;
  durableRootRun?: DurableRootRunDescriptor;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStudioRuntimeEnvironmentContext(input: RuntimeAgentRunInvocation): string | undefined {
  for (const item of input.context) {
    if (item.type !== "json" || item.title !== "studio_context") continue;

    const environmentContext = item.data.environmentContext;
    if (typeof environmentContext === "string" && environmentContext.trim().length > 0) {
      return environmentContext;
    }
  }

  return undefined;
}

function getRuntimeTargetKind(
  value: unknown,
): HostedChatRequestInput["context"]["runtimeTargetKind"] {
  return value === "main_branch" || value === "environment" || value === "preview_branch"
    ? value
    : undefined;
}

/** Builds hosted chat request forwarded props from runtime agent invocation. */
export function buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation(
  input: RuntimeAgentRunInvocation,
): HostedChatRequest["forwardedProps"] {
  const forwardedProps: Record<string, unknown> = isRecord(input.forwardedProps)
    ? { ...input.forwardedProps }
    : {};

  if (input.context.length > 0) {
    forwardedProps.runtimeContext = input.context;
  }

  if (input.tools.length > 0) {
    forwardedProps.runtimeTools = input.tools;
  }

  return Object.keys(forwardedProps).length > 0 ? forwardedProps : undefined;
}

/** Builds hosted chat request input from runtime agent invocation. */
export function buildHostedChatRequestInputFromRuntimeAgentInvocation(
  input: RuntimeAgentRunInvocation,
): HostedChatRequestInput {
  const environmentContext = getStudioRuntimeEnvironmentContext(input);
  const runtimeTargetKind = getRuntimeTargetKind(input.run.project.runtimeTargetKind);

  return {
    messages: input.messages,
    context: {
      conversationId: input.run.conversationId,
      projectId: input.run.project.projectId,
      projectSlug: input.run.project.projectSlug,
      branchId: input.run.project.runtimeTargetBranchId ?? null,
      ...(runtimeTargetKind ? { runtimeTargetKind } : {}),
      ...(input.run.project.runtimeTargetEnvironmentId !== undefined
        ? { runtimeTargetEnvironmentId: input.run.project.runtimeTargetEnvironmentId ?? null }
        : {}),
      ...(environmentContext ? { environmentContext } : {}),
    },
    forwardedProps: buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation(input),
    durableRootRun: {
      runId: input.run.runId,
      messageId: input.run.messageId,
      parentConversationId: input.run.parentConversationId ?? undefined,
      parentRunId: input.run.parentRunId ?? undefined,
      spawnedFromToolCallId: input.run.spawnedFromToolCallId ?? undefined,
    },
  };
}

/** Builds hosted chat request from runtime agent invocation. */
export function buildHostedChatRequestFromRuntimeAgentInvocation(
  input: RuntimeAgentRunInvocation,
): HostedChatRequest {
  return getHostedChatRequestSchema().parse(
    buildHostedChatRequestInputFromRuntimeAgentInvocation(input),
  );
}
