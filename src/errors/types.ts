// Re-export schema-based ErrorCode (both as value and type)
export { ErrorCode } from "./schemas/index.ts";
export type { ErrorCodeType } from "./schemas/index.ts";

// Import for use in class definition
import type { ErrorCodeType } from "./schemas/index.ts";

export class VeryfrontError extends Error {
  public code: ErrorCodeType;
  public context?: unknown;

  constructor(message: string, code: ErrorCodeType, context?: unknown) {
    super(message);
    this.name = "VeryfrontError";
    this.code = code;
    this.context = context;
  }
}
