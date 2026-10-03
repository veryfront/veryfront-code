import { RunStopRegistry } from "#veryfront/internal-agents/run-stop-registry.ts";
import { agentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  API_CLIENT_ERROR,
  INPUT_VALIDATION_FAILED,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
  RESOURCE_NOT_FOUND,
  TIMEOUT_ERROR,
  VeryfrontError,
} from "#veryfront/errors";
import {
  formatSchemaValidationErrors,
  INPUT_VALIDATION_FAILED_CODE,
  OUTPUT_VALIDATION_FAILED_CODE,
  readSchemaValidationErrors,
  type SchemaValidationError,
} from "#veryfront/schemas/validation-errors.ts";
import { CONTROL_PLANE_RUNS_PATH_PREFIX } from "#veryfront/channels/control-plane.ts";
import { getEnvironmentConfig } from "#veryfront/config";
import {
  requireHostPrivateApiHttps,
  resolveHostOwnedSourceApiBaseUrl,
} from "#veryfront/config/host-api-base.ts";
import {
  isAbortSignalAborted,
  removeAbortSignalListener,
} from "#veryfront/platform/compat/abort-signal.ts";
import {
  primordialPromiseCatch,
  primordialPromiseResolve,
  primordialPromiseThen,
} from "#veryfront/platform/compat/primordials/promise.ts";
import { primordialArrayMap } from "#veryfront/platform/compat/primordials/array.ts";
import { getRequestTransportLifetime } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INGRESS_API_TOKEN_HEADER,
  INGRESS_INFERENCE_TOKEN_HEADER,
  INGRESS_RUN_STOP_TOKEN_HEADER,
  inheritIngressCredentials,
  readIngressCredential,
} from "#veryfront/security/http/ingress-credentials.ts";
import {
  INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import { telemetryErrorType } from "#veryfront/observability/telemetry-error.ts";
import {
  activeSpanLink,
  setActiveSpanErrorStatus,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import type { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { StyleScopeProfile } from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { DiscoveryResult } from "#veryfront/discovery";
import { findProjectRuntimeTask } from "#veryfront/task/project-runtime.ts";
import { runTask, type RunTaskOptions, type TaskRunResult } from "#veryfront/task/runner.ts";
import {
  checkDeclaredSchema,
  schemaIdentitySha256,
  type SchemaViolation,
} from "#veryfront/task/io-contract.ts";
import {
  checkRunOutputBytes,
  measureSerializedRunOutputBytes,
  parseSerializedRunOutput,
  serializeRunOutput,
} from "#veryfront/task/run-output-limit.ts";
import { type DiscoveredEval, findEvalById } from "#veryfront/eval/discovery.ts";
import { runEval } from "#veryfront/eval/runner.ts";
import {
  type AgentServiceEvalAdapterConfig,
  type AgentServiceEvalRequestBody,
  createAgentServiceEvalAdapter,
} from "#veryfront/eval/agent-service.ts";
import { bindTrustedLocalEvalFetch } from "#veryfront/eval/agent-service/trusted-fetch.ts";
import { type AgUiRuntimeRestrictions, createAgUiHandler } from "#veryfront/agent/ag-ui/handler.ts";
import { hostedChatRuntimeOverridesSchema } from "#veryfront/agent/hosted/chat-request.ts";
import { resolveConversationRunTargets } from "#veryfront/agent/conversation/durable-contracts.ts";
import type {
  EvalAgentAdapter,
  EvalDefinition,
  EvalMetricResult,
  EvalRecord,
  EvalReport,
  RunEvalOptions,
} from "#veryfront/eval/types.ts";
import { type Logger, serverLogger } from "#veryfront/utils";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { type DiscoveredWorkflow, findWorkflowById } from "#veryfront/workflow/discovery";
import { createWorkflowClient, hasEventWaitSupport, RedisBackend } from "#veryfront/workflow";
import { CONTROL_PLANE_OWNED_START } from "#veryfront/workflow/dsl/validation.ts";
import type { WorkflowClientConfig } from "#veryfront/workflow";
import { MAX_WORKFLOW_CHILD_RUN_DEPENDENCIES } from "#veryfront/workflow/limits.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import {
  PROJECT_RUN_INFERENCE_TOKEN_HEADER,
  runWithProjectRunInferenceCredential,
} from "#veryfront/agent/runtime/project-run-inference-credential.ts";
import { requireInferenceProviderCredential } from "#veryfront/provider/runtime-loader/provider-request-init.ts";
import { ensureProjectDiscovery } from "./api/project-discovery.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { BaseHandler } from "../response/base.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";

const TaskDate = Date;
/** Captured before project code runs, which may replace the global. */
const TaskError = Error;
const TaskDateNow = Date.now;
const TaskDateParse = Date.parse;
const TaskSetTimeout = globalThis.setTimeout;
const TaskClearTimeout = globalThis.clearTimeout;
const TaskAbortController = AbortController;
const TaskAbort = AbortController.prototype.abort;
const TaskAbortSignalAny = AbortSignal.any;
const RunStopTimeout = AbortSignal.timeout;
const RunStopAddListener = EventTarget.prototype.addEventListener;
const ResponsePrototypeJson = Response.prototype.json;

const EXECUTE_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)\/execute$/;
const DEFAULT_WORKFLOW_STATUS_POLL_INTERVAL_MS = 100;
const DEFAULT_WORKFLOW_STATUS_TIMEOUT_MS = 15 * 60 * 1_000;
/** How long a durable run may read `waiting` on no record before a backend without event waits is blamed. */
const WORKFLOW_UNPERSISTED_WAIT_GRACE_MS = 5_000;
/**
 * How long the response waits for the workflow client to release its backend.
 * Cleanup must never hold back a run's result (veryfront-issue-inbox#2109).
 */
const DEFAULT_WORKFLOW_CLIENT_DESTROY_TIMEOUT_MS = 5_000;
/** When the control plane re-dispatches a resume whose request timed out, to report where the run got to. */
const WORKFLOW_RESUME_RECHECK_MS = 30_000;
/** At most one pause acknowledgement per run in this window; a boundary inside it skips the call. */
const WORKFLOW_PAUSE_CHECK_INTERVAL_MS = 1_000;
const WORKFLOW_PAUSE_ACK_ATTEMPTS = 3;
const WORKFLOW_PAUSE_ACK_RETRY_MS = 100;
/** One pause-ack request; the run waits for the answer at its boundary. */
const WORKFLOW_PAUSE_ACK_TIMEOUT_MS = 2_000;
/** After a check the control plane did not answer, boundaries skip asking for this long. */
const WORKFLOW_PAUSE_CHECK_BACKOFF_MS = 30_000;
/**
 * How often a manual resume retries, 100ms apart, while the paused execution still holds the
 * run: about 35s, past the 30s workflow lock lease a parking execution that died may leave.
 */
const WORKFLOW_MANUAL_RESUME_ATTEMPTS = 350;
/** Prefix of a `wait_id` that lists one short hash per wait record of the pause. */
const WAIT_ID_PREFIX = "w";
const WAIT_ID_HASH_LENGTH = 16;
const WAIT_ID_MAX_LENGTH = 256;
const UNPERSISTED_EVENT_WAIT_ERROR =
  "The workflow backend cannot persist event waits, so this run cannot be resumed";
const DEFAULT_LOCAL_AG_UI_PORT = 3001;
const WORKFLOW_PERSISTENCE_REQUIRED_ERROR =
  "Workflow paused but runtime workflow persistence is not configured";
const KNOWLEDGE_LOG_MAX_EVENTS = 1_000;
const KNOWLEDGE_LOG_MAX_BYTES = 256 * 1_024;
const KNOWLEDGE_LOG_TRUNCATED_MESSAGE = "Knowledge ingest logs were truncated";
const ReflectApply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const NumberIsFinite = Number.isFinite;
const NumberParseInt = Number.parseInt;
const MathTrunc = Math.trunc;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const NumberPrototypeToString = Number.prototype.toString;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeTrim = String.prototype.trim;
const NativeRequest = Request;
const RequestPrototypeClone = Request.prototype.clone;
const RequestPrototypeJson = Request.prototype.json;
const ParseHostedChatRuntimeOverrides = hostedChatRuntimeOverridesSchema.safeParse;
/** setTimeout fires at once for a longer delay, so a far deadline is re-armed in steps. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function getOwnDataProperty(value: Record<string, unknown>, key: string): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export interface ProjectRunExecuteRequest {
  runId: string;
  kind: "task" | "workflow";
  target: string;
  projectId: string;
  runtimeAgUiEndpoint?: string;
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch";
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
  deadlineAt?: string;
  /** 1-based attempt under the run's backoff_limit; tasks read it as ctx.attempt. */
  attempt?: number;
  config?: Record<string, unknown>;
  /** Business input: any JSON value. Absent when the run was created without input. */
  input?: unknown;
  parentRunId?: string | null;
  rootRunId?: string | null;
  /** Why a waiting workflow run is dispatched again (#2102, #2110). Absent on a first dispatch. */
  resume?: WorkflowResumeSignal;
}

/**
 * The decision or deadline that releases a waiting workflow run, sent by the
 * control plane when it re-dispatches the same run id. Approval and event
 * decisions come from `POST /runs/{run_id}/resume` (#2102); `deadline` means
 * the pause's earliest wake-up or timeout has passed (#2110).
 */
export type WorkflowResumeSignal =
  | {
    type: "approval";
    node_id: string;
    approved: boolean;
    comment?: string;
    /** Structured response for an approval declared with a `responseSchema`. */
    data?: unknown;
    approver: string;
    wait_id?: string;
  }
  | { type: "event"; name: string; payload?: unknown; wait_id?: string }
  | { type: "deadline"; wait_id?: string }
  | { type: "child_run"; wait_id: string }
  /** Continue a run that paused at a safe boundary on a manual pause request. It names no wait. */
  | { type: "manual" };

/** A resume that releases wait records, as opposed to a manual resume of a paused run. */
type WorkflowWaitResumeSignal = Exclude<WorkflowResumeSignal, { type: "manual" }>;

export interface WorkflowWaitingDependency {
  kind: "run";
  run_id: string;
  correlation: { kind: "workflow_node"; id: string };
}

/** What a paused workflow run waits on, reported with `status: "waiting"` (#2085, #2102, #2110). */
export interface WorkflowWaitingDetails {
  pending_approvals?: string[];
  /** The first awaited event name; `events` lists every one. */
  event?: string;
  events?: string[];
  /**
   * Identifies this pause boundary. The control plane sends it back with a
   * resume decision so a retried dispatch never applies the decision to a
   * later boundary the run reached in the meantime (#2102).
   */
  wait_id?: string;
  /** Earliest `delay()` wake-up or approval/event timeout, as an ISO timestamp. */
  resume_at?: string;
}

export interface ProjectRunExecuteResponse {
  success: boolean;
  /** Lifecycle outcome. Sent for a pause, which `success` alone cannot express (#2085). */
  status?: "waiting";
  waiting_reason?: "approval" | "event" | "child_run" | "manual_pause";
  /** Every independently durable run that must terminate before this workflow continues. */
  waiting_on?: WorkflowWaitingDependency[];
  waiting?: WorkflowWaitingDetails;
  result?: unknown;
  logs?: string | null;
  error?: string | null;
  error_code?:
    | "RUN_TIMEOUT"
    | "INPUT_VALIDATION_FAILED"
    | "OUTPUT_VALIDATION_FAILED"
    | "OUTPUT_TOO_LARGE";
  /**
   * Structured failure detail, such as schema validation errors, or
   * `{ size_bytes, limit_bytes }` for `OUTPUT_TOO_LARGE`.
   */
  error_detail?: unknown;
  /** The task threw a RetryableError; the API may start another attempt. */
  retryable?: true;
  duration_ms?: number;
  artifacts?: unknown[];
  /** sha256 of the canonical declared input schema (task and workflow runs), or `null` when none. */
  input_schema_sha256?: string | null;
  /** sha256 of the canonical declared output schema (task and workflow runs), or `null` when none. */
  output_schema_sha256?: string | null;
  /** A recorded, non-fatal schema mismatch (warning phase), or `null`. */
  schema_violation?: SchemaViolation | null;
}

interface EvalReportUploadInput {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  report: EvalReport;
  projectReference: string;
  reportPath: string;
  content?: string;
  signal?: AbortSignal;
}

interface WorkflowRunView {
  status: string;
  output?: unknown;
  /** The nodes a `waiting` run is parked on. */
  currentNodes?: ReadonlyArray<string>;
  nodeStates?: Readonly<
    Record<string, { input?: unknown; status?: string; _waitInstanceId?: string } | undefined>
  >;
  error?: { message?: string; code?: string; detail?: unknown } | null;
  pendingApprovals?: ReadonlyArray<
    { id: string; nodeId: string; status?: string; expiresAt?: Date | string }
  >;
}

interface WorkflowEventWaitView {
  id?: string;
  nodeId: string;
  eventName: string;
  waitKind: string;
  status?: string;
  expiresAt?: Date | string;
}

interface WorkflowStartHandle {
  runId: string;
  settled?(): Promise<void>;
}

interface WorkflowClientView {
  readonly statePersistence?: "durable" | "ephemeral";
  /** False when the durable backend cannot save event and delay waits. */
  readonly persistsEventWaits?: boolean;
  register(workflow: unknown): void;
  start(
    workflowId: string,
    input: unknown,
    options?: { runId?: string; [CONTROL_PLANE_OWNED_START]?: true },
  ): Promise<WorkflowStartHandle>;
  getRun(runId: string): Promise<WorkflowRunView | null>;
  /** Continue a durable run that paused at a safe boundary. */
  resume?(runId: string): Promise<void>;
  getPendingEventWaits?(runId: string): Promise<WorkflowEventWaitView[]>;
  resumeChildRuns?(
    runId: string,
    expectedBoundary: ReadonlyArray<{ nodeId: string; runIds: string[]; waitInstanceId: string }>,
  ): Promise<boolean>;
  approve?(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<unknown>;
  reject?(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<unknown>;
  /** Resolves with the workflow client's `PublishEventOutcome`. */
  publishEvent?(runId: string, eventName: string, payload?: unknown): Promise<string>;
  retryEventDelivery?(runId: string, eventName: string): Promise<boolean>;
  getApprovalManager?(): { checkExpiredApprovals(runId?: string): Promise<void> };
  getEventWaitManager?(): { checkExpiredEventWaits(runId?: string): Promise<void> };
  cancel(runId: string): Promise<void>;
  /**
   * Positive only for locally owned execution whose underlying operation has stopped.
   * Settled runs keep this evidence only with `executor.retainExecutionStopEvidence`.
   */
  waitForExecutionStopped?(runId: string): Promise<boolean>;
  destroy(): Promise<void>;
}

interface TaskDeadlineClock {
  now: () => number;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

const defaultTaskDeadlineClock: TaskDeadlineClock = Object.freeze({
  now: TaskDateNow,
  setTimeout: TaskSetTimeout,
  clearTimeout: TaskClearTimeout,
});

export interface ProjectRunExecuteHandlerDeps {
  /** Host-owned clock; defaults to intrinsics captured before project code runs. */
  taskDeadlineClock?: TaskDeadlineClock;
  runTask(options: RunTaskOptions): Promise<TaskRunResult>;
  findWorkflowById(
    workflowId: string,
    options: {
      projectDir: string;
      adapter: RuntimeAdapter;
      config?: VeryfrontConfig;
      debug?: boolean;
      allowHostProjectCodeExecution?: boolean;
    },
  ): Promise<DiscoveredWorkflow | null>;
  findEvalById(
    evalId: string,
    options: {
      projectDir: string;
      adapter: RuntimeAdapter;
      config?: VeryfrontConfig;
      debug?: boolean;
      allowHostProjectCodeExecution?: boolean;
    },
  ): Promise<DiscoveredEval | null>;
  createWorkflowClient(
    config: WorkflowClientConfig | undefined,
    options: { projectId: string } & ProjectWorkflowRedisTargetScope,
  ): WorkflowClientView | Promise<WorkflowClientView>;
  runEval(definition: EvalDefinition, options: RunEvalOptions): Promise<EvalReport>;
  createEvalAgentAdapter(config: AgentServiceEvalAdapterConfig): EvalAgentAdapter;
  uploadEvalReport(input: EvalReportUploadInput): Promise<string | null>;
  ensureProjectDiscovery(ctx: HandlerContext): Promise<DiscoveryResult>;
  executeKnowledgeIngest(input: {
    request: ProjectRunExecuteRequest;
    ctx: HandlerContext;
    req: Request;
    signal: AbortSignal;
  }): Promise<ProjectRunExecuteResponse>;
  executeReleaseAssetBuild(input: {
    request: ProjectRunExecuteRequest;
    ctx: HandlerContext;
    req: Request;
    signal: AbortSignal;
  }): Promise<ProjectRunExecuteResponse>;
  executeDependencyArtifactBuild(input: {
    request: ProjectRunExecuteRequest;
    ctx: HandlerContext;
    req: Request;
    signal: AbortSignal;
  }): Promise<ProjectRunExecuteResponse>;
  executeStyleArtifactBuild(input: {
    request: ProjectRunExecuteRequest;
    ctx: HandlerContext;
    req: Request;
    signal: AbortSignal;
  }): Promise<ProjectRunExecuteResponse>;
  workflowResumeTimeoutMs?: number;
  /** How long a response waits for workflow client cleanup; defaults to 5 seconds. */
  workflowClientDestroyTimeoutMs?: number;
  sleep(ms: number): Promise<void>;
  now(): number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw INPUT_VALIDATION_FAILED.create({ detail: "Expected object" });
  return value;
}

function parseOptionalUrl(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
    }
    return url.toString();
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }
}

function parseRuntimeTargetKind(value: unknown): ProjectRunExecuteRequest["runtimeTargetKind"] {
  if (value === undefined || value === null) return undefined;
  if (value === "main_branch" || value === "environment" || value === "preview_branch") {
    return value;
  }
  throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runtimeTargetKind" });
}

function parseOptionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }
  return value;
}

