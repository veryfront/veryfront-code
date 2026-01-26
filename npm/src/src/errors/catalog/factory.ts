import type { ErrorCodeType } from "../error-codes.js";
import { getErrorDocsUrl } from "../error-codes.js";
import type { ErrorSolution } from "./types.js";

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
