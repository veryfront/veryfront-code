import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  hasTimedWaitRecoverySupport,
  type TimedWaitClaim,
  type WorkflowBackend,
  type WorkflowRunCursor,
} from "../backends/types.ts";
import { compareRunIdsDescending } from "../backends/run-filter.ts";
import { isCanonicalApprovalIdentity, type WorkflowRun } from "../types.ts";
import {
  MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES,
  MAX_WORKFLOW_DEFINITION_DEPTH,
  MAX_WORKFLOW_DEFINITION_STATIC_BYTES,
  MAX_WORKFLOW_DEFINITION_STATIC_VALUES,
} from "../limits.ts";
import {
  getTimedWorkflowWaits,
  reconcileClaimedTimedWorkflowWait,
  reconcileTimedWorkflowWait,
  type TimedWorkflowWaitReconciliationOutcome,
} from "./timed-wait-reconciliation.ts";

const TIMED_WAIT_RECOVERY_BATCH_SIZE = 100;
// Long enough for one bounded persistence round trip, short enough for a
// replacement recovery service to make prompt progress after process death.
const TIMED_WAIT_CLAIM_LEASE_MS = 30_000;
const TIMED_WAIT_CLAIM_FIELDS = new Set<PropertyKey>([
  "run",
  "nodeId",
  "deadline",
  "claimId",
  "leaseExpiresAt",
  "waitKind",
]);
const SNAPSHOT_TEXT_ENCODER = new TextEncoder();

export interface TimedWaitRecoveryError {
  readonly error: unknown;
  readonly runId?: string;
}

export interface TimedWaitRecoveryCycleOptions {
  readonly now: number;
  /** Number of delay wakes that can be admitted immediately in this cycle. */
  readonly maxAwakened: number;
  /** Optional next durable owner for a worker that resumes wakes directly. */
  readonly nextWorkerId?: string;
}

export interface TimedWaitRecoveryCycleResult {
  readonly awakenedRuns: WorkflowRun[];
  readonly outcomes: TimedWorkflowWaitReconciliationOutcome[];
  readonly errors: TimedWaitRecoveryError[];
}

function isCanonicalIdentity(value: unknown): value is string {
  return isCanonicalApprovalIdentity(value);
}

