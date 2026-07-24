import { red } from "#veryfront/compat/console";
import { exit } from "#veryfront/platform/compat/process.ts";
import { cliLogger } from "#veryfront/utils/logger/logger.ts";
import { getErrorMessage, isErrorInstance } from "../veryfront-error.ts";
import { formatUserError } from "./error-formatter.ts";
import { sanitizeTerminalDiagnosticText } from "../safe-diagnostics.ts";

export function wrapErrorHandler<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (isErrorInstance(error)) {
        cliLogger.error(formatUserError(error));
      } else {
        cliLogger.error(
          red("✖ Unknown error:"),
          sanitizeTerminalDiagnosticText(getErrorMessage(error)),
        );
      }

      if (import.meta.main) {
        exit(1);
      }

      throw error;
    }
  };
}
