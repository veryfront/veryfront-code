import { red } from "../../platform/compat/console/index.js";
import { exit } from "../../platform/compat/process.js";
import { cliLogger } from "../../utils/logger/logger.js";
import { formatUserError } from "./error-formatter.js";

export function wrapErrorHandler<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof Error) {
        cliLogger.error(formatUserError(error));
      } else {
        cliLogger.error(red("✖ Unknown error:"), error);
      }

      if (import.meta.main) exit(1);

      throw error;
    }
  };
}
