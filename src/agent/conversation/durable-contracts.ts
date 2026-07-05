import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";

/** Zod schema for get conversation run targets. */
export const getConversationRunTargetsSchema = defineSchema((v) =>
  v.object({
    sourceTargetKind: v.enum(["project", "preview_branch"]).nullable(),
    runtimeTargetKind: v.enum(["main_branch", "preview_branch"]).nullable(),
    targetBranchId: v.string().uuid().nullable(),
  })
);

/** Schema for conversation run targets.
 * @deprecated Use getConversationRunTargetsSchema()
 */
export const ConversationRunTargetsSchema = lazySchema(getConversationRunTargetsSchema);

/** Public API contract for conversation run targets. */
export type ConversationRunTargets = InferSchema<
  ReturnType<typeof getConversationRunTargetsSchema>
>;

/** Resolves conversation run targets. */
export function resolveConversationRunTargets(input: {
  projectId?: string | null;
  branchId?: string | null;
}): ConversationRunTargets {
  return getConversationRunTargetsSchema().parse(
    !input.projectId
      ? {
        sourceTargetKind: null,
        runtimeTargetKind: null,
        targetBranchId: null,
      }
      : input.branchId
      ? {
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        targetBranchId: input.branchId,
      }
      : {
        sourceTargetKind: "project",
        runtimeTargetKind: "main_branch",
        targetBranchId: null,
      },
  );
}

/** Zod schema for get conversation run status. */
export const getConversationRunStatusSchema = defineSchema((v) =>
  v.enum(["pending", "running", "waiting_for_tool", "completed", "failed", "cancelled"])
);

/** Schema for conversation run status.
 * @deprecated Use getConversationRunStatusSchema()
 */
export const ConversationRunStatusSchema = lazySchema(getConversationRunStatusSchema);

/** Public API contract for conversation run projection. */
export interface ConversationRunProjection {
  runId: string;
  conversationId: string;
  messageId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
  waitingToolCallId: string | null;
  waitingToolName: string | null;
  status: "pending" | "running" | "waiting_for_tool" | "completed" | "failed" | "cancelled";
}

/** Zod schema for get conversation run projection. */
export const getConversationRunProjectionSchema = defineSchema((v) =>
  v.object({
    runId: v.string().min(1).optional(),
    run_id: v.string().min(1).optional(),
    conversationId: v.string().uuid().optional(),
    conversation_id: v.string().uuid().optional(),
    messageId: v.string().uuid().optional(),
    message_id: v.string().uuid().optional(),
    latestEventId: v.number().int().nonnegative().optional(),
    latest_event_id: v.number().int().nonnegative().optional(),
    latestExternalEventSequence: v.number().int().nonnegative().optional(),
    latest_external_event_sequence: v.number().int().nonnegative().optional(),
    waitingToolCallId: v.string().min(1).nullable().optional(),
    waiting_tool_call_id: v.string().min(1).nullable().optional(),
    waitingToolName: v.string().nullable().optional(),
    waiting_tool_name: v.string().nullable().optional(),
    status: getConversationRunStatusSchema(),
  })
    .passthrough()
    .transform((data): ConversationRunProjection => {
      const d = data as Record<string, unknown>;
      const runId = (d.runId ?? d.run_id) as string | undefined;
      const conversationId = (d.conversationId ?? d.conversation_id) as string | undefined;
      const messageId = (d.messageId ?? d.message_id) as string | undefined;
      const latestEventId = ((d.latestEventId ?? d.latest_event_id) as number | undefined) ?? 0;
      const latestExternalEventSequence = (d.latestExternalEventSequence ??
        d.latest_external_event_sequence) as number | undefined;

      if (!runId || !conversationId || !messageId) {
        throw new Error("Missing run identifiers in durable run response");
      }

      if (latestExternalEventSequence === undefined) {
        throw new Error("Missing latestExternalEventSequence in durable run response");
      }

      return {
        runId,
        conversationId,
        messageId,
        latestEventId,
        latestExternalEventSequence,
        waitingToolCallId: ((d.waitingToolCallId ?? d.waiting_tool_call_id) as string | null) ??
          null,
        waitingToolName: ((d.waitingToolName ?? d.waiting_tool_name) as string | null) ?? null,
        status: d.status as ConversationRunProjection["status"],
      };
    })
);

/** Schema for conversation run projection.
 * @deprecated Use getConversationRunProjectionSchema()
 */
export const ConversationRunProjectionSchema = lazySchema(getConversationRunProjectionSchema);

/** Public API contract for a conversation run status is active. */
export type ActiveConversationRunStatus = Extract<
  ConversationRunProjection["status"],
  "pending" | "running" | "waiting_for_tool"
>;

/** Public API contract for terminal conversation run status. */
export type TerminalConversationRunStatus = Extract<
  ConversationRunProjection["status"],
  "completed" | "failed" | "cancelled"
>;

/** Result returned from conversation run append cursor resync. */
export type ConversationRunAppendCursorResyncResult =
  | "advanced"
  | "non_appendable"
  | "unchanged";

/** Public API contract for conversation run append recovery outcome. */
export type ConversationRunAppendRecoveryOutcome =
  | "resumed"
  | "stopped"
  | "bubbled";

/** Public API contract for conversation run append failure outcome. */
export type ConversationRunAppendFailureOutcome =
  | "resumed"
  | "stopped"
  | "retry_scheduled";

/** Public API contract for conversation run append execution outcome. */
export type ConversationRunAppendExecutionOutcome =
  | "resumed"
  | "stopped"
  | "retry_scheduled";

/** Public API contract for conversation run batch flush outcome. */
export type ConversationRunBatchFlushOutcome =
  | "flushed"
  | "resumed"
  | "stopped"
  | "retry_scheduled";

