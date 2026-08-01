import { logger as baseLogger } from "#veryfront/utils";
import { ensureError, ORCHESTRATION_ERROR, RESOURCE_NOT_FOUND } from "#veryfront/errors";
import {
  hasLockSupport,
  hasWorkerSupport,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import { toDefaultWorkflowOutput } from "./public-run.ts";
import type { CheckpointOwnership } from "../executor/checkpoint-manager.ts";
import type { ApprovalDecision, NodeState, WorkflowContext, WorkflowRun } from "../types.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import type { RunExecutionConfig } from "../worker/executors/types.ts";
import type { WorkflowProjectionState } from "../runtime-state.ts";

const logger = baseLogger.component("workflow-run-control");

export interface WorkflowRunControlExecuteResult {
  completed?: boolean;
  waiting?: boolean;
  waitingNode?: string;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  error?: string;
  _workflowProjection?: WorkflowProjectionState;
}

export interface WorkflowRunControlExecutionFence {
  /** Immutable durable owner admitted for this exact execution. */
  readonly expectedWorkerId?: string;
  /** Immutable acquired or adopted lease token for this exact execution. */
  readonly lockId?: string;
}

export interface WorkflowRunControlExecuteInput {
  backend: WorkflowBackend;
  run: WorkflowRun;
  expectedWorkerId?: string;
  /** Opaque live lease already acquired by this execution and adopted here. */
  existingLockId?: string;
  enableLocking?: boolean;
  lockDuration: number;
  heartbeatInterval: number;
  waitForCancellationUpdate(runId: string): Promise<void>;
  waitForCancellationGrace(operation: Promise<unknown>): Promise<void>;
  registerController?(
    runId: string,
    controller: AbortController,
    fence: WorkflowRunControlExecutionFence,
  ): void;
  clearController?(runId: string, controller: AbortController): void;
  isCurrentExecution(runId: string, controller: AbortController): boolean;
  execute(input: {
    run: WorkflowRun;
    controller: AbortController;
    signal: AbortSignal;
    ownership?: CheckpointOwnership;
  }): Promise<WorkflowRunControlExecuteResult>;
  /** Validate or transform output before the durable completed transition. */
  prepareOutput?(output: unknown): unknown;
  onStart?(run: WorkflowRun): void | Promise<void>;
  onComplete?(run: WorkflowRun): void | Promise<void>;
  onError?(
    run: WorkflowRun,
    error: Error,
    context: WorkflowContext,
  ): void | Promise<void>;
  /**
   * Synchronous fail-closed admission before a resumable waiting state is
   * persisted. Throwing keeps the run under its current running lease so the
   * normal failure path can transition it directly to a terminal state.
   */
  beforeWaiting?(run: WorkflowRun, nodeId: string): void;
  onWaiting?(run: WorkflowRun, nodeId: string): void | Promise<void>;
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
  lockRetryInterval: number;
  executionTimeout: number;
  env: Record<string, string>;
  debug: boolean;
  /** Synchronous lifecycle fence checked before isolated-execution admission. */
  isAdmissionOpen(): boolean;
  createRunExecution(config: RunExecutionConfig): Promise<string>;
  deleteRunExecution(executionId: string): Promise<void>;
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
    | "skipped-claim-lost"
    | "skipped-admission-closed"
    | "failed-before-claim"
    | "failed-after-claim";
  execution?: WorkflowRunControlClaimCreatedExecution;
  /** Exact attempted owner retained when child teardown or claim compensation is incomplete. */
  teardownCandidate?: Pick<WorkflowRunControlClaimCreatedExecution, "executionId" | "runId">;
  error?: Error;
}

function claimCleanupError(
  detail: string,
  primaryError: Error,
  cleanupError: unknown,
): Error {
  return ORCHESTRATION_ERROR.create({
    detail,
    cause: new AggregateError(
      [primaryError, ensureError(cleanupError)],
      "Workflow run claim failed and cleanup also failed",
    ),
  });
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

export interface WorkflowRunControlHydrateEnvOperation {
  type: "hydrate-env";
  run: WorkflowRun;
  env: Record<string, string>;
  expectedWorkerId?: string;
  expectedLockId?: string;
}

export interface WorkflowRunControlFailExecutionOperation {
  type: "fail-execution";
  runId: string;
  error: unknown;
  expectedWorkerId?: string;
  expectedLockId?: string;
}

export interface WorkflowRunControlReconcileInput {
  backend: WorkflowBackend;
  operation:
    | WorkflowRunControlApprovalDecisionOperation
    | WorkflowRunControlHydrateEnvOperation
    | WorkflowRunControlFailExecutionOperation;
}

export interface WorkflowRunControlReconcileOutcome {
  status:
    | "reconciled"
    | "unchanged"
    | "skipped-terminal"
    | "stale-owner"
    | "ownership-changing";
  run?: WorkflowRun;
}

const DEFAULT_DECISION_RECONCILIATION_ATTEMPTS = 8;
const ACTIVE_RECONCILE_STATUSES: WorkflowRun["status"][] = ["pending", "running", "waiting"];

function parseLockAcquisitionResult(value: unknown, runId: string): string | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw ORCHESTRATION_ERROR.create({
    detail: `Workflow backend returned an invalid lock token for run "${runId}"`,
  });
}

function parseLockMutationResult(
  value: unknown,
  operation: "renew" | "release",
  runId: string,
): boolean {
  if (typeof value === "boolean") return value;
  throw ORCHESTRATION_ERROR.create({
    detail: `Workflow backend returned a non-boolean lock ${operation} result for run "${runId}"`,
  });
}

async function notifyTerminalObserver(
  kind: "completion" | "failure",
  runId: string,
  observer: (() => void | Promise<void>) | undefined,
): Promise<void> {
  if (!observer) return;
  try {
    await observer();
  } catch (error) {
    // Terminal state is already durable at this point. Observer failures must
    // neither rewrite that state nor replace the execution error that caused a
    // failed run, but they must remain visible to operators.
    logger.error(`Workflow ${kind} observer failed after terminal persistence`, { runId }, error);
  }
}

export async function reconcileWorkflowRunControl(
  input: WorkflowRunControlReconcileInput,
): Promise<WorkflowRunControlReconcileOutcome> {
  switch (input.operation.type) {
    case "approval-decision":
      return await reconcileApprovalDecision(input.backend, input.operation);
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
    lockRetryInterval,
    executionTimeout,
    env,
    debug,
  } = input;
  const runId = run.id;
  const workerId = `run-execution:${executionId}`;
  let pendingLockToken: string | null = null;
  let runToProcess: WorkflowRun | null = run;
  let stalledClaimed = false;
  let claimed = false;
  let claimHeartbeatIntervalId: ReturnType<typeof setInterval> | undefined;
  let claimHeartbeatPromise: Promise<void> | undefined;
  let claimHeartbeatError: Error | undefined;

  const stopClaimHeartbeat = async (): Promise<void> => {
    if (claimHeartbeatIntervalId) {
      clearInterval(claimHeartbeatIntervalId);
      claimHeartbeatIntervalId = undefined;
    }
    if (claimHeartbeatPromise) {
      await claimHeartbeatPromise;
      claimHeartbeatPromise = undefined;
    }
  };

  const startClaimHeartbeat = (): void => {
    if (!pendingLockToken || !hasLockSupport(backend)) return;
    const interval = Math.max(1, Math.floor(stalledThreshold / 3));
    claimHeartbeatIntervalId = setInterval(() => {
      if (claimHeartbeatPromise || claimHeartbeatError || !pendingLockToken) return;
      const token = pendingLockToken;
      claimHeartbeatPromise = (async () => {
        try {
          const extended = parseLockMutationResult(
            await backend.extendLock(runId, stalledThreshold, token),
            "renew",
            runId,
          );
          if (!extended) {
            throw ORCHESTRATION_ERROR.create({
              detail: `Lost pending claim lock for workflow run "${runId}"`,
            });
          }
          const updated = await updateRunIfStatus(
            backend,
            runId,
            ["running"],
            { heartbeatAt: new Date() },
            workerId,
            token,
          );
          if (!updated) {
            throw ORCHESTRATION_ERROR.create({
              detail: `Lost pending claim ownership for workflow run "${runId}"`,
            });
          }
        } catch (error) {
          claimHeartbeatError = ensureError(error);
          if (claimHeartbeatIntervalId) {
            clearInterval(claimHeartbeatIntervalId);
            claimHeartbeatIntervalId = undefined;
          }
        } finally {
          claimHeartbeatPromise = undefined;
        }
      })();
    }, interval);
  };

  const rollbackClosedAdmission = async (): Promise<WorkflowRunControlClaimOutcome> => {
    if (!claimed && !stalledClaimed) return { status: "skipped-admission-closed" };

    const expectedWorkerId = claimed ? workerId : `mgr:${managerId}`;
    const expectedLockId = claimed ? pendingLockToken ?? undefined : undefined;
    let rolledBack = await updateRunIfStatus(
      backend,
      runId,
      ["running"],
      { status: "pending" },
      expectedWorkerId,
      expectedLockId,
    );
    if (rolledBack && expectedLockId) {
      // A lock-fenced transition away from running consumes the claim lease.
      pendingLockToken = null;
    }

    if (!rolledBack && expectedLockId) {
      // No child has been invoked yet, so the unique durable worker identity is
      // sufficient to requeue an expired manager lease without touching a
      // replacement owner. The finally block still attempts exact-token cleanup.
      rolledBack = await updateRunIfStatus(
        backend,
        runId,
        ["running"],
        { status: "pending" },
        expectedWorkerId,
      );
    }

    if (rolledBack) return { status: "skipped-admission-closed" };

    const latest = await backend.getRun(runId);
    if (latest?.status !== "running" || latest.workerId !== expectedWorkerId) {
      return { status: "skipped-admission-closed" };
    }
    return {
      status: "skipped-claim-lost",
      error: ORCHESTRATION_ERROR.create({
        detail: `Could not requeue workflow run "${runId}" after execution admission closed`,
      }),
    };
  };

  try {
    if (!input.isAdmissionOpen()) return { status: "skipped-admission-closed" };

    if (run.status === "running") {
      if (!hasWorkerSupport(backend)) return { status: "skipped-stalled-claim-lost" };
      stalledClaimed = await backend.claimStalledRun(
        runId,
        `mgr:${managerId}`,
        stalledThreshold,
      );
      if (!stalledClaimed) return { status: "skipped-stalled-claim-lost" };
      if (!input.isAdmissionOpen()) return await rollbackClosedAdmission();
    }

    if (run.status === "pending" && hasLockSupport(backend)) {
      pendingLockToken = parseLockAcquisitionResult(
        await backend.acquireLock(runId, stalledThreshold),
        runId,
      );
      if (!pendingLockToken) return { status: "skipped-lock-held" };
      if (!input.isAdmissionOpen()) return { status: "skipped-admission-closed" };

      const latest = await backend.getRun(runId);
      if (!input.isAdmissionOpen()) return { status: "skipped-admission-closed" };
      if (!latest || latest.status !== "pending") {
        return { status: "skipped-status-changed" };
      }
      runToProcess = latest;
    }

    if (!runToProcess || !["pending", "waiting", "running"].includes(runToProcess.status)) {
      return { status: "skipped-status-changed" };
    }

    requireWorkflowSourceIntegrationPolicy(runToProcess);
    if (!input.isAdmissionOpen()) return await rollbackClosedAdmission();

    const now = new Date();
    const expectedWorkerId = run.status === "running" ? `mgr:${managerId}` : undefined;
    claimed = await updateRunIfStatus(
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
      pendingLockToken ?? undefined,
    );
    if (!claimed) {
      return {
        status: run.status === "running" ? "skipped-stalled-claim-lost" : "skipped-status-changed",
      };
    }
    if (!input.isAdmissionOpen()) return await rollbackClosedAdmission();

    const claimedRun: WorkflowRun = {
      ...runToProcess,
      status: "running",
      startedAt: now,
      heartbeatAt: now,
      workerId,
    };

    const executionConfig: RunExecutionConfig = {
      executionId,
      run: claimedRun,
      managerId,
      timeout: executionTimeout,
      env,
      debug,
      lockAcquisition: {
        duration: stalledThreshold,
        timeout: stalledThreshold,
        retryInterval: lockRetryInterval,
      },
    };

    // No await may occur between this final fence and invoking the executor:
    // the synchronous callback invocation is the admission linearization point.
    if (!input.isAdmissionOpen()) return await rollbackClosedAdmission();
    startClaimHeartbeat();
    const createdExecutionId = await runWithWorkflowSourceIntegrationPolicy(
      claimedRun,
      () => input.createRunExecution(executionConfig),
    );
    await stopClaimHeartbeat();

    if (createdExecutionId !== executionId) {
      await input.deleteRunExecution(createdExecutionId);
      throw ORCHESTRATION_ERROR.create({
        detail:
          `Run executor returned execution id "${createdExecutionId}" for requested id "${executionId}"`,
      });
    }

    const claimStillOwned = !claimHeartbeatError && await updateRunIfStatus(
      backend,
      runId,
      ["running"],
      { heartbeatAt: new Date() },
      workerId,
      pendingLockToken ?? undefined,
    );
    if (!claimStillOwned) {
      const ownershipError = claimHeartbeatError ?? ORCHESTRATION_ERROR.create({
        detail: `Lost workflow run claim before execution "${executionId}" was admitted`,
      });
      const latest = await backend.getRun(runId);
      // The intended child may win its fresh lease immediately after the
      // manager lease expires. Its durable worker identity proves that this is
      // the admitted execution, even though the old token no longer verifies.
      if (latest?.workerId === workerId) {
        return {
          status: "created",
          execution: {
            executionId,
            runId,
            status: "pending",
            createdAt: new Date(),
          },
        };
      }
      try {
        await input.deleteRunExecution(executionId);
      } catch (cleanupError) {
        return {
          status: "skipped-claim-lost",
          teardownCandidate: { executionId, runId },
          error: claimCleanupError(
            `Lost workflow run claim and could not clean up execution "${executionId}"`,
            ownershipError,
            cleanupError,
          ),
        };
      }
      return { status: "skipped-claim-lost", error: ownershipError };
    }

    if (pendingLockToken) {
      if (!hasLockSupport(backend)) {
        await input.deleteRunExecution(executionId);
        return {
          status: "skipped-claim-lost",
          error: ORCHESTRATION_ERROR.create({
            detail: `Workflow backend lost lock support before admitting "${executionId}"`,
          }),
        };
      }
      const released = parseLockMutationResult(
        await backend.releaseLock(runId, pendingLockToken),
        "release",
        runId,
      );
      if (!released) {
        pendingLockToken = null;
        const latest = await backend.getRun(runId);
        // A legitimate child may acquire immediately after an event-loop
        // pause lets the manager lease expire. Durable worker ownership, not
        // failure to delete the old token, decides whether that child remains
        // admitted.
        if (latest?.workerId === workerId) {
          return {
            status: "created",
            execution: {
              executionId,
              runId,
              status: "pending",
              createdAt: new Date(),
            },
          };
        }
        const ownershipError = ORCHESTRATION_ERROR.create({
          detail: `Lost workflow run claim before releasing execution "${executionId}"`,
        });
        try {
          await input.deleteRunExecution(executionId);
        } catch (cleanupError) {
          return {
            status: "skipped-claim-lost",
            teardownCandidate: { executionId, runId },
            error: claimCleanupError(
              `Could not clean up execution "${executionId}" after losing its claim`,
              ownershipError,
              cleanupError,
            ),
          };
        }
        return {
          status: "skipped-claim-lost",
          error: ownershipError,
        };
      }
      pendingLockToken = null;
    }

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
    await stopClaimHeartbeat();
    const failure = claimHeartbeatError ?? ensureError(error);
    try {
      await input.deleteRunExecution(executionId);
    } catch (cleanupError) {
      return {
        status: "skipped-claim-lost",
        teardownCandidate: { executionId, runId },
        error: claimCleanupError(
          `Could not clean up rejected run execution "${executionId}"`,
          failure,
          cleanupError,
        ),
      };
    }
    let outcome: WorkflowRunControlClaimOutcome;
    try {
      outcome = await failClaim(
        input,
        runToProcess ?? run,
        workerId,
        claimed,
        pendingLockToken ?? undefined,
        failure,
      );
    } catch (cleanupError) {
      return {
        status: "skipped-claim-lost",
        teardownCandidate: { executionId, runId },
        error: claimCleanupError(
          `Could not compensate rejected run execution "${executionId}"`,
          failure,
          cleanupError,
        ),
      };
    }
    if (outcome.status === "failed-before-claim" || outcome.status === "failed-after-claim") {
      pendingLockToken = null;
    }
    return outcome;
  } finally {
    await stopClaimHeartbeat();
    if (pendingLockToken) {
      try {
        if (!hasLockSupport(backend)) {
          logger.warn(
            `Failed to release pending claim lock for ${runId}:`,
            ORCHESTRATION_ERROR.create({
              detail: `Workflow backend lost lock support while releasing run "${runId}"`,
            }),
          );
        } else {
          const released = parseLockMutationResult(
            await backend.releaseLock(runId, pendingLockToken),
            "release",
            runId,
          );
          if (!released) {
            logger.warn(`Pending claim lock was no longer owned for ${runId}`);
          }
        }
      } catch (error) {
        logger.warn(`Failed to release pending claim lock for ${runId}:`, error);
      }
    }
  }
}

async function reconcileApprovalDecision(
  backend: WorkflowBackend,
  operation: WorkflowRunControlApprovalDecisionOperation,
): Promise<WorkflowRunControlReconcileOutcome> {
  const maxAttempts = operation.maxAttempts ?? DEFAULT_DECISION_RECONCILIATION_ATTEMPTS;
  const decidedAt = operation.decidedAt ?? new Date();
  const decisionContext = {
    approved: operation.decision.approved,
    approver: operation.decision.approver,
    comment: operation.decision.comment,
    decidedAt: decidedAt.toISOString(),
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const run = await backend.getRun(operation.runId);
    if (!run) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${operation.runId}` });
    }
    if (!ACTIVE_RECONCILE_STATUSES.includes(run.status)) {
      return { status: "skipped-terminal", run };
    }

    const expectedWorkerId = run.workerId;
    const runPatch: Partial<WorkflowRun> = {
      context: {
        ...run.context,
        [operation.nodeId]: decisionContext,
      },
      nodeStates: {
        ...run.nodeStates,
        [operation.nodeId]: {
          nodeId: operation.nodeId,
          status: "completed",
          output: {
            approved: operation.decision.approved,
            approver: operation.decision.approver,
            comment: operation.decision.comment,
          },
          attempt: 1,
          completedAt: decidedAt,
        },
      },
    };

    const updated = await updateRunIfStatus(
      backend,
      operation.runId,
      ACTIVE_RECONCILE_STATUSES,
      operation.decision.approved ? runPatch : {
        ...runPatch,
        status: "failed",
        error: {
          message: `Approval "${operation.approvalId}" was rejected${
            operation.decision.comment ? `: ${operation.decision.comment}` : ""
          }`,
        },
        completedAt: new Date(),
      },
      expectedWorkerId,
    );
    if (!updated) {
      const latest = await backend.getRun(operation.runId);
      if (!latest || !ACTIVE_RECONCILE_STATUSES.includes(latest.status)) {
        return { status: "skipped-terminal", run: latest ?? undefined };
      }
      continue;
    }

    const reconciledRun = await backend.getRun(operation.runId);
    if (!operation.decision.approved || !operation.resume) {
      return { status: "reconciled", run: reconciledRun ?? undefined };
    }

    try {
      await operation.resume(operation.runId, expectedWorkerId);
      return { status: "reconciled", run: reconciledRun ?? undefined };
    } catch (error) {
      const latestRun = await backend.getRun(operation.runId);
      if (
        latestRun && ACTIVE_RECONCILE_STATUSES.includes(latestRun.status) &&
        latestRun.workerId !== expectedWorkerId
      ) {
        continue;
      }
      throw error;
    }
  }

  throw ORCHESTRATION_ERROR.create({
    detail:
      `Workflow execution ownership kept changing while applying approval "${operation.approvalId}"`,
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
    operation.expectedLockId,
  );
  const latest = await backend.getRun(run.id);
  if (!latest) {
    throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${run.id}` });
  }
  if (updated) return { status: "reconciled", run: latest };
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
    operation.expectedLockId,
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
  workerId: string,
  claimed: boolean,
  lockToken?: string,
  error?: Error,
): Promise<WorkflowRunControlClaimOutcome> {
  const message = `RUN_EXECUTION_CREATION_FAILED: Failed to create run execution: ${
    error?.message ?? "run ownership changed before execution creation"
  }`;
  const failure = {
    status: "failed" as const,
    error: { message },
    completedAt: new Date(),
  };

  if (claimed) {
    const failed = await updateRunIfStatus(
      input.backend,
      run.id,
      ["running"],
      failure,
      workerId,
      lockToken,
    );
    return failed
      ? { status: "failed-after-claim", error }
      : { status: "skipped-claim-lost", error };
  }

  const expectedWorkerId = run.status === "running" ? `mgr:${input.managerId}` : undefined;
  const failed = await updateRunIfStatus(
    input.backend,
    run.id,
    ["pending", "waiting", "running"],
    failure,
    expectedWorkerId,
    lockToken,
  );
  return failed
    ? { status: "failed-before-claim", error }
    : { status: "skipped-claim-lost", error };
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
  if (input.enableLocking !== false && !hasLockSupport(backend)) {
    throw ORCHESTRATION_ERROR.create({
      detail:
        "Workflow locking requires backend acquireLock, extendLock, releaseLock, and lock-fenced update methods",
    });
  }
  const lockBackend = input.enableLocking !== false && hasLockSupport(backend) ? backend : null;
  const useLocking = lockBackend !== null;
  if (input.existingLockId !== undefined && !useLocking) {
    throw ORCHESTRATION_ERROR.create({
      detail: "An existing workflow lock requires locking to be enabled",
    });
  }
  if (input.existingLockId !== undefined && expectedWorkerId === undefined) {
    throw ORCHESTRATION_ERROR.create({
      detail: "An existing workflow lock requires an expected worker owner",
    });
  }
  const ownership: CheckpointOwnership | undefined = expectedWorkerId === undefined
    ? undefined
    : { runId, workerId: expectedWorkerId };
  let heartbeatIntervalId: ReturnType<typeof setInterval> | undefined;
  let heartbeatPromise: Promise<void> | undefined;
  let lockLostError: Error | undefined;
  let ownershipLostError: Error | undefined;
  let lockToken: string | null = null;
  let pausedForWaiting = false;
  let durableCancellationObserved = false;

  if (useLocking) {
    if (input.existingLockId !== undefined) {
      lockToken = parseLockAcquisitionResult(input.existingLockId, runId);
      const accepted = parseLockMutationResult(
        await lockBackend!.extendLock(runId, lockDuration, lockToken!),
        "renew",
        runId,
      );
      if (!accepted) {
        throw ORCHESTRATION_ERROR.create({
          detail: `Cannot execute workflow run "${runId}": existing lock is no longer owned`,
        });
      }
    } else {
      lockToken = parseLockAcquisitionResult(
        await lockBackend!.acquireLock(runId, lockDuration),
        runId,
      );
    }
    if (!lockToken) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot execute workflow run "${runId}": another worker is already executing it. ` +
          `This can happen when multiple workers try to execute the same run concurrently.`,
      });
    }
    logger.debug("Acquired lock for run", { runId });
  }

  const executionController = new AbortController();
  input.registerController?.(runId, executionController, {
    expectedWorkerId,
    lockId: lockToken ?? undefined,
  });

  try {
    let currentRun = await backend.getRun(runId);
    if (currentRun?.status === "cancelled") {
      durableCancellationObserved = true;
      return { status: "cancelled", run: currentRun };
    }
    if (executionController.signal.aborted) {
      // Shutdown can race admission after the execution has acquired its
      // lease. Keep that lease live until the exact-fenced cancellation has
      // settled; otherwise finally could release it first and leave a pending
      // run behind.
      await input.waitForCancellationUpdate(runId);
      currentRun = await backend.getRun(runId);
      if (currentRun?.status === "cancelled") {
        durableCancellationObserved = true;
        return { status: "cancelled", run: currentRun };
      }
      return { status: "skipped", run: currentRun ?? undefined };
    }
    if (!input.isCurrentExecution(runId, executionController)) {
      return {
        status: "skipped",
        run: currentRun ?? undefined,
      };
    }

    const now = new Date();
    const activated = await updateRunIfStatus(
      backend,
      runId,
      ["pending", "waiting", "running"],
      {
        status: "running",
        startedAt: run.startedAt || now,
        heartbeatAt: now,
      },
      expectedWorkerId,
      lockToken ?? undefined,
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

        if (useLocking) {
          let extended: boolean;
          try {
            if (!lockToken) {
              throw ORCHESTRATION_ERROR.create({
                detail: `Workflow lock token is missing for run "${runId}"`,
              });
            }
            extended = parseLockMutationResult(
              await lockBackend!.extendLock(runId, lockDuration, lockToken),
              "renew",
              runId,
            );
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
          const updated = await updateRunIfStatus(
            backend,
            runId,
            ["running", "waiting"],
            { heartbeatAt: new Date() },
            expectedWorkerId,
            lockToken ?? undefined,
          );
          if (!updated) {
            ownershipLostError = ORCHESTRATION_ERROR.create({
              detail: `Lost execution ownership for run "${runId}" during heartbeat`,
            });
            if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
            executionController.abort(ownershipLostError);
          }
        } catch (error) {
          if (!ownershipLostError) {
            ownershipLostError = ORCHESTRATION_ERROR.create({
              detail: `Could not verify execution ownership for run "${runId}" during heartbeat`,
              cause: error instanceof Error ? error : undefined,
            });
            logger.error("Could not verify workflow ownership; aborting run", { runId }, error);
            if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
            executionController.abort(ownershipLostError);
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
      if (latestRun?.status === "cancelled") {
        durableCancellationObserved = true;
        return { status: "cancelled", run: latestRun };
      }
      executionController.signal.throwIfAborted();
    }

    // A terminal or waiting transition consumes the current lease. Quiesce
    // any in-flight heartbeat before that atomic transition so a legitimate
    // lease deletion cannot be mistaken for lock loss by an older renewal.
    await stopHeartbeat();
    if (executionController.signal.aborted) executionController.signal.throwIfAborted();

    if (result.completed) {
      const finalRun = await completeRun(
        input,
        executionController,
        result,
        lockToken ?? undefined,
      );
      if (!finalRun) return { status: "ownership-lost" };
      if (finalRun.status === "cancelled") return { status: "cancelled", run: finalRun };
      if (useLocking) lockToken = null;
      await notifyTerminalObserver(
        "completion",
        runId,
        input.onComplete ? () => input.onComplete!(finalRun) : undefined,
      );
      return { status: "completed", run: finalRun };
    }

    if (result.waiting) {
      // Durable waiting is a recovery boundary. Admission must run before the
      // running -> waiting CAS; checking in onWaiting is too late because the
      // lease has already been consumed and a recovery worker can observe the
      // resumable row in the intervening crash window.
      input.beforeWaiting?.(run, result.waitingNode!);
      const paused = await pauseRun(
        input,
        executionController,
        result,
        lockToken ?? undefined,
      );
      if (!paused) return { status: "ownership-lost" };
      if (useLocking) lockToken = null;
      pausedForWaiting = true;

      await releaseWaitingLock();

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
      await input.onWaiting?.(pausedRun, result.waitingNode!);
      return { status: "waiting", run: pausedRun };
    }

    const error = ORCHESTRATION_ERROR.create({ detail: result.error || "Unknown error" });
    const failedRun = await failRun(
      input,
      executionController,
      error,
      result,
      ["running"],
      lockToken ?? undefined,
    );
    if (!failedRun) return { status: "ownership-lost" };
    if (useLocking) lockToken = null;
    await notifyTerminalObserver(
      "failure",
      runId,
      input.onError ? () => input.onError!(failedRun, error, result.context) : undefined,
    );
    return { status: "failed", run: failedRun };
  } catch (error) {
    const normalizedError = ensureError(error);

    // Exceptions from the workflow body also lead to a lease-consuming
    // failed transition. Settle the heartbeat first for the same reason as
    // the normal completed/waiting/failed paths above.
    await stopHeartbeat();

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
    if (latestRun?.status === "cancelled") {
      durableCancellationObserved = true;
      return { status: "cancelled", run: latestRun };
    }
    const failureContext = latestRun?.context ?? run.context;
    const failureNodeStates = latestRun?.nodeStates ?? run.nodeStates;

    // A waiting transition consumes the execution lease before invoking the
    // callback. If that callback fails, reacquire a fresh lease before
    // changing the durable waiting state. A replacement may already hold the
    // lease while it prepares activation; status/worker checks alone cannot
    // distinguish that window from continued ownership by this executor.
    if (pausedForWaiting && useLocking && !lockToken) {
      lockToken = parseLockAcquisitionResult(
        await lockBackend!.acquireLock(runId, lockDuration),
        runId,
      );
      if (!lockToken) {
        logger.warn("Waiting callback failed after execution ownership changed", { runId });
        return { status: "ownership-lost" };
      }
    }

    const failedRun = await failRun(
      input,
      executionController,
      normalizedError,
      {
        context: failureContext,
        nodeStates: failureNodeStates,
      },
      pausedForWaiting ? ["waiting"] : ["running"],
      lockToken ?? undefined,
    );
    if (!failedRun) return { status: "ownership-lost" };
    if (useLocking) lockToken = null;

    await notifyTerminalObserver(
      "failure",
      runId,
      input.onError ? () => input.onError!(failedRun, normalizedError, failureContext) : undefined,
    );
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
      await releaseFinalLock(lockToken, durableCancellationObserved);
    }
  }

  async function releaseFinalLock(
    token: string,
    allowAlreadyConsumed = false,
  ): Promise<void> {
    const released = parseLockMutationResult(
      await lockBackend!.releaseLock(runId, token),
      "release",
      runId,
    );
    if (!released && !allowAlreadyConsumed) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Lost lock ownership before releasing workflow run "${runId}"`,
      });
    }
    if (released) logger.debug("Released lock for run", { runId });
  }

  async function stopHeartbeat(): Promise<void> {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = undefined;
    }
    if (heartbeatPromise) {
      await heartbeatPromise;
      heartbeatPromise = undefined;
    }
  }

  async function releaseWaitingLock(): Promise<void> {
    await stopHeartbeat();
    if (executionController.signal.aborted) executionController.signal.throwIfAborted();
    if (useLocking && lockToken) {
      const released = parseLockMutationResult(
        await lockBackend!.releaseLock(runId, lockToken),
        "release",
        runId,
      );
      if (!released) {
        throw ORCHESTRATION_ERROR.create({
          detail: `Lost lock ownership before pausing workflow run "${runId}"`,
        });
      }
      lockToken = null;
      logger.debug("Released lock for waiting run", { runId });
    }
  }
}

