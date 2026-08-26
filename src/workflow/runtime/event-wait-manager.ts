import { logger as baseLogger } from "#veryfront/utils";
import type { PendingEventWait, WaitNodeConfig, WorkflowRun } from "../types.ts";
import { generateId, parseDuration } from "../types.ts";
import {
  hasEventWaitSupport,
  hasRunPatchKeyMergeSupport,
  isSameWaitNodeExecution,
  type PersistedPendingEventWait,
  type RunEventDeliveryClaim,
  type RunEventEnvelope,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { getConfiguredTimedWaitKind, INTERNAL_DELAY_EVENT_NAME } from "../timed-wait-state.ts";
import { isCanonicalNonEmptyString } from "../dsl/validation.ts";
import {
  consumeWorkflowRunControlOutcomeMayBeCommitted,
  reconcileWorkflowRunControl,
  type WorkflowRunControlReconcileOutcome,
} from "./workflow-run-control.ts";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR } from "#veryfront/errors";
import { unrefTimer } from "#veryfront/compat/process.ts";
import {
  MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
  MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES,
} from "../limits.ts";

const logger = baseLogger.component("event-wait-manager");

/** Default interval for sweeping event waits whose declared timeout elapsed. */
const DEFAULT_EXPIRATION_CHECK_INTERVAL_MS = 60_000;
const MIN_EXPIRY_RETRY_DELAY_MS = 1_000;
const DEFAULT_DELIVERY_CLAIM_RECOVERY_DELAY_MS = 60_000;
const DEFAULT_CLAIM_RECOVERY_CHECK_INTERVAL_MS = 60_000;
const MIN_CLAIM_RECOVERY_LEASE_MS = 1_000;
const MAX_DELIVERY_RECONCILIATION_ATTEMPTS = 8;
const MAX_DELIVERY_FINALIZATION_ATTEMPTS = 8;
const MAX_BACKGROUND_DELIVERY_RETRY_ATTEMPTS = 8;
const ACTIVE_WAIT_STATUSES: WorkflowRun["status"][] = ["pending", "running", "waiting"];
const ACTIVE_WAIT_STATUS_SET = new Set<WorkflowRun["status"]>(ACTIVE_WAIT_STATUSES);
const MAILBOX_RETAINING_RUN_STATUSES = new Set<WorkflowRun["status"]>([
  ...ACTIVE_WAIT_STATUSES,
  "failed",
]);
const expiryTimersByBackend = new WeakMap<
  WorkflowBackend,
  Map<string, Map<EventWaitManager, ReturnType<typeof setTimeout>>>
>();
/** Coordinate drains across every manager sharing one backend instance. */
const drainSessionsByBackend = new WeakMap<WorkflowBackend, Map<string, DrainSession>>();
/** Bounded, backend-scoped attribution for a drain that finishes before its publisher rejoins. */
const deliveredEventReceiptsByBackend = new WeakMap<
  WorkflowBackend,
  Map<string, Set<string>>
>();
/** Envelope ids whose publisher is still awaiting an exact delivery outcome. */
const activeEventPublicationsByBackend = new WeakMap<WorkflowBackend, Set<string>>();

export interface EventWaitManagerConfig {
  /** Backend for persistence */
  backend: WorkflowBackend;
  /** Workflow executor used to resume a run once its wait is released */
  executor?: WorkflowExecutor;
  /** Interval for sweeping timed-out waits parked by another process (ms) */
  expirationCheckInterval?: number;
  /** Age after which an unfinished event claim is recoverable after a process exit (ms). */
  deliveryClaimRecoveryDelay?: number;
  /** Interval for discovering event claims abandoned by another process (ms). */
  claimRecoveryCheckInterval?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * What `publishEvent` did with an event.
 *
 * A boolean cannot carry this: "no wait was released" covers an event safely
 * buffered for a run that has not parked yet, an event dropped because the run
 * is already over, and a wait that matched but could not be delivered. Those
 * need different reactions from the caller, so they are named.
 */
export type PublishEventOutcome =
  /** A wait matched, its node completed, and the run was nudged forward. */
  | "delivered"
  /** No wait matched yet. The event is durably buffered until one does. */
  | "buffered"
  /** The run is already terminal, so the event was discarded rather than buffered. */
  | "run-terminal"
  /**
   * A wait matched but delivering it failed. The wait and the event were both
   * rolled back, so the run is still parked and `retryEventDelivery` can retry
   * the same envelope without appending a duplicate.
   */
  | "delivery-failed";

/** What one `drain` pass did, attributed per envelope so a publish reports its own. */
interface DrainOutcome {
  /** Envelope ids whose delivery completed a node and nudged the run forward. */
  deliveredEventIds: Set<string>;
  /** Envelope ids whose delivery failed and was rolled back into the mailbox. */
  failedEventIds: Set<string>;
  terminal: boolean;
}

interface DrainSession {
  outcome: DrainOutcome;
  activePasses: number;
  idle: Promise<void>;
  resolveIdle: () => void;
}

/** Strip backend-only fields so callers never see worker ownership. */
function projectEventWait(wait: PersistedPendingEventWait): PendingEventWait {
  const {
    workerId: _workerId,
    claimedAt: _claimedAt,
    recoveryClaimedAt: _recoveryClaimedAt,
    claimedEventId: _claimedEventId,
    deliveredEventId: _deliveredEventId,
    waitInstanceId: _waitInstanceId,
    ...projected
  } = wait;
  return projected;
}

function timedWaitClaimKey(runId: string, waitId: string): string {
  return `${runId}\0${waitId}`;
}

/**
 * Persists what a run is parked on, and releases it when the event arrives or
 * its declared timeout elapses.
 *
 * This mirrors `ApprovalManager`. The differences are forced by what an event
 * is: nobody addresses an event to a specific wait record, so delivery matches
 * on the event name against a per-run durable mailbox, and an event that
 * arrives before its node parks is buffered there rather than dropped. A wait
 * with a declared timeout is released by whichever of the two happens first,
 * and the backend's atomic resolve decides that race.
 */
export class EventWaitManager {
  private config: EventWaitManagerConfig;
  private expirationTimer?: ReturnType<typeof setInterval>;
  /** Independent discovery for claims abandoned after this manager starts. */
  private claimRecoveryCheckTimer?: ReturnType<typeof setInterval>;
  private claimRecoveryCheck?: Promise<void>;
  /** In-process deadline timers, keyed by wait id, so a short delay fires promptly. */
  private expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Shared accumulator and completion barrier for same-backend, same-run drain passes. */
  private drainSessions: Map<string, DrainSession>;
  /** Best-effort prompt retries; durable claims remain the restart fallback. */
  private finalizationRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private finalizationRetryAttempts = new Map<string, number>();
  /** Best-effort retries for mail drained after its publisher already returned. */
  private deliveryRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private deliveryRetryAttempts = new Map<string, number>();
  /** Prompt retries for a committed node whose run resume did not complete. */
  private committedResumeRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private committedResumeRetryAttempts = new Map<string, number>();
  /** Same-process timeout claims still reconciling their matching run transition. */
  private activeTimedWaitClaims = new Set<string>();
  private destroyed = false;

  constructor(config: EventWaitManagerConfig) {
    this.config = {
      expirationCheckInterval: DEFAULT_EXPIRATION_CHECK_INTERVAL_MS,
      deliveryClaimRecoveryDelay: DEFAULT_DELIVERY_CLAIM_RECOVERY_DELAY_MS,
      claimRecoveryCheckInterval: DEFAULT_CLAIM_RECOVERY_CHECK_INTERVAL_MS,
      debug: false,
      ...config,
    };
    let drainSessions = drainSessionsByBackend.get(config.backend);
    if (!drainSessions) {
      drainSessions = new Map();
      drainSessionsByBackend.set(config.backend, drainSessions);
    }
    this.drainSessions = drainSessions;
    this.ensureExpirationChecker();
    this.ensureClaimRecoveryChecker();
  }