function compareIdentities(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface TimedWaitSnapshotBudget {
  nodes: number;
  bytes: number;
  readonly seen: Map<object, unknown>;
}

function consumeSnapshotString(value: string, budget: TimedWaitSnapshotBudget): void {
  const remaining = MAX_WORKFLOW_DEFINITION_STATIC_BYTES - budget.bytes;
  if (value.length > remaining) throw new TypeError();
  budget.bytes += SNAPSHOT_TEXT_ENCODER.encode(value).byteLength;
  if (budget.bytes > MAX_WORKFLOW_DEFINITION_STATIC_BYTES) throw new TypeError();
}

/** Capture a bounded data-only graph without invoking getters or Proxy traps. */
function snapshotTimedWaitData(
  value: unknown,
  budget: TimedWaitSnapshotBudget,
  depth = 0,
): unknown {
  if (depth > MAX_WORKFLOW_DEFINITION_DEPTH) throw new TypeError();
  if (++budget.nodes > MAX_WORKFLOW_DEFINITION_STATIC_VALUES) throw new TypeError();
  if (typeof value === "string") {
    consumeSnapshotString(value, budget);
    return value;
  }
  if (
    value === null || value === undefined || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return value;
  if (typeof value !== "object" || isProxyWithoutHooks(value)) throw new TypeError();

  const existing = budget.seen.get(value);
  if (existing !== undefined) return existing;

  try {
    const timestamp = Date.prototype.getTime.call(value);
    if (!Number.isFinite(timestamp)) throw new TypeError();
    const date = new Date(timestamp);
    budget.seen.set(value, date);
    return date;
  } catch (cause) {
    if (cause instanceof TypeError && Object.getPrototypeOf(value) === Date.prototype) throw cause;
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new TypeError();

  if (isArray) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES || keys.length !== length + 1 ||
      !keys.includes("length")
    ) throw new TypeError();
    const snapshot = new Array<unknown>(length);
    budget.seen.set(value, snapshot);
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError();
      snapshot[index] = snapshotTimedWaitData(descriptor.value, budget, depth + 1);
    }
    return snapshot;
  }

  if (keys.length > MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES) throw new TypeError();
  const snapshot = Object.create(prototype) as Record<string, unknown>;
  budget.seen.set(value, snapshot);
  for (const key of keys as string[]) {
    consumeSnapshotString(key, budget);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError();
    Object.defineProperty(snapshot, key, {
      value: snapshotTimedWaitData(descriptor.value, budget, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return snapshot;
}

function snapshotTimedWaitClaimPage(value: unknown, limit: number): TimedWaitClaim[] {
  if (isProxyWithoutHooks(value) || !Array.isArray(value)) throw new TypeError();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  const keys = Reflect.ownKeys(value);
  if (
    !Number.isSafeInteger(length) || length < 0 || length > limit || keys.length !== length + 1 ||
    !keys.includes("length") || keys.some((key) =>
      key !== "length" &&
      (typeof key !== "string" || !/^\d+$/.test(key) || Number(key) >= length)
    )
  ) throw new TypeError();

  const budget: TimedWaitSnapshotBudget = { nodes: 0, bytes: 0, seen: new Map() };
  const claims: TimedWaitClaim[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError();
    const claim = snapshotTimedWaitData(descriptor.value, budget);
    if (
      typeof claim !== "object" || claim === null || Array.isArray(claim) ||
      Reflect.ownKeys(claim).length !== TIMED_WAIT_CLAIM_FIELDS.size ||
      Reflect.ownKeys(claim).some((key) => !TIMED_WAIT_CLAIM_FIELDS.has(key))
    ) throw new TypeError();
    claims.push(claim as TimedWaitClaim);
  }
  return claims;
}

/** Shared bounded timed-wait recovery service used by every managed worker. */
export class TimedWaitRecoveryService {
  private legacyCursor?: WorkflowRunCursor;
  private readonly backend: WorkflowBackend;
  private readonly ownerId: string;

  constructor(backend: WorkflowBackend, ownerId: string) {
    if (typeof ownerId !== "string" || ownerId.length === 0 || ownerId.trim() !== ownerId) {
      throw new TypeError("Timed-wait recovery owner id must be a canonical non-empty string");
    }
    this.backend = backend;
    this.ownerId = ownerId;
  }

  async recover(
    options: TimedWaitRecoveryCycleOptions,
  ): Promise<TimedWaitRecoveryCycleResult> {
    if (!Number.isSafeInteger(options.now)) {
      throw new TypeError("Timed-wait recovery time must be a safe integer");
    }
    if (!Number.isSafeInteger(options.maxAwakened) || options.maxAwakened < 0) {
      throw new TypeError("Timed-wait recovery awakened limit must be a non-negative integer");
    }

    if (hasTimedWaitRecoverySupport(this.backend)) {
      return await this.recoverIndexed(options);
    }
    if (typeof this.backend.listRunsAfterCursor === "function") {
      return await this.recoverLegacyPage(options);
    }
    // Compatibility window for existing third-party worker backends. Once the
    // managed-backend breaking policy is approved this branch can fail closed.
    return { awakenedRuns: [], outcomes: [], errors: [] };
  }

  private async recoverIndexed(
    options: TimedWaitRecoveryCycleOptions,
  ): Promise<TimedWaitRecoveryCycleResult> {
    const awakenedRuns: WorkflowRun[] = [];
    const outcomes: TimedWorkflowWaitReconciliationOutcome[] = [];
    const errors: TimedWaitRecoveryError[] = [];
    const eventRequest = {
      ownerId: this.ownerId,
      now: options.now,
      limit: TIMED_WAIT_RECOVERY_BATCH_SIZE,
      leaseDuration: TIMED_WAIT_CLAIM_LEASE_MS,
      waitKind: "event",
    } as const;
    const eventClaims = this.validateClaimPage(
      await this.backend.claimDueTimedWaits!(eventRequest),
      eventRequest,
    );
    await this.processClaims(eventClaims, options, awakenedRuns, outcomes, errors);

    const delayLimit = Math.min(options.maxAwakened, TIMED_WAIT_RECOVERY_BATCH_SIZE);
    if (delayLimit > 0) {
      const delayRequest = {
        ownerId: this.ownerId,
        now: options.now,
        limit: delayLimit,
        leaseDuration: TIMED_WAIT_CLAIM_LEASE_MS,
        waitKind: "delay",
      } as const;
      const delayClaims = this.validateClaimPage(
        await this.backend.claimDueTimedWaits!(delayRequest),
        delayRequest,
      );
      await this.processClaims(delayClaims, options, awakenedRuns, outcomes, errors);
    }
    return { awakenedRuns, outcomes, errors };
  }

  private validateClaimPage(
    value: unknown,
    request: {
      readonly now: number;
      readonly limit: number;
      readonly waitKind: "delay" | "event";
    },
  ): TimedWaitClaim[] {
    try {
      const claims = snapshotTimedWaitClaimPage(value, request.limit);
      const rowIds = new Set<string>();
      const claimIds = new Set<string>();
      let previous: TimedWaitClaim | undefined;
      for (const claim of claims) {
        if (typeof claim !== "object" || claim === null || Array.isArray(claim)) {
          throw new TypeError();
        }
        const run = claim.run;
        if (
          typeof run !== "object" || run === null || Array.isArray(run) ||
          !isCanonicalIdentity(run.id) || run.status !== "waiting" ||
          !isCanonicalIdentity(run.workerId) || !isCanonicalIdentity(claim.nodeId) ||
          !isCanonicalIdentity(claim.claimId) || claim.waitKind !== request.waitKind ||
          !Number.isSafeInteger(claim.deadline) || claim.deadline > request.now
        ) {
          throw new TypeError();
        }
        let leaseExpiresAt: number;
        try {
          leaseExpiresAt = Date.prototype.getTime.call(claim.leaseExpiresAt);
        } catch {
          throw new TypeError();
        }
        if (!Number.isSafeInteger(leaseExpiresAt)) throw new TypeError();

        const exactRegistration = getTimedWorkflowWaits(run).some((registration) =>
          registration.nodeId === claim.nodeId && registration.deadline === claim.deadline &&
          registration.waitKind === claim.waitKind && registration.workerId === run.workerId
        );
        if (!exactRegistration) throw new TypeError();

        const rowId = JSON.stringify([run.id, claim.nodeId]);
        if (rowIds.has(rowId) || claimIds.has(claim.claimId)) throw new TypeError();
        rowIds.add(rowId);
        claimIds.add(claim.claimId);

        if (previous) {
          const order = claim.deadline - previous.deadline ||
            compareIdentities(claim.run.id, previous.run.id) ||
            compareIdentities(claim.nodeId, previous.nodeId);
          if (order < 0) throw new TypeError();
        }
        previous = claim;
      }
      return claims;
    } catch (cause) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow backend returned an invalid timed-wait claim page",
        cause,
      });
    }
  }

  private async processClaims(
    claims: TimedWaitClaim[],
    options: TimedWaitRecoveryCycleOptions,
    awakenedRuns: WorkflowRun[],
    outcomes: TimedWorkflowWaitReconciliationOutcome[],
    errors: TimedWaitRecoveryError[],
  ): Promise<void> {
    for (const claim of claims) {
      let outcome: TimedWorkflowWaitReconciliationOutcome | null;
      try {
        outcome = await reconcileClaimedTimedWorkflowWait(this.backend, claim, {
          now: options.now,
          nextWorkerId: options.nextWorkerId,
        });
      } catch (error) {
        let observedError: unknown = error;
        try {
          await this.backend.releaseTimedWaitClaim!(claim.run.id, claim.nodeId, claim.claimId);
        } catch (releaseError) {
          observedError = new AggregateError(
            [error, releaseError],
            `Timed-wait reconciliation and claim release both failed for ${claim.run.id}`,
          );
        }
        errors.push({ error: observedError, runId: claim.run.id });
        continue;
      }
      if (!outcome || outcome.status === "not-due" || outcome.status === "unchanged") {
        try {
          await this.backend.releaseTimedWaitClaim!(claim.run.id, claim.nodeId, claim.claimId);
        } catch (error) {
          errors.push({ error, runId: claim.run.id });
        }
        continue;
      }
      if (outcome.status === "awakened") awakenedRuns.push(outcome.run);
      outcomes.push(outcome);
    }
  }

  private async recoverLegacyPage(
    options: TimedWaitRecoveryCycleOptions,
  ): Promise<TimedWaitRecoveryCycleResult> {
    const requestedCursor = this.legacyCursor;
    const page = await this.backend.listRunsAfterCursor!({
      status: "waiting",
      limit: TIMED_WAIT_RECOVERY_BATCH_SIZE,
      cursor: requestedCursor,
    });
    this.validateLegacyPage(page, requestedCursor);
    const last = page.at(-1);
    this.legacyCursor = page.length === TIMED_WAIT_RECOVERY_BATCH_SIZE && last
      ? { createdAt: new Date(last.createdAt), runId: last.id }
      : undefined;

    let awakened = 0;
    const awakenedRuns: WorkflowRun[] = [];
    const outcomes: TimedWorkflowWaitReconciliationOutcome[] = [];
    const errors: TimedWaitRecoveryError[] = [];
    for (const run of page) {
      try {
        const dueWaits = getTimedWorkflowWaits(run).filter((wait) => wait.deadline <= options.now);
        // Event expiry is terminal and must not be hidden by an earlier delay
        // when this compatibility path has no delay execution capacity.
        const due = dueWaits.find((wait) => wait.waitKind === "event") ?? dueWaits[0];
        if (!due || (due.waitKind === "delay" && awakened >= options.maxAwakened)) continue;
        const outcome = await reconcileTimedWorkflowWait(this.backend, due, {
          now: options.now,
          nextWorkerId: options.nextWorkerId,
        });
        if (!outcome || outcome.status === "not-due" || outcome.status === "unchanged") continue;
        if (outcome.status === "awakened") {
          if (awakened >= options.maxAwakened) continue;
          awakened++;
          awakenedRuns.push(outcome.run);
        }
        outcomes.push(outcome);
      } catch (error) {
        errors.push({ error, runId: run.id });
      }
    }
    return { awakenedRuns, outcomes, errors };
  }

  private validateLegacyPage(page: WorkflowRun[], requestedCursor?: WorkflowRunCursor): void {
    if (page.length > TIMED_WAIT_RECOVERY_BATCH_SIZE) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow backend exceeded the timed-wait recovery page limit",
      });
    }
    let previous = requestedCursor;
    for (const run of page) {
      let createdAtMs: number;
      try {
        createdAtMs = Date.prototype.getTime.call(run.createdAt);
      } catch {
        createdAtMs = Number.NaN;
      }
      if (
        run.status !== "waiting" || typeof run.id !== "string" || run.id.length === 0 ||
        !Number.isFinite(createdAtMs)
      ) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Workflow backend returned an invalid timed-wait recovery row",
        });
      }
      if (previous) {
        const previousMs = previous.createdAt.getTime();
        const strictlyAfter = createdAtMs < previousMs ||
          (createdAtMs === previousMs &&
            compareRunIdsDescending(run.id, previous.runId) > 0);
        if (!strictlyAfter) {
          throw ORCHESTRATION_ERROR.create({
            detail:
              "Workflow backend returned a duplicate or out-of-order timed-wait recovery page",
          });
        }
      }
      previous = { createdAt: new Date(createdAtMs), runId: run.id };
    }
  }
}