/**
 * Reject runtime target selections that carry no identifier for their kind.
 *
 * `validateRuntimeAgentTargetSelection` already treats these combinations as
 * invalid for the same selection, but that check runs on the agent invocation
 * contract, not on this wire format. Without it here, an `environment` target
 * missing its environment id — or a `preview_branch` target missing its branch
 * id — canonicalizes to the empty identifier, so every such request shares one
 * durable workflow namespace and can see another target's runs and approval
 * decision claims. An identifier belonging to a different kind is rejected for
 * the same reason: it is a malformed selection, not a namespace.
 *
 * A `main_branch` selection, or an omitted kind, is left alone. Omitted kinds
 * still reach this handler alongside a `runtimeTargetEnvironmentId` that
 * `executeTaskRun` reads as the legacy environment override, and
 * `canonicalWorkflowRedisTarget` already drops identifiers the default branch
 * does not own, so those cannot fork the namespace.
 */
function validateRuntimeTargetSelection(
  kind: ProjectRunExecuteRequest["runtimeTargetKind"],
  environmentId: string | null | undefined,
  branchId: string | null | undefined,
): void {
  if (kind === "environment" && (!environmentId || branchId)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "environment target requires runtimeTargetEnvironmentId and no runtimeTargetBranchId",
    });
  }
  if (kind === "preview_branch" && (!branchId || environmentId)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail:
        "preview_branch target requires runtimeTargetBranchId and no runtimeTargetEnvironmentId",
    });
  }
}

function isValidTaskDeadline(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
      .test(value) ||
    !NumberIsFinite(TaskDateParse(value))
  ) return false;
  // Date.parse normalizes invalid days, so check the calendar date separately
  // from the timezone offset before accepting its instant.
  const day = value.slice(0, 10);
  const midnight = TaskDateParse(`${day}T00:00:00Z`);
  return NumberIsFinite(midnight) && new TaskDate(midnight).toISOString().slice(0, 10) === day;
}

function parseExecuteRequest(value: unknown, pathRunId: string): ProjectRunExecuteRequest {
  if (!isRecord(value)) throw INPUT_VALIDATION_FAILED.create({ detail: "Expected object" });

  const runId = value.runId;
  const kind = value.kind;
  const target = value.target;
  const projectId = value.projectId;

  if (typeof runId !== "string" || !runId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid runId" });
  }
  if (runId !== pathRunId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Run id does not match request path" });
  }
  if (kind === "eval") {
    throw new ControlPlaneRequestError(
      400,
      "Run kind 'eval' is retired; use kind 'task' with target 'task:eval'",
    );
  }
  if (kind !== "task" && kind !== "workflow") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid run kind" });
  }
  if (typeof target !== "string" || !target) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid target" });
  }
  if (typeof projectId !== "string" || !projectId) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid projectId" });
  }
  if (kind === "task" && !target.startsWith("task:")) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid task target" });
  }
  if (kind === "workflow" && !target.startsWith("workflow:")) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid workflow target" });
  }

  const deadlineAt = value.deadlineAt;
  if (deadlineAt !== undefined && !isValidTaskDeadline(deadlineAt)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid deadlineAt" });
  }

  const attempt = value.attempt;
  if (
    attempt !== undefined &&
    (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1)
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid attempt" });
  }

  const runtimeTargetKind = parseRuntimeTargetKind(value.runtimeTargetKind);
  const runtimeTargetEnvironmentId = parseOptionalNullableString(
    value.runtimeTargetEnvironmentId,
    "runtimeTargetEnvironmentId",
  );
  const runtimeTargetBranchId = parseOptionalNullableString(
    value.runtimeTargetBranchId,
    "runtimeTargetBranchId",
  );
  validateRuntimeTargetSelection(
    runtimeTargetKind,
    runtimeTargetEnvironmentId,
    runtimeTargetBranchId,
  );

  return {
    runId,
    kind,
    target,
    projectId,
    runtimeAgUiEndpoint: parseOptionalUrl(value.runtimeAgUiEndpoint, "runtimeAgUiEndpoint"),
    runtimeTargetKind,
    runtimeTargetEnvironmentId,
    runtimeTargetBranchId,
    deadlineAt,
    attempt,
    config: parseRecord(value.config),
    input: value.input,
    parentRunId: parseOptionalNullableString(value.parentRunId, "parentRunId"),
    rootRunId: parseOptionalNullableString(value.rootRunId, "rootRunId"),
    ...(value.resume === undefined ? {} : { resume: parseResumeSignal(value.resume, kind) }),
  };
}

/** The resume field limits the control plane enforces on `POST /runs/{run_id}/resume`. */
const RESUME_ID_MAX_LENGTH = 256;
const RESUME_COMMENT_MAX_LENGTH = 4_000;

function parseBoundedString(
  value: unknown,
  fieldName: string,
  { minLength, maxLength }: { minLength: number; maxLength: number },
): string {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `Invalid ${fieldName}` });
  }
  return value;
}

function parseResumeId(value: unknown, fieldName: string): string {
  return parseBoundedString(value, fieldName, { minLength: 1, maxLength: RESUME_ID_MAX_LENGTH });
}

function parseResumeWaitId(value: unknown): { wait_id?: string } {
  return value === undefined ? {} : { wait_id: parseResumeId(value, "resume.wait_id") };
}

function parseResumeSignal(
  value: unknown,
  kind: ProjectRunExecuteRequest["kind"],
): WorkflowResumeSignal {
  if (kind !== "workflow") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Only workflow runs can be resumed" });
  }
  if (!isRecord(value)) throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid resume" });
  switch (value.type) {
    case "approval": {
      if (typeof value.approved !== "boolean") {
        throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid resume.approved" });
      }
      return {
        type: "approval",
        node_id: parseResumeId(value.node_id, "resume.node_id"),
        approved: value.approved,
        approver: parseResumeId(value.approver, "resume.approver"),
        ...(value.data === undefined ? {} : { data: value.data }),
        ...parseResumeWaitId(value.wait_id),
        // An empty comment is valid, as on the control plane's resume route.
        ...(value.comment === undefined ? {} : {
          comment: parseBoundedString(value.comment, "resume.comment", {
            minLength: 0,
            maxLength: RESUME_COMMENT_MAX_LENGTH,
          }),
        }),
      };
    }
    case "event":
      return {
        type: "event",
        name: parseResumeId(value.name, "resume.name"),
        ...(value.payload === undefined ? {} : { payload: value.payload }),
        ...parseResumeWaitId(value.wait_id),
      };
    case "deadline":
      return { type: "deadline", ...parseResumeWaitId(value.wait_id) };
    case "child_run":
      return { type: "child_run", wait_id: parseResumeId(value.wait_id, "resume.wait_id") };
    case "manual":
      return { type: "manual" };
    default:
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid resume.type" });
  }
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/^eval:/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

function buildEvalReportPath(report: EvalReport, request: ProjectRunExecuteRequest): string {
  const evalId = sanitizePathSegment(report.definitionId || request.target, "eval");
  const runId = sanitizePathSegment(request.runId, "run");
  return `evals/reports/${evalId}/${runId}.json`;
}

// Capture before project code can replace the process-wide serializer.
const capturedArtifactJsonStringify = JSON.stringify.bind(JSON);

function serializeEvalReportFile(report: EvalReport, reportPath: string): string {
  return `${capturedArtifactJsonStringify({ __proto__: null, ...report, reportPath }, null, 2)}\n`;
}

async function createEvalReportArtifact(
  path: string,
  content: string,
): Promise<Record<string, unknown>> {
  return {
    __proto__: null,
    kind: "eval-report",
    path,
    contentType: "application/json",
    size_bytes: utf8ByteLength(content),
    sha256: await computeHash(content),
  };
}

function getRunId(pathname: string): string | null {
  return EXECUTE_PATH_REGEX.exec(pathname)?.[1] ?? null;
}

function stripTargetPrefix(target: string, prefix: "task:" | "workflow:"): string {
  return target.slice(prefix.length);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A workflow input that failed its inputSchema, as a failed run carrying
 * `INPUT_VALIDATION_FAILED` and the validation errors (veryfront-issue-inbox#2091).
 * Any other error yields `null`.
 */
function createInputValidationFailure(
  error: unknown,
  durationMs: number,
): ProjectRunExecuteResponse | null {
  if (!(error instanceof VeryfrontError) || error.slug !== "input-validation-failed") return null;
  const context = error.context;
  const errors: SchemaValidationError[] | undefined = readSchemaValidationErrors(
    typeof context === "object" && context !== null
      ? (context as { errors?: unknown }).errors
      : undefined,
  );
  if (!errors) return null;
  return {
    success: false,
    error: error.message,
    error_code: INPUT_VALIDATION_FAILED_CODE,
    error_detail: { errors },
    logs: null,
    duration_ms: durationMs,
  };
}

/** Keep artifact identity outside the shared prototype graph during wire serialization. */
function serializeRunResponseEnvelope(response: ProjectRunExecuteResponse): string {
  const envelope = { __proto__: null, ...response };
  if (ArrayIsArray(envelope.artifacts)) {
    envelope.artifacts = ObjectSetPrototypeOf(
      primordialArrayMap(
        envelope.artifacts!,
        (artifact) =>
          typeof artifact === "object" && artifact !== null && !ArrayIsArray(artifact)
            ? { __proto__: null, ...artifact }
            : artifact,
      ),
      null,
    );
  }
  return serializeRunOutput(envelope) ?? "null";
}

/**
 * Applies the run output limit before a response is sent (veryfront/veryfront-issue-inbox#2113).
 * A successful result over the limit becomes an OUTPUT_TOO_LARGE failure without the result; a
 * failed response drops an oversized result and keeps its own error. Nothing is truncated.
 */
function enforceRunOutputLimit(response: ProjectRunExecuteResponse): {
  response: ProjectRunExecuteResponse;
  wireJson: string;
} {
  if (!("result" in response)) {
    return { response, wireJson: serializeRunResponseEnvelope(response) };
  }
  // Serialize once: the checked serialization is the one sent, so a result whose `toJSON`
  // or getters change between serializations cannot slip past the limit.
  const serialized = serializeRunOutput(response.result);
  const tooLarge = checkRunOutputBytes(measureSerializedRunOutputBytes(serialized));
  if (!tooLarge) {
    const safeResponse = {
      ...response,
      result: serialized === undefined ? undefined : parseSerializedRunOutput(serialized),
    };
    // Emit the exact bytes that were measured. Re-serializing the parsed copy can grow it,
    // for example `JSON.rawJSON("1e20")` is 4 bytes checked but 21 bytes once parsed.
    const { result: _checked, ...envelope } = response;
    return {
      response: safeResponse,
      wireJson: withSerializedResult(serializeRunResponseEnvelope(envelope), serialized),
    };
  }

  const { result: _oversized, ...withoutResult } = response;
  const safeResponse = response.success
    ? {
      ...withoutResult,
      success: false,
      error: tooLarge.message,
      error_code: tooLarge.code,
      error_detail: tooLarge.detail,
    }
    : withoutResult;
  return { response: safeResponse, wireJson: serializeRunResponseEnvelope(safeResponse) };
}

/** Appends an already serialized `result` member to a serialized response envelope. */
function withSerializedResult(envelopeJson: string, serializedResult: string | undefined): string {
  if (serializedResult === undefined) return envelopeJson;
  const member = `"result":${serializedResult}`;
  return envelopeJson === "{}" ? `{${member}}` : `${envelopeJson.slice(0, -1)},${member}}`;
}

function createExecutionFailure(error: unknown, durationMs: number): ProjectRunExecuteResponse {
  return {
    success: false,
    error: errorMessage(error),
    logs: null,
    duration_ms: durationMs,
  };
}

/**
 * Build the Redis key prefix for one project's durable workflow state on one
 * runtime target.
 *
 * Hosted project runtimes share a single Redis instance, so every durable
 * workflow key must be namespaced per project and runtime target. Without this
 * isolation the approval decision claim recovery scan in one runtime can
 * enumerate and resume runs that belong to a different project, environment,
 * or preview branch. Characters outside a conservative allowlist are escaped
 * so distinct identifiers cannot produce colliding prefixes or Redis SCAN
 * glob metacharacters.
 */
function encodeWorkflowRedisScope(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index++) {
    const codeUnit = ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
    const allowed = codeUnit >= 48 && codeUnit <= 57 ||
      codeUnit >= 65 && codeUnit <= 90 ||
      codeUnit >= 97 && codeUnit <= 122 ||
      codeUnit === 45 || codeUnit === 95;
    encoded += allowed
      ? value[index]
      : `.${ReflectApply(NumberPrototypeToString, codeUnit, [16]) as string}.`;
  }
  return encoded;
}

export interface ProjectWorkflowRedisTargetScope {
  runtimeTargetKind?: ProjectRunExecuteRequest["runtimeTargetKind"];
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
}

/**
 * Reduce a runtime target selection to its one canonical form.
 *
 * `runtimeTargetKind` is optional on the wire and an omitted kind means the
 * default branch, exactly as `resolveControlPlaneBranchBinding` treats it. The
 * identifier fields are also only meaningful for the kind that owns them. If
 * either were encoded verbatim, two wire representations of the same target
 * would derive different Redis namespaces and approval recovery started under
 * one representation could not see runs waiting under the other.
 */
function canonicalWorkflowRedisTarget(
  target: ProjectWorkflowRedisTargetScope,
): { kind: string; environmentId: string; branchId: string } {
  const kind = target.runtimeTargetKind ?? "main_branch";
  return {
    kind,
    environmentId: kind === "environment" ? target.runtimeTargetEnvironmentId ?? "" : "",
    branchId: kind === "preview_branch" ? target.runtimeTargetBranchId ?? "" : "",
  };
}

export function projectWorkflowRedisPrefix(
  projectId: string,
  target: ProjectWorkflowRedisTargetScope = {},
): string {
  const canonical = canonicalWorkflowRedisTarget(target);
  const projectScope = encodeWorkflowRedisScope(projectId);
  const targetKind = encodeWorkflowRedisScope(canonical.kind);
  const environmentScope = encodeWorkflowRedisScope(canonical.environmentId);
  const branchScope = encodeWorkflowRedisScope(canonical.branchId);
  return `vf:workflow:project:${projectScope}:target:${targetKind}:environment:${environmentScope}:branch:${branchScope}:`;
}

export function projectWorkflowRedisConfig(
  projectId: string,
  target: ProjectWorkflowRedisTargetScope = {},
): {
  prefix: string;
  streamKey: string;
  groupName: string;
} {
  if (!projectId) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Durable workflow persistence requires a project scope",
    });
  }

  const prefix = projectWorkflowRedisPrefix(projectId, target);
  return {
    prefix,
    streamKey: `${prefix}stream`,
    groupName: `${prefix}workers`,
  };
}

async function createRuntimeWorkflowClient(
  config: WorkflowClientConfig | undefined,
  options: { projectId: string } & ProjectWorkflowRedisTargetScope,
): Promise<WorkflowClientView> {
  const clientConfig = withRuntimeStepRegistries(config);
  const redisUrl = getHostEnv("REDIS_URL")?.trim();
  if (!redisUrl) {
    return Object.assign(createWorkflowClient(clientConfig), {
      statePersistence: "ephemeral" as const,
    });
  }

  const backend = new RedisBackend({
    url: redisUrl,
    ...projectWorkflowRedisConfig(options.projectId, options),
    debug: config?.debug,
  });
  if (backend.initialize) {
    await backend.initialize();
  }

  return Object.assign(createWorkflowClient({ ...clientConfig, backend, debug: config?.debug }), {
    statePersistence: "durable" as const,
    persistsEventWaits: hasEventWaitSupport(backend),
  });
}

