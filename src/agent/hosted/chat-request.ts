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
    providerExecuted: v.boolean().optional(),
  }).strip()
);

const getHostedChatRawToolResultPartSchema = defineSchema((v) =>
  v.object({
    type: v.literal("tool_result"),
    tool_call_id: v.string().min(1),
    output: v.unknown(),
    is_error: v.boolean().optional(),
    tool_name: v.string().min(1).optional(),
    providerExecuted: v.boolean().optional(),
  }).strip()
);

const getHostedChatRequestMessagePartSchema = defineSchema((v) =>
  v.union([
    getChatUiMessagePartSchema(),
    getHostedChatRawToolCallPartSchema(),
    getHostedChatRawToolResultPartSchema(),
  ])
);

function isHostedChatUiToolPartCandidate(part: unknown): boolean {
  if (!isRecord(part) || typeof part.type !== "string") {
    return false;
  }

  return (
    typeof part.toolCallId === "string" && part.toolCallId.length > 0 &&
    (part.type === "dynamic-tool" || part.type === "tool_call" || part.type.startsWith("tool-"))
  );
}

function isHostedChatToolResultPart(part: unknown): boolean {
  if (!isRecord(part)) {
    return false;
  }

  if (part.type === "tool_result") {
    return true;
  }

  return (
    getHostedChatUiToolIdentity(part) !== null && "state" in part &&
    (part.state === "output-available" || part.state === "output-error" ||
      part.state === "output-denied" || part.state === "error")
  );
}

function hasHostedChatNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function isHostedChatProviderVisibleNonToolPart(role: string, part: unknown): boolean {
  if (!isRecord(part)) {
    return false;
  }

  if (role === "system") {
    return part.type === "text" && typeof part.text === "string" && part.text.length > 0;
  }

  if (role === "user") {
    return (
      part.type === "text" && typeof part.text === "string" && part.text.length > 0 ||
      (part.type === "file" || part.type === "image") &&
        typeof part.mediaType === "string" && typeof part.url === "string"
    );
  }

  if (role === "assistant") {
    return (
      part.type === "text" && typeof part.text === "string" && part.text.length > 0 ||
      part.type === "reasoning" &&
        (hasHostedChatNonEmptyString(part.text) ||
          hasHostedChatNonEmptyString(part.signature) ||
          hasHostedChatNonEmptyString(part.redactedData)) ||
      (part.type === "file" || part.type === "image") &&
        typeof part.mediaType === "string" && typeof part.url === "string"
    );
  }

  return false;
}

/** Upper bound on replayed messages accepted per hosted chat request (DoS guard). */
export const MAX_HOSTED_CHAT_REQUEST_MESSAGES = 1000;
/** Upper bound on parts accepted per replayed hosted chat message (DoS guard). */
export const MAX_HOSTED_CHAT_REQUEST_MESSAGE_PARTS = 1000;

const getHostedChatRequestMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: getChatUiMessageRoleSchema(),
    parts: v.array(getHostedChatRequestMessagePartSchema())
      .max(MAX_HOSTED_CHAT_REQUEST_MESSAGE_PARTS),
    metadata: v.record(v.string(), v.unknown()).optional(),
  }).strip()
);

type OpenHostedToolCall = {
  toolName: string;
  path: Array<string | number>;
  originMessageIndex: number;
  requiresResult: boolean;
  sawLaterNonResultContent: boolean;
};

