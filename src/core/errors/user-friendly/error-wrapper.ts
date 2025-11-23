import { red } from "std/fmt/colors.ts";
import { exit } from "@veryfront/platform/compat/process.ts";
import { cliLogger } from "@veryfront/utils/logger/logger.ts";
import { formatUserError } from "./error-formatter.ts";

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
      if (import.meta.main) {
        exit(1);
      }
      throw error;
    }
  };
}