function withRuntimeStepRegistries(config?: WorkflowClientConfig): WorkflowClientConfig {
  return {
    ...config,
    executor: {
      ...config?.executor,
      stepExecutor: {
        ...config?.executor?.stepExecutor,
        agentRegistry: config?.executor?.stepExecutor?.agentRegistry ?? agentRegistry,
        toolRegistry: config?.executor?.stepExecutor?.toolRegistry ?? toolRegistry,
      },
    },
  };
}

interface TaskDeadlineControl {
  signal: AbortSignal;
  throwIfExpired(): void;
}

async function runWhileActive<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const result = await operation();
  signal.throwIfAborted();
  return result;
}

async function executeTaskRun(
  request: ProjectRunExecuteRequest,
  execute: (control?: TaskDeadlineControl) => Promise<ProjectRunExecuteResponse>,
  acknowledgeNotStarted?: () => Promise<void>,
  clock: TaskDeadlineClock = defaultTaskDeadlineClock,
): Promise<ProjectRunExecuteResponse> {
  if (!request.deadlineAt) return execute();
  const { now, setTimeout: schedule, clearTimeout: clear } = clock;
  const deadline = TaskDateParse(request.deadlineAt);
  const controller = new TaskAbortController();
  let expired = false;
  let executionStarted = false;
  const signal = controller.signal;
  const error = TIMEOUT_ERROR.create({
    detail:
      "Task exceeded its execution deadline; non-cooperative task code may continue inside the runtime process",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The abort reason and the thrown value are the same error: once the signal
  // is aborted, the catch below knows the deadline, not the task, failed.
  const expire = () => {
    expired = true;
    ReflectApply(TaskAbort, controller, [error]);
    return error;
  };
  const control: TaskDeadlineControl = {
    signal,
    throwIfExpired() {
      if (now() >= deadline) throw expire();
    },
  };
  try {
    control.throwIfExpired();
    const expiration = new Promise<never>((_resolve, reject) => {
      const arm = () => {
        const remaining = deadline - now();
        if (remaining <= 0) {
          reject(expire());
        } else {
          timer = schedule(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
        }
      };
      arm();
    });
    executionStarted = true;
    const result = await Promise.race([
      expiration,
      execute(control),
    ]);
    control.throwIfExpired();
    return result;
  } catch (failure) {
    if (!expired && now() >= deadline) expire();
    if (!expired) throw failure;
    return { success: false, error: error.message, error_code: "RUN_TIMEOUT" };
  } finally {
    clear(timer);
    if (!executionStarted) await acknowledgeNotStarted?.();
  }
}

async function executeDiscoveredTaskRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
  control?: TaskDeadlineControl,
): Promise<ProjectRunExecuteResponse> {
  const taskId = stripTargetPrefix(request.target, "task:");
  if (taskId === "knowledge-ingest") {
    throw NOT_SUPPORTED.create({
      detail: "Knowledge ingest must be executed through the knowledge ingest executor",
    });
  }

  const discovery = await deps.ensureProjectDiscovery(ctx);
  const task = findProjectRuntimeTask(discovery, taskId);

  if (!task) {
    return {
      success: false,
      error: `Task not found: ${taskId}`,
      logs: null,
      duration_ms: 0,
    };
  }

  control?.throwIfExpired();
  const result = await deps.runTask({
    task,
    ...(request.attempt === undefined ? {} : { attempt: request.attempt }),
    config: request.config ?? {},
    input: request.input,
    runId: request.runId,
    projectId: request.projectId,
    environmentId: request.runtimeTargetEnvironmentId === undefined
      ? ctx.environmentId
      : request.runtimeTargetEnvironmentId ?? undefined,
    // The control plane aborts its request when the run is cancelled; the
    // task sees that, or its deadline, as ctx.signal and can stop cooperatively.
    signal: control
      ? ReflectApply(TaskAbortSignalAny, AbortSignal, [[signal, control.signal]])
      : signal,
    debug: ctx.debug,
  });

  return {
    success: result.success,
    result: result.result,
    error: result.error,
    ...(result.errorCode === undefined ? {} : { error_code: result.errorCode }),
    ...(result.errorDetail === undefined ? {} : { error_detail: result.errorDetail }),
    duration_ms: result.durationMs,
    logs: null,
    ...(result.retryable ? { retryable: true as const } : {}),
    // Omitted rather than null, so a schema-less task response is byte-identical to before.
    ...(result.inputSchemaSha256 ? { input_schema_sha256: result.inputSchemaSha256 } : {}),
    ...(result.outputSchemaSha256 ? { output_schema_sha256: result.outputSchemaSha256 } : {}),
    ...(result.schemaViolation ? { schema_violation: result.schemaViolation } : {}),
  };
}

/**
 * Polls a workflow run until it settles. When the control plane aborts the
 * request (the run was cancelled), the workflow run is cancelled instead of
 * being polled to completion.
 *
 * The runtime marks a run `waiting` before it saves the approvals and event
 * waits it pauses on, so a durable `waiting` counts as a pause only once it
 * names at least one pending wait and the same waits on two consecutive polls.
 * A pause reported earlier would name no wait, or only some of several
 * parallel waits. `releasedKeys` are the waits a resume just released: the
 * run may still read `waiting` on them while the resumed execution catches up.
 */
async function waitForWorkflowResult(
  client: WorkflowClientView,
  runId: string,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
  releasedKeys?: string[],
  pollingStopped?: AbortSignal,
  cancelRun?: () => Promise<void>,
): Promise<WorkflowRunView> {
  const deadline = deps.now() + DEFAULT_WORKFLOW_STATUS_TIMEOUT_MS;
  let previousKeys: string[] | undefined;
  let parkedOnNothingSince: number | undefined;

  while (true) {
    const run = await client.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Workflow run not found: ${runId}` });

    // A waiting run is resumable, so an aborted request cancels it too.
    if (signal.aborted && !isTerminalWorkflowStatus(run.status)) {
      await (cancelRun ? cancelRun() : client.cancel(runId));
      return {
        status: "cancelled",
        output: run.output,
        error: { message: "Workflow run cancelled" },
      };
    }

    if (pollingStopped?.aborted) {
      throw TIMEOUT_ERROR.create({ detail: `Workflow run timed out: ${runId}` });
    }

    if (isTerminalWorkflowStatus(run.status)) return run;

    if (run.status === "waiting") {
      if (client.statePersistence !== "durable") return run;
      const parked = await readPendingWaits(client, runId, run);
      if (isManualPause(run, parked)) return run;
      const keys = waitKeys(parked);
      // A backend without event waits saves no record for a `waitForEvent()`
      // or `delay()`, so nothing can ever resume the run: fail it instead of
      // polling until the status timeout. An approval pause still saves its
      // record on such a backend, so a slow write there is only awaited.
      if (
        keys.length === 0 && client.persistsEventWaits === false && !isParkedOnApproval(run)
      ) {
        parkedOnNothingSince ??= deps.now();
        if (deps.now() - parkedOnNothingSince >= WORKFLOW_UNPERSISTED_WAIT_GRACE_MS) {
          await client.cancel(runId);
          return {
            status: "failed",
            output: run.output,
            error: { message: UNPERSISTED_EVENT_WAIT_ERROR },
          };
        }
      } else {
        parkedOnNothingSince = undefined;
      }
      const settled = keys.length > 0 &&
        !(releasedKeys && sameKeys(keys, releasedKeys)) &&
        previousKeys !== undefined && sameKeys(keys, previousKeys);
      if (settled) return run;
      previousKeys = keys;
    } else {
      previousKeys = undefined;
      parkedOnNothingSince = undefined;
    }

    if (deps.now() >= deadline) {
      throw TIMEOUT_ERROR.create({ detail: `Workflow run timed out: ${runId}` });
    }

    await deps.sleep(DEFAULT_WORKFLOW_STATUS_POLL_INTERVAL_MS);
  }
}

/** True when a `waiting` run is parked on an approval node, whose record every durable backend saves. */
function isParkedOnApproval(run: WorkflowRunView): boolean {
  return (run.currentNodes ?? []).some((nodeId) => {
    const input = run.nodeStates?.[nodeId]?.input;
    return typeof input === "object" && input !== null &&
      (input as { type?: unknown }).type === "approval";
  });
}

interface PendingWorkflowWaits {
  approvals: NonNullable<WorkflowRunView["pendingApprovals"]>;
  eventWaits: WorkflowEventWaitView[];
  childRunWaits: Array<{ nodeId: string; runIds: string[]; waitInstanceId: string }>;
}

function isPendingWait(entry: { status?: string }): boolean {
  return entry.status === undefined || entry.status === "pending";
}

/** The approvals and event waits (including `delay()`) a run is still parked on. */
async function readPendingWaits(
  client: WorkflowClientView,
  runId: string,
  run: WorkflowRunView,
): Promise<PendingWorkflowWaits> {
  const childRunWaits = (run.currentNodes ?? []).flatMap((nodeId) => {
    const state = run.nodeStates?.[nodeId];
    const input = state?.input as { type?: unknown; runIds?: unknown } | undefined;
    if (
      input?.type !== "child_run" ||
      !Array.isArray(input.runIds) || input.runIds.length === 0 ||
      input.runIds.some((runId) => typeof runId !== "string" || runId.length === 0) ||
      typeof state?._waitInstanceId !== "string" || state._waitInstanceId.length === 0
    ) return [];
    return [{
      nodeId,
      runIds: input.runIds as string[],
      waitInstanceId: state._waitInstanceId,
    }];
  });
  return {
    approvals: (run.pendingApprovals ?? []).filter(isPendingWait),
    eventWaits: (await client.getPendingEventWaits?.(runId) ?? []).filter(isPendingWait),
    childRunWaits,
  };
}

function deadlineMs(value: Date | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = new Date(value).getTime();
  return NumberIsFinite(ms) ? ms : undefined;
}

/**
 * What a durably paused run is parked on: the approval nodes still pending,
 * the events it awaits (a `delay()` exposes no internal event name), the
 * earliest deadline among them, which the control plane uses to dispatch the
 * run again when nothing else will (#2110), and the id of this boundary.
 */
async function describeWorkflowWait(parked: PendingWorkflowWaits): Promise<WorkflowWaitingDetails> {
  const { approvals, eventWaits } = parked;
  const deadlines = [...approvals, ...eventWaits]
    .map((entry) => deadlineMs(entry.expiresAt))
    .filter((deadline): deadline is number => deadline !== undefined);
  const events = eventWaits
    .filter((wait) => wait.waitKind === "event")
    .map((wait) => wait.eventName);

  return {
    ...(approvals.length
      ? { pending_approvals: approvals.map((approval) => approval.nodeId) }
      : {}),
    ...(events.length ? { event: events[0], events } : {}),
    ...(deadlines.length ? { resume_at: new Date(Math.min(...deadlines)).toISOString() } : {}),
    wait_id: await waitBoundaryId(parked),
  };
}

function childRunDependencies(parked: PendingWorkflowWaits): WorkflowWaitingDependency[] {
  return parked.childRunWaits.flatMap(({ nodeId, runIds }) =>
    runIds.map((runId) => ({
      kind: "run" as const,
      run_id: runId,
      correlation: { kind: "workflow_node" as const, id: nodeId },
    }))
  );
}

/**
 * The approval and wait records a run is parked on. A later pause, even on
 * the same node (a loop), creates new records, so the keys change with it.
 */
function waitKeys({ approvals, eventWaits, childRunWaits }: PendingWorkflowWaits): string[] {
  return [
    ...approvals.map((approval) => `approval:${approval.id}`),
    ...eventWaits.map(eventWaitKey),
    ...childRunWaits.flatMap(({ runIds, waitInstanceId }) =>
      runIds.map((runId) => `child:${waitInstanceId}:${runId}`)
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function eventWaitKey(wait: WorkflowEventWaitView): string {
  const identity = wait.id ?? `${wait.nodeId}:${wait.eventName}`;
  return `wait:${identity}`;
}

function sameKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function isParkedOnNothing(
  { approvals, eventWaits, childRunWaits }: PendingWorkflowWaits,
): boolean {
  return approvals.length === 0 && eventWaits.length === 0 && childRunWaits.length === 0;
}

/**
 * A run paused at a safe boundary on request. A wait pause always names the
 * nodes it is parked on; a manual pause names none and holds no wait record.
 */
function isManualPause(run: WorkflowRunView, parked: PendingWorkflowWaits): boolean {
  return run.status === "waiting" && run.currentNodes !== undefined &&
    run.currentNodes.length === 0 && isParkedOnNothing(parked);
}

async function waitKeyHash(key: string): Promise<string> {
  return (await computeHash(key)).slice(0, WAIT_ID_HASH_LENGTH);
}

/**
 * Identifies a pause by its wait records: one short hash per record, so a
 * decision for one of several parallel waits still matches after another of
 * them was released. A pause on too many records to list falls back to one
 * hash of the whole set.
 */
async function waitBoundaryId(parked: PendingWorkflowWaits): Promise<string> {
  const keys = waitKeys(parked);
  const hashes = await Promise.all(keys.map(waitKeyHash));
  const id = [WAIT_ID_PREFIX, ...hashes].join(".");
  return id.length <= WAIT_ID_MAX_LENGTH ? id : computeHash(keys.join("\n"));
}

/** The wait-record hashes a listed `wait_id` names, or undefined for a whole-set hash. */
function listedWaitHashes(waitId: string): Set<string> | undefined {
  const [prefix, ...hashes] = waitId.split(".");
  return prefix === WAIT_ID_PREFIX ? new Set(hashes) : undefined;
}

/**
 * Matches the runtime's expiry sweeps, which release a wait only once the
 * clock is past its deadline, not at the deadline itself.
 */
function hasDueWait({ approvals, eventWaits }: PendingWorkflowWaits, nowMs: number): boolean {
  return [...approvals, ...eventWaits].some((wait) => {
    const deadline = deadlineMs(wait.expiresAt);
    return deadline !== undefined && deadline < nowMs;
  });
}

/**
 * Deliver the event the run waits on. Resolves with whether a wait was
 * released, or a failure when delivery failed even after one retry of the same
 * buffered envelope. A `buffered` or `run-terminal` outcome released nothing,
 * so the caller reports where the run is now.
 */
async function deliverResumeEvent(
  client: WorkflowClientView,
  runId: string,
  resume: Extract<WorkflowResumeSignal, { type: "event" }>,
): Promise<{ released: boolean } | { failure: string }> {
  if (!client.publishEvent) return { failure: "Workflow client cannot deliver events" };
  const outcome = await client.publishEvent(runId, resume.name, resume.payload);
  if (outcome === "delivered") return { released: true };
  if (outcome !== "delivery-failed") return { released: false };
  if (await client.retryEventDelivery?.(runId, resume.name)) return { released: true };
  return { failure: `Delivering event "${resume.name}" to the workflow run failed` };
}

/**
 * Apply one decision or deadline to the waits the run is parked on. Resolves
 * with whether anything was released, or a failure.
 *
 * A deadline release runs the workflow client's expiry pass for this run
 * only, so it releases this run's due waits and no other run's.
 */
async function applyResumeSignal(
  client: WorkflowClientView,
  runId: string,
  resume: WorkflowWaitResumeSignal,
  parked: PendingWorkflowWaits,
  nowMs: number,
): Promise<{ released: boolean } | { failure: string }> {
  if (resume.type === "child_run") {
    if (!client.resumeChildRuns) {
      return { failure: "Workflow client cannot release child-run waits" };
    }
    return { released: await client.resumeChildRuns(runId, parked.childRunWaits) };
  }
  if (resume.type === "event") return deliverResumeEvent(client, runId, resume);
  if (resume.type === "deadline") {
    if (!client.getApprovalManager || !client.getEventWaitManager) {
      return { failure: "Workflow client cannot release due waits" };
    }
    const released = hasDueWait(parked, nowMs);
    await client.getApprovalManager().checkExpiredApprovals(runId);
    await client.getEventWaitManager().checkExpiredEventWaits(runId);
    return { released };
  }
  const approval = parked.approvals.find((candidate) => candidate.nodeId === resume.node_id);
  if (!approval) return { released: false };
  const decide = resume.approved ? client.approve : client.reject;
  if (!decide) return { failure: "Workflow client cannot decide approvals" };
  await decide.call(client, runId, approval.id, resume.approver, resume.comment, resume.data);
  return { released: true };
}

/**
 * Whether a decision was issued for a different boundary than the one the run
 * is parked on now: an earlier dispatch applied it and the run moved on before
 * its response reached the control plane. Such a retry reports where the run
 * is and applies nothing, so it cannot decide a later boundary (#2102).
 *
 * An approval or event decision is checked against the waits it targets, so
 * the second of two parallel waits still accepts its decision after the first
 * was released. A deadline releases every due wait, so it applies only while
 * every pending wait belongs to the pause it was scheduled for.
 */
async function isStaleDecision(
  resume: WorkflowWaitResumeSignal,
  parked: PendingWorkflowWaits,
): Promise<boolean> {
  if (resume.wait_id === undefined) return false;
  if (isParkedOnNothing(parked)) return false;
  const named = listedWaitHashes(resume.wait_id);
  if (!named) return resume.wait_id !== await waitBoundaryId(parked);

  const pending = waitKeys(parked);
  const targeted = targetedWaitKeys(resume, parked);
  const hashes = await Promise.all(pending.map(waitKeyHash));
  const isNamed = (key: string) => named.has(hashes[pending.indexOf(key)]!);
  if (resume.type === "child_run") {
    return targeted.length === 0 || !targeted.every(isNamed);
  }
  if (resume.type === "deadline" || targeted.length === 0) return !pending.every(isNamed);
  return !targeted.some(isNamed);
}

/** The pending wait records an approval or event decision would release. */
function targetedWaitKeys(
  resume: WorkflowWaitResumeSignal,
  parked: PendingWorkflowWaits,
): string[] {
  if (resume.type === "child_run") {
    return waitKeys({ approvals: [], eventWaits: [], childRunWaits: parked.childRunWaits });
  }
  if (resume.type === "approval") {
    return parked.approvals
      .filter((approval) => approval.nodeId === resume.node_id)
      .map((approval) => `approval:${approval.id}`);
  }
  if (resume.type === "event") {
    return parked.eventWaits
      .filter((wait) => wait.waitKind === "event" && wait.eventName === resume.name)
      .map(eventWaitKey);
  }
  return [];
}

/**
 * Continue a durable run the control plane re-dispatched under the same run
 * id: apply the approval or event decision (#2102), or release the waits whose
 * deadline passed (#2110), then poll to the next boundary. The decision is
 * applied through the workflow client, exactly as the runtime's own approval
 * route would, so the resumed execution is the same.
 */
async function resumeWaitingWorkflowRun(
  client: WorkflowClientView,
  runId: string,
  resume: WorkflowResumeSignal,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
  pollingStopped: AbortSignal,
  cancelRun: () => Promise<void>,
  acknowledgePause?: () => Promise<boolean | undefined>,
): Promise<{ run: WorkflowRunView } | { failure: string }> {
  if (client.statePersistence !== "durable") {
    return { failure: "Cannot resume a workflow run without durable workflow persistence" };
  }
  if (resume.type === "manual") {
    return await resumeManuallyPausedRun(
      client,
      runId,
      signal,
      deps,
      pollingStopped,
      cancelRun,
      acknowledgePause,
    );
  }
  const current = await client.getRun(runId);
  if (!current) return { failure: `Workflow run not found: ${runId}` };

  // A re-dispatch that repeats a decision already applied (the previous
  // attempt died after applying it) just reports where the run is now. An
  // older attempt the control plane told to stop may park it meanwhile; that
  // pause continues like a manual resume, which asks the control plane first.
  if (current.status !== "waiting") {
    return await resumeManuallyPausedRun(
      client,
      runId,
      signal,
      deps,
      pollingStopped,
      cancelRun,
      acknowledgePause,
    );
  }

  const parked = await readPendingWaits(client, runId, current);
  // A pause the control plane did not keep (it told a stale attempt to stop) parks the run
  // with no wait. It continues like a manual resume, which asks the control plane first.
  if (isManualPause(current, parked)) {
    return await resumeManuallyPausedRun(
      client,
      runId,
      signal,
      deps,
      pollingStopped,
      cancelRun,
      acknowledgePause,
    );
  }
  if (await isStaleDecision(resume, parked)) {
    return await resumeManuallyPausedRun(
      client,
      runId,
      signal,
      deps,
      pollingStopped,
      cancelRun,
      acknowledgePause,
    );
  }
  // A timed-out request still applies its decision: the timeout reports the
  // run waiting and the recheck dispatch names no decision to apply again.
  if (signal.aborted) {
    await cancelRun();
    return { run: { status: "cancelled", error: { message: "Workflow run cancelled" } } };
  }
  const applied = isParkedOnNothing(parked)
    ? { released: true }
    : await applyResumeSignal(client, runId, resume, parked, deps.now());
  if ("failure" in applied) return applied;

  // The decision can resume the run in the background, so the run may still
  // read `waiting` on the boundary it was just released from while the
  // released node completes. Poll past it; a later pause is a new boundary.
  const releasedKeys = applied.released ? waitKeys(parked) : undefined;
  return {
    run: await waitForWorkflowResult(
      client,
      runId,
      signal,
      deps,
      releasedKeys,
      pollingStopped,
      cancelRun,
    ),
  };
}

/**
 * Continue a run paused at a safe boundary under the same run id. The
 * persisted node states carry every completed node, so only the rest runs.
 * The paused execution may still be releasing the run when this dispatch
 * arrives: wait for it to settle, and retry while it still holds the run.
 *
 * The run is still at a boundary, so the attempt asks the control plane
 * before every resume. A duplicate of an earlier resume dispatch, or an
 * attempt whose run was paused again meanwhile, is told to stop and reports
 * the pause instead of releasing it.
 */
async function resumeManuallyPausedRun(
  client: WorkflowClientView,
  runId: string,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
  pollingStopped: AbortSignal,
  cancelRun: () => Promise<void>,
  acknowledgePause?: () => Promise<boolean | undefined>,
): Promise<{ run: WorkflowRunView } | { failure: string }> {
  const settle = () =>
    waitForWorkflowResult(client, runId, signal, deps, undefined, pollingStopped, cancelRun);
  let current = await settle();
  for (let attempt = 1;; attempt++) {
    if (!isManualPause(current, await readPendingWaits(client, runId, current))) {
      return { run: current };
    }
    if (!signal.aborted && await acknowledgePause?.()) return { run: current };
    if (signal.aborted) {
      await cancelRun();
      return { run: { status: "cancelled", error: { message: "Workflow run cancelled" } } };
    }
    if (!client.resume) return { failure: "Workflow client cannot resume paused runs" };
    try {
      await client.resume(runId);
      break;
    } catch (error) {
      if (attempt >= WORKFLOW_MANUAL_RESUME_ATTEMPTS) throw error;
      await deps.sleep(DEFAULT_WORKFLOW_STATUS_POLL_INTERVAL_MS);
      current = await settle();
    }
  }
  return { run: await settle() };
}

function isTerminalWorkflowStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

async function executeWorkflowRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
  acknowledgeStop?: () => Promise<void>,
  acknowledgePause?: () => Promise<boolean | undefined>,
): Promise<ProjectRunExecuteResponse> {
  let executionEntered = false;
  try {
    const startedAt = deps.now();
    const workflowId = stripTargetPrefix(request.target, "workflow:");
    await deps.ensureProjectDiscovery(ctx);
    const workflow = await deps.findWorkflowById(workflowId, {
      projectDir: ctx.projectDir,
      adapter: ctx.adapter,
      config: ctx.config,
      debug: ctx.debug,
      allowHostProjectCodeExecution: ctx.allowHostProjectCodeExecution,
    });

    if (!workflow) {
      // An initial dispatch has no execution to stop; a resume may still run elsewhere.
      if (!request.resume) await acknowledgeStop?.();
      return {
        success: false,
        error: `Workflow not found: ${workflowId}`,
        logs: null,
        duration_ms: 0,
      };
    }

    // The same identity a task run reports, from the same helper, so the API stores one
    // canonical sha256 per declared schema whatever the run kind (#2108).
    const { inputSchema, outputSchema } = workflow.definition;
    const inputSchemaSha256 = await schemaIdentitySha256(inputSchema);
    const outputSchemaSha256 = await schemaIdentitySha256(outputSchema);
    let response: ProjectRunExecuteResponse;
    try {
      executionEntered = true;
      response = await runDiscoveredWorkflow(
        request,
        ctx,
        workflow,
        signal,
        deps,
        startedAt,
        acknowledgeStop,
        acknowledgePause,
      );
    } catch (error) {
      // A failure after discovery still ran against the declared schemas; keep their identity.
      response = createExecutionFailure(error, Math.max(0, deps.now() - startedAt));
    }
    return {
      ...response,
      // Omitted rather than null, so a schema-less workflow response is byte-identical to before.
      ...(inputSchemaSha256 ? { input_schema_sha256: inputSchemaSha256 } : {}),
      ...(outputSchemaSha256 ? { output_schema_sha256: outputSchemaSha256 } : {}),
    };
  } finally {
    // Discovery/schema preparation never admitted execution; resumes may still run elsewhere.
    if (!executionEntered && !request.resume) await acknowledgeStop?.();
  }
}

async function runDiscoveredWorkflow(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  workflow: DiscoveredWorkflow,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
  startedAt: number,
  acknowledgeStop?: () => Promise<void>,
  acknowledgePause?: () => Promise<boolean | undefined>,
): Promise<ProjectRunExecuteResponse> {
  // Only a durable run can pause: an ephemeral one has nothing to resume from.
  let pauseChecksEnabled = false;
  let lastPauseCheckAt: number | undefined;
  let pauseCheckWindowMs = WORKFLOW_PAUSE_CHECK_INTERVAL_MS;
  const shouldPause = async (runId: string): Promise<boolean> => {
    if (!acknowledgePause || !pauseChecksEnabled || runId !== request.runId) return false;
    if (isAbortSignalAborted(signal)) return false;
    const now = deps.now();
    if (
      lastPauseCheckAt !== undefined && now - lastPauseCheckAt < pauseCheckWindowMs
    ) return false;
    const answer = await acknowledgePause();
    // The window starts when the answer arrives, so a slow reply cannot make every boundary
    // ask, and an unanswered check backs off longer.
    pauseCheckWindowMs = answer === undefined
      ? WORKFLOW_PAUSE_CHECK_BACKOFF_MS
      : WORKFLOW_PAUSE_CHECK_INTERVAL_MS;
    lastPauseCheckAt = deps.now();
    return answer === true;
  };
  let client: WorkflowClientView;
  try {
    client = await deps.createWorkflowClient(
      // Per-request client: keep stop evidence for the cancellation acknowledgement.
      withRuntimeStepRegistries({
        debug: ctx.debug,
        executor: {
          retainExecutionStopEvidence: true,
          ...(acknowledgePause ? { shouldPause } : {}),
        },
      }),
      {
        projectId: request.projectId,
        runtimeTargetKind: request.runtimeTargetKind,
        runtimeTargetEnvironmentId: request.runtimeTargetEnvironmentId,
        runtimeTargetBranchId: request.runtimeTargetBranchId,
      },
    );
  } catch (error) {
    if (!request.resume) await acknowledgeStop?.();
    throw error;
  }
  pauseChecksEnabled = client.statePersistence === "durable";
  let executionStarted = false;
  let activeResume: Promise<unknown> | undefined;
  let stopped: Promise<boolean> | undefined;
  let stopAcknowledgement: Promise<void> | undefined;
  const acknowledgeSettledStop = () => {
    if (!stopped || stopAcknowledgement) return;
    stopAcknowledgement = primordialPromiseThen(stopped, async (confirmed) => {
      if (confirmed) await acknowledgeStop?.();
    });
  };
  try {
    client.register(workflow.definition);
    // A first dispatch has no durable run yet. A resume must cancel its persisted run below.
    if (signal.aborted && !request.resume) {
      await acknowledgeStop?.();
      return {
        success: false,
        error: "Workflow run cancelled",
        logs: null,
        duration_ms: Math.max(0, deps.now() - startedAt),
      };
    }

    let run: WorkflowRunView;
    if (request.resume) {
      const resumeRequest = new AbortController();
      const pollingStopped = new AbortController();
      let cancellation: Promise<void> | undefined;
      let cancellationResult: WorkflowRunView | undefined;
      const cancelRun = () =>
        cancellation ??= (async () => {
          const current = await client.getRun(request.runId);
          if (current && isTerminalWorkflowStatus(current.status)) {
            cancellationResult = current;
            return;
          }
          try {
            await client.cancel(request.runId);
          } catch (error) {
            const latest = await client.getRun(request.runId);
            if (!latest || !isTerminalWorkflowStatus(latest.status)) throw error;
            cancellationResult = latest;
            return;
          }
          cancellationResult = {
            status: "cancelled",
            error: { message: "Workflow run cancelled" },
          };
        })();
      const forwardCancellation = () => {
        resumeRequest.abort();
        void cancelRun().catch(() => {});
      };
      signal.addEventListener("abort", forwardCancellation, { once: true });
      if (signal.aborted) forwardCancellation();
      const operation = resumeWaitingWorkflowRun(
        client,
        request.runId,
        request.resume,
        resumeRequest.signal,
        deps,
        pollingStopped.signal,
        cancelRun,
        acknowledgePause,
      ).then(async (result) => {
        await cancellation;
        return cancellationResult ? { run: cancellationResult } : result;
      }, async (error) => {
        await cancellation;
        if (cancellationResult) return { run: cancellationResult };
        throw error;
      });
      activeResume = operation;
      void operation.then(() => {
        activeResume = undefined;
      }, () => {
        activeResume = undefined;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const resumed = await Promise.race([
        operation,
        new Promise<{ timedOut: true }>((resolve) => {
          timer = setTimeout(() => {
            signal.removeEventListener("abort", forwardCancellation);
            pollingStopped.abort();
            resolve({ timedOut: true });
          }, deps.workflowResumeTimeoutMs ?? DEFAULT_WORKFLOW_STATUS_TIMEOUT_MS);
        }),
      ]).finally(() => {
        clearTimeout(timer);
        signal.removeEventListener("abort", forwardCancellation);
      });
      // A settled cancellation reports what it found, including a run that
      // was already terminal. One still in flight leaves the run to the recheck.
      const outcome = "timedOut" in resumed && cancellationResult
        ? { run: cancellationResult }
        : resumed;
      if ("timedOut" in outcome) {
        // The resumed execution keeps running durably, so the run did not
        // fail: keep the canonical run waiting and have the control plane
        // dispatch it again soon. That dispatch names no pending wait, so it
        // releases nothing and reports where the run got to.
        return {
          success: true,
          status: "waiting",
          waiting_reason: "event",
          waiting: {
            wait_id: WAIT_ID_PREFIX,
            resume_at: new Date(deps.now() + WORKFLOW_RESUME_RECHECK_MS).toISOString(),
          },
          logs: null,
          duration_ms: Math.max(0, deps.now() - startedAt),
        };
      }
      if ("failure" in outcome) {
        return {
          success: false,
          error: outcome.failure,
          logs: null,
          duration_ms: Math.max(0, deps.now() - startedAt),
        };
      }
      run = outcome.run;
    } else {
      // A null input counts as no input, the same as on the API run record.
      let handle: Awaited<ReturnType<typeof client.start>>;
      try {
        executionStarted = true;
        handle = await client.start(workflow.id, request.input ?? {}, {
          runId: request.runId,
          [CONTROL_PLANE_OWNED_START]: true,
        });
      } catch (error) {
        const failure = createInputValidationFailure(error, Math.max(0, deps.now() - startedAt));
        if (failure) {
          // Input parsing happens before the workflow backend creates a run,
          // so this typed failure proves that no lifecycle was admitted.
          await acknowledgeStop?.();
          return failure;
        }
        throw error;
      }
      run = await waitForWorkflowResult(client, handle.runId, signal, deps);
      const pausedOn = run.status === "waiting"
        ? waitKeys(await readPendingWaits(client, handle.runId, run))
        : undefined;
      await handle.settled?.();
      if (pausedOn) {
        const refreshed = await client.getRun(handle.runId) ?? run;
        // An expiring delay or a delivered event can advance the run past the
        // polled pause while it settles: poll it again until a new pause
        // stabilizes, which also cancels the run when the request was aborted.
        run = isTerminalWorkflowStatus(refreshed.status) ||
            (refreshed.status === "waiting" &&
              sameKeys(waitKeys(await readPendingWaits(client, handle.runId, refreshed)), pausedOn))
          ? refreshed
          : await waitForWorkflowResult(client, handle.runId, signal, deps);
      }
    }
    const durationMs = Math.max(0, deps.now() - startedAt);

    // The cancel can arrive after the last poll, while the pause is persisted.
    if (run.status === "waiting" && signal.aborted) {
      await client.cancel(request.runId);
      return {
        success: false,
        result: run.output,
        error: "Workflow run cancelled",
        logs: null,
        duration_ms: durationMs,
      };
    }

    if (run.status === "waiting") {
      if (client.statePersistence !== "durable") {
        return {
          success: false,
          error: WORKFLOW_PERSISTENCE_REQUIRED_ERROR,
          logs: null,
          duration_ms: durationMs,
        };
      }

      // A pause is not a result: report what the run waits on so the control
      // plane keeps the canonical run `waiting` (#2085) and knows when to
      // dispatch it again (#2110). The pause payload is never sent as output.
      const parked = await readPendingWaits(client, request.runId, run);
      if (isManualPause(run, parked)) {
        // The control plane already recorded this pause through the pause
        // acknowledgement; this response converges a lost acknowledgement.
        return {
          success: true,
          status: "waiting",
          waiting_reason: "manual_pause",
          waiting: {},
          logs: null,
          duration_ms: durationMs,
        };
      }
      const waiting = await describeWorkflowWait(parked);
      const waitingOn = childRunDependencies(parked);
      if (waitingOn.length > MAX_WORKFLOW_CHILD_RUN_DEPENDENCIES) {
        return {
          success: false,
          error: `A workflow pause can wait on at most ` +
            `${MAX_WORKFLOW_CHILD_RUN_DEPENDENCIES} child-run dependencies`,
          logs: null,
          duration_ms: durationMs,
        };
      }
      return {
        success: true,
        status: "waiting",
        waiting_reason: waitingOn.length > 0
          ? "child_run"
          : waiting.pending_approvals?.length
          ? "approval"
          : "event",
        ...(waitingOn.length > 0 ? { waiting_on: waitingOn } : {}),
        waiting,
        logs: null,
        duration_ms: durationMs,
      };
    }

    if (run.status === "completed") {
      return {
        success: true,
        result: run.output,
        logs: null,
        duration_ms: durationMs,
      };
    }

    const validationErrors = run.error?.code === INPUT_VALIDATION_FAILED_CODE
      ? readSchemaValidationErrors((run.error.detail as { errors?: unknown } | undefined)?.errors)
      : undefined;
    return {
      success: false,
      ...(validationErrors
        ? {
          error_code: INPUT_VALIDATION_FAILED_CODE,
          error_detail: { errors: validationErrors },
        }
        : {}),
      result: run.output,
      error: run.error?.message ?? `Workflow ended with status: ${run.status}`,
      ...(run.error?.code === OUTPUT_VALIDATION_FAILED_CODE
        ? {
          error_code: OUTPUT_VALIDATION_FAILED_CODE,
          ...(run.error.detail === undefined ? {} : { error_detail: run.error.detail }),
        }
        : {}),
      logs: null,
      duration_ms: durationMs,
    };
  } finally {
    // Initial preparation did not admit execution; resumes can still run remotely.
    if (!request.resume && !executionStarted) await acknowledgeStop?.();
    const captureStopped = async (): Promise<boolean> => {
      try {
        return await (client.waitForExecutionStopped?.(request.runId) ?? false);
      } catch {
        return false;
      }
    };
    if (activeResume) {
      // Capture ownership after resume admission, before cleanup can retire it.
      // Do not join this continuation to the timeout response.
      const finishResume = () => {
        const evidence = captureStopped();
        void primordialPromiseCatch(
          primordialPromiseThen(primordialPromiseResolve(undefined), () => client.destroy()),
          (error) => {
            serverLogger.warn("[project-run-execute] Failed to destroy workflow client", {
              runId: request.runId,
              errorName: error instanceof Error ? error.name : "unknown",
            });
          },
        );
        return evidence;
      };
      stopped = primordialPromiseThen(activeResume, finishResume, finishResume);
      acknowledgeSettledStop();
    } else {
      stopped = captureStopped();
      acknowledgeSettledStop();
      try {
        await destroyWorkflowClient(
          client,
          request.runId,
          deps.workflowClientDestroyTimeoutMs ?? DEFAULT_WORKFLOW_CLIENT_DESTROY_TIMEOUT_MS,
        );
      } finally {
        if (isAbortSignalAborted(signal)) await stopAcknowledgement;
      }
    }
  }
}

/**
 * Release the workflow client without letting cleanup decide the response: a
 * cleanup that fails or does not finish in time is logged, and the run's
 * result is still returned (veryfront-issue-inbox#2109). Uses the host timers
 * captured at load, because project code may have replaced the globals.
 */
async function destroyWorkflowClient(
  client: WorkflowClientView,
  runId: string,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Started inside a promise so a synchronous throw is logged like a rejection.
  const destroyed = Promise.resolve().then(() => client.destroy()).then(
    () => true,
    (error: unknown) => {
      serverLogger.warn("[project-run-execute] Failed to destroy workflow client", {
        runId,
        errorName: error instanceof TaskError ? error.name : "unknown",
      });
      return true;
    },
  );
  const finished = await Promise.race([
    destroyed,
    new Promise<false>((resolve) => {
      timer = TaskSetTimeout(() => resolve(false), timeoutMs);
    }),
  ]).finally(() => TaskClearTimeout(timer));
  if (!finished) {
    serverLogger.warn("[project-run-execute] Workflow client cleanup did not finish", {
      runId,
      timeoutMs,
    });
  }
}

interface RuntimeApiClient {
  get<T>(
    path: string,
    params?: Record<string, string>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal; retryPolicy?: "default" | "none" },
  ): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

const IntrinsicReflectApply = Reflect.apply;
const RequestHeadersGetter = Object.getOwnPropertyDescriptor(Request.prototype, "headers")!.get!;
const RequestUrlGetter = Object.getOwnPropertyDescriptor(Request.prototype, "url")!.get!;
const RequestMethodGetter = Object.getOwnPropertyDescriptor(Request.prototype, "method")!.get!;
const RequestSignalGetter = Object.getOwnPropertyDescriptor(Request.prototype, "signal")!.get!;
const HeadersAppend = Headers.prototype.append;
const HeadersEntries = Headers.prototype.entries;
const HeadersIteratorNext = Object.getPrototypeOf(new Headers().entries()).next as (
  this: IterableIterator<[string, string]>,
) => IteratorResult<[string, string]>;
const StringToLowerCase = String.prototype.toLowerCase;
const NativeHeaders = Headers;

/**
 * The execute request as the run sees it: the same URL, method and headers,
 * and cancellation signal, minus the inference and stop acknowledgement credentials. Project code (a task, workflow or eval
 * module) loads during execution and can patch `Headers.prototype.get`, so the
 * request it can reach must no longer carry the credential. The body was read
 * and verified before this point and is not needed again.
 */
function withoutProjectRunInferenceToken(req: Request, signal?: AbortSignal): Request {
  // Copied entry by entry with iteration primitives captured at load, and the
  // credential is skipped rather than deleted afterwards: handing the original
  // Headers to a constructor would run a patchable `Symbol.iterator` over it.
  const source = IntrinsicReflectApply(RequestHeadersGetter, req, []) as Headers;
  const iterator = IntrinsicReflectApply(HeadersEntries, source, []) as IterableIterator<
    [string, string]
  >;
  const skipped = IntrinsicReflectApply(StringToLowerCase, PROJECT_RUN_INFERENCE_TOKEN_HEADER, []);
  const headers = new NativeHeaders();
  while (true) {
    const step = IntrinsicReflectApply(HeadersIteratorNext, iterator, []) as IteratorResult<
      [string, string]
    >;
    if (step.done) break;
    const name = step.value[0];
    const lowerName = IntrinsicReflectApply(StringToLowerCase, name, []);
    if (lowerName === skipped || lowerName === INGRESS_RUN_STOP_TOKEN_HEADER) continue;
    IntrinsicReflectApply(HeadersAppend, headers, [name, step.value[1]]);
  }
  const copy = new NativeRequest(IntrinsicReflectApply(RequestUrlGetter, req, []) as string, {
    method: IntrinsicReflectApply(RequestMethodGetter, req, []) as string,
    headers,
    // The run is cancelled through this signal; the copy must keep it.
    signal: signal ?? IntrinsicReflectApply(RequestSignalGetter, req, []) as AbortSignal,
  });
  // The run still reads its `x-token` from the ingress credentials.
  return inheritIngressCredentials(req, copy);
}

/**
 * The execute request's gateway-only inference credential, validated with the
 * same visible-ASCII and size checks hosted runs apply to theirs. Read raw:
 * trimming first would turn a malformed header into a valid one. `undefined`
 * when the control plane sent none, which keeps the pre-header behaviour.
 */
function readProjectRunInferenceToken(req: Request): string | undefined {
  // Held outside the headers since ingress, or read through captured accessors
  // for a request that did not pass it: a project that patches
  // `Headers.prototype.get` must not see the credential of this or any later
  // execute request on the same host.
  const value = readIngressCredential(req, INGRESS_INFERENCE_TOKEN_HEADER);
  if (value === null) return undefined;
  return requireInferenceProviderCredential(value, "Inference token header");
}

/** Independent evidence of a settled execution, never evidence from abort alone. */
function createRunStopAcknowledger(
  req: Request,
  runId: string,
  executionSignal?: AbortSignal,
): (() => Promise<void>) | undefined {
  const rawToken = readIngressCredential(req, INGRESS_RUN_STOP_TOKEN_HEADER);
  if (rawToken === null) return undefined;
  const token = requireInferenceProviderCredential(rawToken, "Run stop token header");
  let url: string;
  let transport: typeof fetch;
  try {
    const apiUrl = requireHostPrivateApiHttps(resolveHostOwnedSourceApiBaseUrl());
    url = `${apiUrl}/runs/${encodeURIComponent(runId)}/cancellation-ack`;
    transport = createVeryfrontApiOriginBoundOutboundFetch(apiUrl);
  } catch {
    serverLogger.warn("[project-run-execute] Stop acknowledgement transport is unavailable", {
      runId,
    });
    return undefined;
  }
  const lifetime = getRequestTransportLifetime(req);
  const signal = executionSignal ?? lifetime?.signal ??
    IntrinsicReflectApply(RequestSignalGetter, req, []) as AbortSignal;
  let stopped = false;
  let cancellationObserved = isAbortSignalAborted(signal);
  let acknowledgement: Promise<void> | undefined;
  const reconcile = (): Promise<void> => {
    if (!stopped || !cancellationObserved) return primordialPromiseResolve(undefined);
    return acknowledgement ??= sendAcknowledgement();
  };
  const observeCancellation = () => {
    if (!isAbortSignalAborted(signal)) return;
    cancellationObserved = true;
    removeAbortSignalListener(signal, observeCancellation);
    void reconcile();
  };
  ReflectApply(RunStopAddListener, signal, ["abort", observeCancellation]);
  if (isAbortSignalAborted(signal)) observeCancellation();
  const finishResponse = () => {
    // Completion retires observation, not pending positive settlement evidence.
    if (isAbortSignalAborted(signal)) observeCancellation();
    removeAbortSignalListener(signal, observeCancellation);
  };
  if (lifetime?.completed) {
    void primordialPromiseThen(lifetime.completed, finishResponse, finishResponse);
  }
  async function sendAcknowledgement(): Promise<void> {
    try {
      const response = await transport(url, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
        // Execution's signal is already aborted; this request owns its deadline.
        signal: ReflectApply(RunStopTimeout, AbortSignal, [10_000]),
      });
      await response.body?.cancel();
      if (!response.ok) throw new TaskError("Run stop acknowledgement rejected");
    } catch {
      // Best effort. Missing acknowledgement remains unconfirmed in the API.
      serverLogger.warn("[project-run-execute] Could not acknowledge stopped execution", { runId });
    }
  }
  return () => {
    stopped = true;
    return reconcile();
  };
}

/**
 * Ask the control plane whether this attempt should stop at a safe boundary.
 * A `{ "stop": true }` reply means the API confirmed a requested pause for this
 * attempt, or the attempt no longer holds the run. The call is idempotent, so a
 * transport error or 5xx is retried a few times and then answers `undefined`
 * (unknown, so continue); anything else, including 401, reads as continue.
 */
function createRunPauseAcknowledger(
  req: Request,
  runId: string,
  sleep: (ms: number) => Promise<void>,
): (() => Promise<boolean | undefined>) | undefined {
  const rawToken = readIngressCredential(req, INGRESS_RUN_STOP_TOKEN_HEADER);
  if (rawToken === null) return undefined;
  const token = requireInferenceProviderCredential(rawToken, "Run stop token header");
  let url: string;
  let transport: typeof fetch;
  try {
    const apiUrl = requireHostPrivateApiHttps(resolveHostOwnedSourceApiBaseUrl());
    url = `${apiUrl}/runs/${encodeURIComponent(runId)}/pause-ack`;
    transport = createVeryfrontApiOriginBoundOutboundFetch(apiUrl);
  } catch {
    serverLogger.warn("[project-run-execute] Pause acknowledgement transport is unavailable", {
      runId,
    });
    return undefined;
  }
  // Captured before project code runs, so a replaced `Request.prototype.signal` getter cannot
  // throw from or forge the acknowledgement.
  const signal = IntrinsicReflectApply(RequestSignalGetter, req, []) as AbortSignal;
  return async () => {
    for (let attempt = 1;; attempt++) {
      try {
        const response = await transport(url, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: "{}",
          // A cancelled request stops waiting for the answer at once.
          signal: ReflectApply(TaskAbortSignalAny, AbortSignal, [[
            signal,
            ReflectApply(RunStopTimeout, AbortSignal, [WORKFLOW_PAUSE_ACK_TIMEOUT_MS]),
          ]]),
        });
        if (response.status < 500) {
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              serverLogger.warn("[project-run-execute] Pause acknowledgement was not authorized", {
                runId,
                status: response.status,
              });
            }
            await response.body?.cancel();
            return false;
          }
          const body: unknown = await ReflectApply(ResponsePrototypeJson, response, []);
          return isRecord(body) && body.stop === true;
        }
        await response.body?.cancel();
      } catch {
        // A transport failure or unreadable reply is retried like a 5xx.
      }
      // A cancelled request stops at this boundary; the cancellation then ends the run.
      if (isAbortSignalAborted(signal)) return true;
      if (attempt >= WORKFLOW_PAUSE_ACK_ATTEMPTS) {
        serverLogger.warn("[project-run-execute] Could not read the pause acknowledgement", {
          runId,
        });
        return undefined;
      }
      await sleep(WORKFLOW_PAUSE_ACK_RETRY_MS);
    }
  };
}

function getRuntimeApiToken(req: Request, ctx: HandlerContext): string {
  return readIngressCredential(req, INGRESS_API_TOKEN_HEADER) ?? ctx.proxyToken ??
    ctx.requestContext?.token ?? "";
}

function getHeaderFirstValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function getForwardedProtocol(req: Request): "http:" | "https:" | undefined {
  const value = getHeaderFirstValue(req.headers.get("x-forwarded-proto"))?.replace(/:$/, "");
  return value === "http" || value === "https" ? `${value}:` : undefined;
}

function getRequestOriginCandidates(req: Request): Set<string> {
  const url = new URL(req.url);
  const protocols = new Set([url.protocol]);
  const forwardedProtocol = getForwardedProtocol(req);
  if (forwardedProtocol) protocols.add(forwardedProtocol);

  const hosts = new Set([url.host]);
  const hostHeader = getHeaderFirstValue(req.headers.get("host"));
  const forwardedHost = getHeaderFirstValue(req.headers.get("x-forwarded-host"));
  if (hostHeader) hosts.add(hostHeader);
  if (forwardedHost) hosts.add(forwardedHost);

  const origins = new Set<string>();
  for (const protocol of protocols) {
    for (const host of hosts) {
      origins.add(`${protocol}//${host}`);
    }
  }
  return origins;
}

function isRequestSiblingAgUiEndpoint(endpoint: string, req: Request): boolean {
  try {
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.pathname !== "/api/ag-ui") return false;
    return getRequestOriginCandidates(req).has(endpointUrl.origin);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLocalAgUiEndpoint(endpoint: string): boolean {
  try {
    return isLocalHostname(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

interface ManagedProjectAgUiEndpointContext {
  forwardedHost: string;
  forwardedProto: string;
  environment: "preview" | "production";
}

function getManagedProjectAgUiEndpointContext(
  endpoint?: string,
  projectSlug?: string,
): ManagedProjectAgUiEndpointContext | null {
  if (!endpoint || !projectSlug) return null;
  try {
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.pathname !== "/api/ag-ui") return null;
    const parsed = parseProjectDomain(endpointUrl.host);
    if (!parsed.isVeryfrontDomain || parsed.slug !== projectSlug) return null;
    return {
      forwardedHost: endpointUrl.host,
      forwardedProto: endpointUrl.protocol.replace(/:$/, ""),
      environment: parsed.environment === "preview" ? "preview" : "production",
    };
  } catch {
    return null;
  }
}

function getRuntimeLocalPort(req: Request): number {
  const url = new URL(req.url);
  const requestPort = isLocalHostname(url.hostname) ? url.port : "";
  for (const value of [getHostEnv("PORT"), getHostEnv("VERYFRONT_PORT"), requestPort]) {
    if (!value) continue;
    const port = Number.parseInt(value, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  }
  return DEFAULT_LOCAL_AG_UI_PORT;
}

function getLocalAgUiEndpoint(req: Request): string {
  return `http://127.0.0.1:${getRuntimeLocalPort(req)}/api/ag-ui`;
}

function resolveEvalAgUiEndpoint(
  req: Request,
  endpoint?: string,
  projectSlug?: string,
): string {
  if (!endpoint) {
    return getLocalAgUiEndpoint(req);
  }
  const shouldUseLocalEndpoint = isRequestSiblingAgUiEndpoint(endpoint, req) ||
    !!getManagedProjectAgUiEndpointContext(endpoint, projectSlug) ||
    isLocalAgUiEndpoint(endpoint);
  if (!shouldUseLocalEndpoint) {
    return endpoint;
  }
  return getLocalAgUiEndpoint(req);
}

/**
 * Read the tool allowlist and step budget the eval adapter forwarded for a run.
 *
 * The hosted AG-UI path derives the same values from `runtimeOverrides` and
 * applies them to runtime creation, so the localized path must apply them too:
 * an eval that requests a constrained tool surface must not reach the source
 * agent's full configured tools and MCP servers.
 */
async function readLocalEvalRuntimeRestrictions(
  request: Request,
): Promise<AgUiRuntimeRestrictions | undefined> {
  let body: unknown;
  try {
    const cloned = ReflectApply(RequestPrototypeClone, request, []) as Request;
    body = await (ReflectApply(RequestPrototypeJson, cloned, []) as Promise<unknown>);
  } catch {
    // The AG-UI handler rejects a body it cannot parse, so there is nothing to
    // restrict here.
    return undefined;
  }

  if (!isRecord(body) || !isRecord(body.forwardedProps)) return undefined;
  const veryfront = body.forwardedProps.veryfront;
  if (!isRecord(veryfront)) return undefined;
  const runtimeOverrides = veryfront.runtimeOverrides;
  if (runtimeOverrides === undefined) return undefined;

  const parsed = ParseHostedChatRuntimeOverrides(runtimeOverrides);
  if (!parsed.success) {
    // Fail closed: forwarded restrictions that cannot be read must not degrade
    // into an unrestricted eval run.
    throw INVALID_ARGUMENT.create({ detail: "Eval runtime overrides are invalid" });
  }

  const { allowedTools, maxSteps } = parsed.data;
  if (allowedTools === undefined && maxSteps === undefined) return undefined;
  return {
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
  };
}

function createLocalEvalAgentFetch(input: {
  endpoint: string;
  agentId?: string;
  runtimeRestrictions?: AgUiRuntimeRestrictions;
}): AgentServiceEvalAdapterConfig["fetch"] | undefined {
  if (!input.agentId || !isLocalAgUiEndpoint(input.endpoint)) return undefined;

  const agent = agentRegistry.get(input.agentId);
  if (!agent) return undefined;

  return async (requestInput, init) => {
    const request = new NativeRequest(requestInput, init);
    if (!isLocalAgUiEndpoint(request.url)) return fetch(request);
    const runtimeRestrictions = input.runtimeRestrictions ??
      await readLocalEvalRuntimeRestrictions(request);
    const handler = createAgUiHandler({
      agent,
      context: { runIdBindsToolAuthorization: false },
      ...(runtimeRestrictions ? { runtimeRestrictions } : {}),
    });
    return await handler(request);
  };
}

interface DurableEvalAgentFetchInput extends
  Pick<
    ProjectRunExecuteRequest,
    "runtimeTargetKind" | "runtimeTargetEnvironmentId" | "runtimeTargetBranchId"
  > {
  apiBaseUrl: string;
  authToken: string;
  projectId: string;
  parentRunId: string;
  agentId: string;
}

function parseEvalAgentRequestBody(init: RequestInit | undefined): AgentServiceEvalRequestBody {
  if (typeof init?.body !== "string") {
    throw INVALID_ARGUMENT.create({ detail: "Managed eval agent request body must be JSON" });
  }

  const body: unknown = JSON.parse(init.body);
  if (
    typeof body !== "object" || body === null ||
    typeof (body as { runId?: unknown }).runId !== "string" ||
    !Array.isArray((body as { messages?: unknown }).messages)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Managed eval agent request body is invalid" });
  }

  return body as AgentServiceEvalRequestBody;
}

function getEvalAgentPrompt(request: AgentServiceEvalRequestBody): string {
  const prompt = request.messages
    .flatMap((message) => message.parts)
    .map((part) => part.text)
    .join("\n");
  if (prompt.trim().length === 0) {
    throw INVALID_ARGUMENT.create({ detail: "Managed eval agent prompt is required" });
  }
  return prompt;
}

function createApiUrl(apiBaseUrl: string, path: string): URL {
  const baseHref = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relativePath, baseHref);
}

function createDurableEvalAgentForwardedProps(
  input: DurableEvalAgentFetchInput,
  request: AgentServiceEvalRequestBody,
): Record<string, unknown> {
  // The durable hosted runtime reads `model` and `runtimeOverrides` from the
  // top level of the forwarded props, so promote the eval overrides out of the
  // `veryfront` envelope while keeping the remaining metadata nested.
  const veryfront = request.forwardedProps?.veryfront;
  return {
    ...request.forwardedProps,
    // The adapter body never carries agent selection (public AG-UI must not
    // honor it), so stamp the server-resolved agent here instead.
    veryfront: { ...veryfront, agentId: input.agentId },
    ...(veryfront?.model !== undefined ? { model: veryfront.model } : {}),
    ...(veryfront?.runtimeOverrides !== undefined
      ? { runtimeOverrides: veryfront.runtimeOverrides }
      : {}),
    prompt: getEvalAgentPrompt(request),
  };
}

function createDurableEvalAgentRunBody(
  input: DurableEvalAgentFetchInput,
  request: AgentServiceEvalRequestBody,
) {
  const targets = resolveConversationRunTargets({
    projectId: input.projectId,
    runtimeTargetKind: input.runtimeTargetKind ?? null,
    environmentId: input.runtimeTargetEnvironmentId ?? null,
    branchId: input.runtimeTargetBranchId ?? null,
  });
  return {
    kind: "agent",
    owner: { kind: "project", id: input.projectId },
    public_id: request.runId,
    parent_run_id: input.parentRunId,
    conversation_mode: "create_new",
    request: {
      mode: "agent",
      input: {
        agent_id: input.agentId,
        source_target_kind: targets.sourceTargetKind ?? "project",
        messages: [],
        tools: request.tools,
        context: request.context,
        forwarded_props: createDurableEvalAgentForwardedProps(input, request),
        ...(targets.runtimeTargetKind ? { runtime_target_kind: targets.runtimeTargetKind } : {}),
        ...(targets.targetEnvironmentId
          ? { target_environment_id: targets.targetEnvironmentId }
          : {}),
        ...(targets.targetBranchId ? { target_branch_id: targets.targetBranchId } : {}),
      },
    },
  };
}

function createDurableEvalAgentFetch(
  input: DurableEvalAgentFetchInput,
): NonNullable<AgentServiceEvalAdapterConfig["fetch"]> {
  const headers = {
    Authorization: `Bearer ${input.authToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  return async (_requestInput, init) => {
    const requestBody = parseEvalAgentRequestBody(init);
    const createRunUrl = createApiUrl(input.apiBaseUrl, "/runs");
    const createResponse = await fetch(createRunUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(createDurableEvalAgentRunBody(input, requestBody)),
      signal: init?.signal,
    });
    if (!createResponse.ok) {
      throw API_CLIENT_ERROR.create({
        detail:
          `Veryfront API request failed: ${createResponse.status} ${createResponse.statusText}`,
      });
    }

    const created: unknown = await createResponse.json();
    const conversationId = (created as { conversation_id?: unknown }).conversation_id;
    const runId = (created as { run?: { run_id?: unknown } }).run?.run_id;
    if (typeof conversationId !== "string" || typeof runId !== "string") {
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API returned an invalid durable agent run",
      });
    }

    const streamUrl = createApiUrl(
      input.apiBaseUrl,
      `/conversations/${encodeURIComponent(conversationId)}/runs/${
        encodeURIComponent(runId)
      }/stream`,
    );
    const streamResponse = await fetch(streamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        Accept: "text/event-stream",
      },
      signal: init?.signal,
    });
    if (!streamResponse.ok) {
      throw API_CLIENT_ERROR.create({
        detail:
          `Veryfront API request failed: ${streamResponse.status} ${streamResponse.statusText}`,
      });
    }

    return streamResponse;
  };
}

function getEndpointHost(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
}

function getEndpointProtocol(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).protocol.replace(/:$/, "");
  } catch {
    return undefined;
  }
}

function createRuntimeApiClient(
  req: Request,
  ctx: HandlerContext,
  defaultSignal?: AbortSignal,
): RuntimeApiClient {
  const apiUrl = getEnvironmentConfig().apiBaseUrl;
  const token = getRuntimeApiToken(req, ctx);
  if (!token) {
    throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });
  }

  async function requestJson<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    params?: Record<string, string>,
    signal: AbortSignal | undefined = defaultSignal,
  ): Promise<T> {
    const url = new URL(`${apiUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : capturedArtifactJsonStringify(body),
      signal,
    });

    if (!response.ok) {
      throw API_CLIENT_ERROR.create({
        detail: `Veryfront API request failed: ${response.status} ${response.statusText}`,
      });
    }

    if (response.status === 204) return undefined as T;

    return response.json() as Promise<T>;
  }

  return {
    get<T>(
      path: string,
      params?: Record<string, string>,
      options?: { signal?: AbortSignal },
    ): Promise<T> {
      return requestJson<T>("GET", path, undefined, params, options?.signal);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return requestJson<T>("POST", path, body);
    },
    put<T>(
      path: string,
      body?: unknown,
      options?: { signal?: AbortSignal },
    ): Promise<T> {
      return requestJson<T>("PUT", path, body, undefined, options?.signal);
    },
    patch<T>(path: string, body?: unknown): Promise<T> {
      return requestJson<T>("PATCH", path, body);
    },
    delete<T>(path: string): Promise<T> {
      return requestJson<T>("DELETE", path);
    },
  };
}

export async function uploadEvalReportToProjectFiles(
  input: EvalReportUploadInput,
): Promise<string | null> {
  const client = createRuntimeApiClient(input.req, input.ctx);
  const encodedProject = encodeURIComponent(input.projectReference);
  const encodedPath = encodeURIComponent(input.reportPath);
  const response = await client.put<{ path?: string }>(
    `/projects/${encodedProject}/files/${encodedPath}`,
    // The native serializer must not invoke an inherited project toJSON hook.
    {
      __proto__: null,
      content: input.content ?? serializeEvalReportFile(input.report, input.reportPath),
    },
    { signal: input.signal },
  );
  input.signal?.throwIfAborted();
  return response.path ?? input.reportPath;
}

function getStringArrayConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex];
    if (key === undefined) continue;
    const value = getOwnDataProperty(config, key);
    if (ArrayIsArray(value)) {
      const strings: string[] = [];
      for (let valueIndex = 0; valueIndex < value.length; valueIndex++) {
        const item = value[valueIndex];
        if (typeof item === "string" && item.length > 0) strings[strings.length] = item;
      }
      return strings;
    }
  }

  return [];
}

function getStringConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex];
    if (key === undefined) continue;
    const value = getOwnDataProperty(config, key);
    if (typeof value === "string" && value.length > 0) return value;
  }

  return undefined;
}

async function resolveUploadIdsToPaths(
  client: RuntimeApiClient,
  projectReference: string,
  uploadIds: string[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const uploadId of uploadIds) {
    const upload = await client.get<{ path?: string }>(
      `/projects/${encodeURIComponent(projectReference)}/uploads/${encodeURIComponent(uploadId)}`,
    );
    if (!upload.path) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Upload not found: ${uploadId}` });
    }
    paths.push(upload.path);
  }
  return paths;
}

export function createKnowledgeEventLogger(
  lines: string[],
  truncatedMessage = KNOWLEDGE_LOG_TRUNCATED_MESSAGE,
): Logger {
  const encoder = new TextEncoder();
  const truncatedLine = JSON.stringify({ level: "warn", message: truncatedMessage });
  const truncatedLineBytes = encoder.encode(truncatedLine).byteLength;
  let eventCount = 0;
  let byteCount = 0;
  let truncated = false;

  const truncate = () => {
    if (truncated) return;
    truncated = true;
    const separatorBytes = lines.length > 0 ? 1 : 0;
    if (byteCount + separatorBytes + truncatedLineBytes <= KNOWLEDGE_LOG_MAX_BYTES) {
      lines.push(truncatedLine);
    }
  };
  const append = (level: string, message: string, metadata?: Record<string, unknown>) => {
    if (truncated || eventCount >= KNOWLEDGE_LOG_MAX_EVENTS) {
      truncate();
      return;
    }

    const line = JSON.stringify({ level, message, ...(metadata ?? {}) });
    const lineBytes = encoder.encode(line).byteLength;
    const separatorBytes = lines.length > 0 ? 1 : 0;
    if (
      byteCount + separatorBytes + lineBytes + truncatedLineBytes + 1 >
        KNOWLEDGE_LOG_MAX_BYTES
    ) {
      truncate();
      return;
    }

    lines.push(line);
    eventCount += 1;
    byteCount += separatorBytes + lineBytes;
  };
  const logger: Logger = {
    info: (message: string, metadata?: Record<string, unknown>) =>
      append("info", message, metadata),
    warn: (message: string, metadata?: Record<string, unknown>) =>
      append("warn", message, metadata),
    error: (message: string, metadata?: Record<string, unknown>) =>
      append("error", message, metadata),
    debug: (message: string, metadata?: Record<string, unknown>) =>
      append("debug", message, metadata),
    async time<T>(_label: string, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    child: () => logger,
    component: () => logger,
  };
  return logger;
}

async function executeKnowledgeIngestRun(input: {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  signal: AbortSignal;
}): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const client = createRuntimeApiClient(input.req, input.ctx, input.signal);
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  const outputDir = await Deno.makeTempDir({ prefix: "veryfront-knowledge-run-" });
  const logLines: string[] = [];

  try {
    input.signal.throwIfAborted();
    const {
      buildKnowledgeIngestRunResult,
    } = await import("#cli/commands/knowledge/result");
    const {
      collectKnowledgeSources,
      ingestResolvedSources,
      resolveKnowledgeDownloadOutputDir,
      runKnowledgeParser,
    } = await import("#cli/commands/knowledge/command");
    const { downloadUploadToFile } = await import("#cli/commands/uploads/command");
    const { putRemoteFileFromLocal } = await import("#cli/commands/files/command");

    const uploadIds = getStringArrayConfig(config, ["upload_ids", "uploadIds"]);
    const paths = getStringArrayConfig(config, ["paths", "upload_paths", "uploadPaths"]);
    const uploadPaths = [
      ...paths,
      ...await resolveUploadIdsToPaths(client, projectReference, uploadIds),
    ];
    input.signal.throwIfAborted();
    const pathPrefix = getStringConfig(config, [
      "path_prefix",
      "upload_prefix",
      "pathPrefix",
      "uploadPrefix",
    ]);
    const knowledgePath = getStringConfig(config, ["knowledge_path", "knowledgePath"]) ??
      "knowledge";
    const description = getStringConfig(config, ["description"]);
    const recursive = config.recursive === undefined ? true : Boolean(config.recursive);

    if (uploadPaths.length > 0 && pathPrefix) {
      throw INVALID_ARGUMENT.create({ detail: "Use upload paths or upload prefix, not both." });
    }

    const options = {
      projectSlug: projectReference,
      projectDir: input.ctx.projectDir,
      sources: uploadPaths,
      path: pathPrefix,
      all: pathPrefix !== undefined,
      recursive,
      outputDir,
      knowledgePath,
      description,
      slug: getStringConfig(config, ["slug"]),
      json: true,
      quiet: true,
    };
    const downloadOutputDir = resolveKnowledgeDownloadOutputDir(outputDir);
    const sourceMode = pathPrefix ? "path_prefix" : "explicit_sources";
    const collection = await collectKnowledgeSources(options, {
      client,
      projectSlug: projectReference,
      downloadUploads: async (uploadTargets) => {
        const downloads = uploadTargets.map((uploadPath) =>
          downloadUploadToFile(
            client,
            projectReference,
            uploadPath,
            downloadOutputDir,
            input.signal,
          )
        );
        try {
          return await Promise.all(downloads);
        } catch (error) {
          // A rejected download does not prove its siblings have stopped.
          // Settle every started operation before cleanup and stop acknowledgement.
          await Promise.allSettled(downloads);
          throw error;
        }
      },
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    const requestedCount = collection.sources.length + collection.skipped.length;
    if (requestedCount === 0) {
      throw INVALID_ARGUMENT.create({ detail: "No supported knowledge sources were found." });
    }

    const results = await ingestResolvedSources(collection.sources, options, {
      client,
      projectSlug: projectReference,
      outputDir,
      runParser: runKnowledgeParser,
      eventLogger: createKnowledgeEventLogger(logLines),
      uploadKnowledgeFile: (remotePath, localPath) =>
        putRemoteFileFromLocal(
          client,
          projectReference,
          remotePath,
          localPath,
          input.signal,
        ),
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    const result = buildKnowledgeIngestRunResult({
      requestedCount,
      sourceMode,
      knowledgePath,
      ingested: results.ingested,
      skipped: collection.skipped,
      failed: results.failed,
    });
    const failedCount = result.summary.failed_count;
    const ingestedCount = result.summary.ingested_count;

    return {
      success: failedCount === 0 && ingestedCount > 0,
      result,
      error: failedCount > 0
        ? `${failedCount} knowledge source${failedCount === 1 ? "" : "s"} failed`
        : ingestedCount === 0
        ? "No knowledge sources were ingested"
        : null,
      logs: logLines.length > 0 ? logLines.join("\n") : null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    input.signal.throwIfAborted();
    return {
      success: false,
      error: errorMessage(error),
      logs: logLines.length > 0 ? logLines.join("\n") : null,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await Deno.remove(outputDir, { recursive: true }).catch(() => undefined);
  }
}

function getNumberConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex];
    if (key === undefined) continue;
    const value = getOwnDataProperty(config, key);
    if (typeof value === "number" && NumberIsFinite(value)) return value;
    if (
      typeof value === "string" &&
      ReflectApply(StringPrototypeTrim, value, []) !== ""
    ) {
      const parsed = NumberParseInt(value, 10);
      if (NumberIsFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function getPositiveIntConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  const value = getNumberConfig(config, keys);
  if (value === undefined) return undefined;
  const normalized = MathTrunc(value);
  return normalized > 0 ? normalized : undefined;
}

function isBlockingEvalResult(result: EvalMetricResult): boolean {
  return !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget");
}

function evalRecordFailed(record: EvalRecord): boolean {
  if (!record.completed || record.error) return true;
  return [...(record.metrics ?? []), ...(record.checks ?? [])].some(isBlockingEvalResult);
}

function countFailedEvalRecords(report: EvalReport): number {
  return report.records.filter(evalRecordFailed).length;
}

function withEvalRunConfig(
  definition: EvalDefinition,
  config: Record<string, unknown>,
): EvalDefinition {
  const repetitions = getPositiveIntConfig(config, ["repetitions", "repeat", "repetitionCount"]);
  if (repetitions === undefined || repetitions === definition.repetitions) {
    return definition;
  }

  return {
    ...definition,
    repetitions,
  };
}

function getEvalTargetAgentId(definition: EvalDefinition): string | undefined {
  if (definition.targetKind !== "agent") return undefined;
  const target = definition.target.startsWith("agent:")
    ? definition.target.slice("agent:".length)
    : definition.target;
  return target.length > 0 ? target : undefined;
}

function createEvalAdapterConfig(input: {
  request: ProjectRunExecuteRequest;
  definition: EvalDefinition;
  req: Request;
  ctx: HandlerContext;
}): AgentServiceEvalAdapterConfig {
  const config = input.request.config ?? {};
  // Eval input is an optional bag of target hints (branch_id); other JSON shapes carry no hints.
  const runInput = isRecord(input.request.input) ? input.request.input : {};
  const authToken = getRuntimeApiToken(input.req, input.ctx);
  if (!authToken) {
    throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });
  }
  const managedEndpointContext = getManagedProjectAgUiEndpointContext(
    input.request.runtimeAgUiEndpoint,
    input.ctx.projectSlug,
  );
  const endpoint = resolveEvalAgUiEndpoint(
    input.req,
    input.request.runtimeAgUiEndpoint,
    input.ctx.projectSlug,
  );
  const agentId = getEvalTargetAgentId(input.definition);
  const allowedTools = getStringArrayConfig(config, ["allowed_tools", "allowedTools"]);
  const maxSteps = getPositiveIntConfig(config, ["max_steps", "maxSteps"]);
  const hasMaxSteps = maxSteps != null;
  const runtimeRestrictions = {
    allowedTools,
    ...(hasMaxSteps ? { maxSteps } : {}),
  };
  const localFetch = createLocalEvalAgentFetch({ endpoint, agentId, runtimeRestrictions });

  return {
    endpoint,
    authToken,
    agentId,
    projectId: input.request.projectId,
    projectSlug: input.ctx.projectSlug,
    releaseId: input.req.headers.get("x-release-id") ?? input.ctx.releaseId,
    contentSourceId: input.req.headers.get("x-content-source-id"),
    branchId: getStringConfig(config, ["branch_id", "branchId"]) ??
      getStringConfig(runInput, ["branch_id", "branchId"]) ??
      input.req.headers.get("x-branch-id"),
    branchName: input.req.headers.get("x-branch-name"),
    environment: managedEndpointContext?.environment ?? input.req.headers.get("x-environment") ??
      input.ctx.resolvedEnvironment,
    environmentId: input.req.headers.get("x-environment-id") ?? input.ctx.environmentId,
    forwardedHost: managedEndpointContext?.forwardedHost ??
      getHeaderFirstValue(input.req.headers.get("x-forwarded-host")) ??
      getEndpointHost(input.request.runtimeAgUiEndpoint),
    forwardedProto: managedEndpointContext?.forwardedProto ??
      getHeaderFirstValue(input.req.headers.get("x-forwarded-proto")) ??
      getEndpointProtocol(input.request.runtimeAgUiEndpoint),
    model: getStringConfig(config, ["model"]),
    allowedTools,
    maxSteps,
    fetch: managedEndpointContext && agentId
      ? bindTrustedLocalEvalFetch(
        createDurableEvalAgentFetch({
          apiBaseUrl: getEnvironmentConfig().apiBaseUrl,
          authToken,
          projectId: input.request.projectId,
          parentRunId: input.request.runId,
          agentId,
          runtimeTargetKind: input.request.runtimeTargetKind,
          runtimeTargetEnvironmentId: input.request.runtimeTargetEnvironmentId,
          runtimeTargetBranchId: input.request.runtimeTargetBranchId,
        }),
        agentId,
      )
      : localFetch && agentId
      ? bindTrustedLocalEvalFetch(localFetch, agentId)
      : undefined,
  };
}

async function executeEvalRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  deps: ProjectRunExecuteHandlerDeps,
  options: {
    evalId?: string;
    signal?: AbortSignal;
    summaryOnly?: boolean;
    progressLogs?: string[];
  } = {},
): Promise<ProjectRunExecuteResponse> {
  const startedAt = deps.now();
  const evalId = options.evalId ?? request.target;
  const progressLogs = options.progressLogs ?? [];
  const progressLogger = options.summaryOnly
    ? createKnowledgeEventLogger(progressLogs, "Eval progress logs were truncated")
    : undefined;
  await deps.ensureProjectDiscovery(ctx);
  const evalItem = await deps.findEvalById(evalId, {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug,
    allowHostProjectCodeExecution: ctx.allowHostProjectCodeExecution,
  });

  if (!evalItem) {
    return {
      success: false,
      error: `Eval not found: ${evalId}`,
      logs: null,
      duration_ms: 0,
    };
  }

  if (evalItem.definition.inputSchema !== undefined) {
    const check = await checkDeclaredSchema(evalItem.definition.inputSchema, request.input);
    if (check.outcome === "invalid") {
      return {
        success: false,
        error: `Eval "${evalItem.id}" input failed inputSchema validation: ${
          formatSchemaValidationErrors(check.errors)
        }`,
        error_code: INPUT_VALIDATION_FAILED_CODE,
        error_detail: { errors: check.errors },
        logs: null,
        duration_ms: Math.max(0, deps.now() - startedAt),
      };
    }
    if (check.outcome === "schema_uncompilable") {
      throw INVALID_ARGUMENT.create({
        detail: `Eval "${evalItem.id}" inputSchema could not be compiled`,
      });
    }
  }

  const config = request.config ?? {};
  const report = await deps.runEval(withEvalRunConfig(evalItem.definition, config), {
    adapters: evalItem.definition.targetKind === "agent"
      ? {
        agent: deps.createEvalAgentAdapter(
          createEvalAdapterConfig({ request, definition: evalItem.definition, req, ctx }),
        ),
      }
      : {},
    baseDir: ctx.projectDir,
    runId: request.runId,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.summaryOnly
      ? {
        onProgress: (event) => {
          if (event.type !== "record-finished") return;
          progressLogger?.info("Eval case completed", {
            case_index: event.index + 1,
            total_cases: event.total,
            repetition: event.repetition,
          });
        },
      }
      : {}),
  });
  options.signal?.throwIfAborted();
  const failed = Math.max(report.summary.failed, countFailedEvalRecords(report));
  const projectReference = ctx.projectSlug ?? request.projectId;
  const requestedReportPath = buildEvalReportPath(report, request);
  let artifact: Record<string, unknown> | null = null;
  let reportPath: string | null = null;
  let uploadError: string | null = null;
  try {
    const reportContent = serializeEvalReportFile(report, requestedReportPath);
    artifact = await createEvalReportArtifact(requestedReportPath, reportContent);
    options.signal?.throwIfAborted();
    reportPath = await deps.uploadEvalReport({
      request,
      ctx,
      req,
      report,
      projectReference,
      reportPath: requestedReportPath,
      content: reportContent,
      signal: options.signal,
    });
  } catch (error) {
    uploadError = `Eval report upload failed: ${errorMessage(error)}`;
  }
  options.signal?.throwIfAborted();
  const result = options.summaryOnly
    ? report.summary
    : reportPath
    ? { ...report, reportPath }
    : report;
  const requiredUploadError = options.summaryOnly && !reportPath
    ? uploadError ?? "Eval report upload failed: report was not stored"
    : null;
  const failureMessages = [
    ...(failed > 0 ? [`${failed} eval record${failed === 1 ? "" : "s"} failed`] : []),
    ...(requiredUploadError ? [requiredUploadError] : []),
  ];
  const logs = [...progressLogs, ...(uploadError ? [uploadError] : [])].join("\n") || null;

  return {
    success: failureMessages.length === 0,
    result,
    ...(reportPath ? { artifacts: [{ __proto__: null, ...artifact, path: reportPath }] } : {}),
    ...(failureMessages.length > 0 ? { error: failureMessages.join("; ") } : {}),
    logs,
    duration_ms: Math.max(0, deps.now() - startedAt),
  };
}

async function executeEvalTaskRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  signal: AbortSignal,
  deps: ProjectRunExecuteHandlerDeps,
  control?: TaskDeadlineControl,
): Promise<ProjectRunExecuteResponse> {
  const evalId = getStringConfig(request.config ?? {}, ["eval_id"]);
  if (!evalId) {
    return {
      success: false,
      error: "task:eval requires config.eval_id",
      logs: null,
      duration_ms: 0,
    };
  }
  const taskSignal = control
    ? ReflectApply(TaskAbortSignalAny, AbortSignal, [[signal, control.signal]])
    : signal;
  const progressLogs: string[] = [];
  const taskResult = await deps.runTask({
    task: {
      id: "eval",
      name: "Run eval",
      definition: {
        name: "Run eval",
        run: (taskContext) =>
          executeEvalRun(request, ctx, req, deps, {
            evalId,
            signal: taskContext.signal ?? taskSignal,
            summaryOnly: true,
            progressLogs,
          }),
      },
    },
    ...(request.attempt === undefined ? {} : { attempt: request.attempt }),
    config: request.config ?? {},
    input: request.input,
    runId: request.runId,
    projectId: request.projectId,
    environmentId: request.runtimeTargetEnvironmentId === undefined
      ? ctx.environmentId
      : request.runtimeTargetEnvironmentId ?? undefined,
    signal: taskSignal,
    debug: ctx.debug,
  });
  if (!taskResult.success) {
    return {
      success: false,
      error: taskResult.error,
      logs: progressLogs.join("\n") || null,
      duration_ms: taskResult.durationMs,
      ...(taskResult.retryable ? { retryable: true as const } : {}),
    };
  }
  return taskResult.result as ProjectRunExecuteResponse;
}

async function executeReleaseAssetBuildRun(input: {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  signal: AbortSignal;
}): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  const releaseId = getStringConfig(config, ["release_id", "releaseId"]);
  const releaseVersion = getNumberConfig(config, ["release_version", "releaseVersion"]);
  const tempDir = await Deno.makeTempDir({ prefix: "veryfront-release-assets-" });

  try {
    input.signal.throwIfAborted();
    if (!releaseId || releaseVersion === undefined) {
      throw INVALID_ARGUMENT.create({
        detail: "Missing release_id or release_version for release asset build",
      });
    }

    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const { runReleaseAssetBuild } = await import("#veryfront/release-assets/build-executor.ts");
    const { transformToESM } = await import("#veryfront/transforms/esm-transform.ts");
    const { createCompileProjectCss } = await import(
      "#veryfront/release-assets/css-compile.ts"
    );

    const apiBaseUrl = getEnvironmentConfig().apiBaseUrl;
    const token = readIngressCredential(input.req, INGRESS_API_TOKEN_HEADER) ??
      input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });

    const apiClient = new VeryfrontApiClient({
      apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);

    const releaseVersionRef = releaseId;
    const releaseConfig = input.ctx.config;
    if (!releaseConfig) {
      throw INVALID_ARGUMENT.create({ detail: "Missing validated project config" });
    }

    // Production CSS compiler: compiles the project's Tailwind CSS in-runtime
    // via the pure `generateTailwindCSS` primitive (no distributed-cache /
    // candidate-contract machinery). Missing providers and compile errors
    // propagate to the executor, which records an explicit CSS gap.
    const compileProjectCss = createCompileProjectCss({
      projectScope: projectReference,
    });

    const result = await runReleaseAssetBuild({
      projectReference,
      projectId: input.ctx.projectId ?? input.request.projectId,
      releaseId,
      releaseVersion,
      releaseVersionRef,
      adapter: input.ctx.adapter,
      dependencyMode: "source",
      transform: (source, sourceFile, projectDir, adapter, options) =>
        runWhileActive(input.signal, () =>
          transformToESM(source, sourceFile, projectDir, adapter, {
            projectId: options.projectId,
            dev: options.dev,
            ssr: options.ssr,
            studioEmbed: false,
            reactVersion: options.reactVersion,
            serverExternalPackages: releaseConfig.build?.serverExternalPackages,
            dependencyPinningCacheKey: options.dependencyPinningSnapshot?.cacheKey,
            dependencyPinningDependencies: options.dependencyPinningSnapshot?.dependencies,
            dependencyPinningSource: options.dependencyPinningSource,
          })),
      loadConfig: () => {
        input.signal.throwIfAborted();
        return Promise.resolve(releaseConfig);
      },
      client: {
        beginReleaseAssetManifestBuild: (version) =>
          runWhileActive(
            input.signal,
            () => apiClient.beginReleaseAssetManifestBuild(version, undefined, input.signal),
          ),
        listAllReleaseFiles: async (version) => {
          const files = await runWhileActive(
            input.signal,
            () => apiClient.listAllReleaseFiles(version, {}, input.signal),
          );
          return files.map((file) => {
            if (typeof file.content !== "string") {
              throw API_CLIENT_ERROR.create({
                detail: "Release file list omitted file content",
                status: 502,
              });
            }
            return { path: file.path, content: file.content };
          });
        },
        uploadReleaseAsset: (version, hash, contentType, bytes) =>
          runWhileActive(
            input.signal,
            () =>
              apiClient.uploadReleaseAsset(
                version,
                hash,
                contentType,
                bytes,
                undefined,
                input.signal,
              ),
          ),
        putReleaseAssetManifest: (version, manifest) =>
          runWhileActive(
            input.signal,
            () => apiClient.putReleaseAssetManifest(version, manifest, undefined, input.signal),
          ),
        reportReleaseAssetManifestState: (version, state, error) =>
          runWhileActive(
            input.signal,
            () =>
              apiClient.reportReleaseAssetManifestState(
                version,
                state,
                error,
                undefined,
                input.signal,
              ),
          ),
        compileProjectCss: (...args) =>
          runWhileActive(input.signal, () => compileProjectCss(...args)),
      },
    }, tempDir);
    input.signal.throwIfAborted();

    return {
      success: result.success,
      result,
      error: result.error ?? null,
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    input.signal.throwIfAborted();
    return {
      success: false,
      error: errorMessage(error),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
  }
}

async function executeDependencyArtifactBuildRun(input: {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  signal: AbortSignal;
}): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  try {
    input.signal.throwIfAborted();
    const {
      parseDependencyArtifactBuildTaskInput,
      runDependencyArtifactBuild,
    } = await import("#veryfront/release-assets/dependency-artifact-builder.ts");
    const taskInput = parseDependencyArtifactBuildTaskInput(input.request.config);
    const token = getRuntimeApiToken(input.req, input.ctx);
    if (!token) {
      throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });
    }

    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const apiClient = new VeryfrontApiClient({
      apiBaseUrl: getEnvironmentConfig().apiBaseUrl,
      apiToken: token,
      projectSlug: input.ctx.projectSlug,
      projectId: input.ctx.projectId,
    });
    const result = await runDependencyArtifactBuild(taskInput, {
      uploadAsset: ({ artifactId, attemptCount, contentHash, contentType, bytes }) =>
        runWhileActive(input.signal, () =>
          apiClient.uploadDependencyArtifactAsset(
            artifactId,
            attemptCount,
            contentHash,
            contentType,
            bytes,
            input.signal,
          )),
      reportResult: ({ artifactId, attemptCount, result }) =>
        runWhileActive(input.signal, () =>
          apiClient.reportDependencyArtifactBuildResult(
            artifactId,
            attemptCount,
            result,
            input.signal,
          )),
    }, { signal: input.signal });
    input.signal.throwIfAborted();

    return {
      success: result.success,
      result,
      ...(result.success ? {} : { error: result.failureCode }),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    input.signal.throwIfAborted();
    return {
      success: false,
      error: errorMessage(error),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  }
}

type StyleArtifactBuildSelector = {
  branch?: string;
  environmentName?: string;
  releaseId?: string;
};

type StyleArtifactSourceFile = { path: string; content?: string };

type StyleArtifactSourceProvider = {
  getAllSourceFiles: () => Promise<StyleArtifactSourceFile[]> | StyleArtifactSourceFile[];
  getContentContext?: () => ResolvedContentContext | null;
};

type OptionalTextFileReader = {
  readOptionalTextFile(path: string): Promise<string>;
};

const DEFAULT_STYLESHEET_PATHS = [
  "globals.css",
  "global.css",
  "styles/globals.css",
  "app/globals.css",
  "src/globals.css",
  "src/styles/globals.css",
];

function optionalString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveStyleArtifactBuildSelector(
  config: Record<string, unknown>,
  ctx: HandlerContext,
): StyleArtifactBuildSelector {
  const selector: StyleArtifactBuildSelector = {
    branch: getStringConfig(config, ["branch"]) ?? optionalString(ctx.parsedDomain?.branch),
    environmentName: getStringConfig(config, ["environment_name", "environmentName"]) ??
      optionalString(ctx.environmentName),
    releaseId: getStringConfig(config, ["release_id", "releaseId"]) ??
      optionalString(ctx.releaseId),
  };
  const count = [selector.branch, selector.environmentName, selector.releaseId]
    .filter((value) => typeof value === "string" && value.length > 0).length;

  if (count !== 1) {
    throw INVALID_ARGUMENT.create({ detail: "Exactly one style artifact selector is required" });
  }

  return selector;
}

function getStyleArtifactSourceProvider(ctx: HandlerContext): StyleArtifactSourceProvider | null {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;

  const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
    getAllSourceFiles?: StyleArtifactSourceProvider["getAllSourceFiles"];
    getContentContext?: StyleArtifactSourceProvider["getContentContext"];
  };
  if (typeof fsAdapter.getAllSourceFiles !== "function") return null;

  return {
    getAllSourceFiles: fsAdapter.getAllSourceFiles.bind(fsAdapter),
    getContentContext: typeof fsAdapter.getContentContext === "function"
      ? fsAdapter.getContentContext.bind(fsAdapter)
      : undefined,
  };
}

function stylesheetCandidatePaths(stylesheetPath?: string): string[] {
  return stylesheetPath ? [stylesheetPath.replace(/^\/+/, "")] : DEFAULT_STYLESHEET_PATHS;
}

function textFromFileContent(content: Uint8Array | string): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

function getOptionalTextFileReader(ctx: HandlerContext): OptionalTextFileReader | null {
  const wrappedFs = ctx.adapter.fs as {
    getUnderlyingAdapter?: () => unknown;
    readOptionalTextFile?: OptionalTextFileReader["readOptionalTextFile"];
  };

  if (typeof wrappedFs.readOptionalTextFile === "function") {
    return { readOptionalTextFile: wrappedFs.readOptionalTextFile.bind(wrappedFs) };
  }

  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;
  const underlying = wrappedFs.getUnderlyingAdapter() as Partial<OptionalTextFileReader>;
  if (typeof underlying.readOptionalTextFile !== "function") return null;

  return { readOptionalTextFile: underlying.readOptionalTextFile.bind(underlying) };
}

async function readStylesheetFromAdapter(
  ctx: HandlerContext,
  stylesheetPath?: string,
): Promise<string | undefined> {
  const optionalReader = getOptionalTextFileReader(ctx);

  for (const path of stylesheetCandidatePaths(stylesheetPath)) {
    try {
      const content = optionalReader
        ? await optionalReader.readOptionalTextFile(path)
        : textFromFileContent(await ctx.adapter.fs.readFile(path));
      if (content) return content;
    } catch {
      // keep searching
    }
  }

  return undefined;
}

async function resolveStyleArtifactSourceFiles(
  ctx: HandlerContext,
  styleProfile: StyleScopeProfile,
  collectLocalProjectSourceFiles: (
    options: { projectDir: string; styleProfile: StyleScopeProfile },
  ) => Promise<StyleArtifactSourceFile[]>,
): Promise<{ files: StyleArtifactSourceFile[]; contentContext: ResolvedContentContext | null }> {
  const sourceProvider = getStyleArtifactSourceProvider(ctx);
  if (sourceProvider) {
    return {
      files: await sourceProvider.getAllSourceFiles(),
      contentContext: sourceProvider.getContentContext?.() ?? null,
    };
  }

  return {
    files: await collectLocalProjectSourceFiles({
      projectDir: ctx.projectDir,
      styleProfile,
    }),
    contentContext: null,
  };
}

async function executeStyleArtifactBuildRun(input: {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  signal: AbortSignal;
}): Promise<ProjectRunExecuteResponse> {
  const startedAt = Date.now();
  const config = input.request.config ?? {};
  const projectReference = input.ctx.projectSlug ?? input.request.projectId;
  let apiClient: VeryfrontApiClient | null = null;
  let selector: StyleArtifactBuildSelector | null = null;
  let styleProfileHash: string | null = null;

  try {
    input.signal.throwIfAborted();
    const { VeryfrontApiClient } = await import(
      "#veryfront/platform/adapters/veryfront-api-client/client.ts"
    );
    const {
      buildPreparedCSSArtifactFromFiles,
      collectLocalProjectSourceFiles,
      findStylesheetFromFiles,
      readLocalProjectStylesheet,
    } = await import("#veryfront/html/styles-builder/css-pregeneration.ts");
    const { resolveStyleContentVersion } = await import(
      "#veryfront/html/styles-builder/content-version.ts"
    );
    const { createStyleScopeProfile } = await import(
      "#veryfront/html/styles-builder/style-scope-profile.ts"
    );

    const token = readIngressCredential(input.req, INGRESS_API_TOKEN_HEADER) ??
      input.ctx.proxyToken ??
      input.ctx.requestContext?.token ?? "";
    if (!token) throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });

    apiClient = new VeryfrontApiClient({
      apiBaseUrl: getEnvironmentConfig().apiBaseUrl,
      apiToken: token,
      projectSlug: projectReference,
      projectId: input.ctx.projectId,
    });
    apiClient.setProjectSlug(projectReference);

    selector = resolveStyleArtifactBuildSelector(config, input.ctx);
    const styleProfile = createStyleScopeProfile(input.ctx.config);
    const requestedStyleProfileHash = getStringConfig(config, [
      "style_profile_hash",
      "styleProfileHash",
    ]);
    styleProfileHash = requestedStyleProfileHash ?? styleProfile.hash;

    if (requestedStyleProfileHash && requestedStyleProfileHash !== styleProfile.hash) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Style profile hash mismatch: expected ${requestedStyleProfileHash}, got ${styleProfile.hash}`,
      });
    }

    const { files, contentContext } = await resolveStyleArtifactSourceFiles(
      input.ctx,
      styleProfile,
      collectLocalProjectSourceFiles,
    );
    input.signal.throwIfAborted();
    if (files.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: "No project source files were available to build the style artifact",
      });
    }

    const stylesheetPath = input.ctx.config?.tailwind?.stylesheet;
    const stylesheet = findStylesheetFromFiles(files, stylesheetPath) ??
      (getStyleArtifactSourceProvider(input.ctx)
        ? await readStylesheetFromAdapter(input.ctx, stylesheetPath)
        : await readLocalProjectStylesheet(input.ctx.projectDir, stylesheetPath));
    input.signal.throwIfAborted();
    const result = await buildPreparedCSSArtifactFromFiles({
      projectSlug: projectReference,
      projectVersion: resolveStyleContentVersion(contentContext, {
        branch: selector.branch,
        environmentName: selector.environmentName,
        releaseId: selector.releaseId,
      }),
      projectDir: input.ctx.projectDir,
      files,
      styleProfile,
      stylesheet,
      stylesheetPath,
      minify: true,
      environment: "preview",
      buildMode: "production",
    });
    input.signal.throwIfAborted();

    await apiClient.upsertStyleArtifact(
      {
        ...selector,
        styleProfileHash,
        status: "ready",
        artifactHash: result.hash,
        assetPath: `/_vf/css/${result.hash}.css`,
        contentType: "text/css; charset=utf-8",
        buildRunId: input.request.runId,
      },
      undefined,
      input.signal,
    );
    input.signal.throwIfAborted();

    return {
      success: true,
      result: {
        state: "ready",
        artifactHash: result.hash,
        assetPath: `/_vf/css/${result.hash}.css`,
        candidateCount: result.candidateCount,
        fromCache: result.fromCache,
      },
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    if (apiClient && selector && styleProfileHash) {
      await apiClient.upsertStyleArtifact(
        {
          ...selector,
          styleProfileHash,
          status: "failed",
          buildRunId: input.request.runId,
          failureReason: errorMessage(error),
        },
        undefined,
        input.signal,
      ).catch(() => undefined);
      input.signal.throwIfAborted();
    }

    return {
      success: false,
      error: errorMessage(error),
      logs: null,
      duration_ms: Date.now() - startedAt,
    };
  }
}

