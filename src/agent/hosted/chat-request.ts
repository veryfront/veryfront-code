import type {
  ChatRequestContext,
  ChatRuntimeOverrides,
  DurableRootRunDescriptor,
} from "#veryfront/chat/types.ts";
import {
  getChatRequestContextSchema,
  getChatUiMessagePartSchema,
  getChatUiMessageRoleSchema,
} from "#veryfront/chat/types.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { RuntimeAgentRunInvocation } from "../runtime/agent-invocation-contract.ts";

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
export const hostedDurableRootRunDescriptorSchema: Schema<DurableRootRunDescriptor> = lazySchema(
  getHostedDurableRootRunDescriptorSchema,
);

export const getHostedChatRuntimeOverridesSchema = defineSchema((v) =>
  v.object({
    allowedTools: v.array(v.string().min(1)).max(100).optional(),
    thinking: v.union([v.literal(false), v.number().int().positive()]).optional(),
    maxSteps: v.number().int().positive().optional(),
  }).strip()
);

/** Schema for hosted chat runtime overrides.
 * @deprecated Use getHostedChatRuntimeOverridesSchema()
 */
export const hostedChatRuntimeOverridesSchema: Schema<ChatRuntimeOverrides> = lazySchema(
  getHostedChatRuntimeOverridesSchema,
);

const getHostedChatRequestMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: getChatUiMessageRoleSchema(),
    parts: v.array(getChatUiMessagePartSchema()),
    metadata: v.record(v.string(), v.unknown()).optional(),
  }).strip()
);

const getHostedChatRequestMessagesSchema = defineSchema((v) =>
  v.array(getHostedChatRequestMessageSchema())
);

/** Message accepted by the hosted chat request schema. */
export interface HostedChatRequestMessage {
  /** Message identifier. */
  id: string;
  /** Message author role. */
  role: string;
  /** Ordered UI message parts. */
  parts: Array<{ type: string; [key: string]: unknown }>;
  /** Optional message metadata. */
  metadata?: Record<string, unknown>;
}

/** Validated request used to execute hosted chat. */
export interface HostedChatRequest {
  /** Conversation messages. */
  messages: HostedChatRequestMessage[];
  /** Validated chat request context. */
  context: ChatRequestContext;
  /** Optional model override. */
  model?: string;
  /** Optional delegation policy override. */
  allowDelegation?: boolean;
  /** Opaque properties forwarded to the runtime. */
  forwardedProps?: Record<string, unknown>;
  /** Optional runtime behavior overrides. */
  runtimeOverrides?: ChatRuntimeOverrides;
  /** Optional descriptor for a durable root run. */
  durableRootRun?: DurableRootRunDescriptor;
}

/** Returns the hosted chat request schema. */
export const getHostedChatRequestSchema: () => Schema<HostedChatRequest> = defineSchema((v) =>
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
export const hostedChatRequestSchema: Schema<HostedChatRequest> = lazySchema(
  getHostedChatRequestSchema,
);

/** Input payload for hosted chat request. */
export type HostedChatRequestInput = {
  messages: RuntimeAgentRunInvocation["messages"];
  context: ChatRequestContext;
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
