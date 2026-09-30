/**
 * Task errors that change how the platform treats a failed task run.
 *
 * @module task/errors
 */

/**
 * Brand shared by every copy of the framework, so a project bundle that ships
 * its own `veryfront/task` still throws an error the runtime recognizes.
 */
const RETRYABLE_ERROR_BRAND = Symbol.for("veryfront.task.RetryableError");

/**
 * Throw from a task to ask the platform to run it again.
 *
 * A project task run is retried with exponential backoff while its
 * `backoff_limit` has budget left and its `timeout_seconds` deadline allows.
 * Any other thrown error fails the run immediately. Read `ctx.attempt` to see
 * which attempt is running.
 *
 * @example
 * ```ts
 * import { RetryableError, type TaskContext } from "veryfront/task";
 *
 * export default {
 *   async run(ctx: TaskContext) {
 *     const response = await fetch("https://api.example.com/sync", { signal: ctx.signal });
 *     if (response.status === 503) throw new RetryableError("Upstream unavailable");
 *     return await response.json();
 *   },
 * };
 * ```
 */
export class RetryableError extends Error {
  readonly [RETRYABLE_ERROR_BRAND] = true;

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetryableError";
  }
}

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

/** True for a {@link RetryableError} from any copy of the framework. */
export function isRetryableError(error: unknown): error is RetryableError {
  if (typeof error !== "object" || error === null) return false;
  try {
    return getOwnPropertyDescriptor(error, RETRYABLE_ERROR_BRAND)?.value === true;
  } catch {
    return false;
  }
}
