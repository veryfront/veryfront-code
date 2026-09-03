import { logger as baseLogger } from "#veryfront/utils";
import {
  ensureError,
  NOT_SUPPORTED,
  ORCHESTRATION_ERROR,
  RESOURCE_NOT_FOUND,
} from "#veryfront/errors";
import { getActiveTraceparent } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  hasEventWaitSupport,
  hasLockSupport,
  hasRunPatchKeyMergeSupport,
  hasWorkerSupport,
  isSameWaitNodeExecution,
  updateRunIfStatus,
  type WorkflowBackend,
  type WorkflowRunUpdate,
} from "../backends/types.ts";
import type { CheckpointOwnership } from "../executor/checkpoint-manager.ts";
import type {
  ApprovalDecision,
  NodeState,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import type { RunExecutionConfig } from "../worker/executors/types.ts";
import type { DurableTimedWaitKind } from "../timed-wait-state.ts";

const logger = baseLogger.component("workflow-run-control");

export interface WorkflowRunControlExecuteResult {
  completed?: boolean;
  waiting?: boolean;
  waitingNode?: string;
  waitingConfig?: WaitNodeConfig;
  /**
   * Every node that suspended in the settled batch, when more than one did.
   * A batch of dependency-free waits parks them all at once, and each needs
   * its own durable record; announcing only the first would leave the others
   * parked with nothing able to wake them. `waitingNode` remains the first
   * entry for compatibility.
   */
  waitingNodes?: ReadonlyArray<{ nodeId: string; waitConfig?: WaitNodeConfig }>;
  /**
   * Reported with `error` when the graph found nothing to schedule and every
   * unfinished node is either this wait or blocked behind it. Whether that is a
   * stall or a run still parked depends on the durable approval or event-wait
   * record, which only this layer can read.
   */
  stalledWaitNode?: string;
  /** Every running wait in a graph that found nothing left to schedule. */
  stalledWaitNodes?: ReadonlyArray<{ nodeId: string; waitConfig: WaitNodeConfig }>;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  error?: string;
}

export interface WorkflowRunControlExecuteInput {
  backend: WorkflowBackend;
  run: WorkflowRun;
  expectedWorkerId?: string;
  enableLocking?: boolean;
  lockDuration: number;
  heartbeatInterval: number;
  waitForCancellationUpdate(runId: string): Promise<void>;
  waitForCancellationGrace(operation: Promise<unknown>): Promise<void>;
  registerController?(runId: string, controller: AbortController): void;
  clearController?(runId: string, controller: AbortController): void;
  isCurrentExecution(runId: string, controller: AbortController): boolean;
  execute(input: {
    run: WorkflowRun;
    controller: AbortController;
    signal: AbortSignal;
    ownership?: CheckpointOwnership;
  }): Promise<WorkflowRunControlExecuteResult>;
  onStart?(run: WorkflowRun): void | Promise<void>;
  onComplete?(run: WorkflowRun): void | Promise<void>;
  onError?(
    run: WorkflowRun,
    error: Error,
    context: WorkflowContext,
  ): void | Promise<void>;
  /** Persist the durable wait record while the execution lock is still held. */
  onWaitingPersist?(
    run: WorkflowRun,
    nodeId: string,
    waitConfig?: WaitNodeConfig,
  ): void | Promise<void>;
  /** Notify observers after durable persistence and lock release. */
  onWaiting?(
    run: WorkflowRun,
    nodeId: string,
    waitConfig?: WaitNodeConfig,
  ): void | Promise<void>;
  /** Notify observers when resume observes an already-live wait record. */
  onLiveWaiting?(
    run: WorkflowRun,
    nodeId: string,
    waitConfig?: WaitNodeConfig,
  ): void | Promise<void>;
  onWaitingBatchComplete?(run: WorkflowRun): void | Promise<void>;
}

export interface WorkflowRunControlExecuteOutcome {
  status:
    | "completed"
    | "waiting"
    | "failed"
    | "cancelled"
    | "skipped"
    | "ownership-lost";
  run?: WorkflowRun;
}

export interface WorkflowRunControlClaimInput {
  backend: WorkflowBackend;
  run: WorkflowRun;
  managerId: string;
  executionId: string;
  stalledThreshold: number;
  executionTimeout: number;
  env: Record<string, string>;
  debug: boolean;
  createRunExecution(config: RunExecutionConfig): Promise<string>;
}

export interface WorkflowRunControlClaimCreatedExecution {
  executionId: string;
  runId: string;
  status: "pending";
  createdAt: Date;
}

export interface WorkflowRunControlClaimOutcome {
  status:
    | "created"
    | "skipped-lock-held"
    | "skipped-status-changed"
    | "skipped-stalled-claim-lost"
    | "failed-before-claim"
    | "failed-after-claim";
  execution?: WorkflowRunControlClaimCreatedExecution;
  error?: Error;
}

export interface WorkflowRunControlApprovalDecisionOperation {
  type: "approval-decision";
  runId: string;
  approvalId: string;
  nodeId: string;
  decision: ApprovalDecision;
  decidedAt?: Date;
  maxAttempts?: number;
  resume?(runId: string, expectedWorkerId?: string): Promise<void>;
}

export interface WorkflowRunControlEventDeliveryOperation {
  type: "event-delivery";
  runId: string;
  waitId: string;
  nodeId: string;
  eventName: string;
  waitKind: DurableTimedWaitKind;
  /** Execution identity of the wait record being reconciled. */
  waitInstanceId?: string;
  payload?: unknown;
  deliveredAt?: Date;
  maxAttempts?: number;
  resume?(runId: string, expectedWorkerId?: string): Promise<void>;
}

export interface WorkflowRunControlHydrateEnvOperation {
  type: "hydrate-env";
  run: WorkflowRun;
  env: Record<string, string>;
  expectedWorkerId?: string;
}

export interface WorkflowRunControlFailExecutionOperation {
  type: "fail-execution";
  runId: string;
  error: unknown;
  expectedWorkerId?: string;
}

export interface WorkflowRunControlReconcileInput {
  backend: WorkflowBackend;
  operation:
    | WorkflowRunControlApprovalDecisionOperation
    | WorkflowRunControlEventDeliveryOperation
    | WorkflowRunControlHydrateEnvOperation
    | WorkflowRunControlFailExecutionOperation;
}

export interface WorkflowRunControlReconcileOutcome {
  status:
    | "reconciled"
    | "unchanged"
    | "stale-wait"
    | "skipped-terminal"
    | "stale-owner"
    | "ownership-changing";
  run?: WorkflowRun;
}

const possiblyCommittedReconciliationErrors = new WeakSet<object>();

/** Consume the marker for an error raised after its run patch may have landed. */
export function consumeWorkflowRunControlOutcomeMayBeCommitted(error: unknown): boolean {
  if (!((typeof error === "object" && error !== null) || typeof error === "function")) {
    return false;
  }
  const marked = possiblyCommittedReconciliationErrors.has(error);
  if (marked) possiblyCommittedReconciliationErrors.delete(error);
  return marked;
}

function markWorkflowRunControlOutcomeMayBeCommitted(error: unknown): unknown {
  if ((typeof error === "object" && error !== null) || typeof error === "function") {
    possiblyCommittedReconciliationErrors.add(error);
  }
  return error;
}

const DEFAULT_DECISION_RECONCILIATION_ATTEMPTS = 8;
const ACTIVE_RECONCILE_STATUSES: WorkflowRun["status"][] = ["pending", "running", "waiting"];

type ClaimPhase =
  | { kind: "before-execution-owner" }
  | { kind: "assigning-execution-owner"; workerId: string }
  | { kind: "execution-owner-assigned"; workerId: string };

export async function reconcileWorkflowRunControl(
  input: WorkflowRunControlReconcileInput,
): Promise<WorkflowRunControlReconcileOutcome> {
  switch (input.operation.type) {
    case "approval-decision":
      return await reconcileApprovalDecision(input.backend, input.operation);
    case "event-delivery":
      return await reconcileEventDelivery(input.backend, input.operation);
    case "hydrate-env":
      return await reconcileHydrateEnv(input.backend, input.operation);
    case "fail-execution":
      return await reconcileExecutionFailure(input.backend, input.operation);
  }
}

export async function claimWorkflowRunControl(
  input: WorkflowRunControlClaimInput,
): Promise<WorkflowRunControlClaimOutcome> {
  const {
    backend,
    run,
    managerId,
    executionId,
    stalledThreshold,
    executionTimeout,
    env,
    debug,
  } = input;
  const runId = run.id;
  const workerId = `run-execution:${executionId}`;
  let pendingLockToken: string | null = null;
  let runToProcess: WorkflowRun | null = run;
  let claimPhase: ClaimPhase = { kind: "before-execution-owner" };
  let managerClaimWorkerId: string | undefined;

  try {
    if (run.status === "running") {
      if (!hasWorkerSupport(backend)) return { status: "skipped-stalled-claim-lost" };
      managerClaimWorkerId = `mgr:${managerId}`;
      const stalledClaimed = await backend.claimStalledRun(
        runId,
        managerClaimWorkerId,
        stalledThreshold,
      );
      if (!stalledClaimed) return { status: "skipped-stalled-claim-lost" };
    }

    if (run.status === "pending" && hasLockSupport(backend)) {
      pendingLockToken = await backend.acquireLock(runId, stalledThreshold);
      if (!pendingLockToken) return { status: "skipped-lock-held" };

      const latest = await backend.getRun(runId);
      if (!latest || latest.status !== "pending") {
        return { status: "skipped-status-changed" };
      }
      runToProcess = latest;
    }

    if (!runToProcess || !["pending", "waiting", "running"].includes(runToProcess.status)) {
      return { status: "skipped-status-changed" };
    }

    requireWorkflowSourceIntegrationPolicy(runToProcess);

    const now = new Date();
    const expectedWorkerId = managerClaimWorkerId;
    claimPhase = { kind: "assigning-execution-owner", workerId };
    const claimed = await updateRunIfStatus(
      backend,
      runId,
      [runToProcess.status],
      {
        status: "running",
        startedAt: now,
        heartbeatAt: now,
        workerId,
      },
      expectedWorkerId,
    );
    if (!claimed) {
      return {
        status: run.status === "running" ? "skipped-stalled-claim-lost" : "skipped-status-changed",
      };
    }
    claimPhase = { kind: "execution-owner-assigned", workerId };

    const executionConfig: RunExecutionConfig = {
      executionId,
      run: runToProcess,
      managerId,
      timeout: executionTimeout,
      env,
      debug,
    };

    await runWithWorkflowSourceIntegrationPolicy(
      runToProcess,
      () => input.createRunExecution(executionConfig),
    );

    return {
      status: "created",
      execution: {
        executionId,
        runId,
        status: "pending",
        createdAt: new Date(),
      },
    };
  } catch (error) {
    return await failClaim(
      input,
      runToProcess ?? run,
      claimPhase,
      ensureError(error),
      managerClaimWorkerId,
    );
  } finally {
    if (pendingLockToken) {
      try {
        await backend.releaseLock?.(runId, pendingLockToken);
      } catch (error) {
        logger.warn(`Failed to release pending claim lock for ${runId}:`, error);
      }
    }
  }
}

/**
 * Write one already-durable node outcome onto whichever worker owns the run
 * now, retrying if ownership changes between the read, the conditional patch,
 * and the resume.
 *
 * The outcome (an approval decision, a delivered event) is durable before this
 * runs. Without the retry loop it could be consumed while leaving the workflow
 * permanently parked on the node it already resolved.
 */
type ReconcileNodeOutcomeInput = {
  runId: string;
  maxAttempts: number;
  buildPatch(run: WorkflowRun): WorkflowRunUpdate;
  isApplicable?(run: WorkflowRun): boolean;
  shouldResume: boolean;
  resume?(runId: string, expectedWorkerId?: string): Promise<void>;
  ownershipChurnDetail: string;
  preserveCommittedOutcomeOnError?: boolean;
};

type ReconcileNodeOutcomeAttempt = {
  outcome?: WorkflowRunControlReconcileOutcome;
  outcomeCommitted: boolean;
};

async function reconcileNodeOutcome(
  backend: WorkflowBackend,
  input: ReconcileNodeOutcomeInput,
): Promise<WorkflowRunControlReconcileOutcome> {
  let outcomeCommitted = false;
  try {
    for (let attempt = 0; attempt < input.maxAttempts; attempt++) {
      const attemptResult = await reconcileNodeOutcomeAttempt(backend, input);
      outcomeCommitted ||= attemptResult.outcomeCommitted;
      if (attemptResult.outcome) return attemptResult.outcome;
    }
  } catch (error) {
    if (outcomeCommitted && input.preserveCommittedOutcomeOnError) {
      markWorkflowRunControlOutcomeMayBeCommitted(error);
    }
    throw error;
  }

  throw ORCHESTRATION_ERROR.create({ detail: input.ownershipChurnDetail });
}

async function reconcileNodeOutcomeAttempt(
  backend: WorkflowBackend,
  input: ReconcileNodeOutcomeInput,
): Promise<ReconcileNodeOutcomeAttempt> {
  const run = await requireActiveReconcileRun(backend, input.runId);
  if (!isActiveReconcileRun(run)) {
    return { outcome: { status: "skipped-terminal", run }, outcomeCommitted: false };
  }
  if (input.isApplicable?.(run) === false) {
    return { outcome: { status: "stale-wait", run }, outcomeCommitted: false };
  }

  const expectedWorkerId = run.workerId;
  const updated = await patchNodeOutcome(backend, input, run, expectedWorkerId);
  if (!updated) {
    return {
      outcome: await skippedTerminalReconcileOutcome(backend, input.runId),
      outcomeCommitted: false,
    };
  }

  try {
    const reconciledRun = await backend.getRun(input.runId);
    const resumed = await resumeReconciledRun(backend, input, expectedWorkerId);
    return {
      outcome: resumed ? { status: "reconciled", run: reconciledRun ?? undefined } : undefined,
      outcomeCommitted: true,
    };
  } catch (error) {
    // The node patch is already durable. Preserve that uncertainty even when
    // the extracted attempt helper throws before it can report the commit to
    // the outer retry loop.
    throw input.preserveCommittedOutcomeOnError
      ? markWorkflowRunControlOutcomeMayBeCommitted(error)
      : error;
  }
}

function isActiveReconcileRun(run: WorkflowRun | null): run is WorkflowRun {
  return run !== null && ACTIVE_RECONCILE_STATUSES.includes(run.status);
}

async function skippedTerminalReconcileOutcome(
  backend: WorkflowBackend,
  runId: string,
): Promise<WorkflowRunControlReconcileOutcome | undefined> {
  const latest = await backend.getRun(runId);
  return isActiveReconcileRun(latest)
    ? undefined
    : { status: "skipped-terminal", run: latest ?? undefined };
}

async function requireActiveReconcileRun(
  backend: WorkflowBackend,
  runId: string,
): Promise<WorkflowRun> {
  const run = await backend.getRun(runId);
  if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
  return run;
}

async function patchNodeOutcome(
  backend: WorkflowBackend,
  input: ReconcileNodeOutcomeInput,
  run: WorkflowRun,
  expectedWorkerId: string | undefined,
): Promise<boolean> {
  try {
    return await updateRunIfStatus(
      backend,
      input.runId,
      ACTIVE_RECONCILE_STATUSES,
      input.buildPatch(run),
      expectedWorkerId,
    );
  } catch (error) {
    // A backend can reject after accepting a write. Treat that boundary as
    // uncertain so callers never restore a durable event over a landed node.
    throw input.preserveCommittedOutcomeOnError
      ? markWorkflowRunControlOutcomeMayBeCommitted(error)
      : error;
  }
}

async function resumeReconciledRun(
  backend: WorkflowBackend,
  input: ReconcileNodeOutcomeInput,
  expectedWorkerId: string | undefined,
): Promise<boolean> {
  if (!input.shouldResume || !input.resume) return true;
  try {
    await input.resume(input.runId, expectedWorkerId);
    return true;
  } catch (error) {
    const latestRun = await backend.getRun(input.runId);
    if (isActiveReconcileRun(latestRun) && latestRun.workerId !== expectedWorkerId) return false;
    throw error;
  }
}

/**
 * Shape one node's outcome for this backend's patch semantics.
 *
 * A single-entry patch is only safe on a backend whose updates merge these
 * maps by key; that is what lets concurrent node outcomes land without
 * clobbering each other. A backend without that declared capability replaces
 * the maps wholesale (the historical third-party contract), so a one-entry
 * patch would silently erase every other node's persisted context and state.
 * Such a backend receives the complete maps built over the freshly read run,
 * which is exactly what its conditional update fences were designed around.
 */
function buildNodeOutcomePatch(
  backend: WorkflowBackend,
  run: WorkflowRun,
  nodeId: string,
  contextEntry: unknown,
  nodeState: NodeState,
): Pick<WorkflowRunUpdate, "context" | "nodeStates"> {
  if (hasRunPatchKeyMergeSupport(backend)) {
    return {
      context: { [nodeId]: contextEntry },
      nodeStates: { [nodeId]: nodeState },
    };
  }
  return {
    context: { ...run.context, [nodeId]: contextEntry },
    nodeStates: { ...run.nodeStates, [nodeId]: nodeState },
  };
}

/** Refuse approval outcomes that a replacement-map backend cannot isolate. */
export async function assertApprovalDecisionPatchIsolation(
  backend: WorkflowBackend,
  runId: string,
  approvalId: string,
): Promise<void> {
  if (hasRunPatchKeyMergeSupport(backend)) return;

  const pending = await backend.getPendingApprovals(runId);
  const claims = await backend.listApprovalDecisionClaims?.(runId) ?? [];
  const hasSiblingOutcome = pending.some((approval) => approval.id !== approvalId) ||
    claims.some(({ approval }) => approval.id !== approvalId);
  if (hasSiblingOutcome) {
    throw NOT_SUPPORTED.create({
      detail: "Concurrent approval outcomes require a workflow backend with key-merge run patches",
    });
  }
}

async function reconcileApprovalDecision(
  backend: WorkflowBackend,
  operation: WorkflowRunControlApprovalDecisionOperation,
): Promise<WorkflowRunControlReconcileOutcome> {
  await assertApprovalDecisionPatchIsolation(backend, operation.runId, operation.approvalId);
  const decidedAt = operation.decidedAt ?? new Date();
  const decisionContext = {
    approved: operation.decision.approved,
    approver: operation.decision.approver,
    ...(operation.decision.comment === undefined ? {} : { comment: operation.decision.comment }),
    ...(operation.decision.data === undefined ? {} : { data: operation.decision.data }),
    decidedAt: decidedAt.toISOString(),
  };

  return await reconcileNodeOutcome(backend, {
    runId: operation.runId,
    maxAttempts: operation.maxAttempts ?? DEFAULT_DECISION_RECONCILIATION_ATTEMPTS,
    shouldResume: operation.decision.approved,
    resume: operation.resume,
    ownershipChurnDetail:
      `Workflow execution ownership kept changing while applying approval "${operation.approvalId}"`,
    buildPatch: (run) => {
      const currentNodeState = run.nodeStates[operation.nodeId];
      const runPatch: WorkflowRunUpdate = buildNodeOutcomePatch(
        backend,
        run,
        operation.nodeId,
        decisionContext,
        {
          ...currentNodeState,
          nodeId: operation.nodeId,
          status: "completed",
          output: {
            approved: operation.decision.approved,
            approver: operation.decision.approver,
            ...(operation.decision.comment === undefined
              ? {}
              : { comment: operation.decision.comment }),
            ...(operation.decision.data === undefined ? {} : { data: operation.decision.data }),
          },
          attempt: currentNodeState?.attempt ?? 1,
          completedAt: decidedAt,
        },
      );

      return operation.decision.approved ? runPatch : {
        ...runPatch,
        status: "failed",
        error: {
          message: `Approval "${operation.approvalId}" was rejected${
            operation.decision.comment ? `: ${operation.decision.comment}` : ""
          }`,
        },
        completedAt: new Date(),
      };
    },
  });
}

function reconcileEventDelivery(
  backend: WorkflowBackend,
  operation: WorkflowRunControlEventDeliveryOperation,
): Promise<WorkflowRunControlReconcileOutcome> {
  if (!hasRunPatchKeyMergeSupport(backend)) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Durable event delivery requires backend key-merge run patches",
    });
  }
  const deliveredAt = operation.deliveredAt ?? new Date();
  const outcome = operation.waitKind === "delay" ? { delayed: true } : {
    eventName: operation.eventName,
    ...(operation.payload === undefined ? {} : { payload: operation.payload }),
  };

  return reconcileNodeOutcome(backend, {
    runId: operation.runId,
    maxAttempts: operation.maxAttempts ?? DEFAULT_DECISION_RECONCILIATION_ATTEMPTS,
    shouldResume: true,
    preserveCommittedOutcomeOnError: true,
    resume: operation.resume,
    ownershipChurnDetail:
      `Workflow execution ownership kept changing while delivering event wait "${operation.waitId}"`,
    isApplicable: (run) => {
      // Records written before wait-instance identities existed retain the
      // legacy node-id-only reconciliation behavior.
      if (operation.waitInstanceId === undefined) return true;
      const state = run.nodeStates[operation.nodeId];
      return state !== undefined && state.status !== "completed" && isSameWaitNodeExecution({
        nodeId: operation.nodeId,
        waitInstanceId: operation.waitInstanceId,
      }, {
        nodeId: operation.nodeId,
        waitInstanceId: state._waitInstanceId,
      });
    },
    buildPatch: (run) => {
      const currentNodeState = run.nodeStates[operation.nodeId];
      return buildNodeOutcomePatch(
        backend,
        run,
        operation.nodeId,
        { ...outcome, receivedAt: deliveredAt.toISOString() },
        {
          ...currentNodeState,
          nodeId: operation.nodeId,
          status: "completed",
          output: outcome,
          error: undefined,
          attempt: currentNodeState?.attempt ?? 1,
          completedAt: deliveredAt,
        },
      );
    },
  });
}

