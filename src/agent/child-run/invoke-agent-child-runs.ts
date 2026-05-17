import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  appendConversationRunEvents,
  isIgnorableConversationRunAppendError,
} from "../conversation/durable.ts";

const AG_UI_CUSTOM_EVENT_TYPE = "CUSTOM";

export const getInvokeAgentChildRunLifecycleValueSchema = defineSchema((v) =>
  v.object({
    toolCallId: v.string().min(1),
    childConversationId: v.string().uuid(),
    childRunId: v.string().min(1),
    childMessageId: v.string().uuid(),
    childAgentId: v.string().min(1),
    description: v.string().min(1).optional(),
    status: v.enum(["pending", "running", "waiting_for_tool", "completed", "failed", "cancelled"]),
    sourceTargetKind: v.enum(["project", "main_branch", "environment", "preview_branch"]).nullable()
      .optional(),
    runtimeTargetKind: v.enum(["main_branch", "environment", "preview_branch"]).nullable()
      .optional(),
    targetEnvironmentId: v.string().uuid().nullable().optional(),
    targetBranchId: v.string().uuid().nullable().optional(),
  })
);

/** @deprecated Use getInvokeAgentChildRunLifecycleValueSchema() */
export const InvokeAgentChildRunLifecycleValueSchema = lazySchema(
  getInvokeAgentChildRunLifecycleValueSchema,
);

export type InvokeAgentChildRunLifecycleValue = InferSchema<
  ReturnType<typeof getInvokeAgentChildRunLifecycleValueSchema>
>;

export const getInvokeAgentChildRunStateDeltaSchema = defineSchema((v) =>
  v.object({
    type: v.literal("STATE_DELTA"),
    delta: v.array(
      v.object({
        op: v.enum(["add", "replace"]),
        path: v.string().min(1),
        value: getInvokeAgentChildRunLifecycleValueSchema(),
      }),
    ),
  })
);

/** @deprecated Use getInvokeAgentChildRunStateDeltaSchema() */
export const InvokeAgentChildRunStateDeltaSchema = lazySchema(
  getInvokeAgentChildRunStateDeltaSchema,
);

export type InvokeAgentChildRunStateDelta = InferSchema<
  ReturnType<typeof getInvokeAgentChildRunStateDeltaSchema>
>;

export const getInvokeAgentChildRunLifecycleCustomEventSchema = defineSchema((v) =>
  v.object({
    type: v.literal(AG_UI_CUSTOM_EVENT_TYPE),
    name: v.literal("veryfront.invoke_agent.lifecycle"),
    value: getInvokeAgentChildRunLifecycleValueSchema(),
  })
);

/** @deprecated Use getInvokeAgentChildRunLifecycleCustomEventSchema() */
export const InvokeAgentChildRunLifecycleCustomEventSchema = lazySchema(
  getInvokeAgentChildRunLifecycleCustomEventSchema,
);

export type InvokeAgentChildRunLifecycleCustomEvent = InferSchema<
  ReturnType<typeof getInvokeAgentChildRunLifecycleCustomEventSchema>
>;

export type InvokeAgentChildRunProgressInput = {
  toolCallId: string;
  childConversationId: string;
  childRunId: string;
  childMessageId: string;
  childAgentId: string;
  description?: string;
  status: "pending" | "running" | "waiting_for_tool" | "completed" | "failed" | "cancelled";
  sourceTargetKind?: string | null;
  runtimeTargetKind?: string | null;
  targetEnvironmentId?: string | null;
  targetBranchId?: string | null;
};

export type InvokeAgentChildRunProgressEvent =
  | InvokeAgentChildRunStateDelta
  | InvokeAgentChildRunLifecycleCustomEvent;

function buildInvokeAgentChildRunLifecycleValue(
  input: InvokeAgentChildRunProgressInput,
): InvokeAgentChildRunLifecycleValue {
  return getInvokeAgentChildRunLifecycleValueSchema().parse({
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
  return getInvokeAgentChildRunStateDeltaSchema().parse({
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
  return getInvokeAgentChildRunLifecycleCustomEventSchema().parse({
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
  sourceTargetKind?: "project" | "main_branch" | "environment" | "preview_branch" | null;
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
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