/** Public API contract for conversation run queue flush outcome. */
export type ConversationRunQueueFlushOutcome =
  | "flushed"
  | "stopped"
  | "retry_scheduled";

/** Public API contract for conversation run event queue controller. */
export interface ConversationRunEventQueueController {
  enqueue(events: unknown[]): void;
  flush(): Promise<
    | {
      outcome: "idle" | "flushed";
      latestEventId: number;
      latestExternalEventSequence: number;
      pendingEventCount: number;
      consecutiveFailures: number;
      disabled: boolean;
    }
    | {
      outcome: "stopped";
      latestEventId: number;
      latestExternalEventSequence: number;
      pendingEventCount: 0;
      consecutiveFailures: number;
      disabled: true;
      disableReason?:
        | "cursor_resyncs_exhausted"
        | "non_appendable"
        | "ignorable_append_rejection"
        | "payload_too_large";
    }
    | {
      outcome: "retry_scheduled";
      latestEventId: number;
      latestExternalEventSequence: number;
      pendingEventCount: number;
      consecutiveFailures: number;
      disabled: false;
      errorMessage: string;
    }
  >;
  getSnapshot(): {
    latestEventId: number;
    latestExternalEventSequence: number;
    pendingEventCount: number;
    consecutiveFailures: number;
    disabled: boolean;
  };
}

/** Zod schema for get create conversation run accepted. */
export const getCreateConversationRunAcceptedSchema = defineSchema((v) =>
  v.object({
    run: v.object({
      runId: v.string().min(1).optional(),
      run_id: v.string().min(1).optional(),
    }).passthrough(),
  })
    .passthrough()
    .transform((data): { runId: string } => {
      const d = data as { run: Record<string, unknown> };
      const runId = (d.run.runId ?? d.run.run_id) as string | undefined;
      if (!runId) {
        throw new Error("Missing run id in canonical create run response");
      }
      return { runId };
    })
);

/** Schema for create conversation run accepted.
 * @deprecated Use getCreateConversationRunAcceptedSchema()
 */
export const CreateConversationRunAcceptedSchema = lazySchema(
  getCreateConversationRunAcceptedSchema,
);

/** Zod schema for get complete conversation run response. */
export const getCompleteConversationRunResponseSchema = defineSchema((v) =>
  v.object({
    completed: v.boolean(),
    run: v.object({
      runId: v.string().min(1).optional(),
      run_id: v.string().min(1).optional(),
      status: v.enum(["pending", "running", "waiting", "completed", "failed", "cancelled"]),
    }).passthrough(),
  }).passthrough()
);

/** Schema for complete conversation run response.
 * @deprecated Use getCompleteConversationRunResponseSchema()
 */
export const CompleteConversationRunResponseSchema = lazySchema(
  getCompleteConversationRunResponseSchema,
);

/** Response payload for append conversation run events. */
export interface AppendConversationRunEventsResponse {
  latestEventId: number;
  latestExternalEventSequence: number;
  appendedCount: number;
  run: {
    runId: string;
    conversationId: string;
    latestEventId: number;
    latestExternalEventSequence: number;
    [key: string]: unknown;
  };
}

/** Zod schema for get append conversation run events response. */
export const getAppendConversationRunEventsResponseSchema = defineSchema((v) =>
  v.union([
    v.object({
      latestEventId: v.number().int().nonnegative(),
      latestExternalEventSequence: v.number().int().nonnegative(),
      appendedCount: v.number().int().nonnegative(),
      run: v.object({
        runId: v.string().min(1),
        conversationId: v.string().uuid(),
        latestEventId: v.number().int().nonnegative(),
        latestExternalEventSequence: v.number().int().nonnegative(),
      }).passthrough(),
    }),
    v.object({
      latest_event_id: v.number().int().nonnegative(),
      latest_external_event_sequence: v.number().int().nonnegative(),
      appended_count: v.number().int().nonnegative(),
      run: v.object({
        run_id: v.string().min(1),
        conversation_id: v.string().uuid(),
        latest_event_id: v.number().int().nonnegative(),
        latest_external_event_sequence: v.number().int().nonnegative(),
      }).passthrough(),
    }).transform((data): AppendConversationRunEventsResponse => {
      const d = data as Record<string, unknown>;
      const run = d.run as Record<string, unknown>;
      return {
        latestEventId: d.latest_event_id as number,
        latestExternalEventSequence: d.latest_external_event_sequence as number,
        appendedCount: d.appended_count as number,
        run: {
          ...run,
          runId: run.run_id as string,
          conversationId: run.conversation_id as string,
          latestEventId: run.latest_event_id as number,
          latestExternalEventSequence: run.latest_external_event_sequence as number,
        },
      };
    }),
  ])
);

/** Schema for append conversation run events response.
 * @deprecated Use getAppendConversationRunEventsResponseSchema()
 */
export const AppendConversationRunEventsResponseSchema = lazySchema(
  getAppendConversationRunEventsResponseSchema,
);

/** Zod schema for get conversation run error. */
export const getConversationRunErrorSchema = defineSchema((v) =>
  v.object({
    detail: v.string().min(1).optional(),
    error: v.string().min(1).optional(),
  })
);

/** Public API contract for conversation agent run usage. */
export interface ConversationAgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Input payload for create conversation agent run. */
export interface CreateConversationAgentRunInput {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId?: string;
  parentRunId?: string;
  agentId: string;
  implementationKind?: string | null;
  projectId?: string | null;
  branchId?: string | null;
}

/** Input payload for finalize conversation agent run. */
export interface FinalizeConversationAgentRunInput {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  status: "completed" | "failed" | "cancelled";
  model: string;
  provider: string;
  usage?: ConversationAgentRunUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}
