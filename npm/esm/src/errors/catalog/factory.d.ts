import type { ErrorCodeType } from "../error-codes.js";
import type { ErrorSolution } from "./types.js";
export declare function createErrorSolution(code: ErrorCodeType, config: Omit<ErrorSolution, "code" | "docs"> & {
    docs?: string;
}): ErrorSolution;
export declare function createSimpleError(code: ErrorCodeType, title: string, message: string, steps: string[]): ErrorSolution;
//# sourceMappingURL=factory.d.ts.map