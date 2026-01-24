import type { ErrorCodeType } from "../error-codes.ts";
import { getErrorDocsUrl } from "../error-codes.ts";
import type { ErrorSolution } from "./types.ts";

export function createErrorSolution(
  code: ErrorCodeType,
  config: Omit<ErrorSolution, "code" | "docs"> & { docs?: string },
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
