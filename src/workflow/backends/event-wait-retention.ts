import type { PersistedPendingEventWait, RunEventEnvelope } from "./types.ts";
import {
  MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES,
  MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES,
} from "../limits.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

function isResolved(wait: PersistedPendingEventWait): boolean {
  return wait.status !== "pending";
}

/**
 * Append a detached event-wait record and retain a bounded history.
 *
 * Retention is state-aware for the same reason approval retention is: a wait a
 * run is still parked on must never be evicted, because nothing could then
 * deliver its event or expire it and the run would wait forever. At the bound
 * the oldest resolved record is evicted first, and when there are not enough
 * resolved records to make room the append is rejected without changing
 * existing history.
 */
export function appendRetainedPendingEventWait(
  waits: PersistedPendingEventWait[],
  wait: PersistedPendingEventWait,
): void {
  const snapshot = structuredClone(wait);
  const evictionsRequired = waits.length - MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES + 1;
  if (evictionsRequired <= 0) {
    waits.push(snapshot);
    return;
  }
  const resolvedIndexes: number[] = [];
  for (let index = 0; index < waits.length; index++) {
    if (isResolved(waits[index]!)) resolvedIndexes.push(index);
    if (resolvedIndexes.length === evictionsRequired) break;
  }
  if (resolvedIndexes.length < evictionsRequired) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Event wait list full (max: ${MAX_WORKFLOW_PENDING_EVENT_WAIT_ENTRIES}) and ` +
        `not enough resolved records can be evicted without dropping a pending wait. ` +
        `Cannot append event wait: ${wait.id}`,
    });
  }
  for (let index = resolvedIndexes.length - 1; index >= 0; index--) {
    waits.splice(resolvedIndexes[index]!, 1);
  }
  waits.push(snapshot);
}

/**
 * Append one event to a run's bounded mailbox, refusing the append at the bound.
 *
 * Every entry in a mailbox is unconsumed by definition: an event is removed the
 * moment a wait takes it. So no entry is safe to evict. Dropping the oldest
 * would silently discard an event published before its node parked, which is
 * the case the mailbox exists to serve, and would leave the run parked forever
 * on a wait whose event was accepted. The publish is refused instead, loudly,
 * the way the event-wait list refuses rather than dropping a pending wait.
 */
export function appendRetainedRunEvent(
  mailbox: RunEventEnvelope[],
  event: RunEventEnvelope,
): void {
  if (mailbox.length >= MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Run event mailbox full (max: ${MAX_WORKFLOW_RUN_EVENT_MAILBOX_ENTRIES}) and no ` +
        `buffered event can be dropped without losing one a wait may still claim. ` +
        `Cannot publish event: ${event.eventName}`,
    });
  }
  mailbox.push(structuredClone(event));
}

/**
 * Remove and return the oldest buffered event with this name.
 *
 * Callers must treat this as the point where the event is consumed: it is
 * removed from the mailbox, so a caller that then fails to deliver it has to
 * put it back.
 */
export function takeRetainedRunEvent(
  mailbox: RunEventEnvelope[],
  eventName: string,
): RunEventEnvelope | null {
  const index = mailbox.findIndex((event) => event.eventName === eventName);
  if (index === -1) return null;
  return mailbox.splice(index, 1)[0] ?? null;
}

/**
 * Return a claimed event to the head of the mailbox after delivery failed.
 *
 * The claimed event was the oldest with its name, and waits consume matching
 * events oldest-first, so it goes back at the front: re-appending it at the
 * tail would deliver an event published later ahead of it after a transient
 * failure. No bound is enforced here on purpose: the event already held a
 * place in this mailbox when it was claimed, and refusing the restore would
 * lose an event that was durably accepted.
 */
export function restoreRetainedRunEvent(
  mailbox: RunEventEnvelope[],
  event: RunEventEnvelope,
): void {
  mailbox.unshift(structuredClone(event));
}
