import { ORCHESTRATION_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import {
  hasTimedWaitRecoverySupport,
  type TimedWaitClaim,
  updateRunIfStatus,
  type WorkflowBackend,
  type WorkflowRunUpdate,
} from "../backends/types.ts";
import {
  type DurableTimedWaitKind,
  INTERNAL_DELAY_EVENT_NAME,
  INTERNAL_WAIT_KIND_FIELD,
} from "../timed-wait-state.ts";
import type { Checkpoint, NodeState, WorkflowRun } from "../types.ts";
import { parsePositiveDurationWithLabel } from "../types.ts";

export interface TimedWorkflowWaitRegistration {
  readonly runId: string;
  readonly nodeId: string;
  readonly workerId?: string;
  readonly waitKind: DurableTimedWaitKind;
  readonly eventName: string;
  readonly timeoutMs: number;
  readonly startedAtMs: number;
  readonly deadline: number;
}

export type TimedWorkflowWaitReconciliationOutcome =
  | {
    readonly status: "not-due" | "unchanged";
    readonly run?: WorkflowRun;
    readonly registration: TimedWorkflowWaitRegistration;
  }
  | {
    readonly status: "awakened";
    readonly run: WorkflowRun;
    readonly registration: TimedWorkflowWaitRegistration;
  }
  | {
    readonly status: "failed";
    readonly run: WorkflowRun;
    readonly error: Error;
    readonly registration: TimedWorkflowWaitRegistration;
  };

interface ReconcileTimedWorkflowWaitOptions {
  readonly now?: number;
  /** Optional durable owner used by a long-lived in-process recovery worker. */
  readonly nextWorkerId?: string;
}

function getWaitInput(state: NodeState): Record<string, unknown> | null {
  const input = state.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function getPersistedWaitKind(input: Record<string, unknown>): DurableTimedWaitKind {
  const marker = input[INTERNAL_WAIT_KIND_FIELD];
  if (marker === "delay" || marker === "event") return marker;
  if (marker !== undefined) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Persisted timed wait has an invalid ${INTERNAL_WAIT_KIND_FIELD}`,
    });
  }

  // Compatibility for delays persisted before the explicit discriminator was
  // introduced. Newly captured event definitions cannot use this name.
  return input.eventName === INTERNAL_DELAY_EVENT_NAME ? "delay" : "event";
}

function getStartedAtMs(state: NodeState, nodeId: string): number {
  if (!state.startedAt) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Persisted event wait "${nodeId}" has no start time`,
    });
  }
  let startedAtMs: number;
  try {
    startedAtMs = Date.prototype.getTime.call(state.startedAt);
  } catch (cause) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Persisted event wait "${nodeId}" has an invalid start time`,
      cause,
    });
  }
  if (!Number.isFinite(startedAtMs)) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Persisted event wait "${nodeId}" has an invalid start time`,
    });
  }
  return startedAtMs;
}

function parseTimedWaitState(
  run: WorkflowRun,
  nodeId: string,
  state: NodeState,
): TimedWorkflowWaitRegistration | null {
  const input = getWaitInput(state);
  if (!input || input.type !== "event" || typeof input.eventName !== "string") return null;
  if (input.timeout === undefined) return null;

  const timeoutMs = parsePositiveDurationWithLabel(
    input.timeout as string | number,
    `Persisted event wait "${nodeId}" timeout`,
  );
  const startedAtMs = getStartedAtMs(state, nodeId);
  return {
    runId: run.id,
    nodeId,
    workerId: run.workerId,
    waitKind: getPersistedWaitKind(input),
    eventName: input.eventName,
    timeoutMs,
    startedAtMs,
    deadline: startedAtMs + timeoutMs,
  };
}

/** Parse one active persisted event wait with a durable timeout. */
export function getTimedWorkflowWait(
  run: WorkflowRun,
  nodeId: string,
  state: NodeState,
): TimedWorkflowWaitRegistration | null {
  if (state.status !== "running") return null;
  return parseTimedWaitState(run, nodeId, state);
}

