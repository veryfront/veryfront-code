import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";

/** Workflow-internal cleanup bound shared by step and composite attempts. */
const DEFAULT_CANCELLATION_GRACE_PERIOD_MS = 1_000;

const nonCooperativeReasons = new WeakSet<object>();
const abortCleanupMetadata = new WeakMap<
  object,
  { primaryReason: unknown; cleanupErrors: readonly unknown[] }
>();
const nonCooperativeAbortMetadata = new WeakMap<object, { primaryReason: unknown }>();

interface AbortableOperationTimeout {
  milliseconds: number;
  reason: Error;
}

export interface AbortableOperationOptions {
  label: string;
  parentSignal?: AbortSignal;
  timeout?: AbortableOperationTimeout;
  cancellationGracePeriod?: number;
}

interface FulfilledSettlement<T> {
  status: "fulfilled";
  value: T;
}

interface RejectedSettlement {
  status: "rejected";
  reason: unknown;
}

type OperationSettlement<T> = FulfilledSettlement<T> | RejectedSettlement;

/**
 * An abort completed, but the operation also reported a distinct cleanup
 * failure. The abort reason is always first so callers retain its precedence.
 */
export class AbortCleanupError extends AggregateError {
  readonly primaryReason: unknown;
  readonly cleanupErrors: readonly unknown[];

  constructor(primaryReason: unknown, cleanupErrors: readonly unknown[], label: string) {
    const copiedCleanupErrors = [...cleanupErrors];
    super(
      [primaryReason, ...copiedCleanupErrors],
      `${describeReason(primaryReason)}; ${label} cleanup failed: ${
        copiedCleanupErrors.map(describeReason).join("; ")
      }`,
      { cause: primaryReason },
    );
    this.name = "AbortCleanupError";
    this.primaryReason = primaryReason;
    this.cleanupErrors = Object.freeze(copiedCleanupErrors);
    abortCleanupMetadata.set(this, {
      primaryReason,
      cleanupErrors: this.cleanupErrors,
    });
  }
}

/** Marker used only when an abort reason cannot itself carry weak identity. */
export class NonCooperativeAbortError extends Error {
  readonly primaryReason: unknown;

  constructor(primaryReason: unknown, label: string) {
    super(
      `${
        describeReason(primaryReason)
      }; ${label} did not settle within the cancellation grace period`,
      { cause: primaryReason },
    );
    this.name = "NonCooperativeAbortError";
    this.primaryReason = primaryReason;
    nonCooperativeAbortMetadata.set(this, { primaryReason });
  }
}

/**
 * Run work under an owned signal, fence late success, and join cooperative
 * cleanup before returning control to a retry policy.
 */
export async function runAbortableOperation<T>(
  operation: (signal: AbortSignal) => T | Promise<T>,
  options: AbortableOperationOptions,
): Promise<T> {
  const { label, parentSignal, timeout, cancellationGracePeriod } = options;
  parentSignal?.throwIfAborted();

  const controller = new AbortController();
  const forwardParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", forwardParentAbort, { once: true });

  const rawOperation = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return operation(controller.signal);
  });
  const settlement: Promise<OperationSettlement<T>> = rawOperation.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );

  const operationOutcome = settlement.then((result) => {
    if (controller.signal.aborted) return { kind: "aborted" as const };
    return result.status === "fulfilled"
      ? { kind: "fulfilled" as const, value: result.value }
      : { kind: "rejected" as const, reason: result.reason };
  });

  let resolveAbort: (() => void) | undefined;
  const abortOutcome = new Promise<{ kind: "aborted" }>((resolve) => {
    resolveAbort = () => resolve({ kind: "aborted" });
    if (controller.signal.aborted) resolveAbort();
    else controller.signal.addEventListener("abort", resolveAbort, { once: true });
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeout !== undefined) {
    timeoutId = setTimeout(() => {
      // A caller cancellation already visible at the deadline owns the race.
      if (parentSignal?.aborted) forwardParentAbort();
      else controller.abort(timeout.reason);
    }, timeout.milliseconds);
  }

  try {
    const outcome = await Promise.race([operationOutcome, abortOutcome]);
    if (outcome.kind === "fulfilled") return outcome.value;
    if (outcome.kind === "rejected") throw outcome.reason;

    const initialAbortReason = controller.signal.reason;
    const cleanup = await waitForCancellationGrace(settlement, cancellationGracePeriod);
    // Caller cancellation remains authoritative until cleanup has joined. This
    // preserves the existing outer-cancellation contract and prevents a local
    // timeout from being retried after the caller has cancelled the operation.
    const primaryReason = parentSignal?.aborted ? parentSignal.reason : initialAbortReason;

    if (cleanup === undefined) {
      markNonCooperative(primaryReason);
      if (isWeakKey(primaryReason)) throw primaryReason;
      throw new NonCooperativeAbortError(primaryReason, label);
    }

    if (cleanup.status === "fulfilled") throw primaryReason;

    const collected = collectCleanupFailures(
      cleanup.reason,
      primaryReason,
      initialAbortReason,
    );
    if (collected.nonCooperative) markNonCooperative(primaryReason);
    if (collected.errors.length === 0) throw primaryReason;

    const aggregate = new AbortCleanupError(primaryReason, collected.errors, label);
    if (collected.nonCooperative) markNonCooperative(aggregate);
    throw aggregate;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (resolveAbort) controller.signal.removeEventListener("abort", resolveAbort);
    parentSignal?.removeEventListener("abort", forwardParentAbort);
  }
}

