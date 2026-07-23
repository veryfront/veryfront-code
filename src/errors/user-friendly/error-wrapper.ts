import { red } from "#veryfront/compat/console";
import { exit } from "#veryfront/platform/compat/process.ts";
import { cliLogger } from "#veryfront/utils/logger/logger.ts";
import { formatUserError } from "./error-formatter.ts";

/** Wrap an asynchronous handler with sanitized CLI reporting and rethrow semantics. */
export function wrapErrorHandler<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  if (typeof fn !== "function") throw new TypeError("fn must be a function");
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args);
    } catch (error) {
      try {
        if (error instanceof Error) {
          cliLogger.error(formatUserError(error));
        } else {
          cliLogger.error(red("✖ Unknown error"));
        }
      } catch {
        // Reporting must not replace the original application failure.
      }

      if (import.meta.main) {
        exit(1);
      }

      throw error;
    }
  };
}
