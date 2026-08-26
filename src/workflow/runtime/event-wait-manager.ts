import { logger as baseLogger } from "#veryfront/utils";
import type { PendingEventWait, WaitNodeConfig, WorkflowRun } from "../types.ts";
import { generateId, parseDuration } from "../types.ts";
import {
  hasEventWaitSupport,
  hasRunPatchKeyMergeSupport,
  type PersistedPendingEventWait,
  type RunEventEnvelope,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { getConfiguredTimedWaitKind, INTERNAL_DELAY_EVENT_NAME } from "../timed-wait-state.ts";
import { isCanonicalNonEmptyString } from "../dsl/validation.ts";
import {
  reconcileWorkflowRunControl,
  type WorkflowRunControlReconcileOutcome,
} from "./workflow-run-control.ts";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR } from "#veryfront/errors";
import { unrefTimer } from "#veryfront/compat/process.ts";

const logger = baseLogger.component("event-wait-manager");

/** Default interval for sweeping event waits whose declared timeout elapsed. */
const DEFAULT_EXPIRATION_CHECK_INTERVAL_MS = 60_000;
const MIN_EXPIRY_RETRY_DELAY_MS = 1_000;
const MAX_DELIVERY_RECONCILIATION_ATTEMPTS = 8;
const ACTIVE_WAIT_STATUSES: WorkflowRun["status"][] = ["pending", "running", "waiting"];