/** Preserve abort precedence without discarding rejected cleanup in a joined batch. */
export function throwIfAbortedWithCleanup(
  signal: AbortSignal | undefined,
  rejectedReasons: readonly unknown[],
  label: string,
): void {
  if (!signal?.aborted) return;

  const primaryReason = signal.reason;
  const errors: unknown[] = [];
  let nonCooperative = false;
  for (const reason of rejectedReasons) {
    const collected = collectCleanupFailures(reason, primaryReason, primaryReason);
    errors.push(...collected.errors);
    nonCooperative ||= collected.nonCooperative;
  }

  if (nonCooperative) markNonCooperative(primaryReason);
  if (errors.length === 0) throw primaryReason;

  const aggregate = new AbortCleanupError(primaryReason, errors, label);
  if (nonCooperative) markNonCooperative(aggregate);
  throw aggregate;
}

export function isNonCooperativeOperationError(error: unknown): boolean {
  if (isWeakKey(error) && nonCooperativeAbortMetadata.has(error)) return true;
  if (isWeakKey(error) && nonCooperativeReasons.has(error)) return true;
  const metadata = isWeakKey(error) ? abortCleanupMetadata.get(error) : undefined;
  if (metadata === undefined) return false;
  if (isNonCooperativeOperationError(metadata.primaryReason)) return true;
  return metadata.cleanupErrors.some(isNonCooperativeOperationError);
}

export function getPrimaryAbortReason(error: AbortCleanupError): unknown {
  return abortCleanupMetadata.get(error)?.primaryReason;
}

export function isAbortCleanupError(error: unknown): error is AbortCleanupError {
  return isWeakKey(error) && abortCleanupMetadata.has(error);
}

async function waitForCancellationGrace<T>(
  settlement: Promise<OperationSettlement<T>>,
  configuredGracePeriod: number | undefined,
): Promise<OperationSettlement<T> | undefined> {
  const gracePeriod = configuredGracePeriod ?? DEFAULT_CANCELLATION_GRACE_PERIOD_MS;
  let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const graceExpired = new Promise<undefined>((resolve) => {
    graceTimeoutId = setTimeout(() => resolve(undefined), gracePeriod);
  });

  try {
    return await Promise.race([settlement, graceExpired]);
  } finally {
    if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);
  }
}

function collectCleanupFailures(
  reason: unknown,
  primaryReason: unknown,
  ownedAbortReason: unknown,
): { errors: unknown[]; nonCooperative: boolean } {
  if (Object.is(reason, primaryReason) || Object.is(reason, ownedAbortReason)) {
    return {
      errors: [],
      nonCooperative: isNonCooperativeOperationError(reason),
    };
  }

  const cleanupMetadata = isWeakKey(reason) ? abortCleanupMetadata.get(reason) : undefined;
  if (cleanupMetadata !== undefined) {
    const errors = Object.is(cleanupMetadata.primaryReason, primaryReason) ||
        Object.is(cleanupMetadata.primaryReason, ownedAbortReason)
      ? [...cleanupMetadata.cleanupErrors]
      : [cleanupMetadata.primaryReason, ...cleanupMetadata.cleanupErrors];
    return {
      errors,
      nonCooperative: isNonCooperativeOperationError(reason),
    };
  }

  const nonCooperativeMetadata = isWeakKey(reason)
    ? nonCooperativeAbortMetadata.get(reason)
    : undefined;
  if (nonCooperativeMetadata !== undefined) {
    const nonCooperativeReason = nonCooperativeMetadata.primaryReason;
    return {
      errors: Object.is(nonCooperativeReason, primaryReason) ||
          Object.is(nonCooperativeReason, ownedAbortReason)
        ? []
        : [nonCooperativeReason],
      nonCooperative: true,
    };
  }

  return {
    errors: [reason],
    nonCooperative: isNonCooperativeOperationError(reason),
  };
}

function markNonCooperative(reason: unknown): void {
  if (isWeakKey(reason)) nonCooperativeReasons.add(reason);
}

function isWeakKey(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function describeReason(reason: unknown): string {
  return snapshotThrowableDiagnostic(reason);
}