async function completeRun(
  input: WorkflowRunControlExecuteInput,
  executionController: AbortController,
  result: WorkflowRunControlExecuteResult,
  lockToken?: string,
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

  const output = toDefaultWorkflowOutput(
    result.context,
    result._workflowProjection?.context,
  );
  const preparedOutput = input.prepareOutput ? input.prepareOutput(output) : output;
  const completed = await updateRunIfStatus(
    backend,
    run.id,
    ["running"],
    {
      status: "completed",
      currentNodes: [],
      output: preparedOutput,
      context: result.context,
      nodeStates: result.nodeStates,
      _workflowProjection: result._workflowProjection,
      completedAt: new Date(),
    },
    expectedWorkerId,
    lockToken,
  );
  if (!completed) return null;

  return (await backend.getRun(run.id))!;
}

async function failRun(
  input: WorkflowRunControlExecuteInput,
  executionController: AbortController,
  error: Error,
  result: Pick<
    WorkflowRunControlExecuteResult,
    "context" | "nodeStates" | "_workflowProjection"
  >,
  expectedStatuses: WorkflowRun["status"][],
  lockToken?: string,
): Promise<WorkflowRun | null> {
  const { backend, run, expectedWorkerId } = input;
  await input.waitForCancellationUpdate(run.id);
  const currentRun = await backend.getRun(run.id);
  if (currentRun?.status === "cancelled") return null;
  if (!input.isCurrentExecution(run.id, executionController)) return null;

  const completedAt = new Date();
  const patch = {
    status: "failed" as const,
    currentNodes: [],
    context: result.context,
    nodeStates: result.nodeStates,
    _workflowProjection: result._workflowProjection,
    error: {
      message: error.message,
      stack: error.stack,
    },
    completedAt,
  };
  const updated = await updateRunIfStatus(
    backend,
    run.id,
    expectedStatuses,
    patch,
    expectedWorkerId,
    lockToken,
  );
  return updated ? structuredClone({ ...(currentRun ?? run), ...patch }) : null;
}

async function pauseRun(
  input: WorkflowRunControlExecuteInput,
  executionController: AbortController,
  result: WorkflowRunControlExecuteResult,
  lockToken?: string,
): Promise<boolean> {
  const { backend, run, expectedWorkerId } = input;
  await input.waitForCancellationUpdate(run.id);
  const currentRun = await backend.getRun(run.id);
  if (currentRun?.status === "cancelled") return false;
  if (
    executionController.signal.aborted ||
    !input.isCurrentExecution(run.id, executionController)
  ) return false;

  return await updateRunIfStatus(
    backend,
    run.id,
    ["running"],
    {
      status: "waiting",
      currentNodes: [result.waitingNode!],
      context: result.context,
      nodeStates: result.nodeStates,
      _workflowProjection: result._workflowProjection,
    },
    expectedWorkerId,
    lockToken,
  );
}
