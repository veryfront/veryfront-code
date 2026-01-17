import { ErrorCode, VeryfrontError } from "./types.ts";

export class BuildError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.BUILD_ERROR, context);
    this.name = "BuildError";
  }
}

export class CompilationError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.COMPILATION_ERROR, context);
    this.name = "CompilationError";
  }
}