const defaultDeps: ProjectRunExecuteHandlerDeps = {
  runTask,
  findWorkflowById,
  findEvalById,
  createWorkflowClient: createRuntimeWorkflowClient,
  runEval,
  createEvalAgentAdapter: createAgentServiceEvalAdapter,
  uploadEvalReport: uploadEvalReportToProjectFiles,
  ensureProjectDiscovery,
  executeKnowledgeIngest: executeKnowledgeIngestRun,
  executeReleaseAssetBuild: executeReleaseAssetBuildRun,
  executeDependencyArtifactBuild: executeDependencyArtifactBuildRun,
  executeStyleArtifactBuild: executeStyleArtifactBuildRun,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Runs the task or workflow a control-plane execute request names. */
function executeProjectRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  deps: ProjectRunExecuteHandlerDeps,
  acknowledgeStop?: () => Promise<void>,
  acknowledgePause?: () => Promise<boolean | undefined>,
): Promise<ProjectRunExecuteResponse> {
  if (request.kind === "task") {
    const clockDescriptor = ObjectGetOwnPropertyDescriptor(deps, "taskDeadlineClock");
    const clock = clockDescriptor && ObjectHasOwn(clockDescriptor, "value")
      ? clockDescriptor.value as TaskDeadlineClock | undefined
      : undefined;
    return executeTaskRun(
      request,
      async (control) => {
        try {
          const signal = control
            ? ReflectApply(TaskAbortSignalAny, AbortSignal, [[req.signal, control.signal]])
            : req.signal;
          switch (request.target) {
            case "task:eval":
              return await executeEvalTaskRun(request, ctx, req, req.signal, deps, control);
            case "task:knowledge-ingest":
              return await deps.executeKnowledgeIngest({ request, ctx, req, signal });
            case "task:release-asset-build":
              return await deps.executeReleaseAssetBuild({ request, ctx, req, signal });
            case "task:dependency-artifact-build":
              return await deps.executeDependencyArtifactBuild({ request, ctx, req, signal });
            case "task:style-artifact-build":
              return await deps.executeStyleArtifactBuild({ request, ctx, req, signal });
            default:
              return await executeDiscoveredTaskRun(request, ctx, req.signal, deps, control);
          }
        } finally {
          await acknowledgeStop?.();
        }
      },
      acknowledgeStop,
      clock,
    );
  }
  return executeWorkflowRun(request, ctx, req.signal, deps, acknowledgeStop, acknowledgePause);
}

