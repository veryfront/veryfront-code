import { z } from "zod";
import { appendConversationRunEvents, isIgnorableConversationRunAppendError } from "./durable.ts";

const AG_UI_CUSTOM_EVENT_TYPE = "CUSTOM";

export const InvokeAgentChildRunLifecycleValueSchema = z.object({
  toolCallId: z.string().min(1),
  childConversationId: z.string().uuid(),
  childRunId: z.string().min(1),
  childMessageId: z.string().uuid(),
  childAgentId: z.string().min(1),
  description: z.string().min(1).optional(),
  status: z.enum(["pending", "running", "waiting_for_tool", "completed", "failed", "cancelled"]),
  sourceTargetKind: z.enum(["project", "production", "environment", "preview_branch"]).nullable()
    .optional(),
  runtimeTargetKind: z.enum(["production", "environment", "preview_branch"]).nullable().optional(),
  targetEnvironmentId: z.string().uuid().nullable().optional(),
  targetBranchId: z.string().uuid().nullable().optional(),
});

export type InvokeAgentChildRunLifecycleValue = z.infer<
  typeof InvokeAgentChildRunLifecycleValueSchema
>;

export const InvokeAgentChildRunStateDeltaSchema = z.object({
  type: z.literal("STATE_DELTA"),
  delta: z.array(
    z.object({
      op: z.enum(["add", "replace"]),
      path: z.string().min(1),
      value: InvokeAgentChildRunLifecycleValueSchema,
    }),
  ),
});

export type InvokeAgentChildRunStateDelta = z.infer<typeof InvokeAgentChildRunStateDeltaSchema>;

export const InvokeAgentChildRunLifecycleCustomEventSchema = z.object({
  type: z.literal(AG_UI_CUSTOM_EVENT_TYPE),
  name: z.literal("veryfront.invoke_agent.lifecycle"),
  value: InvokeAgentChildRunLifecycleValueSchema,
});

export type InvokeAgentChildRunLifecycleCustomEvent = z.infer<
  typeof InvokeAgentChildRunLifecycleCustomEventSchema
>;

export type InvokeAgentChildRunProgressInput = {
  toolCallId: string;
  childConversationId: string;
  childRunId: string;
  childMessageId: string;
  childAgentId: string;
  description?: string;
  status: "pending" | "running" | "waiting_for_tool" | "completed" | "failed" | "cancelled";
  sourceTargetKind?: "project" | "production" | "environment" | "preview_branch" | null;
  runtimeTargetKind?: "production" | "environment" | "preview_branch" | null;
  targetEnvironmentId?: string | null;
  targetBranchId?: string | null;
};

export type InvokeAgentChildRunProgressEvent =
  | InvokeAgentChildRunStateDelta
  | InvokeAgentChildRunLifecycleCustomEvent;

function buildInvokeAgentChildRunLifecycleValue(
  input: InvokeAgentChildRunProgressInput,
): InvokeAgentChildRunLifecycleValue {
  return InvokeAgentChildRunLifecycleValueSchema.parse({
    toolCallId: input.toolCallId,
    childConversationId: input.childConversationId,
    childRunId: input.childRunId,
    childMessageId: input.childMessageId,
    childAgentId: input.childAgentId,
    ...(input.description ? { description: input.description } : {}),
    status: input.status,
    ...(input.sourceTargetKind !== undefined ? { sourceTargetKind: input.sourceTargetKind } : {}),
    ...(input.runtimeTargetKind !== undefined
      ? { runtimeTargetKind: input.runtimeTargetKind }
      : {}),
    ...(input.targetEnvironmentId !== undefined
      ? { targetEnvironmentId: input.targetEnvironmentId }
      : {}),
    ...(input.targetBranchId !== undefined ? { targetBranchId: input.targetBranchId } : {}),
  });
}

export function buildInvokeAgentChildRunStateDelta(
  input: InvokeAgentChildRunProgressInput,
): InvokeAgentChildRunStateDelta {
  const escapedToolCallId = input.toolCallId.replaceAll("~", "~0").replaceAll("/", "~1");
  return InvokeAgentChildRunStateDeltaSchema.parse({
    type: "STATE_DELTA",
    delta: [
      {
        op: input.status === "pending" ? "add" : "replace",
        path: `/invokeAgentChildRuns/${escapedToolCallId}`,
        value: buildInvokeAgentChildRunLifecycleValue(input),
      },
    ],
  });
}

export function buildInvokeAgentChildRunLifecycleCustomEvent(
  input: InvokeAgentChildRunProgressInput,
): InvokeAgentChildRunLifecycleCustomEvent {
  return InvokeAgentChildRunLifecycleCustomEventSchema.parse({
    type: AG_UI_CUSTOM_EVENT_TYPE,
    name: "veryfront.invoke_agent.lifecycle",
    value: buildInvokeAgentChildRunLifecycleValue(input),
  });
}

export function buildInvokeAgentChildRunProgressEvents(
  input: InvokeAgentChildRunProgressInput,
): readonly [InvokeAgentChildRunStateDelta, InvokeAgentChildRunLifecycleCustomEvent] {
  return [
    buildInvokeAgentChildRunStateDelta(input),
    buildInvokeAgentChildRunLifecycleCustomEvent(input),
  ] as const;
}

export async function publishInvokeAgentChildRunProgress(input: {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  expectedPreviousEventId?: number;
  expectedPreviousExternalEventSequence?: number;
  toolCallId: string;
  childAgentId: string;
  childConversationId: string;
  childRunId: string;
  childMessageId: string;
  description?: string;
  status: "pending" | "running" | "waiting_for_tool" | "completed" | "failed" | "cancelled";
  sourceTargetKind?: "project" | "production" | "environment" | "preview_branch" | null;
  runtimeTargetKind?: "production" | "environment" | "preview_branch" | null;
  targetEnvironmentId?: string | null;
  targetBranchId?: string | null;
  publishParentRunEvents?: (events: InvokeAgentChildRunProgressEvent[]) => Promise<void> | void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const events = [...buildInvokeAgentChildRunProgressEvents(input)];

  if (input.publishParentRunEvents) {
    await input.publishParentRunEvents(events);
    return;
  }

  try {
    await appendConversationRunEvents({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      conversationId: input.conversationId,
      runId: input.runId,
      expectedPreviousEventId: input.expectedPreviousEventId,
      expectedPreviousExternalEventSequence: input.expectedPreviousExternalEventSequence,
      events,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    if (isIgnorableConversationRunAppendError(error)) {
      return;
    }

    throw error;
  }
}
