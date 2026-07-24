import { logger as baseLogger } from "#veryfront/utils";
import { ensureError, ORCHESTRATION_ERROR, RESOURCE_NOT_FOUND } from "#veryfront/errors";
import {
  hasLockSupport,
  hasWorkerSupport,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import type { CheckpointOwnership } from "../executor/checkpoint-manager.ts";
import type { NodeState, WorkflowContext, WorkflowRun } from "../types.ts";
import {
  requireWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../source-integration-policy.ts";
import type { RunExecutionConfig } from "../worker/executors/types.ts";

const logger = baseLogger.component("workflow-run-control");

export interface WorkflowRunControlExecuteResult {
  completed?: boolean;
  waiting?: boolean;
  waitingNode?: string;
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
  let claimed = false;

  try {
    if (run.status === "running") {
      if (!hasWorkerSupport(backend)) return { status: "skipped-stalled-claim-lost" };
      const stalledClaimed = await backend.claimStalledRun(
        runId,
        `mgr:${managerId}`,
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
    const expectedWorkerId = run.status === "running" ? `mgr:${managerId}` : undefined;
    claimed = await updateRunIfStatus(
      backend,
      runId,
      [runToProcess.status],
      {
        status: "running",
        startedAt: runToProcess.startedAt || now,
        heartbeatAt: now,
        workerId,
      },
      expectedWorkerId,
    );
    if (!claimed) {
      return await failClaim(input, runToProcess, workerId, false);
    }

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
    logger.error(`Failed to claim workflow run ${runId}:`, error);
    return await failClaim(input, runToProcess ?? run, workerId, claimed, ensureError(error));
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

async function failClaim(
  input: WorkflowRunControlClaimInput,
  run: WorkflowRun,
  workerId: string,
  claimed: boolean,
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
    await updateRunIfStatus(input.backend, run.id, ["running"], failure, workerId);
    return { status: "failed-after-claim", error };
  }

  await updateRunIfStatus(
    input.backend,
    run.id,
    ["pending", "waiting", "running"],
    failure,
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
      const paused = await pauseRun(input, executionController, result);
      if (!paused) return { status: "ownership-lost" };
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

  const publicContext = toPublicContext(result.context);
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

  const publicContext = toPublicContext(result.context);
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

async function pauseRun(
  input: WorkflowRunControlExecuteInput,
  executionController: AbortController,
  result: WorkflowRunControlExecuteResult,
): Promise<boolean> {
  const { backend, run, expectedWorkerId } = input;
  await input.waitForCancellationUpdate(run.id);
  const currentRun = await backend.getRun(run.id);
  if (currentRun?.status === "cancelled") return false;
  if (
    executionController.signal.aborted ||
    !input.isCurrentExecution(run.id, executionController)
  ) return false;

  const publicContext = toPublicContext(result.context);
  return await updateRunIfStatus(
    backend,
    run.id,
    ["running"],
    {
      status: "waiting",
      currentNodes: [result.waitingNode!],
      context: publicContext,
      nodeStates: result.nodeStates,
    },
    expectedWorkerId,
  );
}

function toPublicContext(context: WorkflowContext): WorkflowContext {
  const { _tenant: _tenant, ...publicContext } = context;
  return publicContext;
}

function determineOutput(context: WorkflowContext): unknown {
  const { input: _input, _tenant: _tenant, ...rest } = context;
  return rest;
}
