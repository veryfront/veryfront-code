/****
 * Memory Workflow Backend
 *
 * In-memory implementation of WorkflowBackend for development and testing.
 * Data is NOT persisted across restarts.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type {
  ApprovalDecision,
  Checkpoint,
  RunFilter,
  WorkflowContext,
  WorkflowQueueItem,
  WorkflowRun,
} from "../types.ts";
import {
  serializeWorkflowContext,
  serializeWorkflowJson,
  type WorkflowJsonSerializationOptions,
} from "../context-serialization.ts";
import {
  assertWorkflowRunUpdate,
  type BackendConfig,
  isSameWaitNodeExecution,
  type PersistedPendingApproval,
  type PersistedPendingEventWait,
  type RunEventDeliveryClaim,
  type RunEventEnvelope,
  type TerminalRunRetentionBatch,
  type TerminalRunRetentionCandidate,
  type WorkflowBackend,
  type WorkflowRunObservation,
  type WorkflowRunObservedState,
  type WorkflowRunStateSnapshot,
  type WorkflowRunUpdate,
} from "./types.ts";
import { requeueRun } from "./shared/requeue-run.ts";
import {
  appendRetainedCheckpoint,
  cloneRetainedCheckpoint,
  deleteOldestCheckpointOccurrences,
} from "./checkpoint-retention.ts";
import { appendRetainedPendingApproval } from "./approval-retention.ts";
import {
  appendRetainedPendingEventWait,
  appendRetainedRunEvent,
  restoreRetainedRunEvent,
  takeRetainedRunEvent,
} from "./event-wait-retention.ts";
import { MAX_WORKFLOW_RUN_EVENT_MAILBOXES } from "../limits.ts";
import { ORCHESTRATION_ERROR, RESOURCE_NOT_FOUND } from "#veryfront/errors";
import { requireWorkflowSourceIntegrationPolicy } from "../source-integration-policy.ts";

const logger = baseLogger.component("memory-backend");
const ArrayConstructor = Array;
const arrayIsArray = Array.isArray;
const arrayFilter = Array.prototype.filter;
const arrayPop = Array.prototype.pop;
const arraySome = Array.prototype.some;
const arraySplice = Array.prototype.splice;
const DateConstructor = Date;
const dateGetTime = Date.prototype.getTime;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const objectPrototype = Object.prototype;
const jsonParse = JSON.parse;
const mathFloor = Math.floor;
const numberIsFinite = Number.isFinite;
const numberIsNaN = Number.isNaN;
const numberIsSafeInteger = Number.isSafeInteger;
const NUMBER_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const reflectApply = Reflect.apply;
const SetConstructor = Set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const structuredCloneValue = structuredClone;

/**
 * Memory backend configuration
 */
interface MemoryBackendConfig extends BackendConfig, WorkflowJsonSerializationOptions {
  /** Maximum queue size (default: 10000) */
  maxQueueSize?: number;
}

interface MemoryRunUpdateCondition {
  readonly matches: (run: WorkflowRun) => boolean;
  updated: boolean;
}

interface MaterializedMemoryRunUpdate {
  readonly contextPatch: Partial<WorkflowContext> | undefined;
  readonly contextPatchKeys: string[];
  readonly contextDeleteKeys: string[];
  readonly nodeStatePatch: WorkflowRun["nodeStates"] | undefined;
  readonly nodeStateDeleteKeys: string[];
  readonly storedPatch: WorkflowRunUpdate;
}

function memoryTerminalRetentionCandidate(
  run: WorkflowRun,
  cutoff: number,
  revision: number,
): TerminalRunRetentionCandidate | undefined {
  if (
    run.status !== "completed" && run.status !== "failed" &&
    run.status !== "cancelled"
  ) return undefined;
  if (run.completedAt === undefined) return undefined;
  const completedAt = reflectApply(dateGetTime, run.completedAt, []) as number;
  const createdAt = reflectApply(dateGetTime, run.createdAt, []) as number;
  if (!numberIsFinite(completedAt) || !numberIsFinite(createdAt) || completedAt >= cutoff) {
    return undefined;
  }
  return {
    runId: run.id,
    workflowId: run.workflowId,
    createdAt: new DateConstructor(createdAt),
    status: run.status,
    completedAt: new DateConstructor(completedAt),
    revision,
  };
}

function compareTerminalRetentionCandidates(
  left: TerminalRunRetentionCandidate,
  right: TerminalRunRetentionCandidate,
): number {
  const leftCompletedAt = reflectApply(dateGetTime, left.completedAt, []) as number;
  const rightCompletedAt = reflectApply(dateGetTime, right.completedAt, []) as number;
  if (leftCompletedAt !== rightCompletedAt) return leftCompletedAt - rightCompletedAt;
  if (left.runId === right.runId) return 0;
  return left.runId < right.runId ? -1 : 1;
}

function insertBoundedTerminalRetentionCandidate(
  candidates: TerminalRunRetentionCandidate[],
  candidate: TerminalRunRetentionCandidate,
  limit: number,
): boolean {
  let insertAt = 0;
  while (
    insertAt < candidates.length &&
    compareTerminalRetentionCandidates(candidates[insertAt]!, candidate) <= 0
  ) insertAt += 1;
  reflectApply(arraySplice, candidates, [insertAt, 0, candidate]);
  if (candidates.length <= limit) return false;
  reflectApply(arrayPop, candidates, []);
  return true;
}

interface PreparedMemoryRunCondition {
  readonly matches: (run: WorkflowRun) => boolean;
  readonly run: WorkflowRun | null;
}

/** Default max queue size */
const DEFAULT_MAX_QUEUE_SIZE = 10_000;
const RUN_OBSERVATION_QUEUE_SIZE = 64;

function toArrayLength(value: number): number {
  const numericLength = +value;
  if (numericLength <= 0 || numberIsNaN(numericLength)) return 0;
  if (numericLength >= NUMBER_MAX_SAFE_INTEGER) return NUMBER_MAX_SAFE_INTEGER;
  return mathFloor(numericLength);
}

function snapshotExpectedRunStatuses(
  expectedStatuses: WorkflowRun["status"][],
): Set<WorkflowRun["status"]> {
  const snapshot = new SetConstructor<WorkflowRun["status"]>();
  const length = toArrayLength(expectedStatuses.length);
  for (let index = 0; index < length; index++) {
    reflectApply(setAdd, snapshot, [expectedStatuses[index]!]);
  }
  return snapshot;
}

function hasExpectedRunStatus(
  expectedStatuses: Set<WorkflowRun["status"]>,
  status: WorkflowRun["status"],
): boolean {
  return reflectApply(setHas, expectedStatuses, [status]) as boolean;
}

function materializeMemoryRunUpdate(
  patch: WorkflowRunUpdate,
  runId: string,
  options: WorkflowJsonSerializationOptions,
): MaterializedMemoryRunUpdate {
  const {
    context: patchContext,
    contextDeletes = [],
    nodeStates: patchNodeStates,
    nodeStateDeletes = [],
    ...storedPatch
  } = patch;
  const contextPatchKeys = patchContext === undefined ? [] : objectKeys(patchContext);
  const contextPatch = patchContext === undefined
    ? undefined
    : persistedWorkflowContextPatch(patchContext, runId, options);
  return {
    contextPatch,
    contextPatchKeys,
    contextDeleteKeys: [...contextDeletes],
    nodeStatePatch: patchNodeStates === undefined ? undefined : { ...patchNodeStates },
    nodeStateDeleteKeys: [...nodeStateDeletes],
    storedPatch,
  };
}

function mergeMemoryRunUpdate(
  run: WorkflowRun,
  update: MaterializedMemoryRunUpdate,
): WorkflowRun {
  const context = { ...run.context, ...update.contextPatch };
  if (update.contextPatch !== undefined) {
    for (const key of update.contextPatchKeys) {
      if (!objectHasOwn(update.contextPatch, key)) delete context[key];
    }
  }
  for (const key of update.contextDeleteKeys) delete context[key];
  const nodeStates = { ...run.nodeStates, ...update.nodeStatePatch };
  for (const key of update.nodeStateDeleteKeys) delete nodeStates[key];
  return {
    ...run,
    ...update.storedPatch,
    nodeStates,
    context,
  };
}

