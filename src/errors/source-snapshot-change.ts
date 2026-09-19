/**
 * Single owner for the "did the mutable source change under this request?"
 * question.
 *
 * Requests served from a mutable branch or preview source pin one snapshot
 * generation and fail with a 503 when an edit lands mid-request, rather than
 * serve a mix of two generations. That rejection is the contract working, and
 * the caller retries it (the control plane re-dispatches agent runs; the
 * renderer replays document requests). It shares the
 * `source-snapshot-freshness-unavailable` slug with genuine adapter capability
 * failures so existing retry paths keep matching it, and is told apart by the
 * `sourceSnapshotChanged: true` error context set at the throw site.
 */

import { SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE } from "./error-registry/server.ts";
import { snapshotVeryfrontError, type VeryfrontError } from "./types.ts";

const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;

const SOURCE_SNAPSHOT_CHANGED_CONTEXT_KEY = "sourceSnapshotChanged";

/** Reject a request whose mutable source advanced to a new generation mid-request. */
export function createSourceSnapshotChangedError(detail: string): VeryfrontError {
  return SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail,
    context: { [SOURCE_SNAPSHOT_CHANGED_CONTEXT_KEY]: true },
  });
}

/**
 * Whether `error` is the retryable "source changed mid-request" rejection, as
 * opposed to an adapter that cannot establish or identify freshness at all.
 */
export function isSourceSnapshotChangedError(error: unknown): boolean {
  const snapshot = snapshotVeryfrontError(error);
  if (!snapshot || snapshot.slug !== SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.slug) return false;
  const errorContext = snapshot.context;
  if (typeof errorContext !== "object" || errorContext === null) return false;
  try {
    const descriptor = ReflectGetOwnPropertyDescriptor(
      errorContext,
      SOURCE_SNAPSHOT_CHANGED_CONTEXT_KEY,
    );
    return descriptor !== undefined &&
      ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) === true &&
      descriptor.value === true;
  } catch {
    return false;
  }
}