  /**
   * Start the periodic sweep, once, for the life of this manager.
   *
   * It has to start here rather than on first use. The sweep's whole job is
   * waits this process did not park, above all waits that outlived the process
   * that parked them: after a restart nothing local ever parks or publishes,
   * so a sweep armed on first use would never arm at all and those waits would
   * never reach their declared deadline. The timer is unreferenced, so a
   * process holding only this is still free to exit.
   */
  private ensureExpirationChecker(): void {
    if (this.expirationTimer !== undefined || this.destroyed) return;
    const interval = this.config.expirationCheckInterval ?? 0;
    if (interval <= 0) return;

    this.expirationTimer = setInterval(() => {
      this.checkExpiredEventWaits().catch((error) => {
        logger.error("Event wait expiration check failed", error);
      });
    }, interval);
    unrefTimer(this.expirationTimer);
  }

  /** Discover abandoned claims independently of deadline expiration sweeping. */
  private ensureClaimRecoveryChecker(): void {
    if (this.claimRecoveryCheckTimer !== undefined || this.destroyed) return;
    const interval = this.config.claimRecoveryCheckInterval ?? 0;
    if (
      interval <= 0 || (this.config.expirationCheckInterval ?? 0) > 0 ||
      !hasEventWaitSupport(this.config.backend)
    ) return;

    void this.checkAbandonedClaims().catch((error) => {
      logger.error("Event-wait claim recovery failed", error);
    });
    this.claimRecoveryCheckTimer = setInterval(() => {
      void this.checkAbandonedClaims().catch((error) => {
        logger.error("Event-wait claim recovery failed", error);
      });
    }, interval);
    unrefTimer(this.claimRecoveryCheckTimer);
  }

  private checkAbandonedClaims(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.claimRecoveryCheck) return this.claimRecoveryCheck;

    const check = this.recoverAndDrainAbandonedDeliveries();
    this.claimRecoveryCheck = check;
    void check.then(
      () => {
        if (this.claimRecoveryCheck === check) this.claimRecoveryCheck = undefined;
      },
      () => {
        if (this.claimRecoveryCheck === check) this.claimRecoveryCheck = undefined;
      },
    );
    return check;
  }

