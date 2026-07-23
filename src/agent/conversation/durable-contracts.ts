import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";

/** Zod schema for get conversation run targets. */
export const getConversationRunTargetsSchema = defineSchema((v) =>
  v.object({
    sourceTargetKind: v.enum(["project", "environment", "preview_branch"] as const).nullable(),
    runtimeTargetKind: v.enum(["main_branch", "environment", "preview_branch"] as const).nullable(),
    targetEnvironmentId: v.string().uuid().nullable().optional(),
    targetBranchId: v.string().uuid().nullable(),
  })
);

/** Schema for conversation run targets.
 * @deprecated Use getConversationRunTargetsSchema()
 */
export const ConversationRunTargetsSchema: Schema<ConversationRunTargets> = lazySchema(
  getConversationRunTargetsSchema,
);

/** Source target kind recorded on project-backed conversation runs. */
export type ConversationRunSourceTargetKind = "project" | "environment" | "preview_branch";

/** Runtime target kind recorded on project-backed conversation runs. */
export type ConversationRunRuntimeTargetKind = "main_branch" | "environment" | "preview_branch";

/** Public API contract for conversation run targets. */
export interface ConversationRunTargets {
  /** Source target kind value. */
  sourceTargetKind: ConversationRunSourceTargetKind | null;
  /** Runtime target kind value. */
  runtimeTargetKind: ConversationRunRuntimeTargetKind | null;
  /** Target environment ID value. */
  targetEnvironmentId?: string | null;
  /** Target branch ID value. */
  targetBranchId: string | null;
}

/** Resolves conversation run targets. */
export function resolveConversationRunTargets(input: {
  projectId?: string | null;
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
  environmentId?: string | null;
  branchId?: string | null;
}): ConversationRunTargets {
  if (!input.projectId) {
    return getConversationRunTargetsSchema().parse({
      sourceTargetKind: null,
      runtimeTargetKind: null,
      targetEnvironmentId: null,
      targetBranchId: null,
    }) as ConversationRunTargets;
  }

  if (input.runtimeTargetKind === "environment" && input.environmentId) {
    return getConversationRunTargetsSchema().parse({
      sourceTargetKind: "environment",
      runtimeTargetKind: "environment",
      targetEnvironmentId: input.environmentId,
      targetBranchId: null,
    }) as ConversationRunTargets;
  }

  return getConversationRunTargetsSchema().parse(
    input.branchId
      ? {
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        targetEnvironmentId: null,
        targetBranchId: input.branchId,
      }
      : {
        sourceTargetKind: "project",
        runtimeTargetKind: "main_branch",
        targetEnvironmentId: null,
        targetBranchId: null,
      },
  ) as ConversationRunTargets;
}

/** Zod schema for get conversation run status. */
export const getConversationRunStatusSchema = defineSchema((v) =>
  v.enum(["pending", "running", "waiting_for_tool", "completed", "failed", "cancelled"] as const)
);

/** Schema for conversation run status.
 * @deprecated Use getConversationRunStatusSchema()
 */
export const ConversationRunStatusSchema: Schema<ConversationRunProjection["status"]> = lazySchema(
  getConversationRunStatusSchema,
);

/** Public API contract for conversation run projection. */
export interface ConversationRunProjection {
  /** Run ID value. */
  runId: string;
  /** Conversation ID value. */
  conversationId: string;
  /** Message ID value. */
  messageId: string;
  /** Latest event ID value. */
  latestEventId: number;
  /** Latest external event sequence value. */
  latestExternalEventSequence: number;
  /** Waiting tool call ID value. */
  waitingToolCallId: string | null;
  /** Waiting tool name value. */
  waitingToolName: string | null;
  /** Status. */
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
      const latestEventId = (d.latestEventId ?? d.latest_event_id) as number | undefined;
      const latestExternalEventSequence = (d.latestExternalEventSequence ??
        d.latest_external_event_sequence) as number | undefined;