async function reconcileHydrateEnv(
  backend: WorkflowBackend,
  operation: WorkflowRunControlHydrateEnvOperation,
): Promise<WorkflowRunControlReconcileOutcome> {
  const run = operation.run;
  const currentSerialized = run.context.env ? JSON.stringify(run.context.env) : "";
  const nextSerialized = JSON.stringify(operation.env);
  if (currentSerialized === nextSerialized) {
    return { status: "unchanged", run };
  }

  const updated = await updateRunIfStatus(
    backend,
    run.id,
    [run.status],
    {
      context: {
        ...run.context,
        env: operation.env,
      },
    },
    operation.expectedWorkerId,
  );
  const latest = await backend.getRun(run.id);
  if (updated) return { status: "reconciled", run: latest ?? undefined };
  if (!latest) return { status: "skipped-terminal" };
  if (!ACTIVE_RECONCILE_STATUSES.includes(latest.status)) {
    return { status: "skipped-terminal", run: latest };
  }
  if (
    operation.expectedWorkerId !== undefined &&
    latest.workerId !== operation.expectedWorkerId
  ) {
    return { status: "stale-owner", run: latest };
  }
  return { status: "ownership-changing", run: latest };
}

async function reconcileExecutionFailure(
  backend: WorkflowBackend,
  operation: WorkflowRunControlFailExecutionOperation,
): Promise<WorkflowRunControlReconcileOutcome> {
  const error = operation.error;
  const updated = await updateRunIfStatus(
    backend,
    operation.runId,
    ["pending", "running"],
    {
      status: "failed",
      error: {
        message: `EXECUTION_ERROR: ${error instanceof Error ? error.message : String(error)}`,
        stack: error instanceof Error ? error.stack : undefined,
      },
      completedAt: new Date(),
    },
    operation.expectedWorkerId,
  );
  const latest = await backend.getRun(operation.runId);
  if (updated) return { status: "reconciled", run: latest ?? undefined };
  if (!latest || !ACTIVE_RECONCILE_STATUSES.includes(latest.status)) {
    return { status: "skipped-terminal", run: latest ?? undefined };
  }
  if (
    operation.expectedWorkerId !== undefined &&
    latest.workerId !== operation.expectedWorkerId
  ) {
    return { status: "stale-owner", run: latest };
  }
  return { status: "ownership-changing", run: latest };
}

