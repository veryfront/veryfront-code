import type { ChatRuntimeOverrides, DurableRootRunDescriptor } from "#veryfront/chat/types.ts";
import { getChatRequestContextSchema, getChatUiMessagesSchema } from "#veryfront/chat/types.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
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

/** @deprecated Use getHostedDurableRootRunDescriptorSchema() */
export const hostedDurableRootRunDescriptorSchema = lazySchema(
  getHostedDurableRootRunDescriptorSchema,
);

export const getHostedChatRuntimeOverridesSchema = defineSchema((v) =>
  v.object({
    allowedTools: v.array(v.string().min(1)).max(100).optional(),
    thinking: v.union([v.literal(false), v.number().int().positive()]).optional(),
    maxSteps: v.number().int().positive().optional(),
  }).strip()
);

/** @deprecated Use getHostedChatRuntimeOverridesSchema() */
export const hostedChatRuntimeOverridesSchema = lazySchema(getHostedChatRuntimeOverridesSchema);

export const getHostedChatRequestSchema = defineSchema((v) =>
  v.object({
    messages: getChatUiMessagesSchema(),
    context: getChatRequestContextSchema(),
    model: v.string().optional(),
    allowDelegation: v.boolean().optional(),
    forwardedProps: v.record(v.string(), v.unknown()).optional(),
    runtimeOverrides: getHostedChatRuntimeOverridesSchema().optional(),
    durableRootRun: getHostedDurableRootRunDescriptorSchema().optional(),
  })
);

/** @deprecated Use getHostedChatRequestSchema() */
export const hostedChatRequestSchema = lazySchema(getHostedChatRequestSchema);

export type HostedChatRequest = InferSchema<ReturnType<typeof getHostedChatRequestSchema>>;
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

export function buildHostedChatRequestInputFromRuntimeAgentInvocation(
  input: RuntimeAgentRunInvocation,
): HostedChatRequestInput {
  return {
    messages: input.messages,
    context: {
      conversationId: input.run.conversationId,
      projectId: input.run.project.projectId,
      branchId: input.run.project.runtimeTargetBranchId ?? null,
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

export function buildHostedChatRequestFromRuntimeAgentInvocation(
  input: RuntimeAgentRunInvocation,
): HostedChatRequest {
  return getHostedChatRequestSchema().parse(
    buildHostedChatRequestInputFromRuntimeAgentInvocation(input),
  );
}