export class ProjectRunExecuteHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ProjectRunExecuteHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: CONTROL_PLANE_RUNS_PATH_PREFIX, prefix: true, method: "POST" },
    ],
  };

  constructor(
    private readonly deps: ProjectRunExecuteHandlerDeps = defaultDeps,
    private readonly stopRegistry: RunStopRegistry = agentRunSessionManager.stopRegistry,
  ) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const runId = getRunId(new URL(req.url).pathname);
    if (!runId) {
      return this.continue();
    }

    return this.withProxyContext(ctx, async () => {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);

      try {
        const rawBody = await readInternalAgentRequestBody(
          req,
          INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES,
        );
        const request = parseExecuteRequest(JSON.parse(rawBody), runId);
        const claims = await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: runId,
          expectedSurface: "studio",
        });

        if (
          request.projectId !== claims.project_id ||
          (ctx.projectId !== undefined && request.projectId !== ctx.projectId)
        ) {
          return this.respond(builder.json({ error: "Invalid control-plane signature" }, 401));
        }
        const inferenceToken = readProjectRunInferenceToken(req);
        const stopController = new TaskAbortController();
        const executionSignal = ReflectApply(TaskAbortSignalAny, AbortSignal, [[
          IntrinsicReflectApply(RequestSignalGetter, req, []) as AbortSignal,
          stopController.signal,
        ]]) as AbortSignal;
        const callback = createRunStopAcknowledger(req, request.runId, executionSignal);
        const acknowledgePause = request.kind === "workflow"
          ? createRunPauseAcknowledger(req, request.runId, this.deps.sleep)
          : undefined;
        const executionRequest = withoutProjectRunInferenceToken(req, executionSignal);
        const settledStop = this.stopRegistry.register(request.runId, () => {
          ReflectApply(TaskAbort, stopController, [new Error("Run cancelled")]);
        });
        const acknowledgeStop = async () => {
          settledStop();
          await callback?.();
        };

        return await withSpan(
          "project_run.execute",
          async () => {
            const startedAt = this.deps.now();
            try {
              const limited = enforceRunOutputLimit(
                inferenceToken === undefined
                  ? await executeProjectRun(
                    request,
                    ctx,
                    executionRequest,
                    this.deps,
                    acknowledgeStop,
                    acknowledgePause,
                  )
                  : await runWithProjectRunInferenceCredential(
                    inferenceToken,
                    () =>
                      executeProjectRun(
                        request,
                        ctx,
                        executionRequest,
                        this.deps,
                        acknowledgeStop,
                        acknowledgePause,
                      ),
                  ),
              );
              const response = limited.response;
              if (!response.success) setActiveSpanErrorStatus(new Error("Project run failed"));
              return this.respond(
                builder.withContentType("application/json; charset=utf-8", limited.wireJson, 200),
              );
            } catch (error) {
              setActiveSpanErrorStatus(new Error(telemetryErrorType(error)));
              return this.respond(
                builder.json(
                  createExecutionFailure(error, Math.max(0, this.deps.now() - startedAt)),
                  200,
                ),
              );
            }
          },
          {
            "run.id": request.runId,
            "run.kind": request.kind,
            "project.id": request.projectId,
            "parent.run.id": request.parentRunId ?? undefined,
            "root.run.id": request.rootRunId ?? undefined,
          },
          // A run must stay findable by run.id when the control-plane request was
          // sampled out, so it roots its own trace and links back to the request.
          { root: true, links: [activeSpanLink()].filter((link) => link !== undefined) },
        );
      } catch (error) {
        if (error instanceof InternalAgentRequestBodyTooLargeError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof ControlPlaneRequestError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof VeryfrontError && error.slug === "input-validation-failed") {
          return this.respond(builder.json({ error: error.detail ?? error.message }, 400));
        }

        return this.respond(builder.json({ error: "Invalid project run execute request" }, 400));
      }
    });
  }
}
