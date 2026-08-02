/** Combine a primary operation failure with every cleanup failure. */
export function combinePrimaryAndCleanupFailures(
  primaryFailure: unknown,
  cleanupFailure: unknown,
  message: string,
): AggregateError {
  const cleanupFailures = cleanupFailure instanceof AggregateError
    ? cleanupFailure.errors
    : [cleanupFailure];
  return new AggregateError([primaryFailure, ...cleanupFailures], message);
}