async function failClaim(
  input: WorkflowRunControlClaimInput,
  run: WorkflowRun,
  claimPhase: ClaimPhase,
  error?: Error,
  managerClaimWorkerId?: string,
): Promise<WorkflowRunControlClaimOutcome> {
  const message = `RUN_EXECUTION_CREATION_FAILED: Failed to create run execution: ${
    error?.message ?? "run ownership changed before execution creation"
  }`;
  const failure = {
    status: "failed" as const,
    error: { message },
    completedAt: new Date(),
  };

  if (claimPhase.kind !== "before-execution-owner") {
    const updated = await updateRunIfStatus(
      input.backend,
      run.id,
      ["pending", "waiting", "running"],
      failure,
      claimPhase.workerId,
    );
    if (updated) return { status: "failed-after-claim", error };

    const latest = await input.backend.getRun(run.id);
    if (
      !latest ||
      !ACTIVE_RECONCILE_STATUSES.includes(latest.status) ||
      (latest.workerId !== undefined && latest.workerId !== managerClaimWorkerId)
    ) {
      return { status: "failed-after-claim", error };
    }
  }

  if (claimPhase.kind === "execution-owner-assigned") {
    return { status: "failed-after-claim", error };
  }

  await updateRunIfStatus(
    input.backend,
    run.id,
    ["pending", "waiting", "running"],
    failure,
    managerClaimWorkerId,
  );
  return { status: "failed-before-claim", error };
}