/** Return active timed waits ordered by deadline and stable node identity. */
export function getTimedWorkflowWaits(run: WorkflowRun): TimedWorkflowWaitRegistration[] {
  const waits: TimedWorkflowWaitRegistration[] = [];
  for (const [nodeId, state] of Object.entries(run.nodeStates)) {
    const wait = getTimedWorkflowWait(run, nodeId, state);
    if (wait) waits.push(wait);
  }
  waits.sort((left, right) =>
    left.deadline - right.deadline ||
    left.nodeId.localeCompare(right.nodeId)
  );
  return waits;
}

function registrationsMatch(
  left: TimedWorkflowWaitRegistration,
  right: TimedWorkflowWaitRegistration,
): boolean {
  return left.runId === right.runId && left.nodeId === right.nodeId &&
    left.workerId === right.workerId && left.waitKind === right.waitKind &&
    left.eventName === right.eventName && left.timeoutMs === right.timeoutMs &&
    left.startedAtMs === right.startedAtMs && left.deadline === right.deadline;
}

async function persistTimedWaitResolution(
  backend: WorkflowBackend,
  run: WorkflowRun,
  registration: TimedWorkflowWaitRegistration,
  options: ReconcileTimedWorkflowWaitOptions,
  update: (patch: WorkflowRunUpdate) => Promise<boolean>,
): Promise<TimedWorkflowWaitReconciliationOutcome> {
  const now = options.now ?? Date.now();
  const completedAt = new Date(now);
  const nodeStates = structuredClone(run.nodeStates);
  if (registration.waitKind === "delay") {
    nodeStates[registration.nodeId] = {
      ...nodeStates[registration.nodeId]!,
      status: "completed",
      error: undefined,
      completedAt,
    };
    const patch: WorkflowRunUpdate = {
      status: "pending",
      currentNodes: [registration.nodeId],
      nodeStates,
      ...(options.nextWorkerId === undefined ? {} : { workerId: options.nextWorkerId }),
    };
    const awakened = await update(patch);
    if (!awakened) {
      return { status: "unchanged", run: await backend.getRun(run.id) ?? undefined, registration };
    }
    const awakenedRun: WorkflowRun = {
      ...run,
      ...patch,
    };
    return {
      status: "awakened",
      // Return the owner established by this exact CAS. A later read may
      // already belong to a replacement execution and must never be adopted by
      // the reconciler that performed the wake.
      run: awakenedRun,
      registration,
    };
  }

  const error = TIMEOUT_ERROR.create({
    detail: `Wait node "${registration.nodeId}" timed out after ${registration.timeoutMs}ms`,
  });
  nodeStates[registration.nodeId] = {
    ...nodeStates[registration.nodeId]!,
    status: "failed",
    error: error.message,
    completedAt,
  };
  const patch: WorkflowRunUpdate = {
    status: "failed",
    currentNodes: [],
    nodeStates,
    error: { message: error.message, stack: error.stack },
    completedAt,
  };
  const failed = await update(patch);
  if (!failed) {
    return { status: "unchanged", run: await backend.getRun(run.id) ?? undefined, registration };
  }
  const failedRun: WorkflowRun = {
    ...run,
    ...patch,
  };
  return {
    status: "failed",
    run: failedRun,
    error,
    registration,
  };
}

function validateCurrentTimedWait(
  run: WorkflowRun | null,
  registration: TimedWorkflowWaitRegistration,
): run is WorkflowRun {
  if (!run || run.status !== "waiting" || run.workerId !== registration.workerId) return false;
  const state = Object.hasOwn(run.nodeStates, registration.nodeId)
    ? run.nodeStates[registration.nodeId]
    : undefined;
  if (!state) return false;
  const current = getTimedWorkflowWait(run, registration.nodeId, state);
  return !!current && registrationsMatch(current, registration);
}

/**
 * Reconcile one exact persisted wait deadline through an owner-fenced CAS.
 * Delay expiry wakes the run; ordinary event expiry fails it durably.
 */
