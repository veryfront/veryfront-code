import { red } from "#veryfront/compat/console";
import { exit } from "#veryfront/platform/compat/process/lifecycle.ts";
import { cliLogger } from "#veryfront/utils/logger/logger.ts";
import { formatUserError } from "./error-formatter.ts";
import {
  isNativeErrorWithoutHooks,
  sanitizeTerminalDiagnosticText,
  snapshotThrowableDiagnostic,
} from "../safe-diagnostics.ts";

function logCaughtErrorBestEffort(error: unknown): void {
  try {
    if (isNativeErrorWithoutHooks(error)) {
      cliLogger.error(formatUserError(error));
    } else {
      cliLogger.error(
        red("✖ Unknown error:"),
        sanitizeTerminalDiagnosticText(snapshotThrowableDiagnostic(error)),
      );
    }
  } catch {
    // Logging must never replace the original operation error.
  }
}

export function wrapErrorHandler<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args);
    } catch (error) {
      logCaughtErrorBestEffort(error);

      if (import.meta.main) {
        exit(1);
      }

      throw error;
    }
  };
}
