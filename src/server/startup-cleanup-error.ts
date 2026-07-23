import { getErrorMessage } from "#veryfront/errors";

/**
 * A server startup phase failed and at least one owned resource remains live.
 * Call {@link retryCleanup} until it succeeds before starting a replacement
 * generation in the same process.
 *
 * @internal
 */
export class ServerStartupCleanupError extends AggregateError {
  constructor(
    scope: string,
    primaryError: unknown,
    cleanupError: unknown,
    readonly retryCleanup: () => Promise<void>,
  ) {
    super(
      [primaryError, cleanupError],
      `${scope} failed and cleanup is incomplete: ${getErrorMessage(primaryError)}`,
    );
    this.name = "ServerStartupCleanupError";
  }
}