function materializeRunStateSnapshot(
  snapshot: WorkflowRunStateSnapshot,
  runId: string,
  options: WorkflowJsonSerializationOptions,
): WorkflowRunStateSnapshot {
  const {
    context: snapshotContext,
    nodeStates: snapshotNodeStates,
    ...snapshotFields
  } = snapshot;
  return {
    ...snapshotFields,
    context: persistedWorkflowContext(snapshotContext, runId, options),
    nodeStates: { ...snapshotNodeStates },
  };
}

function persistedWorkflowContext(
  context: WorkflowContext,
  runId: string,
  options: WorkflowJsonSerializationOptions,
): WorkflowContext {
  return jsonParse(serializeWorkflowContext(context, runId, options));
}

function persistedWorkflowContextPatch(
  context: Partial<WorkflowContext>,
  runId: string,
  options: WorkflowJsonSerializationOptions,
): Partial<WorkflowContext> {
  return jsonParse(serializeWorkflowJson(context, "context", runId, options));
}

function persistedCheckpointContext(
  context: WorkflowContext,
  runId: string,
  options: WorkflowJsonSerializationOptions,
): WorkflowContext {
  return jsonParse(serializeWorkflowJson(context, "checkpoint.context", runId, options));
}

function persistedApprovalDecisionData(
  data: unknown,
  runId: string,
  options: WorkflowJsonSerializationOptions,
): unknown {
  return jsonParse(serializeWorkflowJson(data, "approval decision data", runId, options));
}

