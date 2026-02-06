import { VeryfrontError } from "./types.ts";
import { BUILD_FAILED, COMPILATION_ERROR } from "./error-registry.ts";

export class BuildError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: BUILD_FAILED.slug,
      category: BUILD_FAILED.category,
      status: BUILD_FAILED.status,
      title: BUILD_FAILED.title,
      suggestion: BUILD_FAILED.suggestion,
      detail: message,
      context,
    });
    this.name = "BuildError";
  }
}

export class CompilationError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: COMPILATION_ERROR.slug,
      category: COMPILATION_ERROR.category,
      status: COMPILATION_ERROR.status,
      title: COMPILATION_ERROR.title,
      suggestion: COMPILATION_ERROR.suggestion,
      detail: message,
      context,
    });
    this.name = "CompilationError";
  }
}