      if (!runId || !conversationId || !messageId) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Missing run identifiers in durable run response",
        });
      }

      if (latestEventId === undefined) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Missing latestEventId in durable run response",
        });
      }

      if (latestExternalEventSequence === undefined) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Missing latestExternalEventSequence in durable run response",
        });
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
export const ConversationRunProjectionSchema: Schema<ConversationRunProjection> = lazySchema(
  getConversationRunProjectionSchema,
);

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
  /** Performs the enqueue operation. */
  enqueue(events: unknown[]): void;
  /** Performs the flush operation. */
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
        | "payload_too_large"
        | "auth_rejected";
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
  /** Returns snapshot. */
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
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Missing run id in canonical create run response",
        });
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
      status: v.enum(
        [
          "pending",
          "running",
          // The completion API has historically reported "waiting" where run
          // projections use "waiting_for_tool"; accept both so a server-side
          // normalization to either value cannot break finalization.
          "waiting",
          "waiting_for_tool",
          "completed",
          "failed",
          "cancelled",
        ] as const,
      ),
    }).passthrough(),
  }).passthrough()
);

/** Response returned after completing a conversation run. */
export interface CompleteConversationRunResponse {
  /** Whether the completion request finished the run. */
  completed: boolean;
  /** Updated run state returned by the control plane. */
  run: {
    /** Canonical run identifier when returned in camel case. */
    runId?: string;
    /** Canonical run identifier when returned in REST snake case. */
    run_id?: string;
    /** Current durable run status. */
    status:
      | "pending"
      | "running"
      | "waiting"
      | "waiting_for_tool"
      | "completed"
      | "failed"
      | "cancelled";
    /** Additional run fields returned by the control plane. */
    [key: string]: unknown;
  };
  /** Additional completion response fields returned by the control plane. */
  [key: string]: unknown;
}

/** Schema for complete conversation run response.
 * @deprecated Use getCompleteConversationRunResponseSchema()
 */
export const CompleteConversationRunResponseSchema: Schema<CompleteConversationRunResponse> =
  lazySchema(
    getCompleteConversationRunResponseSchema,
  );

/** Response payload for append conversation run events. */
export interface AppendConversationRunEventsResponse {
  /** Latest event ID value. */
  latestEventId: number;
  /** Latest external event sequence value. */
  latestExternalEventSequence: number;
  /** Appended count value. */
  appendedCount: number;
  /** Run value. */
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
export const AppendConversationRunEventsResponseSchema: Schema<
  AppendConversationRunEventsResponse
> = lazySchema(
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
  /** Input tokens value. */
  inputTokens: number;
  /** Output tokens value. */
  outputTokens: number;
  /** Total tokens value. */
  totalTokens: number;
}

/** Input payload for create conversation agent run. */
export interface CreateConversationAgentRunInput {
  /** Bearer token used for control-plane requests. */
  authToken: string;
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Conversation identifier. */
  conversationId: string;
  /** Optional caller-selected run identifier. */
  runId?: string;
  /** Optional parent run identifier. */
  parentRunId?: string;
  /** Agent identifier. */
  agentId: string;
  /** Optional runtime implementation kind. */
  implementationKind?: string | null;
  /** Optional project identifier. */
  projectId?: string | null;
  /** Optional runtime target category. */
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
  /** Optional target environment identifier. */
  runtimeTargetEnvironmentId?: string | null;
  /** Optional target branch identifier. */
  branchId?: string | null;
  /** Signal used to cancel the control-plane request. */
  abortSignal?: AbortSignal;
}

/** Input payload for finalize conversation agent run. */
export interface FinalizeConversationAgentRunInput {
  /** Bearer token used for control-plane requests. */
  authToken: string;
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Conversation identifier. */
  conversationId: string;
  /** Run identifier. */
  runId: string;
  /** Terminal run status. */
  status: "completed" | "failed" | "cancelled";
  /** Model used by the run. */
  model: string;
  /** Provider used by the run. */
  provider: string;
  /** Optional final token usage. */
  usage?: ConversationAgentRunUsage;
  /** Optional provider finish reason. */
  finishReason?: string;
  /** Optional stable terminal error code. */
  terminalErrorCode?: string | null;
  /** Optional terminal error message. */
  terminalErrorMessage?: string | null;
}