export async function executeWorkflowRunControl(
  input: WorkflowRunControlExecuteInput,
): Promise<WorkflowRunControlExecuteOutcome> {
  const {
    backend,
    run,
    expectedWorkerId,
    lockDuration,
    heartbeatInterval,
  } = input;
  const runId = run.id;
  const useLocking = input.enableLocking !== false && hasLockSupport(backend);
  const ownership: CheckpointOwnership | undefined = expectedWorkerId === undefined
    ? undefined
    : { runId, workerId: expectedWorkerId };
  let heartbeatIntervalId: ReturnType<typeof setInterval> | undefined;
  let heartbeatPromise: Promise<void> | undefined;
  let lockLostError: Error | undefined;
  let ownershipLostError: Error | undefined;
  let lockToken: string | null = null;
  let pausedForWaiting = false;

  if (useLocking) {
    lockToken = await backend.acquireLock!(runId, lockDuration);
    if (!lockToken) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot execute workflow run "${runId}": another worker is already executing it. ` +
          `This can happen when multiple workers try to execute the same run concurrently.`,
      });
    }
    logger.debug("Acquired lock for run", { runId });
  }

  const executionController = new AbortController();
  input.registerController?.(runId, executionController);

  try {
    const currentRun = await backend.getRun(runId);
    if (
      currentRun?.status === "cancelled" || executionController.signal.aborted ||
      !input.isCurrentExecution(runId, executionController)
    ) {
      return {
        status: currentRun?.status === "cancelled" ? "cancelled" : "skipped",
        run: currentRun ?? undefined,
      };
    }

    const now = new Date();
    // This is the one write per execution that is already fenced and already
    // inside the run's span, so the run's trace identity rides along with it
    // rather than costing a round trip of its own. A later execution reads it
    // back and links to it; nothing else in the framework consumes it, so a
    // process with no tracer simply leaves the field alone.
    const traceContext = getActiveTraceparent();
    const activated = await updateRunIfStatus(
      backend,
      runId,
      ["pending", "waiting", "running"],
      {
        status: "running",
        startedAt: run.startedAt || now,
        heartbeatAt: now,
        ...(traceContext ? { _traceContext: traceContext } : {}),
      },
      expectedWorkerId,
    );
    if (!activated) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Cannot execute workflow run because execution ownership or status changed",
      });
    }

    heartbeatIntervalId = setInterval(() => {
      if (heartbeatPromise) return;

      heartbeatPromise = (async () => {
        if (
          executionController.signal.aborted ||
          !input.isCurrentExecution(runId, executionController)
        ) return;

        if (useLocking && typeof backend.extendLock === "function") {
          let extended: boolean;
          try {
            extended = await backend.extendLock(runId, lockDuration, lockToken ?? undefined);
          } catch (error) {
            if (!lockLostError) {
              lockLostError = ORCHESTRATION_ERROR.create({
                detail: `Could not renew lock for run "${runId}"; aborting to avoid ` +
                  `concurrent execution by another worker.`,
                cause: error instanceof Error ? error : undefined,
              });
              logger.error("Could not renew workflow lock; aborting run", { runId }, error);
              if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
              executionController.abort(lockLostError);
            }
            return;
          }

          if (!extended && !lockLostError) {
            lockLostError = ORCHESTRATION_ERROR.create({
              detail: `Lost lock for run "${runId}" during heartbeat; aborting to avoid ` +
                `concurrent execution by another worker.`,
            });
            logger.error("Lost workflow lock; aborting run", { runId });
            if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
            executionController.abort(lockLostError);
            return;
          }
        }

        if (
          executionController.signal.aborted ||
          !input.isCurrentExecution(runId, executionController)
        ) return;

        try {
          if (expectedWorkerId === undefined) {
            await backend.updateRun(runId, { heartbeatAt: new Date() });
          } else {
            const updated = await updateRunIfStatus(
              backend,
              runId,
              ["running", "waiting"],
              { heartbeatAt: new Date() },
              expectedWorkerId,
            );
            if (!updated) {
              ownershipLostError = ORCHESTRATION_ERROR.create({
                detail: `Lost execution ownership for run "${runId}" during heartbeat`,
              });
              if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
              executionController.abort(ownershipLostError);
            }
          }
        } catch (error) {
          if (expectedWorkerId !== undefined && !ownershipLostError) {
            ownershipLostError = ORCHESTRATION_ERROR.create({
              detail: `Could not verify execution ownership for run "${runId}" during heartbeat`,
              cause: error instanceof Error ? error : undefined,
            });
            logger.error("Could not verify workflow ownership; aborting run", { runId }, error);
            if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
            executionController.abort(ownershipLostError);
          } else {
            logger.warn("Heartbeat update failed", { runId }, error);
          }
        } finally {
          heartbeatPromise = undefined;
        }
      })();
    }, heartbeatInterval);

    const updatedRun = await backend.getRun(runId);
    if (updatedRun) await input.onStart?.(updatedRun);

    const result = await input.execute({
      run,
      controller: executionController,
      signal: executionController.signal,
      ownership,
    });

    if (executionController.signal.aborted) {
      await input.waitForCancellationUpdate(runId);
      const latestRun = await backend.getRun(runId);
      if (latestRun?.status === "cancelled") return { status: "cancelled", run: latestRun };
      executionController.signal.throwIfAborted();
    }

    if (result.completed) {
      const finalRun = await completeRun(input, executionController, result);
      if (!finalRun) return { status: "ownership-lost" };
      if (finalRun.status === "cancelled") return { status: "cancelled", run: finalRun };
      await input.onComplete?.(finalRun);
      return { status: "completed", run: finalRun };
    }

    if (result.waiting) {
      // Every wait the settled batch parked, not just the first: each needs
      // its own durable record or the others park with nothing to wake them.
      const waitingNodes = result.waitingNodes && result.waitingNodes.length > 0
        ? result.waitingNodes
        : [{ nodeId: result.waitingNode!, waitConfig: result.waitingConfig }];

      const paused = await pauseRun(input, executionController, result, {
        currentNodes: waitingNodes.map((waiting) => waiting.nodeId),
        // The DAG persisted this settled batch before returning. Restrict the
        // final park to status/currentNodes so a sibling delivered between the
        // DAG write and this transition cannot be reverted by this snapshot.
        statusOnly: true,
      });
      if (!paused) return { status: "ownership-lost" };
      pausedForWaiting = true;

      const pausedRun = await backend.getRun(runId);
      if (
        pausedRun?.status !== "waiting" ||
        executionController.signal.aborted ||
        !input.isCurrentExecution(runId, executionController) ||
        (expectedWorkerId !== undefined && pausedRun.workerId !== expectedWorkerId)
      ) {
        return {
          status: pausedRun?.status === "cancelled" ? "cancelled" : "skipped",
          run: pausedRun ?? undefined,
        };
      }
      const announcedWaits: Array<{ nodeId: string; waitConfig?: WaitNodeConfig }> = [];
      for (const waiting of waitingNodes) {
        // A composite can rediscover a sibling that remained parked while a
        // different wait in the same child graph was resolved. Its durable
        // record is still live, so announcing it again would create a second
        // approval or event wait for the same node.
        if (
          await hasLiveNodeWait(
            backend,
            runId,
            waiting.nodeId,
            pausedRun.nodeStates[waiting.nodeId]?._waitInstanceId,
          )
        ) continue;
        await input.onWaitingPersist?.(pausedRun, waiting.nodeId, waiting.waitConfig);
        announcedWaits.push(waiting);
      }
      // Keep the execution lock until every wait in the settled batch has a
      // durable record. A publisher may reconcile the first visible wait as
      // soon as it is appended; releasing earlier lets that resume race the
      // owner-fenced append of a later sibling. The batch-complete hook may
      // drain mail and resume the run, so it deliberately runs after release.
      await releaseWaitingLock();
      const releasedRun = await backend.getRun(runId);
      if (
        releasedRun?.status !== "waiting" ||
        executionController.signal.aborted ||
        !input.isCurrentExecution(runId, executionController) ||
        (expectedWorkerId !== undefined && releasedRun.workerId !== expectedWorkerId)
      ) {
        return {
          status: releasedRun?.status === "cancelled" ? "cancelled" : "skipped",
          run: releasedRun ?? undefined,
        };
      }
      for (const waiting of announcedWaits) {
        await input.onWaiting?.(releasedRun, waiting.nodeId, waiting.waitConfig);
      }
      await input.onWaitingBatchComplete?.(releasedRun);
      return { status: "waiting", run: releasedRun };
    }

    // A graph that found nothing to schedule behind a parked wait is not
    // stalled while that wait's durable record is still live: the decision or
    // event can still arrive. Failing here would let a resume that simply came
    // too early destroy a healthy run, which is the only nudge callers have.
    if (result.stalledWaitNode !== undefined) {
      const stalledWaitNodes = result.stalledWaitNodes && result.stalledWaitNodes.length > 0
        ? result.stalledWaitNodes
        : [{ nodeId: result.stalledWaitNode, waitConfig: result.waitingConfig }];
      const stalledWaitNode = stalledWaitNodes[0]!.nodeId;
      const stillParked: WorkflowRunControlExecuteResult = {
        ...result,
        waiting: true,
        waitingNode: stalledWaitNode,
        waitingConfig: stalledWaitNodes[0]!.waitConfig,
        waitingNodes: stalledWaitNodes,
        error: undefined,
      };
      // Park with a status-only patch. The durable node states were persisted
      // when the run first parked; rewriting them from this re-execution's
      // stale copy would overwrite a delivery or approval decision that landed
      // between the durable-record check below and this write, leaving the run
      // waiting on a node whose outcome was just destroyed.
      const paused = await pauseRun(input, executionController, stillParked, {
        currentNodes: stalledWaitNodes.map((waiting) => waiting.nodeId),
        statusOnly: true,
      });
      if (!paused) return { status: "ownership-lost" };
      pausedForWaiting = true;

      const pausedRun = await backend.getRun(runId);
      if (
        !pausedRun || pausedRun.status !== "waiting" ||
        executionController.signal.aborted ||
        !input.isCurrentExecution(runId, executionController) ||
        (expectedWorkerId !== undefined && pausedRun.workerId !== expectedWorkerId)
      ) {
        return {
          status: pausedRun?.status === "cancelled" ? "cancelled" : "skipped",
          run: pausedRun ?? undefined,
        };
      }

      // No live record, but the node may not be stuck: a worker that died
      // between committing the parked status and persisting the record, or
      // between resolving a record and completing its node, leaves exactly
      // this shape. If its outcome already landed, the run moved on and there
      // is nothing to do; otherwise re-announce every missing wait from the
      // exact runtime config retained by the DAG. A live first sibling must
      // not hide a later sibling whose process died before persisting it.
      const announcedWaits: Array<{ nodeId: string; waitConfig?: WaitNodeConfig }> = [];
      const liveWaitingNodes: Array<{ nodeId: string; waitConfig?: WaitNodeConfig }> = [];
      for (const waiting of stalledWaitNodes) {
        if (
          await hasLiveNodeWait(
            backend,
            runId,
            waiting.nodeId,
            pausedRun.nodeStates[waiting.nodeId]?._waitInstanceId,
          )
        ) {
          liveWaitingNodes.push(waiting);
          continue;
        }
        if (pausedRun.nodeStates[waiting.nodeId]?.status !== "running") continue;
        await input.onWaitingPersist?.(pausedRun, waiting.nodeId, waiting.waitConfig);
        announcedWaits.push(waiting);
      }
      await releaseWaitingLock();
      const releasedRun = await backend.getRun(runId);
      if (
        releasedRun?.status !== "waiting" ||
        executionController.signal.aborted ||
        !input.isCurrentExecution(runId, executionController) ||
        (expectedWorkerId !== undefined && releasedRun.workerId !== expectedWorkerId)
      ) {
        return {
          status: releasedRun?.status === "cancelled" ? "cancelled" : "skipped",
          run: releasedRun ?? undefined,
        };
      }
      for (const waiting of liveWaitingNodes) {
        await input.onLiveWaiting?.(releasedRun, waiting.nodeId, waiting.waitConfig);
      }
      for (const waiting of announcedWaits) {
        await input.onWaiting?.(releasedRun, waiting.nodeId, waiting.waitConfig);
      }
      // A live event wait may already have buffered mail whose publisher died
      // before draining it. Run the batch-complete hook even when no wait had
      // to be reconstructed so a resume can consume that durable envelope.
      await input.onWaitingBatchComplete?.(releasedRun);

      const latestRun = await backend.getRun(runId);
      if (!latestRun) return { status: "skipped" };
      if (latestRun.status !== "waiting") return { status: "waiting", run: latestRun };

      let missingWaitRemains = false;
      for (const waiting of stalledWaitNodes) {
        const nodeStatus = latestRun.nodeStates[waiting.nodeId]?.status;
        if (
          await hasLiveNodeWait(
            backend,
            runId,
            waiting.nodeId,
            latestRun.nodeStates[waiting.nodeId]?._waitInstanceId,
          )
        ) continue;
        if (nodeStatus === "completed") continue;
        missingWaitRemains = true;
        break;
      }
      if (!missingWaitRemains) return { status: "waiting", run: latestRun };

      // Nothing durable could be re-established: the graph really is stuck.
      const stalledError = ORCHESTRATION_ERROR.create({
        detail: result.error || "Unknown error",
      });
      const failedStalled = await failRun(
        input,
        executionController,
        stalledError,
        result,
        ["waiting"],
      );
      if (!failedStalled) return { status: "ownership-lost" };
      await input.onError?.(run, stalledError, result.context);
      return { status: "failed" };
    }

    const error = ORCHESTRATION_ERROR.create({ detail: result.error || "Unknown error" });
    const failed = await failRun(input, executionController, error, result, ["running"]);
    if (!failed) return { status: "ownership-lost" };
    await input.onError?.(run, error, result.context);
    return { status: "failed" };
  } catch (error) {
    const normalizedError = ensureError(error);

    if (lockLostError) {
      logger.warn("Aborted run after losing lock; leaving status for new owner", { runId });
      throw lockLostError;
    }
    if (ownershipLostError) {
      logger.warn("Aborted run after losing execution ownership", { runId });
      throw ownershipLostError;
    }

    await input.waitForCancellationUpdate(runId);
    const latestRun = await backend.getRun(runId);
    if (latestRun?.status === "cancelled") return { status: "cancelled", run: latestRun };
    const failureContext = latestRun?.context ?? run.context;
    const failureNodeStates = latestRun?.nodeStates ?? run.nodeStates;

    const failed = await failRun(
      input,
      executionController,
      normalizedError,
      {
        context: failureContext,
        nodeStates: failureNodeStates,
      },
      pausedForWaiting ? ["waiting"] : ["running"],
    );
    if (!failed) return { status: "ownership-lost" };

    await input.onError?.(latestRun ?? run, normalizedError, failureContext);
    throw normalizedError;
  } finally {
    if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
    if (heartbeatPromise) {
      if (executionController.signal.aborted) {
        await input.waitForCancellationGrace(heartbeatPromise);
      } else {
        await heartbeatPromise;
      }
    }

    input.clearController?.(runId, executionController);

    if (useLocking && !lockLostError && lockToken) {
      await backend.releaseLock!(runId, lockToken);
      logger.debug("Released lock for run", { runId });
    }
  }

  async function releaseWaitingLock(): Promise<void> {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = undefined;
    }
    if (heartbeatPromise) {
      await heartbeatPromise;
      heartbeatPromise = undefined;
    }
    if (executionController.signal.aborted) executionController.signal.throwIfAborted();
    if (useLocking && lockToken) {
      await backend.releaseLock!(runId, lockToken);
      lockToken = null;
      logger.debug("Released lock for waiting run", { runId });
    }
  }
}

async function completeRun(
  input: WorkflowRunControlExecuteInput,
  executionController: AbortController,
  result: WorkflowRunControlExecuteResult,
): Promise<WorkflowRun | null> {
  const { backend, run, expectedWorkerId } = input;
  await input.waitForCancellationUpdate(run.id);
  const currentRun = await backend.getRun(run.id);
  if (!currentRun) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${run.id}` });
  if (currentRun.status === "cancelled") return currentRun;
  if (
    executionController.signal.aborted ||
    !input.isCurrentExecution(run.id, executionController)
  ) return null;

  const publicContext = toPersistedWorkflowContext(result.context);
  const output = determineOutput(publicContext);
  const completed = await updateRunIfStatus(
    backend,
    run.id,
    ["running"],
    {
      status: "completed",
      output,
      context: publicContext,
      nodeStates: result.nodeStates,
      // A run that resumes past its final wait reaches here with the wait
      // still named from when it parked; nothing is current once it completes.
      currentNodes: [],
      error: undefined,
      completedAt: new Date(),
    },
    expectedWorkerId,
  );
  if (!completed) return null;

  return (await backend.getRun(run.id))!;
}

