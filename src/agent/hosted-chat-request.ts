import type { ChatRuntimeOverrides, DurableRootRunDescriptor } from "#veryfront/chat/types.ts";
import { chatRequestContextSchema, chatUiMessagesSchema } from "#veryfront/chat/types.ts";
import { z } from "zod";
import type { RuntimeAgentRunInvocation } from "./runtime-agent-invocation-contract.ts";

const durableRootRunIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export const hostedDurableRootRunDescriptorSchema: z.ZodType<DurableRootRunDescriptor> = z
  .object({
    runId: durableRootRunIdSchema,
    messageId: z.string().uuid(),
    latestEventId: z.number().int().nonnegative().optional(),
    latestExternalEventSequence: z.number().int().nonnegative().optional(),
    parentConversationId: z.string().uuid().optional(),
    parentRunId: durableRootRunIdSchema.optional(),
    spawnedFromToolCallId: z.string().min(1).max(256).optional(),
  })
  .strict();

export const hostedChatRuntimeOverridesSchema: z.ZodType<ChatRuntimeOverrides> = z
  .object({
    allowedTools: z.array(z.string().min(1)).max(100).optional(),
    thinking: z.union([z.literal(false), z.number().int().positive()]).optional(),
    maxSteps: z.number().int().positive().optional(),
  })
  .strip();

export const hostedChatRequestSchema = z.object({
  messages: chatUiMessagesSchema,
  context: chatRequestContextSchema,
  model: z.string().optional(),
  allowDelegation: z.boolean().optional(),
  forwardedProps: z.record(z.string(), z.unknown()).optional(),
  runtimeOverrides: hostedChatRuntimeOverridesSchema.optional(),
  durableRootRun: hostedDurableRootRunDescriptorSchema.optional(),
});

export type HostedChatRequest = z.infer<typeof hostedChatRequestSchema>;
export type HostedChatRequestInput = {
  messages: RuntimeAgentRunInvocation["messages"];
  context: z.infer<typeof chatRequestContextSchema>;
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
  return hostedChatRequestSchema.parse(
    buildHostedChatRequestInputFromRuntimeAgentInvocation(input),
  );
}