export interface EventWaitManagerConfig {
  /** Backend for persistence */
  backend: WorkflowBackend;
  /** Workflow executor used to resume a run once its wait is released */
  executor?: WorkflowExecutor;
  /** Interval for sweeping timed-out waits parked by another process (ms) */
  expirationCheckInterval?: number;
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
   * rolled back, so the run is still parked and a later publish can retry.
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

/** Strip backend-only fields so callers never see worker ownership. */
function projectEventWait(wait: PersistedPendingEventWait): PendingEventWait {
  const { workerId: _workerId, ...projected } = wait;
  return projected;
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
  /** In-process deadline timers, keyed by wait id, so a short delay fires promptly. */
  private expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private destroyed = false;

  constructor(config: EventWaitManagerConfig) {
    this.config = {
      expirationCheckInterval: DEFAULT_EXPIRATION_CHECK_INTERVAL_MS,
      debug: false,
      ...config,
    };
    this.ensureExpirationChecker();
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
    const wait: PersistedPendingEventWait = {
      id: generateId("evw"),
      runId: run.id,
      nodeId,
      eventName,
      waitKind: getConfiguredTimedWaitKind(waitConfig) ?? "event",
      requestedAt: new Date(),
      ...(timeoutMs === undefined ? {} : { expiresAt: new Date(timeoutBaseMs + timeoutMs) }),
      status: "pending",
      ...(run.workerId === undefined ? {} : { workerId: run.workerId }),
    };

    // The deadline timer is armed BEFORE the record becomes claimable. A
    // publish that lands during the persistence await can claim the freshly
    // visible record and clear its expiry; a timer armed only afterwards
    // would survive that clear and hold its closure until the original
    // deadline. Armed first, the claimer's clear always finds it.
    this.scheduleExpiry(wait);
    try {
      // Worker-owned waits are reserved atomically, so a delayed onWaiting
      // callback cannot append after a replacement worker claimed the run.
      if (run.workerId !== undefined) {
        const saveOwned = backend.savePendingEventWaitIfStatusAndWorker;
        const saved = saveOwned
          ? await saveOwned.call(backend, run.id, ["waiting"], run.workerId, wait)
          : false;
        if (!saved) {
          throw ORCHESTRATION_ERROR.create({
            detail: "Workflow execution ownership changed before event wait persistence",
          });
        }
      } else {
        await backend.savePendingEventWait(run.id, wait);
      }
    } catch (error) {
      // Nothing was persisted, so the early timer guards nothing: drop it.
      this.clearExpiry(wait.id);
      throw error;
    }

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
    return projectEventWait(wait);
  }

  /** Drain buffered events after a complete waiting batch has been persisted. */
  async drainPendingEvents(runId: string): Promise<void> {
    await this.drain(runId);
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

    if (!isCanonicalNonEmptyString(eventName) || eventName === INTERNAL_DELAY_EVENT_NAME) {
      throw INVALID_ARGUMENT.create({
        detail: "publishEvent eventName must be a canonical non-empty public event name",
      });
    }

    // An absent run is not terminal: publishing to a reserved id before the run
    // starts is the case the mailbox exists to serve.
    const run = await backend.getRun(runId);
    if (run && !ACTIVE_WAIT_STATUSES.includes(run.status)) return "run-terminal";

    const envelope: RunEventEnvelope = {
      id: generateId("evt"),
      eventName,
      payload,
      publishedAt: new Date(),
    };
    await backend.appendRunEvent(runId, envelope);
    const outcome = await this.drain(runId);

    // The outcome reports what happened to THIS envelope. With concurrent
    // publishes or previously buffered mail, the drain can deliver an older
    // envelope with the same name while this one stays buffered, and a caller
    // told "delivered" about an envelope that was not would retry and
    // duplicate the event.
    if (outcome.deliveredEventIds.has(envelope.id)) return "delivered";
    if (outcome.failedEventIds.has(envelope.id)) return "delivery-failed";

    // Re-check for a terminal transition that landed between the status check
    // above and the append. The documented outcome for a finished run is
    // `run-terminal`, and its mail can never be consumed, so reclaim what this
    // name has buffered rather than leaving it stranded.
    const latest = await backend.getRun(runId);
    if (latest && !ACTIVE_WAIT_STATUSES.includes(latest.status)) {
      while (await backend.takeRunEvent(runId, eventName)) {
        // Discard: no wait can ever claim mail addressed to a finished run.
      }
      return "run-terminal";
    }
    if (outcome.terminal) return "run-terminal";
    return "buffered";
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
  private async drain(runId: string): Promise<DrainOutcome> {
    const backend = this.config.backend;
    const outcome: DrainOutcome = {
      deliveredEventIds: new Set(),
      failedEventIds: new Set(),
      terminal: false,
    };
    if (!hasEventWaitSupport(backend)) return outcome;

    for (const wait of await backend.getPendingEventWaits(runId)) {
      // A delay is released by its own deadline, never by a published event,
      // so it must not consume anything from the mailbox.
      if (wait.waitKind === "delay") continue;

      // A wait whose declared deadline has already passed must not be resolved
      // by an event published after it: a delayed timer or a restarted process
      // does not extend the timeout. Expire it here, before matching, so the
      // race is decided by the deadline and not by which sweep ran last.
      if (wait.expiresAt && Date.now() > wait.expiresAt.getTime()) {
        try {
          await this.expire(wait);
        } catch (error) {
          logger.error(
            "Failed to expire an overdue event wait before matching",
            { runId, waitId: wait.id },
            error,
          );
        }
        continue;
      }

      // The claim is one atomic backend step: the event leaves the mailbox and
      // the wait flips to delivered together, so no crash can strand an event
      // outside the mailbox against a wait that is still pending.
      const event = await backend.claimRunEventForWait(runId, wait.id, wait.eventName);
      if (!event) continue;

      this.clearExpiry(wait.id);
      let reconciled: WorkflowRunControlReconcileOutcome;
      try {
        reconciled = await this.deliver(wait, event.payload);
      } catch (error) {
        if (await this.nodeOutcomeCommitted(wait)) {
          outcome.deliveredEventIds.add(event.id);
          logger.error(
            "Event wait node committed but resuming the run failed",
            { runId, waitId: wait.id, nodeId: wait.nodeId },
            error,
          );
          continue;
        }
        // The event is out of the mailbox and the wait is marked delivered, but
        // the node never completed. Leaving it there strands the run: nothing
        // pending remains for a later publish to match, and run control reads
        // the same record to tell a parked run from a stuck one, so a resume
        // would fail a run that is merely waiting. Give both back instead.
        outcome.failedEventIds.add(event.id);
        logger.error(
          "Event wait delivery failed; restoring the wait and re-buffering the event",
          { runId, waitId: wait.id, nodeId: wait.nodeId },
          error,
        );
        await this.rollBackDelivery(wait, event);
        continue;
      }

      if (reconciled.status === "skipped-terminal") {
        if (reconciled.run?.status === "failed") {
          outcome.failedEventIds.add(event.id);
          await this.rollBackDelivery(wait, event);
          continue;
        }
        outcome.terminal = true;
        continue;
      }
      outcome.deliveredEventIds.add(event.id);
    }
    return outcome;
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
   * The event goes back to the head of the mailbox: it was the oldest with
   * its name when it was claimed, and re-appending it at the tail would
   * deliver a later same-name event before it on the next drain, reordering
   * the run's mail after a transient failure.
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
    try {
      const run = await this.config.backend.getRun(wait.runId);
      return run?.nodeStates[wait.nodeId]?.status === "completed";
    } catch {
      return false;
    }
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
    const timer = setTimeout(() => {
      this.expiryTimers.delete(wait.id);
      this.expire(wait).catch((error) => {
        logger.error("Failed to apply event wait timeout", { waitId: wait.id }, error);
      });
    }, Math.max(minimumDelayMs, wait.expiresAt.getTime() - Date.now()));
    // Unreferenced like the sweep interval: a deadline timer is a convenience
    // for promptness, not what keeps the wait enforceable. A process done with
    // its work, an isolated per-run executor above all, must be free to exit
    // during a long delay; the durable record and another process's sweep
    // still enforce the deadline.
    unrefTimer(timer);
    this.expiryTimers.set(wait.id, timer);
  }

  private clearExpiry(waitId: string): void {
    const timer = this.expiryTimers.get(waitId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.expiryTimers.delete(waitId);
  }

  /**
   * Apply a wait's declared timeout.
   *
   * A delay's timeout is its whole purpose, so reaching it completes the node.
   * A wait-for-event's timeout means the event never came, which fails the run
   * the same way an expired approval does. Either way the run stops consuming
   * capacity on a deadline it declared and then ignored.
   */
  private async expire(wait: PersistedPendingEventWait): Promise<void> {
    const backend = this.config.backend;
    if (this.destroyed || !hasEventWaitSupport(backend)) return;

    // A delay's deadline is its delivery, so the record resolves as delivered
    // rather than expired: the node completed on time, it did not time out.
    const claimed = await backend.resolvePendingEventWait(
      wait.runId,
      wait.id,
      wait.waitKind === "delay" ? "delivered" : "expired",
    );
    if (!claimed) return;

    if (wait.waitKind === "delay") {
      try {
        await this.deliver(wait, undefined);
      } catch (error) {
        if (await this.nodeOutcomeCommitted(wait)) {
          logger.error(
            "Delay node committed but resuming the run failed",
            { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
            error,
          );
          return;
        }
        // Same bargain as a failed event delivery: the record says the delay
        // was served but the node never completed, so give the claim back and
        // let the sweep reach this already-elapsed deadline again.
        logger.error(
          "Delay delivery failed; restoring the wait so its deadline is reached again",
          { runId: wait.runId, waitId: wait.id, nodeId: wait.nodeId },
          error,
        );
        await this.restoreClaimedWait(wait);
      }
      return;
    }

    try {
      const applied = await this.failRunForExpiredWait(wait);
      if (applied) return;
    } catch (error) {
      logger.error(
        "Failed to apply an event wait timeout to its run; restoring the wait for the sweep",
        { runId: wait.runId, waitId: wait.id },
        error,
      );
    }
    // The record committed as expired, but the run was never failed: the
    // process could also have died between the two. An expired outcome must
    // stay replayable until the run transition succeeds, so give the claim
    // back and let the sweep reach this already-elapsed deadline again rather
    // than leaving the run parked forever with no live record.
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
   * Resolves `true` when the failure was applied, or when the run is already
   * terminal and there is nothing left to apply; `false` when the conditional
   * update lost a race and should be retried by the sweep.
   */
  private async failRunForExpiredWait(wait: PersistedPendingEventWait): Promise<boolean> {
    const backend = this.config.backend;
    const timedOutAt = new Date();
    const run = await backend.getRun(wait.runId);
    if (!run) return true;
    if (!ACTIVE_WAIT_STATUSES.includes(run.status)) return true;

    const existingNodeState = run.nodeStates[wait.nodeId];
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

    const now = Date.now();
    const runStatuses = new Map<string, WorkflowRun["status"] | null>();
    for (const { runId, wait } of await backend.listPendingEventWaits()) {
      // A wait whose run is already terminal can never be delivered or
      // expired: without a deadline it would stay pending, and enumerated by
      // every future sweep, forever. Resolve it as cancelled instead.
      let status = runStatuses.get(runId);
      if (status === undefined) {
        try {
          status = (await backend.getRun(runId))?.status ?? null;
        } catch (error) {
          logger.error("Failed to read a run during the event wait sweep", { runId }, error);
          continue;
        }
        runStatuses.set(runId, status);
      }
      if (status !== null && !ACTIVE_WAIT_STATUSES.includes(status)) {
        try {
          await backend.resolvePendingEventWait(runId, wait.id, "cancelled");
          this.clearExpiry(wait.id);
        } catch (error) {
          logger.error(
            "Failed to clean up a terminal run's event wait during the sweep",
            { runId, waitId: wait.id },
            error,
          );
        }
        continue;
      }

      if (!wait.expiresAt || now <= wait.expiresAt.getTime()) continue;
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
  }

  /** Stop the manager and drop every timer it owns. */
  stop(): void {
    this.destroyed = true;
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
    if (this.expirationTimer === undefined) return;
    clearInterval(this.expirationTimer);
    this.expirationTimer = undefined;
  }
}