export async function reconcileTimedWorkflowWait(
  backend: WorkflowBackend,
  registration: TimedWorkflowWaitRegistration,
  options: ReconcileTimedWorkflowWaitOptions = {},
): Promise<TimedWorkflowWaitReconciliationOutcome> {
  const run = await backend.getRun(registration.runId);
  if (!validateCurrentTimedWait(run, registration)) {
    return { status: "unchanged", run: run ?? undefined, registration };
  }
  const now = options.now ?? Date.now();
  if (now < registration.deadline) return { status: "not-due", run, registration };
  return await persistTimedWaitResolution(
    backend,
    run,
    registration,
    { ...options, now },
    (patch) =>
      updateRunIfStatus(
        backend,
        run.id,
        ["waiting"],
        patch,
        registration.workerId,
      ),
  );
}

/** Reconcile a backend-leased deadline through its exact live fencing token. */
export async function reconcileClaimedTimedWorkflowWait(
  backend: WorkflowBackend,
  claim: TimedWaitClaim,
  options: ReconcileTimedWorkflowWaitOptions = {},
): Promise<TimedWorkflowWaitReconciliationOutcome | null> {
  if (!hasTimedWaitRecoverySupport(backend)) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Workflow backend does not support indexed timed-wait recovery",
    });
  }
  const registration = getTimedWorkflowWaits(claim.run).find((candidate) =>
    candidate.nodeId === claim.nodeId && candidate.deadline === claim.deadline &&
    candidate.waitKind === claim.waitKind
  );
  if (!registration || registration.workerId === undefined) return null;
  const now = options.now ?? Date.now();
  if (now < registration.deadline) {
    return { status: "not-due", run: claim.run, registration };
  }
  if (!validateCurrentTimedWait(claim.run, registration)) {
    return { status: "unchanged", run: claim.run, registration };
  }
  return await persistTimedWaitResolution(
    backend,
    claim.run,
    registration,
    { ...options, now },
    (patch) =>
      backend.updateRunIfTimedWaitClaim(
        claim.run.id,
        claim.nodeId,
        claim.claimId,
        claim.deadline,
        registration.workerId!,
        patch,
      ),
  );
}

/** Reconcile the earliest due timed wait in one waiting run. */
export function reconcileDueTimedWorkflowWait(
  backend: WorkflowBackend,
  run: WorkflowRun,
  options: ReconcileTimedWorkflowWaitOptions = {},
): Promise<TimedWorkflowWaitReconciliationOutcome | null> {
  const now = options.now ?? Date.now();
  const registration = getTimedWorkflowWaits(run).find((wait) => wait.deadline <= now);
  return registration
    ? reconcileTimedWorkflowWait(backend, registration, { ...options, now })
    : Promise.resolve(null);
}

/** Return the exact delay leaf carried as a durable post-timeout wake marker. */
export function getTimedWaitWakeNodeId(run: WorkflowRun): string | null {
  if (run.status !== "pending" && run.status !== "running") return null;
  if (run.currentNodes.length !== 1) return null;
  const nodeId = run.currentNodes[0]!;
  const state = Object.hasOwn(run.nodeStates, nodeId) ? run.nodeStates[nodeId] : undefined;
  if (!state || state.status !== "completed") return null;
  const wait = parseTimedWaitState(run, nodeId, state);
  return wait?.waitKind === "delay" ? nodeId : null;
}

/** A checkpoint is safe for implicit recovery only when it contains this exact wake. */
export function checkpointContainsTimedWaitWake(
  run: WorkflowRun,
  checkpoint: Checkpoint,
  wakeNodeId: string,
): boolean {
  const runState = Object.hasOwn(run.nodeStates, wakeNodeId)
    ? run.nodeStates[wakeNodeId]
    : undefined;
  const checkpointState = Object.hasOwn(checkpoint.nodeStates, wakeNodeId)
    ? checkpoint.nodeStates[wakeNodeId]
    : undefined;
  if (
    !runState || runState.status !== "completed" ||
    !checkpointState || checkpointState.status !== "completed"
  ) return false;

  const runWait = parseTimedWaitState(run, wakeNodeId, runState);
  const checkpointWait = parseTimedWaitState(run, wakeNodeId, checkpointState);
  return !!runWait && !!checkpointWait && runWait.waitKind === "delay" &&
    registrationsMatch(runWait, checkpointWait);
}
