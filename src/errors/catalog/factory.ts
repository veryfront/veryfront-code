import type { ErrorCodeType } from "../error-codes.ts";
import { getErrorDocsUrl } from "../error-codes.ts";
import type { ErrorSolution } from "./types.ts";

type ErrorSolutionConfig = Omit<ErrorSolution, "code" | "docs"> & { docs?: string };

export function createErrorSolution(
  code: ErrorCodeType,
  config: ErrorSolutionConfig,
): ErrorSolution {
  return {
    ...config,
    code,
    docs: config.docs ?? getErrorDocsUrl(code),
  };
}

export function createSimpleError(
  code: ErrorCodeType,
  title: string,
  message: string,
  steps: string[],
): ErrorSolution {
  return createErrorSolution(code, { title, message, steps });
}
