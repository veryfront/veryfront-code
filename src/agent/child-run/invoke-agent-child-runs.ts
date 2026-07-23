import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import {
  appendConversationRunEvents,
  isIgnorableConversationRunAppendError,
} from "../conversation/durable.ts";

const AG_UI_CUSTOM_EVENT_TYPE = "CUSTOM";

/** Lifecycle state published for an invoke-agent child run. */
export interface InvokeAgentChildRunLifecycleValue {
  /** Parent tool call identifier. */
  toolCallId: string;
  /** Child conversation identifier. */
  childConversationId: string;
  /** Child run identifier. */
  childRunId: string;
  /** Child message identifier. */
  childMessageId: string;
  /** Child agent identifier. */
  childAgentId: string;
  /** Optional child task description. */
  description?: string;
  /** Current child run status. */
  status: "pending" | "running" | "waiting_for_tool" | "completed" | "failed" | "cancelled";
  /** Source target selected for the child run. */
  sourceTargetKind?: "project" | "main_branch" | "environment" | "preview_branch" | null;
  /** Runtime target selected for the child run. */
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
  /** Optional target environment identifier. */
  targetEnvironmentId?: string | null;
  /** Optional target branch identifier. */
  targetBranchId?: string | null;
}

/** Returns the invoke-agent child lifecycle value schema. */
export const getInvokeAgentChildRunLifecycleValueSchema: () => Schema<
  InvokeAgentChildRunLifecycleValue
> = defineSchema((v) =>
  v.object({
    toolCallId: v.string().min(1),
    childConversationId: v.string().uuid(),
    childRunId: v.string().min(1),
    childMessageId: v.string().uuid(),
    childAgentId: v.string().min(1),
    description: v.string().min(1).optional(),
    status: v.enum(
      [
        "pending",
        "running",
        "waiting_for_tool",
        "completed",
        "failed",
        "cancelled",
      ] as const,
    ),
    sourceTargetKind: v.enum(
      [
        "project",
        "main_branch",
        "environment",
        "preview_branch",
      ] as const,
    ).nullable()
      .optional(),
    runtimeTargetKind: v.enum(["main_branch", "environment", "preview_branch"] as const).nullable()
      .optional(),
    targetEnvironmentId: v.string().uuid().nullable().optional(),
    targetBranchId: v.string().uuid().nullable().optional(),
  })
);

/** Schema for invoke agent child run lifecycle value.
 * @deprecated Use getInvokeAgentChildRunLifecycleValueSchema()
 */
export const InvokeAgentChildRunLifecycleValueSchema: Schema<InvokeAgentChildRunLifecycleValue> =
  lazySchema(
    getInvokeAgentChildRunLifecycleValueSchema,
  );

/** State delta that updates invoke-agent child lifecycle state. */
export interface InvokeAgentChildRunStateDelta {
  /** Additional event fields accepted by AG-UI transport. */
  [key: string]: unknown;
  /** Event discriminator. */
  type: "STATE_DELTA";
  /** JSON patch-like child lifecycle operations. */
  delta: Array<{
    op: "add" | "replace";
    path: string;
    value: InvokeAgentChildRunLifecycleValue;
  }>;
}

/** Returns the invoke-agent child state delta schema. */
export const getInvokeAgentChildRunStateDeltaSchema: () => Schema<
  InvokeAgentChildRunStateDelta
> = defineSchema((v) =>
  v.object({
    type: v.literal("STATE_DELTA"),
    delta: v.array(
      v.object({
        op: v.enum(["add", "replace"] as const),
        path: v.string().min(1),
        value: getInvokeAgentChildRunLifecycleValueSchema(),
      }),
    ),
  })
);

/** Schema for invoke agent child run state delta.
 * @deprecated Use getInvokeAgentChildRunStateDeltaSchema()
 */
export const InvokeAgentChildRunStateDeltaSchema: Schema<InvokeAgentChildRunStateDelta> =
  lazySchema(
    getInvokeAgentChildRunStateDeltaSchema,
  );

/** Custom AG-UI event carrying invoke-agent child lifecycle state. */
export interface InvokeAgentChildRunLifecycleCustomEvent {
  /** Additional event fields accepted by AG-UI transport. */
  [key: string]: unknown;
  /** Event discriminator. */
  type: "CUSTOM";
  /** Stable custom event name. */
  name: "veryfront.invoke_agent.lifecycle";
  /** Child lifecycle payload. */
  value: InvokeAgentChildRunLifecycleValue;
}

/** Returns the invoke-agent child lifecycle custom event schema. */
export const getInvokeAgentChildRunLifecycleCustomEventSchema: () => Schema<
  InvokeAgentChildRunLifecycleCustomEvent
> = defineSchema((v) =>
  v.object({
    type: v.literal(AG_UI_CUSTOM_EVENT_TYPE),
    name: v.literal("veryfront.invoke_agent.lifecycle"),
    value: getInvokeAgentChildRunLifecycleValueSchema(),
  })
);

/** Schema for invoke agent child run lifecycle custom event.
 * @deprecated Use getInvokeAgentChildRunLifecycleCustomEventSchema()
 */
export const InvokeAgentChildRunLifecycleCustomEventSchema: Schema<
  InvokeAgentChildRunLifecycleCustomEvent
> = lazySchema(
  getInvokeAgentChildRunLifecycleCustomEventSchema,
);

/** Input payload for invoke agent child run progress. */
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

/** Event emitted for invoke agent child run progress. */
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

/** Builds invoke agent child run state delta. */
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

/** Event emitted for build invoke agent child run lifecycle custom. */
export function buildInvokeAgentChildRunLifecycleCustomEvent(
  input: InvokeAgentChildRunProgressInput,
): InvokeAgentChildRunLifecycleCustomEvent {
  return getInvokeAgentChildRunLifecycleCustomEventSchema().parse({
    type: AG_UI_CUSTOM_EVENT_TYPE,
    name: "veryfront.invoke_agent.lifecycle",
    value: buildInvokeAgentChildRunLifecycleValue(input),
  });
}

/** Builds invoke agent child run progress events. */
export function buildInvokeAgentChildRunProgressEvents(
  input: InvokeAgentChildRunProgressInput,
): readonly [InvokeAgentChildRunStateDelta, InvokeAgentChildRunLifecycleCustomEvent] {
  return [
    buildInvokeAgentChildRunStateDelta(input),
    buildInvokeAgentChildRunLifecycleCustomEvent(input),
  ] as const;
}

/** Publish invoke agent child run progress helper. */
export async function publishInvokeAgentChildRunProgress(
  // Reuse the shared progress-input shape so callers composing from it never
  // drift from this signature; the lifecycle schema still validates target
  // kinds at runtime.
  input: InvokeAgentChildRunProgressInput & {
    authToken: string;
    apiUrl: string;
    conversationId: string;
    runId: string;
    expectedPreviousEventId?: number;
    expectedPreviousExternalEventSequence?: number;
    publishParentRunEvents?: (events: InvokeAgentChildRunProgressEvent[]) => Promise<void> | void;
    abortSignal?: AbortSignal;
  },
): Promise<void> {
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
