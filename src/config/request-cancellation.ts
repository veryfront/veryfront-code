import { createDeclarativeConfigWorkerInfrastructureError } from "#veryfront/config/declarative-evaluator-worker-protocol.ts";

// Keep cancellation ownership outside error fields that another error could imitate.
const requestCancellations = new WeakSet<object>();
const recordCancellation = requestCancellations.add.bind(requestCancellations);
const hasCancellation = requestCancellations.has.bind(requestCancellations);

/** @internal Build the existing typed error for a caller-owned cancellation. */
export function createHostedConfigRequestCancellation() {
  const error = createDeclarativeConfigWorkerInfrastructureError("worker-aborted");
  recordCancellation(error);
  return error;
}

/** @internal Identify only errors created by a hosted request's cancellation path. */
export function isHostedConfigRequestCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && hasCancellation(error);
}