async function failRun(
  input: WorkflowRunControlExecuteInput,
  executionController: AbortController,
  error: Error,
  result: Pick<WorkflowRunControlExecuteResult, "context" | "nodeStates">,
  expectedStatuses: WorkflowRun["status"][],
): Promise<boolean> {
  const { backend, run, expectedWorkerId } = input;
  await input.waitForCancellationUpdate(run.id);
  const currentRun = await backend.getRun(run.id);
  if (currentRun?.status === "cancelled") return false;
  if (!input.isCurrentExecution(run.id, executionController)) return false;

  const publicContext = toPersistedWorkflowContext(result.context);
  return await updateRunIfStatus(
    backend,
    run.id,
    expectedStatuses,
    {
      status: "failed",
      context: publicContext,
      nodeStates: result.nodeStates,
      error: {
        message: error.message,
        stack: error.stack,
      },
      completedAt: new Date(),
    },
    expectedWorkerId,
  );
}

/**
 * Whether a durable record still exists for what this node is parked on.
 *
 * This is the fact that separates a parked run from a stuck one, and it lives
 * only in the backend. A node whose approval was decided, or whose event wait
 * was delivered or expired, has no live record and the graph really is stuck.
 */
async function hasLiveNodeWait(
  backend: WorkflowBackend,
  runId: string,
  nodeId: string,
  waitInstanceId?: string,
): Promise<boolean> {
  try {
    const expected = { nodeId, waitInstanceId };
    const approvals = await backend.getPendingApprovals(runId);
    if (approvals.some((approval) => isSameWaitNodeExecution(approval, expected))) return true;
    const approvalClaims = await backend.listApprovalDecisionClaims?.(runId) ?? [];
    if (
      approvalClaims.some(({ approval }) => isSameWaitNodeExecution(approval, expected))
    ) return true;
    if (!hasEventWaitSupport(backend)) return false;
    const waits = await backend.getPendingEventWaits(runId);
    if (waits.some((wait) => isSameWaitNodeExecution(wait, expected))) return true;
    const deliveryClaims = await backend.listRunEventDeliveryClaims(runId);
    if (
      deliveryClaims.some((claim) => isSameWaitNodeExecution(claim.wait, expected))
    ) return true;
    const timedClaims = await backend.listTimedEventWaitClaims(runId);
    return timedClaims.some((wait) => isSameWaitNodeExecution(wait, expected));
  } catch (error) {
    logger.warn(
      "Could not read durable wait records; re-announcing the wait",
      { runId, nodeId, error: ensureError(error).message },
    );
    return false;
  }
}