function clonePersistedPendingApproval(
  approval: PersistedPendingApproval,
): PersistedPendingApproval {
  const { decisionData, ...approvalWithoutDecisionData } = approval;
  const cloned = structuredClone(approvalWithoutDecisionData);
  if (decisionData !== undefined) {
    objectDefineProperty(cloned, "decisionData", {
      value: clonePersistedJsonValue(decisionData),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return cloned;
}

type PersistedJsonContainer = Record<string, unknown> | unknown[];

interface PersistedJsonCloneFrame {
  readonly source: PersistedJsonContainer;
  readonly target: PersistedJsonContainer;
  readonly keys: string[];
}

function isStructuredCloneRangeError(error: unknown): boolean {
  return error instanceof RangeError;
}

function isPersistedJsonContainer(value: unknown): value is PersistedJsonContainer {
  return typeof value === "object" && value !== null;
}

function createPersistedJsonContainer(value: PersistedJsonContainer): PersistedJsonContainer {
  return arrayIsArray(value) ? new ArrayConstructor(value.length) : objectCreate(objectPrototype);
}

function clonePersistedJsonValue<T>(value: T): T {
  try {
    return structuredCloneValue(value);
  } catch (error) {
    if (!isStructuredCloneRangeError(error)) throw error;
  }

  if (!isPersistedJsonContainer(value)) return value;

  const root = createPersistedJsonContainer(value);
  const frames: PersistedJsonCloneFrame[] = [{
    source: value,
    target: root,
    keys: objectKeys(value),
  }];
  while (frames.length > 0) {
    const frame = frames.pop()!;
    for (const key of frame.keys) {
      const field = objectGetOwnPropertyDescriptor(frame.source, key)?.value;
      const clonedField = isPersistedJsonContainer(field)
        ? createPersistedJsonContainer(field)
        : field;
      objectDefineProperty(frame.target, key, {
        value: clonedField,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      if (isPersistedJsonContainer(field) && isPersistedJsonContainer(clonedField)) {
        frames.push({
          source: field,
          target: clonedField,
          keys: objectKeys(field),
        });
      }
    }
  }
  return root as T;
}

function clonePersistedWorkflowContext(value: WorkflowContext): WorkflowContext {
  return clonePersistedJsonValue(value);
}

function cloneWorkflowRunWithContext(run: WorkflowRun, context: WorkflowContext): WorkflowRun {
  const { context: _context, ...runWithoutContext } = run;
  return {
    ...structuredClone(runWithoutContext),
    context,
  };
}

function cloneWorkflowRun(run: WorkflowRun): WorkflowRun {
  return cloneWorkflowRunWithContext(
    run,
    clonePersistedWorkflowContext(run.context),
  );
}

class ObservationFeed implements AsyncIterable<WorkflowRunObservedState> {
  readonly #values: WorkflowRunObservedState[] = [];
  readonly #waiters: Array<{
    resolve: (result: IteratorResult<WorkflowRunObservedState>) => void;
    reject: (error: unknown) => void;
  }> = [];
  #closed = false;
  #error: unknown;

  push(value: WorkflowRunObservedState): boolean {
    if (this.#closed || this.#error !== undefined) return false;
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return true;
    }
    if (this.#values.length >= RUN_OBSERVATION_QUEUE_SIZE) {
      this.fail(new Error("Workflow run slow observer exceeded its bounded queue"));
      return false;
    }
    this.#values.push(value);
    return true;
  }

  finish(): void {
    if (this.#closed || this.#error !== undefined) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  close(): void {
    this.#values.length = 0;
    this.finish();
  }

  fail(error: unknown): void {
    if (this.#closed || this.#error !== undefined) return;
    this.#error = error;
    this.#values.length = 0;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<WorkflowRunObservedState> {
    return {
      next: () => {
        if (this.#error !== undefined) return Promise.reject(this.#error);
        const value = this.#values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
      },
    };
  }
}

interface MemoryRunObserver {
  feed: ObservationFeed;
  detach(drain?: boolean): void;
}

/** Implement memory backend. */
export class MemoryBackend implements WorkflowBackend {
  /** updateRun patches merge context and node-state maps by key. */
  readonly supportsRunPatchKeyMerge = true;
  private runs = new Map<string, WorkflowRun>();
  private checkpoints = new Map<string, Checkpoint[]>();
  private approvals = new Map<string, PersistedPendingApproval[]>();
  private eventWaits = new Map<string, PersistedPendingEventWait[]>();
  private runEvents = new Map<string, RunEventEnvelope[]>();
  private nextRunEventPublicationOrder = 0;
  private runEventClaims = new Map<string, Map<string, RunEventDeliveryClaim>>();
  private queue: WorkflowQueueItem[] = [];
  private locks = new Map<string, { lockId: string; expiresAt: number }>();
  private stalledClaims = new Map<string, { workerId: string; expiresAt: number }>();
  private runRevisions = new Map<string, number>();
  private runRetentionRevisions = new Map<string, number>();
  private terminalRetryQueued = new Set<string>();
  private terminalRetryPending = new Map<string, number>();
  private nextRunRetentionGeneration = 0;
  private runObservers = new Map<string, Set<MemoryRunObserver>>();
  private config: MemoryBackendConfig;

  constructor(config: MemoryBackendConfig = {}) {
    this.config = {
      prefix: "wf:",
      debug: false,
      maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
      strictContext: false,
      ...config,
    };
  }

  // =========================================================================
  // Run Management
  // =========================================================================

  createRun(run: WorkflowRun): Promise<void> {
    logger.debug(`Creating run: ${run.id}`);
    let runForClone: WorkflowRun;
    let context: WorkflowContext;
    try {
      const { context: sourceContext, ...runWithoutContext } = run;
      const sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(run);
      context = persistedWorkflowContext(sourceContext, run.id, this.config);
      runForClone = {
        ...runWithoutContext,
        context,
        sourceIntegrationPolicy,
      };
    } catch (error) {
      return Promise.reject(error);
    }
    this.runs.set(
      run.id,
      cloneWorkflowRunWithContext(runForClone, context),
    );
    this.runRevisions.set(run.id, 0);
    this.runRetentionRevisions.set(run.id, this.nextRunRetentionGeneration++);
    return Promise.resolve();
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = this.runs.get(runId);
    if (!run) return null;

    return {
      ...cloneWorkflowRun(run),
      pendingApprovals: await this.getPendingApprovals(runId),
    };
  }

  updateRun(runId: string, patch: WorkflowRunUpdate): Promise<void> {
    return this.applyRunUpdate(runId, patch);
  }

  private requireRun(runId: string): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    return run;
  }

  private runMatchesUpdateCondition(
    run: WorkflowRun,
    condition: MemoryRunUpdateCondition | undefined,
  ): boolean {
    return condition === undefined || condition.matches(run);
  }

  private prepareRunCondition(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId?: string,
  ): PreparedMemoryRunCondition {
    this.requireRun(runId);
    const expectedStatusSnapshot = snapshotExpectedRunStatuses(expectedStatuses);
    const matches = (candidate: WorkflowRun) =>
      hasExpectedRunStatus(expectedStatusSnapshot, candidate.status) &&
      (expectedWorkerId === undefined || candidate.workerId === expectedWorkerId);
    const run = this.requireRun(runId);
    return { matches, run: matches(run) ? run : null };
  }

  private captureExpectedStatusesForExistingRun(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
  ):
    | { readonly run: WorkflowRun; readonly snapshot: Set<WorkflowRun["status"]> }
    | { readonly error: unknown }
    | null {
    if (!this.runs.has(runId)) return null;
    let snapshot: Set<WorkflowRun["status"]>;
    try {
      snapshot = snapshotExpectedRunStatuses(expectedStatuses);
    } catch (error) {
      return { error };
    }
    const run = this.runs.get(runId);
    return run ? { run, snapshot } : null;
  }

  private getRunMatchingCondition(
    runId: string,
    matches: (run: WorkflowRun) => boolean,
  ): WorkflowRun | null {
    const run = this.requireRun(runId);
    return matches(run) ? run : null;
  }

  private storeRunUpdate(
    runId: string,
    updated: WorkflowRun,
    status: WorkflowRun["status"] | undefined,
  ): void {
    this.runs.set(runId, updated);
    this.publishRunObservation(runId, updated);

    if (status && status !== "running") this.stalledClaims.delete(runId);
    if (status !== "completed" && status !== "cancelled") return;
    if (status === "completed") this.persistRunEventDeliveryReceipts(runId);
    this.runEvents.delete(runId);
    this.runEventClaims.delete(runId);
  }

  private applyRunUpdate(
    runId: string,
    patch: WorkflowRunUpdate,
    condition?: MemoryRunUpdateCondition,
  ): Promise<void> {
    let run: WorkflowRun;
    try {
      // Reject rather than throw synchronously so callers see a rejected Promise
      // consistently (matching the Redis backend's async error paths).
      run = this.requireRun(runId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!this.runMatchesUpdateCondition(run, condition)) return Promise.resolve();

    try {
      assertWorkflowRunUpdate(patch);
    } catch (error) {
      return Promise.reject(error);
    }

    logger.debug(`Updating run: ${runId}`, patch);

    let materializedUpdate: MaterializedMemoryRunUpdate;
    try {
      materializedUpdate = materializeMemoryRunUpdate(patch, runId, this.config);
    } catch (error) {
      return Promise.reject(error);
    }
    let currentRun: WorkflowRun;
    try {
      currentRun = this.requireRun(runId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!this.runMatchesUpdateCondition(currentRun, condition)) return Promise.resolve();
    const updated = mergeMemoryRunUpdate(currentRun, materializedUpdate);
    this.storeRunUpdate(runId, updated, materializedUpdate.storedPatch.status);
    if (condition !== undefined) condition.updated = true;

    return Promise.resolve();
  }

  private updateRunConditionally(
    runId: string,
    patch: WorkflowRunUpdate,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId?: string,
  ): Promise<boolean> {
    let prepared: PreparedMemoryRunCondition;
    try {
      prepared = this.prepareRunCondition(runId, expectedStatuses, expectedWorkerId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (prepared.run === null) return Promise.resolve(false);

    const condition: MemoryRunUpdateCondition = {
      matches: prepared.matches,
      updated: false,
    };
    return this.applyRunUpdate(runId, patch, condition).then(() => condition.updated);
  }

  updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    return this.updateRunConditionally(
      runId,
      patch,
      expectedStatuses,
    );
  }

  updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean> {
    return this.updateRunConditionally(
      runId,
      patch,
      expectedStatuses,
      expectedWorkerId,
    );
  }

  restoreRunStateIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    snapshot: WorkflowRunStateSnapshot,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    let prepared: PreparedMemoryRunCondition;
    try {
      prepared = this.prepareRunCondition(runId, expectedStatuses, expectedWorkerId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (prepared.run === null) return Promise.resolve(false);

    try {
      assertWorkflowRunUpdate(snapshot);
    } catch (error) {
      return Promise.reject(error);
    }

    logger.debug(`Restoring run state snapshot: ${runId}`);

    let storedSnapshot: WorkflowRunStateSnapshot;
    try {
      storedSnapshot = materializeRunStateSnapshot(snapshot, runId, this.config);
    } catch (error) {
      return Promise.reject(error);
    }
    let currentRun: WorkflowRun | null;
    try {
      currentRun = this.getRunMatchingCondition(runId, prepared.matches);
    } catch (error) {
      return Promise.reject(error);
    }
    if (currentRun === null) return Promise.resolve(false);

    // Replacement, not the per-key merge updateRun applies: keys written after
    // the snapshot must not survive a checkpoint restore, or nodes completed
    // after the checkpoint stay completed and are skipped on replay.
    const updated: WorkflowRun = {
      ...currentRun,
      ...storedSnapshot,
    };
    this.storeRunUpdate(runId, updated, storedSnapshot.status);
    return Promise.resolve(true);
  }

  private deleteRunState(runId: string): boolean {
    const hadState = this.runs.has(runId) || this.checkpoints.has(runId) ||
      this.approvals.has(runId) || this.eventWaits.has(runId) ||
      this.runEvents.has(runId) || this.runEventClaims.has(runId) ||
      this.locks.has(runId) || this.stalledClaims.has(runId) ||
      this.runRevisions.has(runId) || this.runRetentionRevisions.has(runId) ||
      this.terminalRetryQueued.has(runId) ||
      this.terminalRetryPending.has(runId) ||
      this.runObservers.has(runId) ||
      reflectApply(arraySome, this.queue, [(item: WorkflowQueueItem) => item.runId === runId]);
    this.closeRunObservers(runId);
    this.runs.delete(runId);
    this.checkpoints.delete(runId);
    this.approvals.delete(runId);
    this.eventWaits.delete(runId);
    this.runEvents.delete(runId);
    this.runEventClaims.delete(runId);
    this.locks.delete(runId);
    this.stalledClaims.delete(runId);
    this.runRevisions.delete(runId);
    this.runRetentionRevisions.delete(runId);
    this.terminalRetryQueued.delete(runId);
    this.terminalRetryPending.delete(runId);
    this.queue = reflectApply(arrayFilter, this.queue, [
      (item: WorkflowQueueItem) => item.runId !== runId,
    ]) as WorkflowQueueItem[];
    return hadState;
  }

  deleteRun(runId: string): Promise<void> {
    this.deleteRunState(runId);
    return Promise.resolve();
  }

  deleteTerminalRunIfUnchanged(
    candidate: TerminalRunRetentionCandidate,
  ): Promise<boolean> {
    let expectedCreatedAt: number;
    let expectedCompletedAt: number;
    try {
      expectedCreatedAt = reflectApply(dateGetTime, candidate.createdAt, []) as number;
      expectedCompletedAt = reflectApply(dateGetTime, candidate.completedAt, []) as number;
    } catch {
      return Promise.resolve(false);
    }
    if (
      !numberIsFinite(expectedCreatedAt) || !numberIsFinite(expectedCompletedAt) ||
      !numberIsSafeInteger(candidate.revision) || candidate.revision < 0
    ) {
      return Promise.resolve(false);
    }
    const run = this.runs.get(candidate.runId);
    if (run === undefined) return Promise.resolve(false);
    const createdAt = reflectApply(dateGetTime, run.createdAt, []) as number;
    const completedAt = run.completedAt === undefined
      ? undefined
      : reflectApply(dateGetTime, run.completedAt, []) as number;
    if (
      run.workflowId !== candidate.workflowId || run.status !== candidate.status ||
      createdAt !== expectedCreatedAt || completedAt !== expectedCompletedAt ||
      this.runRetentionRevisions.get(candidate.runId) !== candidate.revision ||
      (run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled")
    ) {
      return Promise.resolve(false);
    }
    return Promise.resolve(this.deleteRunState(candidate.runId));
  }

  listTerminalRunRetentionCandidates(
    completedBefore: Date,
    limit: number,
  ): Promise<TerminalRunRetentionBatch> {
    let cutoff: number;
    try {
      cutoff = reflectApply(dateGetTime, completedBefore, []) as number;
    } catch {
      return Promise.resolve({ candidates: [], hasMore: false });
    }
    if (!numberIsFinite(cutoff) || !numberIsSafeInteger(limit) || limit <= 0) {
      return Promise.resolve({ candidates: [], hasMore: false });
    }

    const candidates: TerminalRunRetentionCandidate[] = [];
    let hasMore = false;
    for (const run of this.runs.values()) {
      if (
        this.terminalRetryQueued.has(run.id) ||
        this.terminalRetryPending.has(run.id)
      ) continue;
      const candidate = memoryTerminalRetentionCandidate(
        run,
        cutoff,
        this.runRetentionRevisions.get(run.id) ?? 0,
      );
      if (candidate === undefined) continue;
      if (insertBoundedTerminalRetentionCandidate(candidates, candidate, limit)) hasMore = true;
    }
    return Promise.resolve({ candidates, hasMore });
  }

  openRunObservation(
    runId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorkflowRunObservation | null> {
    const run = this.runs.get(runId);
    if (!run) return Promise.resolve(null);

    const feed = new ObservationFeed();
    let detached = false;
    const observer: MemoryRunObserver = {
      feed,
      detach: (drain = false) => {
        if (detached) return;
        detached = true;
        options.signal?.removeEventListener("abort", abortListener);
        const observers = this.runObservers.get(runId);
        observers?.delete(observer);
        if (observers?.size === 0) this.runObservers.delete(runId);
        if (drain) feed.finish();
        else feed.close();
      },
    };
    const abortListener = () => observer.detach();
    let observers = this.runObservers.get(runId);
    if (!observers) {
      observers = new Set();
      this.runObservers.set(runId, observers);
    }
    observers.add(observer);
    options.signal?.addEventListener("abort", abortListener, { once: true });
    if (options.signal?.aborted) observer.detach();

    return Promise.resolve({
      initial: {
        ...cloneWorkflowRun(run),
        pendingApprovals: (this.approvals.get(runId) ?? []).map((approval) =>
          clonePersistedPendingApproval(approval)
        ),
      },
      changes: feed,
      close: () => {
        observer.detach();
        return Promise.resolve();
      },
    });
  }

  private advanceRunRetentionRevision(runId: string): number {
    if (!this.runRetentionRevisions.has(runId)) return 0;
    const revision = this.nextRunRetentionGeneration++;
    this.runRetentionRevisions.set(runId, revision);
    return revision;
  }

  private publishRunObservation(
    runId: string,
    run: WorkflowRun,
    options: { includeApprovals?: boolean } = {},
  ): void {
    const revision = (this.runRevisions.get(runId) ?? 0) + 1;
    this.runRevisions.set(runId, revision);
    this.advanceRunRetentionRevision(runId);
    const observers = this.runObservers.get(runId);
    if (!observers?.size) return;
    const nodes: WorkflowRunObservedState["nodes"] = {};
    for (const [nodeId, node] of Object.entries(run.nodeStates ?? {})) {
      if (!node) continue;
      objectDefineProperty(nodes, nodeId, {
        value: {
          status: node.status,
          attempt: node.attempt,
          ...(node.error !== undefined ? { error: node.error } : {}),
        },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    // Approvals are carried only by approval-append revisions, matching the
    // observed-state contract: an absent field means unchanged. The projection
    // stays down to identifiers and the request message; payloads never leave
    // the approvals store through this path.
    const approvals = options.includeApprovals
      ? (this.approvals.get(runId) ?? [])
        .filter((approval) => approval.status === "pending")
        .map((approval) => ({
          id: approval.id,
          nodeId: approval.nodeId,
          ...(approval.message !== undefined ? { message: approval.message } : {}),
        }))
      : undefined;
    const state: WorkflowRunObservedState = {
      revision,
      status: run.status,
      nodes,
      ...(run.error?.message !== undefined ? { runError: run.error.message } : {}),
      ...(approvals !== undefined ? { approvals } : {}),
    };
    const terminal = run.status === "completed" || run.status === "failed" ||
      run.status === "cancelled";
    for (const observer of [...observers]) {
      if (!observer.feed.push(structuredClone(state))) {
        observer.detach();
      } else if (terminal) {
        observer.detach(true);
      }
    }
  }

  private closeRunObservers(runId: string): void {
    for (const observer of [...(this.runObservers.get(runId) ?? [])]) observer.detach();
  }

  listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    let runs = Array.from(this.runs.values());

    if (filter.workflowId) {
      runs = runs.filter((r) => r.workflowId === filter.workflowId);
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      runs = runs.filter((r) => statuses.includes(r.status));
    }

    if (filter.createdAfter) {
      const createdAfter = filter.createdAfter;
      runs = runs.filter((r) => r.createdAt >= createdAfter);
    }

    if (filter.createdBefore) {
      const createdBefore = filter.createdBefore;
      runs = runs.filter((r) => r.createdAt <= createdBefore);
    }

    runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = filter.offset ?? 0;
    const end = filter.limit ? start + filter.limit : undefined;
    runs = runs.slice(start, end);

    return Promise.resolve(runs.map((run) => cloneWorkflowRun(run)));
  }

  countRuns(filter: RunFilter): Promise<number> {
    // Count in place, with no structuredClone per run (unlike listRuns).
    const statuses = filter.status
      ? Array.isArray(filter.status) ? filter.status : [filter.status]
      : null;

    let count = 0;
    for (const run of this.runs.values()) {
      if (filter.workflowId && run.workflowId !== filter.workflowId) continue;
      if (statuses && !statuses.includes(run.status)) continue;
      if (filter.createdAfter && run.createdAt < filter.createdAfter) continue;
      if (filter.createdBefore && run.createdAt > filter.createdBefore) continue;
      count++;
    }

    return Promise.resolve(count);
  }

  // =========================================================================
  // Checkpointing
  // =========================================================================

  saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void> {
    logger.debug("Saving checkpoint", { checkpointId: checkpoint.id, runId });
    const checkpoints = this.checkpoints.get(runId) ?? [];
    let context: WorkflowContext;
    try {
      context = persistedCheckpointContext(checkpoint.context, runId, this.config);
    } catch (error) {
      return Promise.reject(error);
    }
    appendRetainedCheckpoint(checkpoints, { ...checkpoint, context });
    this.checkpoints.set(runId, checkpoints);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve();
  }

  saveCheckpointIfStatusAndWorker(
    storageRunId: string,
    ownershipRunId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    checkpoint: Checkpoint,
  ): Promise<boolean> {
    const captured = this.captureExpectedStatusesForExistingRun(
      ownershipRunId,
      expectedStatuses,
    );
    if (captured === null) return Promise.resolve(false);
    if ("error" in captured) return Promise.reject(captured.error);
    const { run, snapshot: expectedStatusSnapshot } = captured;
    if (
      !hasExpectedRunStatus(expectedStatusSnapshot, run.status) || run.workerId !== expectedWorkerId
    ) {
      return Promise.resolve(false);
    }

    let persistedCheckpoint: Checkpoint;
    try {
      const context = persistedCheckpointContext(checkpoint.context, storageRunId, this.config);
      persistedCheckpoint = cloneRetainedCheckpoint({ ...checkpoint, context });
    } catch (error) {
      return Promise.reject(error);
    }

    const currentRun = this.runs.get(ownershipRunId);
    if (
      !currentRun || !hasExpectedRunStatus(expectedStatusSnapshot, currentRun.status) ||
      currentRun.workerId !== expectedWorkerId
    ) {
      return Promise.resolve(false);
    }

    const checkpoints = this.checkpoints.get(storageRunId) ?? [];
    appendRetainedCheckpoint(checkpoints, persistedCheckpoint);
    this.checkpoints.set(storageRunId, checkpoints);
    this.advanceRunRetentionRevision(storageRunId);
    return Promise.resolve(true);
  }

  getLatestCheckpoint(runId: string): Promise<Checkpoint | null> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints?.length) return Promise.resolve(null);

    const latest = checkpoints[checkpoints.length - 1];
    return Promise.resolve(latest ? cloneRetainedCheckpoint(latest) : null);
  }

  getCheckpoints(runId: string): Promise<Checkpoint[]> {
    const checkpoints = this.checkpoints.get(runId) ?? [];
    return Promise.resolve(checkpoints.map((c) => cloneRetainedCheckpoint(c)));
  }

  deleteCheckpoint(runId: string, checkpointId: string): Promise<void> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints) return Promise.resolve();

    const index = checkpoints.findIndex((c) => c.id === checkpointId);
    if (index === -1) return Promise.resolve();

    checkpoints.splice(index, 1);
    logger.debug(`Deleted checkpoint: ${checkpointId}`);
    return Promise.resolve();
  }

  deleteCheckpoints(runId: string, checkpointIds: string[]): Promise<void> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints) return Promise.resolve();

    this.checkpoints.set(runId, deleteOldestCheckpointOccurrences(checkpoints, checkpointIds));

    logger.debug("Deleted checkpoints", { count: checkpointIds.length });
    return Promise.resolve();
  }

  // =========================================================================
  // Approvals
  // =========================================================================

  savePendingApproval(runId: string, approval: PersistedPendingApproval): Promise<void> {
    logger.debug("Saving approval", { approvalId: approval.id, runId });
    const approvals = this.approvals.get(runId) ?? [];
    try {
      appendRetainedPendingApproval(approvals, approval);
    } catch (error) {
      return Promise.reject(error);
    }
    this.approvals.set(runId, approvals);
    const run = this.runs.get(runId);
    if (run) this.publishRunObservation(runId, run, { includeApprovals: true });
    return Promise.resolve();
  }

  savePendingApprovalIfAbsent(
    runId: string,
    approval: PersistedPendingApproval,
  ): Promise<boolean> {
    logger.debug("Saving approval", { approvalId: approval.id, runId });
    const approvals = this.approvals.get(runId) ?? [];
    if (
      approvals.some((candidate) =>
        (candidate.status === "pending" || candidate.reconciliationPending === true) &&
        isSameWaitNodeExecution(candidate, approval)
      )
    ) {
      return Promise.resolve(false);
    }
    try {
      appendRetainedPendingApproval(approvals, approval);
    } catch (error) {
      return Promise.reject(error);
    }
    this.approvals.set(runId, approvals);
    // An approval append is a persisted transition of its own. Without it a
    // subscriber only sees the run reach `waiting` and has to fetch approvals
    // separately, racing this very write.
    const run = this.runs.get(runId);
    if (run) this.publishRunObservation(runId, run, { includeApprovals: true });
    return Promise.resolve(true);
  }

  savePendingApprovalIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    approval: PersistedPendingApproval,
  ): Promise<boolean> {
    const captured = this.captureExpectedStatusesForExistingRun(runId, expectedStatuses);
    if (captured === null) return Promise.resolve(false);
    if ("error" in captured) return Promise.reject(captured.error);
    const { run, snapshot: expectedStatusSnapshot } = captured;
    if (
      !hasExpectedRunStatus(expectedStatusSnapshot, run.status) || run.workerId !== expectedWorkerId
    ) {
      return Promise.resolve(false);
    }

    const approvals = this.approvals.get(runId) ?? [];
    if (
      approvals.some((candidate) =>
        (candidate.status === "pending" || candidate.reconciliationPending === true) &&
        isSameWaitNodeExecution(candidate, approval)
      )
    ) {
      return Promise.resolve(false);
    }
    try {
      appendRetainedPendingApproval(approvals, approval);
    } catch (error) {
      return Promise.reject(error);
    }
    this.approvals.set(runId, approvals);
    this.publishRunObservation(runId, run, { includeApprovals: true });
    return Promise.resolve(true);
  }

  updatePendingApproval(
    runId: string,
    approvalId: string,
    patch: Partial<PersistedPendingApproval>,
  ): Promise<void> {
    const approvals = this.approvals.get(runId);
    const index = approvals?.findIndex((approval) => approval.id === approvalId) ?? -1;
    if (!approvals || index === -1) {
      return Promise.reject(
        RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` }),
      );
    }

    approvals[index] = {
      ...approvals[index]!,
      ...structuredClone(patch),
      id: approvalId,
    };
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve();
  }

  getPendingApprovals(runId: string): Promise<PersistedPendingApproval[]> {
    const approvals = this.approvals.get(runId) ?? [];
    return Promise.resolve(
      approvals.filter((a) => a.status === "pending").map((a) => clonePersistedPendingApproval(a)),
    );
  }

  getPendingApproval(
    runId: string,
    approvalId: string,
  ): Promise<PersistedPendingApproval | null> {
    const approvals = this.approvals.get(runId) ?? [];
    const approval = approvals.find((a) => a.id === approvalId);
    return Promise.resolve(approval ? clonePersistedPendingApproval(approval) : null);
  }

  updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<boolean> {
    const approvals = this.approvals.get(runId);
    if (!approvals) {
      return Promise.reject(
        RESOURCE_NOT_FOUND.create({ detail: `No approvals found for run: ${runId}` }),
      );
    }

    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) {
      return Promise.reject(
        RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` }),
      );
    }

    // Pending-precondition gate: only the first decision wins. A concurrent
    // decision on an already-resolved approval is reported as skipped so callers
    // can treat this return value as the authoritative gate.
    if (approval.status !== "pending") {
      return Promise.resolve(false);
    }

    let approved: boolean;
    let approver: string;
    let comment: string | undefined;
    let sourceDecisionData: unknown;
    let decisionData: unknown;
    try {
      approved = decision.approved;
      approver = decision.approver;
      comment = decision.comment;
      sourceDecisionData = decision.data;
      if (sourceDecisionData !== undefined) {
        decisionData = persistedApprovalDecisionData(sourceDecisionData, runId, this.config);
      }
    } catch (error) {
      return Promise.reject(error);
    }
    const currentApproval = this.approvals.get(runId)?.find((candidate) =>
      candidate.id === approvalId
    );
    if (!currentApproval || currentApproval !== approval) {
      return Promise.reject(
        RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` }),
      );
    }
    if (currentApproval.status !== "pending") return Promise.resolve(false);
    logger.debug("Updating approval", { approvalId, approved });
    currentApproval.status = approved ? "approved" : "rejected";
    currentApproval.decidedBy = approver;
    currentApproval.decidedAt = new Date();
    currentApproval.comment = comment;
    if (sourceDecisionData === undefined) delete currentApproval.decisionData;
    else currentApproval.decisionData = decisionData;
    currentApproval.reconciliationPending = true;
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  listApprovalDecisionClaims(
    runId?: string,
  ): Promise<Array<{ runId: string; approval: PersistedPendingApproval }>> {
    const claims: Array<{ runId: string; approval: PersistedPendingApproval }> = [];
    for (const [claimRunId, approvals] of this.approvals) {
      if (runId !== undefined && claimRunId !== runId) continue;
      for (const approval of approvals) {
        if (approval.reconciliationPending === true) {
          claims.push({
            runId: claimRunId,
            approval: clonePersistedPendingApproval(approval),
          });
        }
      }
    }
    return Promise.resolve(claims);
  }

  reserveApprovalDecisionClaim(
    runId: string,
    approvalId: string,
    recoveryClaimId: string,
    claimedAt: Date,
    staleBefore: Date,
  ): Promise<boolean> {
    const approval = this.approvals.get(runId)?.find((candidate) => candidate.id === approvalId);
    if (approval?.reconciliationPending !== true) return Promise.resolve(false);
    if (approval.recoveryClaimedAt && approval.recoveryClaimedAt > staleBefore) {
      return Promise.resolve(false);
    }
    approval.recoveryClaimId = recoveryClaimId;
    approval.recoveryClaimedAt = new Date(claimedAt);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  releaseApprovalDecisionClaim(
    runId: string,
    approvalId: string,
    recoveryClaimId: string,
  ): Promise<void> {
    const approval = this.approvals.get(runId)?.find((candidate) => candidate.id === approvalId);
    if (approval?.recoveryClaimId === recoveryClaimId) {
      delete approval.recoveryClaimId;
      delete approval.recoveryClaimedAt;
      this.advanceRunRetentionRevision(runId);
    }
    return Promise.resolve();
  }

  finalizeApprovalDecision(
    runId: string,
    approvalId: string,
    recoveryClaimId?: string,
  ): Promise<void> {
    const approval = this.approvals.get(runId)?.find((candidate) => candidate.id === approvalId);
    if (!approval) return Promise.resolve();
    if (
      recoveryClaimId === undefined
        ? approval.recoveryClaimId !== undefined
        : approval.recoveryClaimId !== recoveryClaimId
    ) return Promise.resolve();
    delete approval.reconciliationPending;
    delete approval.recoveryClaimId;
    delete approval.recoveryClaimedAt;
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve();
  }

  listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PersistedPendingApproval }>> {
    const result: Array<{ runId: string; approval: PersistedPendingApproval }> = [];

    for (const [runId, approvals] of this.approvals) {
      const run = this.runs.get(runId);
      if (!run) continue;
      if (filter?.workflowId && run.workflowId !== filter.workflowId) continue;

      for (const approval of approvals) {
        if (filter?.status === "pending" && approval.status !== "pending") continue;

        if (filter?.status === "expired") {
          const isExpired = approval.expiresAt != null && new Date() > approval.expiresAt;
          if (!isExpired) continue;
        }

        if (
          filter?.approver &&
          approval.approvers &&
          !approval.approvers.includes(filter.approver)
        ) {
          continue;
        }

        result.push({ runId, approval: clonePersistedPendingApproval(approval) });
      }
    }

    return Promise.resolve(result);
  }

  // =========================================================================
  // Durable event waits
  // =========================================================================

  savePendingEventWait(runId: string, wait: PersistedPendingEventWait): Promise<void> {
    logger.debug("Saving event wait", { waitId: wait.id, runId });
    const waits = this.eventWaits.get(runId) ?? [];
    if (
      waits.some((candidate) =>
        (candidate.status === "pending" || candidate.claimedEventId !== undefined ||
          (candidate.claimedAt !== undefined &&
            (candidate.waitKind === "delay" || candidate.status === "expired"))) &&
        isSameWaitNodeExecution(candidate, wait)
      )
    ) {
      return Promise.resolve();
    }
    try {
      appendRetainedPendingEventWait(waits, wait);
    } catch (error) {
      return Promise.reject(error);
    }
    this.eventWaits.set(runId, waits);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve();
  }

  savePendingEventWaitIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    wait: PersistedPendingEventWait,
  ): Promise<boolean> {
    const captured = this.captureExpectedStatusesForExistingRun(runId, expectedStatuses);
    if (captured === null) {
      return Promise.reject(RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` }));
    }
    if ("error" in captured) return Promise.reject(captured.error);
    const { run, snapshot: expectedStatusSnapshot } = captured;
    if (
      !hasExpectedRunStatus(expectedStatusSnapshot, run.status) ||
      run.workerId !== expectedWorkerId
    ) {
      return Promise.resolve(false);
    }
    const waits = this.eventWaits.get(runId) ?? [];
    if (
      waits.some((candidate) =>
        (candidate.status === "pending" || candidate.claimedEventId !== undefined ||
          (candidate.claimedAt !== undefined &&
            (candidate.waitKind === "delay" || candidate.status === "expired"))) &&
        isSameWaitNodeExecution(candidate, wait)
      )
    ) {
      return Promise.resolve(false);
    }
    try {
      appendRetainedPendingEventWait(waits, wait);
    } catch (error) {
      return Promise.reject(error);
    }
    this.eventWaits.set(runId, waits);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  getPendingEventWaits(runId: string): Promise<PersistedPendingEventWait[]> {
    const waits = this.eventWaits.get(runId) ?? [];
    return Promise.resolve(
      waits.filter((wait) => wait.status === "pending").map((wait) => structuredClone(wait)),
    );
  }

  listPendingEventWaits(): Promise<Array<{ runId: string; wait: PersistedPendingEventWait }>> {
    const result: Array<{ runId: string; wait: PersistedPendingEventWait }> = [];
    for (const [runId, waits] of this.eventWaits) {
      if (!this.runs.has(runId)) continue;
      for (const wait of waits) {
        if (wait.status !== "pending") continue;
        result.push({ runId, wait: structuredClone(wait) });
      }
    }
    return Promise.resolve(result);
  }

  resolvePendingEventWait(
    runId: string,
    waitId: string,
    status: "delivered" | "expired" | "cancelled",
  ): Promise<boolean> {
    const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === waitId);
    // Pending-precondition gate: delivery, expiry, and cancellation race for
    // the same record, and only the winner may act on the run.
    if (wait?.status !== "pending") return Promise.resolve(false);
    wait.status = status;
    if (status === "delivered" || status === "expired") wait.claimedAt = new Date();
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  restorePendingEventWait(runId: string, waitId: string): Promise<boolean> {
    const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === waitId);
    // Only a claim is given back: a delivered claim whose node completion
    // failed, or an expired claim whose run failure did not commit. A record
    // still pending was never claimed by anyone, and a cancelled record
    // belongs to a terminal run.
    if (wait?.status !== "delivered" && wait?.status !== "expired") {
      return Promise.resolve(false);
    }
    wait.status = "pending";
    delete wait.claimedAt;
    delete wait.recoveryClaimedAt;
    delete wait.claimedEventId;
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  listTimedEventWaitClaims(runId?: string): Promise<PersistedPendingEventWait[]> {
    const claims: PersistedPendingEventWait[] = [];
    for (const [claimRunId, waits] of this.eventWaits) {
      if (runId !== undefined && claimRunId !== runId) continue;
      for (const wait of waits) {
        if (
          wait.claimedAt !== undefined &&
          ((wait.waitKind === "delay" && wait.status === "delivered") ||
            (wait.waitKind === "event" && wait.status === "expired"))
        ) {
          claims.push(structuredClone(wait));
        }
      }
    }
    return Promise.resolve(claims);
  }

  reserveTimedEventWaitClaim(
    runId: string,
    waitId: string,
    claimedAt: Date,
    staleBefore: Date,
  ): Promise<boolean> {
    const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === waitId);
    const isTimedClaim = wait?.claimedAt !== undefined &&
      ((wait.waitKind === "delay" && wait.status === "delivered") ||
        (wait.waitKind === "event" && wait.status === "expired"));
    if (
      !isTimedClaim ||
      (wait.recoveryClaimedAt !== undefined && wait.recoveryClaimedAt > staleBefore)
    ) return Promise.resolve(false);
    wait.recoveryClaimedAt = new Date(claimedAt);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  finalizeTimedEventWaitClaim(runId: string, waitId: string): Promise<void> {
    const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === waitId);
    if (wait) {
      delete wait.claimedAt;
      delete wait.recoveryClaimedAt;
      this.advanceRunRetentionRevision(runId);
    }
    return Promise.resolve();
  }

  appendRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    const existingMailbox = this.runEvents.get(runId);
    if (existingMailbox === undefined) {
      this.evictOrphanRunEventMailboxes(1);
      if (this.runEvents.size >= MAX_WORKFLOW_RUN_EVENT_MAILBOXES) {
        return Promise.reject(ORCHESTRATION_ERROR.create({
          detail: "Run event mailbox capacity reached",
        }));
      }
    }
    const mailbox = existingMailbox ?? [];
    try {
      appendRetainedRunEvent(mailbox, {
        ...event,
        _publicationOrder: this.nextRunEventPublicationOrder++,
      } as RunEventEnvelope, this.runEventClaims.get(runId)?.size ?? 0);
    } catch (error) {
      return Promise.reject(error);
    }
    this.runEvents.set(runId, mailbox);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve();
  }

  removeRunEvent(runId: string, eventId: string): Promise<boolean> {
    const mailbox = this.runEvents.get(runId);
    if (!mailbox) return Promise.resolve(false);
    const index = mailbox.findIndex((event) => event.id === eventId);
    if (index < 0) return Promise.resolve(false);
    mailbox.splice(index, 1);
    this.deleteEmptyRunEventMailbox(runId, mailbox);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  /**
   * Drop the oldest mailboxes that no wait can ever claim from again, once the
   * mailbox count is over its bound. Publishing to a run id before the run
   * exists is supported, so a caller publishing to ids that never become runs
   * would otherwise accumulate mailboxes forever, and a run that reached a
   * completed or cancelled will never park on anything again, so its buffered
   * events are equally unclaimable. Failed runs remain retryable and retain
   * their mail just like active runs.
   */
  private evictOrphanRunEventMailboxes(requiredSlots = 0): void {
    let overflow = this.runEvents.size + requiredSlots - MAX_WORKFLOW_RUN_EVENT_MAILBOXES;
    if (overflow <= 0) return;
    const mailboxRetainingStatuses = new Set<WorkflowRun["status"]>([
      "pending",
      "running",
      "waiting",
      "failed",
    ]);
    for (const mailboxRunId of this.runEvents.keys()) {
      if (overflow <= 0) return;
      const run = this.runs.get(mailboxRunId);
      if (run && mailboxRetainingStatuses.has(run.status)) continue;
      if ((this.runEventClaims.get(mailboxRunId)?.size ?? 0) > 0) continue;
      this.runEvents.delete(mailboxRunId);
      overflow--;
    }
  }

  takeRunEvent(runId: string, eventName: string): Promise<RunEventEnvelope | null> {
    const mailbox = this.runEvents.get(runId);
    if (!mailbox) return Promise.resolve(null);
    // Taking mutates synchronously before returning, so removal and return are
    // one atomic step for this in-memory backend.
    const taken = takeRetainedRunEvent(mailbox, eventName);
    this.deleteEmptyRunEventMailbox(runId, mailbox);
    if (taken) this.advanceRunRetentionRevision(runId);
    return Promise.resolve(taken);
  }

  peekRunEvent(runId: string, eventName: string): Promise<RunEventEnvelope | null> {
    const event = this.runEvents.get(runId)?.find((candidate) => candidate.eventName === eventName);
    return Promise.resolve(event ? structuredClone(event) : null);
  }

  /** Claim the oldest matching event and its pending wait as one synchronous mutation. */
  claimRunEventForWait(
    runId: string,
    waitId: string,
    eventName: string,
    publishedBefore?: Date,
  ): Promise<RunEventEnvelope | null> {
    const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === waitId);
    if (wait?.status !== "pending") return Promise.resolve(null);
    const mailbox = this.runEvents.get(runId);
    if (!mailbox) return Promise.resolve(null);
    const taken = takeRetainedRunEvent(mailbox, eventName, publishedBefore);
    if (!taken) return Promise.resolve(null);
    wait.status = "delivered";
    wait.claimedAt = new Date();
    wait.claimedEventId = taken.id;
    const claims = this.runEventClaims.get(runId) ?? new Map<string, RunEventDeliveryClaim>();
    claims.set(taken.id, {
      wait: structuredClone(wait),
      event: structuredClone(taken),
      claimedAt: wait.claimedAt,
    });
    this.runEventClaims.set(runId, claims);
    // Keep an empty mailbox as the claimed event's capacity reservation. The
    // asynchronous delivery may still roll back, and another run must not take
    // this slot before restoreRunEventDelivery puts the event back.
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(taken);
  }

  listRunEventDeliveryClaims(runId?: string): Promise<RunEventDeliveryClaim[]> {
    const claims: RunEventDeliveryClaim[] = [];
    for (const [claimRunId, runClaims] of this.runEventClaims) {
      if (runId !== undefined && claimRunId !== runId) continue;
      for (const claim of runClaims.values()) claims.push(structuredClone(claim));
    }
    return Promise.resolve(claims);
  }

  reserveRunEventDeliveryClaim(
    runId: string,
    waitId: string,
    eventId: string,
    claimedAt: Date,
    staleBefore: Date,
  ): Promise<boolean> {
    const claim = this.runEventClaims.get(runId)?.get(eventId);
    if (
      claim?.wait.id !== waitId ||
      (claim.wait.recoveryClaimedAt !== undefined &&
        claim.wait.recoveryClaimedAt > staleBefore)
    ) {
      return Promise.resolve(false);
    }
    claim.wait.recoveryClaimedAt = new Date(claimedAt);
    const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === waitId);
    if (wait) wait.recoveryClaimedAt = new Date(claimedAt);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(true);
  }

  restoreRunEvent(runId: string, event: RunEventEnvelope): Promise<void> {
    const mailbox = this.runEvents.get(runId) ?? [];
    restoreRetainedRunEvent(mailbox, event);
    this.runEvents.set(runId, mailbox);
    this.releaseRunEventClaim(runId, event.id);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve();
  }

  /**
   * Undo a claimed-but-undelivered delivery: the wait returns to pending and
   * the event to its publication-order mailbox position as one step.
   *
   * Every mutation is one synchronous in-memory state transition, so callers
   * cannot observe the restored wait before its event returns to the mailbox.
   * A durable backend must implement this as a single atomic operation (a
   * transaction or script) instead.
   */
  restoreRunEventDelivery(
    runId: string,
    waitId: string,
    event: RunEventEnvelope,
  ): Promise<boolean> {
    const claim = this.runEventClaims.get(runId)?.get(event.id);
    if (claim?.wait.id !== waitId) return Promise.resolve(false);
    const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === waitId);
    const restored = !!wait && (wait.status === "delivered" || wait.status === "expired");
    if (restored) {
      wait.status = "pending";
      delete wait.claimedAt;
      delete wait.recoveryClaimedAt;
      delete wait.claimedEventId;
    }
    // The event goes back even when the wait belongs to another actor now: it
    // held its mailbox place before the claim.
    const mailbox = this.runEvents.get(runId) ?? [];
    restoreRetainedRunEvent(mailbox, claim.event);
    this.runEvents.set(runId, mailbox);
    this.releaseRunEventClaim(runId, event.id);
    this.advanceRunRetentionRevision(runId);
    return Promise.resolve(restored);
  }

  finalizeRunEventDelivery(
    runId: string,
    eventId: string,
    delivered: boolean,
  ): Promise<void> {
    const claim = this.runEventClaims.get(runId)?.get(eventId);
    if (claim) {
      const wait = this.eventWaits.get(runId)?.find((candidate) => candidate.id === claim.wait.id);
      if (wait) {
        delete wait.claimedAt;
        delete wait.recoveryClaimedAt;
        delete wait.claimedEventId;
        if (delivered) wait.deliveredEventId = eventId;
      }
      this.advanceRunRetentionRevision(runId);
    }
    this.releaseRunEventClaim(runId, eventId);
    const mailbox = this.runEvents.get(runId);
    if (mailbox) this.deleteEmptyRunEventMailbox(runId, mailbox);
    return Promise.resolve();
  }

  hasRunEventDeliveryReceipt(runId: string, eventId: string): Promise<boolean> {
    return Promise.resolve(
      this.eventWaits.get(runId)?.some((wait) => wait.deliveredEventId === eventId) ?? false,
    );
  }

  private persistRunEventDeliveryReceipts(runId: string): void {
    const waits = this.eventWaits.get(runId);
    const run = this.runs.get(runId);
    if (!waits || !run) return;
    for (const [eventId, claim] of this.runEventClaims.get(runId) ?? []) {
      const wait = waits.find((candidate) => candidate.id === claim.wait.id);
      if (!wait) continue;
      delete wait.claimedAt;
      delete wait.recoveryClaimedAt;
      delete wait.claimedEventId;
      if (run.nodeStates[claim.wait.nodeId]?.status === "completed") {
        wait.deliveredEventId = eventId;
      }
    }
  }

  private releaseRunEventClaim(runId: string, eventId: string): void {
    const claims = this.runEventClaims.get(runId);
    if (!claims) return;
    claims.delete(eventId);
    if (claims.size === 0) this.runEventClaims.delete(runId);
  }

  private deleteEmptyRunEventMailbox(runId: string, mailbox: RunEventEnvelope[]): void {
    if (mailbox.length > 0 || (this.runEventClaims.get(runId)?.size ?? 0) > 0) return;
    this.runEvents.delete(runId);
  }

  // =========================================================================
  // Queue Operations
  // =========================================================================

  enqueue(job: WorkflowQueueItem): Promise<void> {
    const maxSize = this.config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    if (this.queue.length >= maxSize) {
      return Promise.reject(
        ORCHESTRATION_ERROR.create({
          detail: `Queue full (max: ${maxSize}). Cannot enqueue job: ${job.runId}`,
        }),
      );
    }

    logger.debug(`Enqueueing job: ${job.runId}`);

    const priority = job.priority ?? 0;
    const insertIndex = this.queue.findIndex((j) => (j.priority ?? 0) < priority);
    const cloned = structuredClone(job);

    if (insertIndex === -1) this.queue.push(cloned);
    else this.queue.splice(insertIndex, 0, cloned);
    this.terminalRetryQueued.add(job.runId);
    this.advanceRunRetentionRevision(job.runId);
    return Promise.resolve();
  }

  dequeue(): Promise<WorkflowQueueItem | null> {
    const job = this.queue.shift();
    if (job && this.terminalRetryQueued.has(job.runId)) {
      this.terminalRetryPending.set(
        job.runId,
        (this.terminalRetryPending.get(job.runId) ?? 0) + 1,
      );
    }
    return Promise.resolve(job ? structuredClone(job) : null);
  }

  acknowledge(runId: string): Promise<void> {
    logger.debug(`Acknowledging job: ${runId}`);
    const pending = this.terminalRetryPending.get(runId) ?? 0;
    if (pending > 1) this.terminalRetryPending.set(runId, pending - 1);
    else this.terminalRetryPending.delete(runId);
    const stillQueued = reflectApply(arraySome, this.queue, [
      (item: WorkflowQueueItem) => item.runId === runId,
    ]) as boolean;
    if (!stillQueued && !this.terminalRetryPending.has(runId)) {
      this.terminalRetryQueued.delete(runId);
    }
    return Promise.resolve();
  }

  async nack(runId: string): Promise<void> {
    await requeueRun(this, runId);
    await this.acknowledge(runId);
  }

  // =========================================================================
  // Distributed Locking
  // =========================================================================

  acquireLock(runId: string, duration: number): Promise<string | null> {
    const existing = this.locks.get(runId);
    const now = Date.now();

    if (existing && existing.expiresAt > now) return Promise.resolve(null);

    logger.debug(`Acquiring lock for: ${runId}`);

    const lockId = crypto.randomUUID();
    this.locks.set(runId, { lockId, expiresAt: now + duration });
    return Promise.resolve(lockId);
  }

  releaseLock(runId: string, lockId?: string): Promise<void> {
    logger.debug(`Releasing lock for: ${runId}`);

    // Compare-and-delete: a stalled worker whose lock already expired and was
    // re-acquired by another owner must not delete the new owner's lock.
    const existing = this.locks.get(runId);
    if (lockId !== undefined && existing && existing.lockId !== lockId) {
      return Promise.resolve();
    }

    this.locks.delete(runId);
    return Promise.resolve();
  }

  extendLock(runId: string, duration: number, lockId?: string): Promise<boolean> {
    const existing = this.locks.get(runId);
    const now = Date.now();

    if (!existing || existing.expiresAt <= now) return Promise.resolve(false);
    if (lockId !== undefined && existing.lockId !== lockId) return Promise.resolve(false);

    existing.expiresAt = now + duration;
    return Promise.resolve(true);
  }

  isLocked(runId: string): Promise<boolean> {
    const existing = this.locks.get(runId);
    return Promise.resolve(!!existing && existing.expiresAt > Date.now());
  }

  // =========================================================================
  // Stalled Run Recovery
  // =========================================================================

  findStalledRuns(stalledThreshold: number): Promise<WorkflowRun[]> {
    const now = Date.now();
    const stalled = Array.from(this.runs.values())
      .filter((run) => run.status === "running")
      .filter((run) => {
        const lastActivity = run.heartbeatAt?.getTime() ?? run.startedAt?.getTime() ??
          run.createdAt.getTime();
        return now - lastActivity >= stalledThreshold;
      })
      .map((run) => cloneWorkflowRun(run));

    return Promise.resolve(stalled);
  }

  claimStalledRun(runId: string, workerId: string, stalledThreshold: number): Promise<boolean> {
    const now = Date.now();
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") {
      return Promise.resolve(false);
    }

    const lastActivity = run.heartbeatAt?.getTime() ?? run.startedAt?.getTime() ??
      run.createdAt.getTime();
    if (now - lastActivity < stalledThreshold) {
      return Promise.resolve(false);
    }

    const claim = this.stalledClaims.get(runId);
    if (claim && claim.expiresAt > now) {
      return Promise.resolve(false);
    }

    this.stalledClaims.set(runId, {
      workerId,
      expiresAt: now + stalledThreshold,
    });

    run.workerId = workerId;
    run.startedAt = run.startedAt ?? new Date(now);
    run.heartbeatAt = new Date(now);
    this.runs.set(runId, run);
    this.publishRunObservation(runId, run);

    return Promise.resolve(true);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  initialize(): Promise<void> {
    logger.debug("Initialized");
    return Promise.resolve();
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  destroy(): Promise<void> {
    this.clear();

    logger.debug("Destroyed");
    return Promise.resolve();
  }

  // =========================================================================
  // Development Helpers
  // =========================================================================

  getStats(): {
    runs: number;
    checkpoints: number;
    approvals: number;
    queueLength: number;
    locks: number;
  } {
    let totalCheckpoints = 0;
    let totalApprovals = 0;

    for (const checkpoints of this.checkpoints.values()) totalCheckpoints += checkpoints.length;
    for (const approvals of this.approvals.values()) totalApprovals += approvals.length;

    return {
      runs: this.runs.size,
      checkpoints: totalCheckpoints,
      approvals: totalApprovals,
      queueLength: this.queue.length,
      locks: this.locks.size,
    };
  }

  clear(): Promise<void> {
    for (const runId of [...this.runObservers.keys()]) this.closeRunObservers(runId);
    this.runs.clear();
    this.checkpoints.clear();
    this.approvals.clear();
    this.eventWaits.clear();
    this.runEvents.clear();
    this.runEventClaims.clear();
    this.queue = [];
    this.locks.clear();
    this.stalledClaims.clear();
    this.runRevisions.clear();
    this.runRetentionRevisions.clear();
    this.terminalRetryQueued.clear();
    this.terminalRetryPending.clear();
    return Promise.resolve();
  }
}
