import { VeryfrontError } from "./types.ts";
import { RENDER_ERROR } from "./error-registry.ts";

export class RuntimeError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: RENDER_ERROR.slug,
      category: RENDER_ERROR.category,
      status: RENDER_ERROR.status,
      title: RENDER_ERROR.title,
      suggestion: RENDER_ERROR.suggestion,
      detail: message,
      context,
    });
    this.name = "RuntimeError";
  }
}

export class RenderError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, {
      slug: RENDER_ERROR.slug,
      category: RENDER_ERROR.category,
      status: RENDER_ERROR.status,
      title: RENDER_ERROR.title,
      suggestion: RENDER_ERROR.suggestion,
      detail: message,
      context,
    });
    this.name = "RenderError";
  }
}