async function pauseRun(
  input: WorkflowRunControlExecuteInput,
  executionController: AbortController,
  result: WorkflowRunControlExecuteResult,
  options?: {
    /** Top-level nodes the paused run is parked on; defaults to the waiting node. */
    currentNodes?: string[];
    /**
     * Write only the status transition, keeping the persisted context and node
     * states. A re-park of an already-parked run has nothing new to record,
     * and rewriting durable state from a re-execution's copy would clobber a
     * concurrently delivered outcome.
     */
    statusOnly?: boolean;
  },
): Promise<boolean> {
  const { backend, run, expectedWorkerId } = input;
  await input.waitForCancellationUpdate(run.id);
  const currentRun = await backend.getRun(run.id);
  if (currentRun?.status === "cancelled") return false;
  if (
    executionController.signal.aborted ||
    !input.isCurrentExecution(run.id, executionController)
  ) return false;

  const publicContext = toPersistedWorkflowContext(result.context);
  return await updateRunIfStatus(
    backend,
    run.id,
    ["running"],
    {
      status: "waiting",
      currentNodes: options?.currentNodes ?? [result.waitingNode!],
      ...(options?.statusOnly ? {} : {
        context: publicContext,
        nodeStates: result.nodeStates,
      }),
    },
    expectedWorkerId,
  );
}

/** Remove request-only tenant authority before persisting workflow context. */
export function toPersistedWorkflowContext(context: WorkflowContext): WorkflowContext {
  const { _tenant: _tenant, ...publicContext } = context;
  return publicContext;
}

function determineOutput(context: WorkflowContext): unknown {
  const { input: _input, _tenant: _tenant, ...rest } = context;
  return rest;
}