  /**
   * Record a run parking on a wait-for-event or delay node.
   *
   * Persisting happens before draining the mailbox so an event published in
   * between is matched by whichever side sees the other first, rather than
   * falling between them.
   */
  async createEventWait(
    run: WorkflowRun,
    nodeId: string,
    waitConfig: WaitNodeConfig,
  ): Promise<PendingEventWait | null> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) {
      logger.warn(
        "Backend cannot persist event waits; the run will park with nothing able to wake it",
        { runId: run.id, nodeId },
      );
      return null;
    }

    const eventName = waitConfig.eventName;
    if (eventName === undefined) {
      logger.warn("Wait node parked without an event name; nothing can be matched against it", {
        runId: run.id,
        nodeId,
      });
      return null;
    }

    const wait = this.buildPendingEventWait(run, nodeId, waitConfig, eventName);

    // The deadline timer is armed BEFORE the record becomes claimable. A
    // publish that lands during the persistence await can claim the freshly
    // visible record and clear its expiry; a timer armed only afterwards
    // would survive that clear and hold its closure until the original
    // deadline. Armed first, the claimer's clear always finds it.
    this.scheduleExpiry(wait);
    const durableWait = run.workerId === undefined
      ? await this.persistOwnerlessEventWait(run, wait)
      : await this.persistOwnedEventWait(run, wait);
    if (durableWait !== wait) return projectEventWait(durableWait);

    this.rearmExpiryAfterSlowPersistence(wait);
    return projectEventWait(wait);
  }

  private buildPendingEventWait(
    run: WorkflowRun,
    nodeId: string,
    waitConfig: WaitNodeConfig,
    eventName: string,
  ): PersistedPendingEventWait {
    const timeoutMs = waitConfig.timeout === undefined
      ? undefined
      : parseDuration(waitConfig.timeout);
    // The deadline is anchored to when the wait node started, not to when this
    // callback runs. A dependency-free wait settles in the same DAG batch as
    // its siblings, so this callback can fire long after the node suspended; a
    // one-minute timeout must not stretch by a slow sibling's whole runtime.
    const nodeStartedAt = run.nodeStates[nodeId]?.startedAt;
    const nodeStartedAtMs = nodeStartedAt === undefined
      ? Number.NaN
      : new Date(nodeStartedAt).getTime();
    const timeoutBaseMs = Number.isFinite(nodeStartedAtMs) ? nodeStartedAtMs : Date.now();
    return {
      id: generateId("evw"),
      runId: run.id,
      nodeId,
      eventName,
      waitKind: getConfiguredTimedWaitKind(waitConfig) ?? "event",
      requestedAt: new Date(),
      ...(timeoutMs === undefined ? {} : { expiresAt: new Date(timeoutBaseMs + timeoutMs) }),
      status: "pending",
      ...(run.workerId === undefined ? {} : { workerId: run.workerId }),
      ...(run.nodeStates[nodeId]?._waitInstanceId === undefined
        ? {}
        : { waitInstanceId: run.nodeStates[nodeId]._waitInstanceId }),
    };
  }

  private async persistOwnedEventWait(
    run: WorkflowRun,
    wait: PersistedPendingEventWait,
  ): Promise<PersistedPendingEventWait> {
    const backend = this.config.backend;
    try {
      // Worker-owned waits are reserved atomically, so a delayed onWaiting
      // callback cannot append after a replacement worker claimed the run.
      const saveOwned = backend.savePendingEventWaitIfStatusAndWorker;
      const saved = saveOwned && run.workerId !== undefined
        ? await saveOwned.call(backend, run.id, ["waiting"], run.workerId, wait)
        : false;
      if (saved) return wait;

      const existing = await this.findWaitExecutionRecord(run, wait);
      if (existing) {
        this.clearExpiry(wait.id);
        return existing;
      }
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow execution ownership changed before event wait persistence",
      });
    } catch (error) {
      this.clearExpiry(wait.id);
      throw error;
    }
  }

  private async persistOwnerlessEventWait(
    run: WorkflowRun,
    wait: PersistedPendingEventWait,
  ): Promise<PersistedPendingEventWait> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) {
      this.clearExpiry(wait.id);
      throw ORCHESTRATION_ERROR.create({
        detail: "The configured workflow backend does not support durable event delivery",
      });
    }
    let persisted = false;
    try {
      await backend.savePendingEventWait(run.id, wait);
      persisted = true;
      const pending = await backend.getPendingEventWaits(run.id);
      if (!pending.some((candidate) => candidate.id === wait.id)) {
        const existing = await this.findWaitExecutionRecord(run, wait, pending);
        this.clearExpiry(wait.id);
        if (existing) return existing;
        throw ORCHESTRATION_ERROR.create({
          detail: "Event wait persistence completed without a pending record",
        });
      }
      // An ownerless backend cannot atomically bind the append to the run's
      // active status. If cancellation or completion finished before the
      // append became visible, its earlier cleanup saw nothing; close that
      // race by resolving the newly persisted wait after observing terminal
      // state. A later terminal transition will see the wait itself.
      const latestRun = await backend.getRun(run.id);
      if (!latestRun || latestRun.status === "completed" || latestRun.status === "cancelled") {
        await backend.resolvePendingEventWait(run.id, wait.id, "cancelled");
        this.clearExpiry(wait.id);
        return { ...wait, status: "cancelled" };
      }
      return wait;
    } catch (error) {
      // Drop the early timer only when the append itself did not land. Once a
      // record is durable, a later read failure must not also disable its only
      // local deadline enforcement.
      if (!persisted) this.clearExpiry(wait.id);
      throw error;
    }
  }

  private rearmExpiryAfterSlowPersistence(wait: PersistedPendingEventWait): void {
    if (
      wait.expiresAt !== undefined &&
      wait.expiresAt.getTime() <= Date.now() &&
      !this.expiryTimers.has(wait.id)
    ) {
      // The deadline elapsed while persistence was in flight and the early
      // timer fired against a record that did not exist yet, so its expiry
      // was a no-op. Re-arm with the bounded minimum delay: the retry either
      // enforces the deadline promptly or finds the wait already resolved by
      // a concurrent claim and quietly does nothing. An absent timer with a
      // future deadline means a concurrent claim cleared it, and that clear
      // must be honored, not undone.
      this.scheduleExpiry(wait, MIN_EXPIRY_RETRY_DELAY_MS);
    }
  }

  /**
   * Find the durable handoff for a wait creation that did not remain pending.
   * A delivery or timeout may claim and even finalize the record while the
   * backend's save promise is still settling; that is successful persistence,
   * not a lost append.
   */
  private async findWaitExecutionRecord(
    originalRun: WorkflowRun,
    expected: PersistedPendingEventWait,
    knownPending?: PersistedPendingEventWait[],
  ): Promise<PersistedPendingEventWait | null> {
    const backend = this.config.backend;
    const pending = knownPending ?? await backend.getPendingEventWaits?.(originalRun.id) ?? [];
    const pendingMatch = pending.find((candidate) => isSameWaitNodeExecution(candidate, expected));
    if (pendingMatch) return pendingMatch;

    const deliveryClaims = await backend.listRunEventDeliveryClaims?.(originalRun.id) ?? [];
    const deliveryMatch = deliveryClaims.find(({ wait }) =>
      isSameWaitNodeExecution(wait, expected)
    );
    if (deliveryMatch) return deliveryMatch.wait;

    const timedClaims = await backend.listTimedEventWaitClaims?.(originalRun.id) ?? [];
    const timedMatch = timedClaims.find((candidate) =>
      isSameWaitNodeExecution(candidate, expected)
    );
    if (timedMatch) return timedMatch;

    // A fast claimant can finish and discard its claim before the save caller
    // reads any of the durable wait collections. A committed node outcome, a
    // newer execution of this reusable wait node, or a terminal run proves the
    // append was handed off rather than lost.
    const latestRun = await backend.getRun(originalRun.id);
    const latestState = latestRun?.nodeStates[expected.nodeId];
    const newerExecution = expected.waitInstanceId !== undefined &&
      latestState?._waitInstanceId !== undefined &&
      latestState._waitInstanceId !== expected.waitInstanceId;
    if (
      latestState?.status === "completed" || newerExecution || latestRun?.status === "completed"
    ) {
      return { ...expected, status: "delivered" };
    }
    if (latestRun?.status === "failed") return { ...expected, status: "expired" };
    if (latestRun?.status === "cancelled") return { ...expected, status: "cancelled" };
    return null;
  }

  /** Drain buffered events after a complete waiting batch has been persisted. */
  async drainPendingEvents(runId: string): Promise<void> {
    // This callback can run recursively while an outer delivery awaits resume.
    // Its pass contributes to the shared outcome but cannot wait for the outer
    // pass without deadlocking that resume.
    const outcome = await this.drain(runId, false);
    if (outcome.failedEventIds.size > 0) this.scheduleDeliveryRetry(runId);
    else this.clearDeliveryRetry(runId);
  }

  /** Release an in-process deadline after another owner resolves the wait. */
  clearWaitExpiry(waitId: string): void {
    this.clearExpiry(waitId);
  }

  /**
   * Buffer an event for a run and release any wait it matches.
   *
   * The event is buffered before it is matched. A publish that arrives before
   * its node parks, or while no process holds the run, must survive until a
   * wait can claim it, which is exactly what a run-scoped mailbox provides and
   * a subscription does not.
   *
   * A run that has already finished is the exception. It will never park on
   * anything again, so buffering for it would report a durable delivery that
   * can never happen. Such a publish is refused up front and reported as
   * `run-terminal` instead.
   */
  async publishEvent(
    runId: string,
    eventName: string,
    payload?: unknown,
  ): Promise<PublishEventOutcome> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) {
      throw ORCHESTRATION_ERROR.create({
        detail: "The configured workflow backend does not support durable event delivery",
      });
    }

    this.assertPublicEventName(eventName, "publishEvent");

    // An absent run is not terminal: publishing to a reserved id before the run
    // starts is the case the mailbox exists to serve.
    const run = await backend.getRun(runId);
    if (run && !MAILBOX_RETAINING_RUN_STATUSES.has(run.status)) return "run-terminal";

    const envelope: RunEventEnvelope = {
      id: generateId("evt"),
      eventName,
      payload,
      publishedAt: new Date(),
    };
    this.markEventPublicationActive(envelope.id);
    try {
      await backend.appendRunEvent(runId, envelope);
      // Failed runs are retryable but cannot reconcile a delivery until retry()
      // makes them active again. Preserve the event for the sibling wait instead
      // of claiming and immediately rolling it back against the failed run.
      const failedRunOutcome = await this.classifyFailedRunAppend(runId, envelope.id, run);
      if (failedRunOutcome) return failedRunOutcome;
      const outcome = await this.drain(runId, true);

      // The outcome reports what happened to THIS envelope. With concurrent
      // publishes or previously buffered mail, the drain can deliver an older
      // envelope with the same name while this one stays buffered, and a caller
      // told "delivered" about an envelope that was not would retry and
      // duplicate the event.
      const deliveredBySharedDrain = this.consumeDeliveredEventReceipt(runId, envelope.id) ||
        await this.hasCommittedEventDelivery(runId, envelope.id);
      if (outcome.deliveredEventIds.has(envelope.id) || deliveredBySharedDrain) {
        return "delivered";
      }

      // Re-check for a terminal transition that landed between the status check
      // above and the append. Failed remains mailbox-retaining because retry can
      // still consume the restored envelope; completed and cancelled cannot.
      const latest = await backend.getRun(runId);
      if (latest?.status === "failed") return "buffered";
      if (!latest && run) {
        await backend.removeRunEvent(runId, envelope.id);
        return "run-terminal";
      }
      if (latest && !MAILBOX_RETAINING_RUN_STATUSES.has(latest.status)) {
        await backend.removeRunEvent(runId, envelope.id);
        return "run-terminal";
      }
      if (outcome.failedEventIds.has(envelope.id)) return "delivery-failed";
      if (outcome.terminal) return "run-terminal";
      return "buffered";
    } finally {
      this.clearEventPublicationActive(runId, envelope.id);
    }
  }

  /** Retry the oldest buffered envelope without publishing a duplicate. */
  async retryEventDelivery(runId: string, eventName: string): Promise<boolean> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) {
      throw ORCHESTRATION_ERROR.create({
        detail: "The configured workflow backend does not support durable event delivery",
      });
    }
    this.assertPublicEventName(eventName, "retryEventDelivery");

    const envelope = await backend.peekRunEvent(runId, eventName);
    if (!envelope) return false;
    this.markEventPublicationActive(envelope.id);
    try {
      const outcome = await this.drain(runId, true);
      const deliveredBySharedDrain = this.consumeDeliveredEventReceipt(runId, envelope.id) ||
        await this.hasCommittedEventDelivery(runId, envelope.id);
      return outcome.deliveredEventIds.has(envelope.id) || deliveredBySharedDrain;
    } finally {
      this.clearEventPublicationActive(runId, envelope.id);
    }
  }

  private assertPublicEventName(eventName: string, operation: string): void {
    if (
      isCanonicalNonEmptyString(eventName) &&
      eventName.length <= MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS &&
      eventName !== INTERNAL_DELAY_EVENT_NAME
    ) return;
    throw INVALID_ARGUMENT.create({
      detail: `${operation} eventName must be a canonical non-empty public event name of at ` +
        `most ${MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS} code units`,
    });
  }

  private async classifyFailedRunAppend(
    runId: string,
    eventId: string,
    run: WorkflowRun | null,
  ): Promise<PublishEventOutcome | undefined> {
    if (run?.status !== "failed") return undefined;
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return undefined;
    const latestAfterAppend = await backend.getRun(runId);
    if (latestAfterAppend?.status === "failed") return "buffered";
    if (!latestAfterAppend || !MAILBOX_RETAINING_RUN_STATUSES.has(latestAfterAppend.status)) {
      await backend.removeRunEvent(runId, eventId);
      return "run-terminal";
    }
    return undefined;
  }

  private markEventPublicationActive(eventId: string): void {
    let active = activeEventPublicationsByBackend.get(this.config.backend);
    if (!active) {
      active = new Set();
      activeEventPublicationsByBackend.set(this.config.backend, active);
    }
    active.add(eventId);
  }

  private clearEventPublicationActive(runId: string, eventId: string): void {
    const active = activeEventPublicationsByBackend.get(this.config.backend);
    active?.delete(eventId);
    if (active?.size === 0) activeEventPublicationsByBackend.delete(this.config.backend);
    this.consumeDeliveredEventReceipt(runId, eventId);
  }

  private recordDeliveredEventReceipt(runId: string, eventId: string): void {
    if (!activeEventPublicationsByBackend.get(this.config.backend)?.has(eventId)) return;
    let receiptsByRun = deliveredEventReceiptsByBackend.get(this.config.backend);
    if (!receiptsByRun) {
      receiptsByRun = new Map();
      deliveredEventReceiptsByBackend.set(this.config.backend, receiptsByRun);
    }
    let receipts = receiptsByRun.get(runId);
    if (!receipts) {
      receipts = new Set();
      receiptsByRun.set(runId, receipts);
    }
    receipts.add(eventId);
    while (receipts.size > MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES) {
      receipts.delete(receipts.values().next().value!);
    }
  }

  /**
   * Observe a delivery committed by another process before its receipt write.
   *
   * A finalization retry leaves the durable claim in place. Once that claim's
   * wait node is completed, the publisher can report delivery without relying
   * on process-local attribution or waiting for the receipt write to recover.
   * Read the claim before the receipt so finalization racing this check is
   * visible on at least one side of the transition.
   */
  private async hasCommittedEventDelivery(runId: string, eventId: string): Promise<boolean> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return false;
    const claim = (await backend.listRunEventDeliveryClaims(runId)).find(
      (candidate) => candidate.event.id === eventId,
    );
    if (claim && await this.nodeOutcomeCommitted(claim.wait)) return true;
    return await backend.hasRunEventDeliveryReceipt(runId, eventId);
  }

  private consumeDeliveredEventReceipt(runId: string, eventId: string): boolean {
    const receiptsByRun = deliveredEventReceiptsByBackend.get(this.config.backend);
    const receipts = receiptsByRun?.get(runId);
    if (!receipts?.delete(eventId)) return false;
    if (receipts.size === 0) receiptsByRun!.delete(runId);
    if (receiptsByRun!.size === 0) {
      deliveredEventReceiptsByBackend.delete(this.config.backend);
    }
    return true;
  }

  /** Read the waits a run is currently parked on. */
  async getPendingEventWaits(runId: string): Promise<PendingEventWait[]> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return [];
    const waits = await backend.getPendingEventWaits(runId);
    return waits.map(projectEventWait);
  }

  /**
   * Match this run's pending waits against its buffered events.
   *
   * Reports what happened, so a publish can distinguish waking a run from
   * merely buffering, and from matching a wait it could not deliver.
   *
   * Every wait is attempted independently. Delivery touches the run, which can
   * fail for reasons that have nothing to do with the other waits parked on it,
   * and one such failure must not stop the rest of this run's mail.
   */
  private async drain(
    runId: string,
    waitForIdle: boolean,
    expireOverdueWaits = true,
  ): Promise<DrainOutcome> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) {
      return this.createDrainOutcome();
    }
    let session = this.drainSessions.get(runId);
    let createdSession = false;
    if (!session) {
      session = this.createDrainSession();
      this.drainSessions.set(runId, session);
      createdSession = true;
    }
    if (createdSession) await this.recoverDrainSession(runId, session);
    const outcome = session.outcome;
    session.activePasses++;

    try {
      for (const wait of await backend.getPendingEventWaits(runId)) {
        // A replacement process can resume a run whose durable wait was
        // parked by a process that no longer owns an in-memory deadline
        // timer. Re-arm every live persisted deadline while inspecting the
        // stalled batch; this also covers delays, which intentionally do not
        // participate in mailbox matching below.
        if (
          wait.waitKind === "delay" ||
          (wait.expiresAt !== undefined && wait.expiresAt.getTime() > Date.now())
        ) {
          this.scheduleExpiry(wait);
        }
        await this.drainWait(wait, runId, outcome, expireOverdueWaits);
      }
    } finally {
      this.finishDrainPass(runId, session);
    }
    if (waitForIdle) await session.idle;
    return outcome;
  }

  private createDrainOutcome(): DrainOutcome {
    return {
      deliveredEventIds: new Set(),
      failedEventIds: new Set(),
      terminal: false,
    };
  }

  private createDrainSession(): DrainSession {
    const idle = Promise.withResolvers<void>();
    return {
      outcome: this.createDrainOutcome(),
      activePasses: 0,
      idle: idle.promise,
      resolveIdle: idle.resolve,
    };
  }

  private async recoverDrainSession(runId: string, session: DrainSession): Promise<void> {
    try {
      await this.recoverAbandonedDeliveries(runId, runId);
    } catch (error) {
      this.drainSessions.delete(runId);
      session.resolveIdle();
      throw error;
    }
  }

  private finishDrainPass(runId: string, session: DrainSession): void {
    session.activePasses--;
    if (session.activePasses !== 0) return;
    this.drainSessions.delete(runId);
    session.resolveIdle();
  }

  private async drainWait(
    wait: PersistedPendingEventWait,
    runId: string,
    outcome: DrainOutcome,
    expireOverdueWaits: boolean,
  ): Promise<void> {
    if (wait.waitKind === "delay") return;
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;

    const event = await backend.claimRunEventForWait(
      runId,
      wait.id,
      wait.eventName,
      wait.expiresAt,
    );
    if (!event) {
      await this.expireUnclaimedOverdueWait(wait, expireOverdueWaits);
      return;
    }

    this.clearExpiry(wait.id);
    let reconciled: WorkflowRunControlReconcileOutcome;
    try {
      reconciled = await this.deliver(wait, event.payload);
    } catch (error) {
      await this.handleDrainDeliveryError(wait, event, outcome, error);
      return;
    }
    await this.applyDrainDeliveryOutcome(wait, event, outcome, reconciled);
  }

  private async expireUnclaimedOverdueWait(
    wait: PersistedPendingEventWait,
    expireOverdueWaits: boolean,
  ): Promise<void> {
    if (
      !expireOverdueWaits || wait.expiresAt === undefined ||
      Date.now() <= wait.expiresAt.getTime()
    ) return;
    try {
      await this.expire(wait, true);
    } catch (error) {
      logger.error(
        "Failed to expire an overdue event wait before matching",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
    }
  }

  private async handleDrainDeliveryError(
    wait: PersistedPendingEventWait,
    event: RunEventEnvelope,
    outcome: DrainOutcome,
    error: unknown,
  ): Promise<void> {
    if (consumeWorkflowRunControlOutcomeMayBeCommitted(error)) {
      outcome.failedEventIds.delete(event.id);
      outcome.deliveredEventIds.add(event.id);
      this.recordDeliveredEventReceipt(wait.runId, event.id);
      this.scheduleCommittedResumeRetry(wait, event);
      logger.error(
        "Event wait node committed but resuming the run failed",
        { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
        error,
      );
      return;
    }
    outcome.deliveredEventIds.delete(event.id);
    outcome.failedEventIds.add(event.id);
    logger.error(
      "Event wait delivery failed; restoring the wait and re-buffering the event",
      { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
      error,
    );
    await this.rollBackDelivery(wait, event);
  }

  private async applyDrainDeliveryOutcome(
    wait: PersistedPendingEventWait,
    event: RunEventEnvelope,
    outcome: DrainOutcome,
    reconciled: WorkflowRunControlReconcileOutcome,
  ): Promise<void> {
    if (reconciled.status === "stale-wait") {
      outcome.deliveredEventIds.delete(event.id);
      outcome.failedEventIds.delete(event.id);
      await this.retireStaleDelivery(wait, event);
      return;
    }
    if (reconciled.status === "skipped-terminal") {
      if (reconciled.run?.status === "failed") {
        outcome.deliveredEventIds.delete(event.id);
        outcome.failedEventIds.add(event.id);
        await this.rollBackDelivery(wait, event);
        return;
      }
      outcome.terminal = true;
      await this.finalizeDelivery(wait, event, false);
      return;
    }
    outcome.failedEventIds.delete(event.id);
    outcome.deliveredEventIds.add(event.id);
    this.recordDeliveredEventReceipt(wait.runId, event.id);
    await this.finalizeDelivery(wait, event, true);
  }

  /** Re-buffer an event claimed by a wait execution a checkpoint discarded. */
  private async retireStaleDelivery(
    wait: PersistedPendingEventWait,
    event: RunEventEnvelope,
  ): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    await backend.restoreRunEventDelivery(wait.runId, wait.id, event);
    await backend.resolvePendingEventWait(wait.runId, wait.id, "cancelled");
    this.clearExpiry(wait.id);
  }

  private async finalizeDelivery(
    wait: PersistedPendingEventWait,
    event: RunEventEnvelope,
    delivered: boolean,
  ): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    try {
      await backend.finalizeRunEventDelivery(wait.runId, event.id, delivered);
      this.clearFinalizationRetry(event.id);
    } catch (error) {
      logger.error(
        "Failed to finalize an event delivery mailbox reservation",
        { runId: wait.runId, waitId: wait.id, eventId: event.id },
        error,
      );
      this.scheduleFinalizationRetry(wait, event, delivered);
    }
  }

  private scheduleFinalizationRetry(
    wait: PersistedPendingEventWait,
    event: RunEventEnvelope,
    delivered: boolean,
  ): void {
    if (this.destroyed || this.finalizationRetryTimers.has(event.id)) return;
    const attempt = (this.finalizationRetryAttempts.get(event.id) ?? 0) + 1;
    const hasExpirationSweep = (this.config.expirationCheckInterval ?? 0) > 0;
    if (attempt >= MAX_DELIVERY_FINALIZATION_ATTEMPTS && hasExpirationSweep) {
      this.finalizationRetryAttempts.delete(event.id);
      return;
    }
    this.finalizationRetryAttempts.set(
      event.id,
      Math.min(attempt, MAX_DELIVERY_FINALIZATION_ATTEMPTS),
    );
    const retryDelay = attempt >= MAX_DELIVERY_FINALIZATION_ATTEMPTS
      ? DEFAULT_DELIVERY_CLAIM_RECOVERY_DELAY_MS
      : Math.min(
        MIN_EXPIRY_RETRY_DELAY_MS * 2 ** (attempt - 1),
        DEFAULT_DELIVERY_CLAIM_RECOVERY_DELAY_MS,
      );
    const timer = setTimeout(() => {
      this.finalizationRetryTimers.delete(event.id);
      if (this.destroyed) return;
      void this.finalizeDelivery(wait, event, delivered);
    }, retryDelay);
    unrefTimer(timer);
    this.finalizationRetryTimers.set(event.id, timer);
  }

  private clearFinalizationRetry(eventId: string): void {
    const timer = this.finalizationRetryTimers.get(eventId);
    if (timer !== undefined) clearTimeout(timer);
    this.finalizationRetryTimers.delete(eventId);
    this.finalizationRetryAttempts.delete(eventId);
  }

  private committedResumeRetryKey(
    wait: PersistedPendingEventWait,
    event?: RunEventEnvelope,
  ): string {
    return `${wait.runId}\0${wait.id}\0${event?.id ?? "timed"}`;
  }

  /**
   * Keep the durable claim as a reconciliation signal until a committed node
   * has actually nudged its run. A process exit leaves that claim enumerable
   * for the next manager; this timer only makes the same-process retry prompt.
   */
  private scheduleCommittedResumeRetry(
    wait: PersistedPendingEventWait,
    event?: RunEventEnvelope,
  ): void {
    const key = this.committedResumeRetryKey(wait, event);
    if (this.destroyed || this.committedResumeRetryTimers.has(key)) return;
    const attempt = (this.committedResumeRetryAttempts.get(key) ?? 0) + 1;
    if (attempt > MAX_BACKGROUND_DELIVERY_RETRY_ATTEMPTS) {
      this.committedResumeRetryAttempts.delete(key);
      return;
    }
    this.committedResumeRetryAttempts.set(key, attempt);
    const retryDelay = Math.min(
      MIN_EXPIRY_RETRY_DELAY_MS * 2 ** (attempt - 1),
      DEFAULT_DELIVERY_CLAIM_RECOVERY_DELAY_MS,
    );
    const timer = setTimeout(() => {
      this.committedResumeRetryTimers.delete(key);
      if (this.destroyed) return;
      void this.reconcileCommittedResume(wait, event).catch((error) => {
        logger.error(
          "Failed to resume a run after its event-wait node committed",
          { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
          error,
        );
        this.scheduleCommittedResumeRetry(wait, event);
      });
    }, retryDelay);
    unrefTimer(timer);
    this.committedResumeRetryTimers.set(key, timer);
  }

  private clearCommittedResumeRetry(
    wait: PersistedPendingEventWait,
    event?: RunEventEnvelope,
  ): void {
    const key = this.committedResumeRetryKey(wait, event);
    const timer = this.committedResumeRetryTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.committedResumeRetryTimers.delete(key);
    this.committedResumeRetryAttempts.delete(key);
  }

  private async reconcileCommittedResume(
    wait: PersistedPendingEventWait,
    event?: RunEventEnvelope,
  ): Promise<void> {
    const run = await this.config.backend.getRun(wait.runId);
    if (!run) {
      if (event) await this.finalizeDelivery(wait, event, true);
      else await this.finalizeTimedWaitClaim(wait);
      this.clearCommittedResumeRetry(wait, event);
      return;
    }
    const committedNodeStatus = event || wait.waitKind === "delay" ? "completed" : "failed";
    if (run.nodeStates[wait.nodeId]?.status !== committedNodeStatus) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Event-wait node "${wait.nodeId}" is no longer durably ${committedNodeStatus}`,
      });
    }
    if (committedNodeStatus === "completed" && run.status === "waiting") {
      if (!this.config.executor) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Cannot resume a committed event-wait node without a workflow executor",
        });
      }
      await this.config.executor.resume(run.id, undefined, run.workerId);
    }
    if (event) await this.finalizeDelivery(wait, event, true);
    else await this.finalizeTimedWaitClaim(wait);
    this.clearCommittedResumeRetry(wait, event);
  }

  private scheduleDeliveryRetry(runId: string): void {
    if (this.destroyed || this.deliveryRetryTimers.has(runId)) return;
    const attempt = (this.deliveryRetryAttempts.get(runId) ?? 0) + 1;
    if (attempt > MAX_BACKGROUND_DELIVERY_RETRY_ATTEMPTS) {
      this.deliveryRetryAttempts.delete(runId);
      return;
    }
    this.deliveryRetryAttempts.set(runId, attempt);
    const retryDelay = Math.min(
      MIN_EXPIRY_RETRY_DELAY_MS * 2 ** (attempt - 1),
      DEFAULT_DELIVERY_CLAIM_RECOVERY_DELAY_MS,
    );
    const timer = setTimeout(() => {
      this.deliveryRetryTimers.delete(runId);
      if (this.destroyed) return;
      void this.drain(runId, false).then((outcome) => {
        if (outcome.failedEventIds.size > 0) this.scheduleDeliveryRetry(runId);
        else this.clearDeliveryRetry(runId);
      }).catch((error) => {
        logger.error("Failed to retry buffered event delivery", { runId }, error);
        this.scheduleDeliveryRetry(runId);
      });
    }, retryDelay);
    unrefTimer(timer);
    this.deliveryRetryTimers.set(runId, timer);
  }

  private clearDeliveryRetry(runId: string): void {
    const timer = this.deliveryRetryTimers.get(runId);
    if (timer !== undefined) clearTimeout(timer);
    this.deliveryRetryTimers.delete(runId);
    this.deliveryRetryAttempts.delete(runId);
  }

  private async finalizeTimedWaitClaim(wait: PersistedPendingEventWait): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    try {
      await backend.finalizeTimedEventWaitClaim(wait.runId, wait.id);
    } catch (error) {
      // The durable claimedAt marker remains enumerable, so the next sweep
      // retries cleanup without a per-claim hot loop.
      logger.error(
        "Failed to finalize a durable timed event-wait claim",
        { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
        error,
      );
    }
  }

  /** Recover durable claims left behind before delivery or finalization committed. */
  private async recoverAbandonedDeliveries(
    runId?: string,
    activeRecoveryRunId?: string,
  ): Promise<Set<string>> {
    const backend = this.config.backend;
    const restoredRunIds = new Set<string>();
    if (this.destroyed || !hasEventWaitSupport(backend)) return restoredRunIds;
    const recoveryDelay = this.config.deliveryClaimRecoveryDelay ??
      DEFAULT_DELIVERY_CLAIM_RECOVERY_DELAY_MS;
    const recoveryLease = Math.max(recoveryDelay, MIN_CLAIM_RECOVERY_LEASE_MS);

    for (const claim of await backend.listRunEventDeliveryClaims(runId)) {
      if (
        !await this.reserveAbandonedDeliveryClaim(
          claim,
          activeRecoveryRunId,
          recoveryDelay,
          recoveryLease,
        )
      ) continue;
      await this.recoverAbandonedDeliveryClaim(claim, restoredRunIds);
    }
    for (const wait of await backend.listTimedEventWaitClaims(runId)) {
      if (!await this.reserveAbandonedTimedWait(wait, recoveryDelay, recoveryLease)) continue;
      await this.recoverAbandonedTimedWait(wait, restoredRunIds);
    }
    return restoredRunIds;
  }

  private async reserveAbandonedDeliveryClaim(
    claim: RunEventDeliveryClaim,
    activeRecoveryRunId: string | undefined,
    recoveryDelay: number,
    recoveryLease: number,
  ): Promise<boolean> {
    if (
      this.drainSessions.has(claim.wait.runId) && claim.wait.runId !== activeRecoveryRunId
    ) return false;
    const lastClaimedAt = claim.wait.recoveryClaimedAt ?? claim.claimedAt;
    const requiredAge = claim.wait.recoveryClaimedAt ? recoveryLease : recoveryDelay;
    if (Date.now() - lastClaimedAt.getTime() < requiredAge) return false;
    const claimedAt = new Date();
    const backend = this.config.backend;
    return hasEventWaitSupport(backend) && await backend.reserveRunEventDeliveryClaim(
      claim.wait.runId,
      claim.wait.id,
      claim.event.id,
      claimedAt,
      new Date(claimedAt.getTime() - recoveryLease),
    );
  }

  private async recoverAbandonedDeliveryClaim(
    claim: RunEventDeliveryClaim,
    restoredRunIds: Set<string>,
  ): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    let run: WorkflowRun | null;
    try {
      run = await backend.getRun(claim.wait.runId);
    } catch (error) {
      logger.error(
        "Failed to inspect an abandoned event delivery claim",
        { runId: claim.wait.runId, waitId: claim.wait.id, eventId: claim.event.id },
        error,
      );
      return;
    }
    if (!run || run.status === "completed" || run.status === "cancelled") {
      const delivered = run?.status === "completed" &&
        run.nodeStates[claim.wait.nodeId]?.status === "completed";
      await this.finalizeDelivery(claim.wait, claim.event, delivered);
      return;
    }
    const currentState = run.nodeStates[claim.wait.nodeId];
    if (
      !isSameWaitNodeExecution(claim.wait, {
        nodeId: claim.wait.nodeId,
        waitInstanceId: currentState?._waitInstanceId,
      })
    ) {
      await this.finalizeDelivery(claim.wait, claim.event, true);
      return;
    }
    if (currentState?.status === "completed") {
      await this.recoverCommittedDeliveryClaim(claim);
      return;
    }
    try {
      const restored = await backend.restoreRunEventDelivery(
        claim.wait.runId,
        claim.wait.id,
        claim.event,
      );
      if (restored) this.rearmRestoredWaitExpiry(claim.wait);
      restoredRunIds.add(claim.wait.runId);
    } catch (error) {
      logger.error(
        "Failed to recover an abandoned event delivery claim",
        { runId: claim.wait.runId, waitId: claim.wait.id, eventId: claim.event.id },
        error,
      );
    }
  }

  private async recoverCommittedDeliveryClaim(claim: RunEventDeliveryClaim): Promise<void> {
    try {
      await this.reconcileCommittedResume(claim.wait, claim.event);
    } catch (error) {
      logger.error(
        "Failed to reconcile an abandoned committed event delivery",
        { runId: claim.wait.runId, waitId: claim.wait.id, eventId: claim.event.id },
        error,
      );
      this.scheduleCommittedResumeRetry(claim.wait, claim.event);
    }
  }

  private async reserveAbandonedTimedWait(
    wait: PersistedPendingEventWait,
    recoveryDelay: number,
    recoveryLease: number,
  ): Promise<boolean> {
    if (this.activeTimedWaitClaims.has(timedWaitClaimKey(wait.runId, wait.id))) return false;
    const lastClaimedAt = wait.recoveryClaimedAt ?? wait.claimedAt;
    const requiredAge = wait.recoveryClaimedAt ? recoveryLease : recoveryDelay;
    if (lastClaimedAt && Date.now() - lastClaimedAt.getTime() < requiredAge) return false;
    const claimedAt = new Date();
    const backend = this.config.backend;
    return hasEventWaitSupport(backend) && await backend.reserveTimedEventWaitClaim(
      wait.runId,
      wait.id,
      claimedAt,
      new Date(claimedAt.getTime() - recoveryLease),
    );
  }

  private async recoverAbandonedTimedWait(
    wait: PersistedPendingEventWait,
    restoredRunIds: Set<string>,
  ): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    let run: WorkflowRun | null;
    try {
      run = await backend.getRun(wait.runId);
    } catch (error) {
      logger.error(
        "Failed to inspect an abandoned timed event wait claim",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
      return;
    }
    const currentState = run?.nodeStates[wait.nodeId];
    const terminal = !run || run.status === "completed" || run.status === "cancelled";
    const newerExecution = run !== null && !isSameWaitNodeExecution(wait, {
      nodeId: wait.nodeId,
      waitInstanceId: currentState?._waitInstanceId,
    });
    const committed = wait.waitKind === "delay"
      ? currentState?.status === "completed"
      : currentState?.status === "failed";
    if (terminal || newerExecution) {
      await this.finalizeTimedWaitClaim(wait);
      return;
    }
    if (committed) {
      await this.recoverCommittedTimedWait(wait);
      return;
    }
    try {
      const restored = await backend.restorePendingEventWait(wait.runId, wait.id);
      if (restored) {
        this.rearmRestoredWaitExpiry(wait);
        restoredRunIds.add(wait.runId);
      }
    } catch (error) {
      logger.error(
        "Failed to recover an abandoned timed event wait claim",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
    }
  }

  private async recoverCommittedTimedWait(wait: PersistedPendingEventWait): Promise<void> {
    try {
      await this.reconcileCommittedResume(wait);
    } catch (error) {
      logger.error(
        "Failed to reconcile an abandoned committed timed event wait",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
      this.scheduleCommittedResumeRetry(wait);
    }
  }

  /** Recover abandoned claims and promptly retry any restored mailbox state. */
  private async recoverAndDrainAbandonedDeliveries(): Promise<void> {
    for (const runId of await this.recoverAbandonedDeliveries()) {
      if (this.destroyed) return;
      try {
        await this.drain(runId, false);
      } catch (error) {
        logger.error(
          "Failed to drain a recovered run during event-wait claim recovery",
          { runId },
          error,
        );
      }
    }
  }

  /**
   * Undo a claimed-but-undelivered event so the run stays wakeable.
   *
   * The wait and the event are restored by ONE backend operation, not two.
   * Committed as separate calls, a crash after the wait restore but before
   * the event restore would leave the wait pending while its event is gone
   * from the mailbox forever: the sweep cannot recover an untimed wait, and
   * an event the publisher was told was accepted would be lost unless it
   * happened to retry. `restoreRunEventDelivery` closes that window.
   *
   * The backend restores the event to its publication-order position. Two
   * concurrent claims can roll back in either order, so blindly prepending
   * each one would reverse otherwise FIFO delivery.
   */
  private async rollBackDelivery(
    wait: PersistedPendingEventWait,
    event: RunEventEnvelope,
  ): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    try {
      const restored = await backend.restoreRunEventDelivery(wait.runId, wait.id, event);
      if (restored) this.rearmRestoredWaitExpiry(wait);
    } catch (error) {
      logger.error(
        "Failed to roll back an event wait delivery; the run may stay parked until it is retried",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
      throw error;
    }
  }

  /**
   * Return a wait this process claimed to pending, and re-arm its deadline.
   *
   * This is the no-event path (a delay whose delivery failed, an expired
   * deadline whose run failure did not commit); a claimed EVENT is given back
   * through `rollBackDelivery`, whose backend operation restores the wait and
   * the event atomically.
   */
  private async restoreClaimedWait(wait: PersistedPendingEventWait): Promise<boolean> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return false;
    const restored = await backend.restorePendingEventWait(wait.runId, wait.id);
    if (restored) this.rearmRestoredWaitExpiry(wait);
    return restored;
  }

  /**
   * Re-arm the deadline of a wait whose record really came back to pending.
   *
   * Only for restored records: a claim that could not be given back belongs
   * to whoever holds it now. An already-elapsed deadline is left to the
   * periodic sweep when one exists. Managers with sweeping disabled re-arm it
   * with a bounded minimum delay, so a failed delay delivery remains live
   * without spinning on every event-loop tick.
   */
  private rearmRestoredWaitExpiry(wait: PersistedPendingEventWait): void {
    if (!wait.expiresAt) return;
    const remaining = wait.expiresAt.getTime() - Date.now();
    if (remaining > 0) {
      this.scheduleExpiry(wait);
    } else if ((this.config.expirationCheckInterval ?? 0) <= 0) {
      this.scheduleExpiry(wait, MIN_EXPIRY_RETRY_DELAY_MS);
    }
  }

  private async nodeOutcomeCommitted(wait: PersistedPendingEventWait): Promise<boolean> {
    const run = await this.config.backend.getRun(wait.runId);
    return run?.nodeStates[wait.nodeId]?.status === "completed";
  }

  private async deliver(
    wait: PersistedPendingEventWait,
    payload: unknown,
  ): Promise<WorkflowRunControlReconcileOutcome> {
    logger.debug("Delivering event wait", { waitId: wait.id, runId: wait.runId });
    return await reconcileWorkflowRunControl({
      backend: this.config.backend,
      operation: {
        type: "event-delivery",
        runId: wait.runId,
        waitId: wait.id,
        nodeId: wait.nodeId,
        eventName: wait.eventName,
        waitKind: wait.waitKind,
        waitInstanceId: wait.waitInstanceId,
        payload,
        deliveredAt: new Date(),
        maxAttempts: MAX_DELIVERY_RECONCILIATION_ATTEMPTS,
        resume: this.config.executor
          ? (id, expectedWorkerId) => this.config.executor!.resume(id, undefined, expectedWorkerId)
          : undefined,
      },
    });
  }

  /**
   * Fire a wait's deadline in this process.
   *
   * The periodic sweep alone cannot serve `delay()`: a 200ms delay must not
   * wait out a 60s poll. The sweep remains the recovery path for a wait whose
   * process died with this timer in it.
   */
  private scheduleExpiry(wait: PersistedPendingEventWait, minimumDelayMs = 0): void {
    if (!wait.expiresAt || this.destroyed) return;
    this.clearOwnedExpiry(wait.id);
    const timer = setTimeout(() => {
      this.clearExpiry(wait.id);
      this.expire(wait).catch((error) => {
        logger.error("Failed to apply event wait timeout", { waitId: wait.id }, error);
        this.scheduleExpiry(wait, MIN_EXPIRY_RETRY_DELAY_MS);
      });
    }, Math.max(minimumDelayMs, wait.expiresAt.getTime() - Date.now()));
    // Unreferenced like the sweep interval: a deadline timer is a convenience
    // for promptness, not what keeps the wait enforceable. A process done with
    // its work, an isolated per-run executor above all, must be free to exit
    // during a long delay; the durable record and another process's sweep
    // still enforce the deadline.
    unrefTimer(timer);
    this.expiryTimers.set(wait.id, timer);
    let waits = expiryTimersByBackend.get(this.config.backend);
    if (!waits) {
      waits = new Map();
      expiryTimersByBackend.set(this.config.backend, waits);
    }
    const registrations = waits.get(wait.id) ?? new Map();
    registrations.set(this, timer);
    waits.set(wait.id, registrations);
  }

  private clearExpiry(waitId: string): void {
    const waits = expiryTimersByBackend.get(this.config.backend);
    const registrations = waits?.get(waitId);
    if (!registrations) {
      this.clearOwnedExpiry(waitId);
      return;
    }
    for (const [manager, timer] of registrations) {
      clearTimeout(timer);
      manager.expiryTimers.delete(waitId);
    }
    waits!.delete(waitId);
    if (waits!.size === 0) expiryTimersByBackend.delete(this.config.backend);
  }

  private clearOwnedExpiry(waitId: string): void {
    const timer = this.expiryTimers.get(waitId);
    if (timer !== undefined) clearTimeout(timer);
    this.expiryTimers.delete(waitId);
    const waits = expiryTimersByBackend.get(this.config.backend);
    const registrations = waits?.get(waitId);
    registrations?.delete(this);
    if (registrations?.size === 0) waits!.delete(waitId);
    if (waits?.size === 0) expiryTimersByBackend.delete(this.config.backend);
  }

  /**
   * Apply a wait's declared timeout.
   *
   * A delay's timeout is its whole purpose, so reaching it completes the node.
   * A wait-for-event's timeout means the event never came, which fails the run
   * the same way an expired approval does. Either way the run stops consuming
   * capacity on a deadline it declared and then ignored.
   */
  private async expire(
    wait: PersistedPendingEventWait,
    mailboxChecked = false,
  ): Promise<void> {
    const backend = this.config.backend;
    if (this.destroyed || !hasEventWaitSupport(backend)) return;
    if (await this.shouldDeferEventExpiry(wait, mailboxChecked)) return;

    // A delay's deadline is its delivery, so the record resolves as delivered
    // rather than expired: the node completed on time, it did not time out.
    const claimed = await backend.resolvePendingEventWait(
      wait.runId,
      wait.id,
      wait.waitKind === "delay" ? "delivered" : "expired",
    );
    if (!claimed) return;
    const claimKey = timedWaitClaimKey(wait.runId, wait.id);
    this.activeTimedWaitClaims.add(claimKey);
    try {
      if (wait.waitKind === "delay") await this.completeClaimedDelay(wait);
      else await this.applyClaimedEventExpiry(wait);
    } finally {
      this.activeTimedWaitClaims.delete(claimKey);
    }
  }

  private async shouldDeferEventExpiry(
    wait: PersistedPendingEventWait,
    mailboxChecked: boolean,
  ): Promise<boolean> {
    if (wait.waitKind !== "event" || mailboxChecked) return false;
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return true;
    const outcome = await this.drain(wait.runId, false, false);
    if (outcome.failedEventIds.size > 0) this.scheduleDeliveryRetry(wait.runId);
    const stillPending = (await backend.getPendingEventWaits(wait.runId)).some(
      (candidate) => candidate.id === wait.id,
    );
    if (!stillPending) return true;
    const buffered = await backend.peekRunEvent(wait.runId, wait.eventName);
    const wonDeadline = buffered !== null && wait.expiresAt !== undefined &&
      buffered.publishedAt.getTime() <= wait.expiresAt.getTime();
    if (wonDeadline) this.scheduleDeliveryRetry(wait.runId);
    return wonDeadline;
  }

  private async completeClaimedDelay(wait: PersistedPendingEventWait): Promise<void> {
    try {
      const reconciled = await this.deliver(wait, undefined);
      if (reconciled.status === "stale-wait") {
        await this.retireStaleTimedWait(wait);
        return;
      }
      if (reconciled.status === "skipped-terminal" && reconciled.run?.status === "failed") {
        await this.restoreClaimedWait(wait);
      } else {
        await this.finalizeTimedWaitClaim(wait);
      }
    } catch (error) {
      if (consumeWorkflowRunControlOutcomeMayBeCommitted(error)) {
        this.scheduleCommittedResumeRetry(wait);
        logger.error(
          "Delay node committed but resuming the run failed",
          { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
          error,
        );
        return;
      }
      logger.error(
        "Delay delivery failed; restoring the wait so its deadline is reached again",
        { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
        error,
      );
      await this.restoreClaimedWait(wait);
    }
  }

  private async retireStaleTimedWait(wait: PersistedPendingEventWait): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    const restored = await backend.restorePendingEventWait(wait.runId, wait.id);
    if (restored) {
      await backend.resolvePendingEventWait(wait.runId, wait.id, "cancelled");
    } else {
      await backend.finalizeTimedEventWaitClaim(wait.runId, wait.id);
    }
    this.clearExpiry(wait.id);
  }

  private async applyClaimedEventExpiry(wait: PersistedPendingEventWait): Promise<void> {
    try {
      if (await this.failRunForExpiredWait(wait)) {
        await this.finalizeTimedWaitClaim(wait);
        return;
      }
    } catch (error) {
      logger.error(
        "Failed to apply an event wait timeout to its run; restoring the wait for the sweep",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
    }
    await this.restoreClaimedWait(wait);
  }

  /**
   * Fail a run whose wait-for-event deadline passed, marking the wait node
   * itself failed in the same patch.
   *
   * The node state matters for `retry()`: a wait left recorded `running` is
   * deliberately never re-scheduled by the DAG, so a retried run would stall
   * again immediately. A failed node is re-armed by retry like any other
   * failure.
   *
   * Resolves `true` when the failure was applied, or when the run can never be
   * retried and there is nothing left to apply; `false` when the conditional
   * update lost a race or a failed run still owns the replayable wait.
   */
  private async failRunForExpiredWait(wait: PersistedPendingEventWait): Promise<boolean> {
    const backend = this.config.backend;
    const timedOutAt = new Date();
    const run = await backend.getRun(wait.runId);
    if (!run) return true;
    if (run.status === "failed") return false;
    if (!ACTIVE_WAIT_STATUS_SET.has(run.status)) return true;

    const existingNodeState = run.nodeStates[wait.nodeId];
    if (
      existingNodeState?.status !== "running" ||
      !isSameWaitNodeExecution(wait, {
        nodeId: wait.nodeId,
        waitInstanceId: existingNodeState._waitInstanceId,
      })
    ) return true;
    const failedNodeState = {
      ...existingNodeState,
      nodeId: wait.nodeId,
      status: "failed" as const,
      error: `Wait for event "${wait.eventName}" timed out`,
      attempt: existingNodeState?.attempt ?? 1,
      completedAt: timedOutAt,
    };
    return await updateRunIfStatus(backend, wait.runId, ACTIVE_WAIT_STATUSES, {
      status: "failed",
      error: {
        message: `Wait for event "${wait.eventName}" at node "${wait.nodeId}" timed out`,
      },
      // A single-entry patch relies on the backend merging node states by
      // key; a replacement-semantics backend would erase every sibling's
      // persisted state, so it gets the complete map instead.
      nodeStates: hasRunPatchKeyMergeSupport(backend)
        ? { [wait.nodeId]: failedNodeState }
        : { ...run.nodeStates, [wait.nodeId]: failedNodeState },
      completedAt: timedOutAt,
    });
  }

  /**
   * Release every wait whose deadline has already passed.
   *
   * Each record is expired on its own. This sweep spans every run on the
   * backend, so one run whose expiry cannot be applied must not deny every
   * other run its deadline.
   */
  async checkExpiredEventWaits(): Promise<void> {
    const backend = this.config.backend;
    if (this.destroyed || !hasEventWaitSupport(backend)) return;

    await this.recoverAndDrainAbandonedDeliveries();

    const runStatuses = new Map<string, WorkflowRun["status"] | null>();
    const activeRunIds = new Set<string>();
    for (const { runId, wait } of await backend.listPendingEventWaits()) {
      await this.sweepPendingWait(runId, wait, runStatuses, activeRunIds);
    }

    // A rolled-back post-parking delivery leaves only durable pending state:
    // the publisher already returned and the process that scheduled its prompt
    // retry may have exited. Draining every active run represented by the
    // pending-wait index makes the sweep the restart-safe retry path too.
    for (const runId of activeRunIds) {
      await this.drainActiveSweepRun(runId);
    }
  }

  private async sweepPendingWait(
    runId: string,
    wait: PersistedPendingEventWait,
    runStatuses: Map<string, WorkflowRun["status"] | null>,
    activeRunIds: Set<string>,
  ): Promise<void> {
    const status = await this.readSweepRunStatus(runId, runStatuses);
    if (status === undefined || status === "failed") return;
    if (status !== null && !ACTIVE_WAIT_STATUS_SET.has(status)) {
      await this.cleanUpTerminalWait(runId, wait.id);
      return;
    }
    if (status !== null) activeRunIds.add(runId);
    if (!wait.expiresAt || Date.now() <= wait.expiresAt.getTime()) return;
    try {
      await this.expire(wait);
    } catch (error) {
      logger.error(
        "Failed to expire an event wait during the sweep",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
    }
  }

  private async readSweepRunStatus(
    runId: string,
    runStatuses: Map<string, WorkflowRun["status"] | null>,
  ): Promise<WorkflowRun["status"] | null | undefined> {
    const cached = runStatuses.get(runId);
    if (cached !== undefined) return cached;
    try {
      const status = (await this.config.backend.getRun(runId))?.status ?? null;
      runStatuses.set(runId, status);
      return status;
    } catch (error) {
      logger.error("Failed to read a run during the event wait sweep", { runId }, error);
      return undefined;
    }
  }

  private async cleanUpTerminalWait(runId: string, waitId: string): Promise<void> {
    const backend = this.config.backend;
    if (!hasEventWaitSupport(backend)) return;
    try {
      await backend.resolvePendingEventWait(runId, waitId, "cancelled");
      this.clearExpiry(waitId);
    } catch (error) {
      logger.error(
        "Failed to clean up a terminal run's event wait during the sweep",
        { runId, waitId },
        error,
      );
    }
  }

  private async drainActiveSweepRun(runId: string): Promise<void> {
    const backend = this.config.backend;
    try {
      const run = await backend.getRun(runId);
      if (!run || !ACTIVE_WAIT_STATUSES.includes(run.status)) return;
      const outcome = await this.drain(runId, false);
      if (outcome.failedEventIds.size > 0) this.scheduleDeliveryRetry(runId);
      else this.clearDeliveryRetry(runId);
    } catch (error) {
      logger.error(
        "Failed to drain an active run during the event-wait sweep",
        { runId },
        error,
      );
    }
  }

  /** Stop the manager and drop every timer it owns. */
  stop(): void {
    this.destroyed = true;
    for (const waitId of this.expiryTimers.keys()) this.clearOwnedExpiry(waitId);
    for (const eventId of this.finalizationRetryTimers.keys()) {
      this.clearFinalizationRetry(eventId);
    }
    this.finalizationRetryAttempts.clear();
    for (const runId of this.deliveryRetryTimers.keys()) this.clearDeliveryRetry(runId);
    this.deliveryRetryAttempts.clear();
    for (const key of this.committedResumeRetryTimers.keys()) {
      clearTimeout(this.committedResumeRetryTimers.get(key)!);
    }
    this.committedResumeRetryTimers.clear();
    this.committedResumeRetryAttempts.clear();
    this.activeTimedWaitClaims.clear();
    if (this.claimRecoveryCheckTimer !== undefined) {
      clearInterval(this.claimRecoveryCheckTimer);
      this.claimRecoveryCheckTimer = undefined;
    }
    if (this.expirationTimer === undefined) return;
    clearInterval(this.expirationTimer);
    this.expirationTimer = undefined;
  }
}