const getHostedChatRequestMessagesSchema = defineSchema((v) =>
  v.array(getHostedChatRequestMessageSchema()).max(MAX_HOSTED_CHAT_REQUEST_MESSAGES)
    .superRefine((messages, ctx) => {
      const knownToolNames = new Map<string, string>();
      const knownToolResultIds = new Set<string>();
      const openToolCalls = new Map<string, OpenHostedToolCall>();
      // Count of openToolCalls entries originating from the current message that
      // have not seen later non-result content. When every open entry is in that
      // state, rejectOpenToolCallsBeforeNewCall is a no-op, so tracking the count
      // lets it skip rescanning the map for each tool call in the same message
      // (keeping validation linear instead of quadratic in parts per message).
      let currentMessageIndex = 0;
      let freshOpenToolCallCount = 0;
      const recordToolCall = (
        toolCallId: string,
        toolName: string,
        path: Array<string | number>,
        options: { messageIndex: number; requiresResult?: boolean },
      ): boolean => {
        rejectOpenToolCallsBeforeNewCall(options.messageIndex);
        if (knownToolNames.has(toolCallId)) {
          ctx.addIssue({
            code: "custom",
            message: "tool_call id must be unique",
            path,
          });
          return false;
        }

        knownToolNames.set(toolCallId, toolName);
        openToolCalls.set(toolCallId, {
          toolName,
          path,
          originMessageIndex: options.messageIndex,
          requiresResult: options?.requiresResult === true,
          sawLaterNonResultContent: false,
        });
        freshOpenToolCallCount += 1;
        return true;
      };
      const rejectUnresolvedTerminalToolCalls = (message: string): boolean => {
        let rejected = false;
        for (const openToolCall of openToolCalls.values()) {
          if (!openToolCall.requiresResult) {
            continue;
          }

          rejected = true;
          ctx.addIssue({
            code: "custom",
            message,
            path: openToolCall.path,
          });
        }

        if (rejected) {
          openToolCalls.clear();
          freshOpenToolCallCount = 0;
        }
        return rejected;
      };
      const closeOpenBatchBeforeContinuation = (): void => {
        rejectUnresolvedTerminalToolCalls(
          "terminal tool_call requires an adjacent tool_result before conversation continuation",
        );
        openToolCalls.clear();
        freshOpenToolCallCount = 0;
      };
      const rejectOpenToolCallsBeforeNewCall = (messageIndex: number): void => {
        if (openToolCalls.size === freshOpenToolCallCount) {
          return;
        }

        for (const [toolCallId, openToolCall] of openToolCalls) {
          if (
            openToolCall.originMessageIndex === messageIndex &&
            !openToolCall.sawLaterNonResultContent
          ) {
            continue;
          }

          if (openToolCall.requiresResult) {
            ctx.addIssue({
              code: "custom",
              message: openToolCall.originMessageIndex === messageIndex
                ? "terminal tool_call requires a same-message tool_result before assistant continuation"
                : "terminal tool_call requires an adjacent tool_result before conversation continuation",
              path: openToolCall.path,
            });
          }
          openToolCalls.delete(toolCallId);
        }
        freshOpenToolCallCount = openToolCalls.size;
      };
      const handleNonResultContent = (messageIndex: number): void => {
        for (const [toolCallId, openToolCall] of openToolCalls) {
          if (openToolCall.originMessageIndex !== messageIndex) {
            if (openToolCall.requiresResult) {
              ctx.addIssue({
                code: "custom",
                message:
                  "terminal tool_call requires an adjacent tool_result before conversation continuation",
                path: openToolCall.path,
              });
            }
            openToolCalls.delete(toolCallId);
            continue;
          }

          openToolCalls.set(toolCallId, {
            ...openToolCall,
            sawLaterNonResultContent: true,
          });
        }
        freshOpenToolCallCount = 0;
      };
      const closeOpenBatchAfterSameMessageContinuation = (): void => {
        for (const [toolCallId, openToolCall] of openToolCalls) {
          if (!openToolCall.sawLaterNonResultContent) {
            continue;
          }

          if (openToolCall.requiresResult) {
            ctx.addIssue({
              code: "custom",
              message:
                "terminal tool_call requires a same-message tool_result before assistant continuation",
              path: openToolCall.path,
            });
          }
          openToolCalls.delete(toolCallId);
        }
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

        const openToolCall = openToolCalls.get(toolCallId);
        if (!openToolCall) {
          ctx.addIssue({
            code: "custom",
            message: "tool_result requires an adjacent terminal tool_call",
            path: toolCallIdPath,
          });
          return;
        }

        if (
          openToolCall.originMessageIndex === currentMessageIndex &&
          !openToolCall.sawLaterNonResultContent
        ) {
          freshOpenToolCallCount -= 1;
        }
        openToolCalls.delete(toolCallId);
        if (toolName && toolName !== openToolCall.toolName) {
          ctx.addIssue({
            code: "custom",
            message: "tool_result tool_name must match its preceding tool_call",
            path: toolNamePath,
          });
        }
      };
      const getFirstProviderVisiblePart = (
        role: string,
        parts: readonly unknown[],
      ): unknown | undefined => {
        return parts.find((part) =>
          isHostedChatToolResultPart(part) ||
          isHostedChatUiToolPartCandidate(part) ||
          (isRecord(part) && part.type === "tool_call" && "id" in part && "name" in part) ||
          isHostedChatProviderVisibleNonToolPart(role, part)
        );
      };

      for (const [messageIndex, message] of messages.entries()) {
        currentMessageIndex = messageIndex;
        freshOpenToolCallCount = 0;
        const firstPart = getFirstProviderVisiblePart(message.role, message.parts);
        if (firstPart && openToolCalls.size > 0 && !isHostedChatToolResultPart(firstPart)) {
          closeOpenBatchBeforeContinuation();
        }

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

          if (!uiToolIdentity && !isRawToolCall && isHostedChatUiToolPartCandidate(part)) {
            ctx.addIssue({
              code: "custom",
              message: "tool UI parts require a non-empty toolName",
              path: [messageIndex, "parts", partIndex, "toolName"],
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
            recordToolCall(part.id, part.name, [messageIndex, "parts", partIndex, "id"], {
              messageIndex,
              requiresResult: part.state === "completed" || part.state === "error",
            });
            continue;
          }

          if (uiToolIdentity) {
            if (message.role === "assistant") {
              recordToolCall(uiToolIdentity.toolCallId, uiToolIdentity.toolName, [
                messageIndex,
                "parts",
                partIndex,
                "toolCallId",
              ], {
                messageIndex,
                requiresResult: "state" in part && part.state === "completed",
              });
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
            if (isHostedChatProviderVisibleNonToolPart(message.role, part)) {
              handleNonResultContent(messageIndex);
            }
            continue;
          }

          validateToolResult(
            part.tool_call_id,
            part.tool_name,
            [messageIndex, "parts", partIndex, "tool_call_id"],
            [messageIndex, "parts", partIndex, "tool_name"],
          );
        }

        closeOpenBatchAfterSameMessageContinuation();
      }

      rejectUnresolvedTerminalToolCalls("terminal tool_call requires a matching tool_result");
    })
);

export const getHostedChatRequestSchema = defineSchema((v) =>
  v.object({
    messages: getHostedChatRequestMessagesSchema(),
    context: getChatRequestContextSchema(),
    model: v.string().optional(),
    allowDelegation: v.boolean().optional(),
    forwardedProps: v.record(v.string(), v.unknown()).optional(),
    serverResolvedProviderReplayCheckpoints: v.unknown().optional(),
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
  serverResolvedProviderReplayCheckpoints?: unknown;
  runtimeOverrides?: ChatRuntimeOverrides;
  durableRootRun?: DurableRootRunDescriptor;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getNonEmptyStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeHostedRuntimeInvocationMessagePart(part: unknown): unknown {
  if (!isRecord(part) || (part.type !== "file" && part.type !== "image")) {
    return part;
  }

  const mediaType = getNonEmptyStringField(part, "mediaType") ??
    getNonEmptyStringField(part, "media_type");
  const url = getNonEmptyStringField(part, "url");
  if (!mediaType || !url) {
    return part;
  }

  const uploadId = getNonEmptyStringField(part, "uploadId") ??
    getNonEmptyStringField(part, "upload_id");
  const uploadPath = getNonEmptyStringField(part, "uploadPath") ??
    getNonEmptyStringField(part, "upload_path");
  const filename = getNonEmptyStringField(part, "filename");

  return {
    type: "file",
    mediaType,
    url,
    ...(filename ? { filename } : {}),
    ...(uploadId ? { uploadId } : {}),
    ...(uploadPath ? { uploadPath } : {}),
  };
}

function normalizeHostedRuntimeInvocationMessages(
  messages: RuntimeAgentRunInvocation["messages"],
): RuntimeAgentRunInvocation["messages"] {
  return messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.parts)) {
      return message;
    }

    return {
      ...message,
      parts: message.parts.map(normalizeHostedRuntimeInvocationMessagePart),
    };
  });
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
    messages: normalizeHostedRuntimeInvocationMessages(input.messages),
    ...(input.allowDelegation !== undefined ? { allowDelegation: input.allowDelegation } : {}),
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
    ...(input.serverResolvedProviderReplayCheckpoints !== undefined
      ? { serverResolvedProviderReplayCheckpoints: input.serverResolvedProviderReplayCheckpoints }
      : {}),
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
