import { ErrorCode, VeryfrontError } from "./types.js";

export class RuntimeError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.RENDER_ERROR, context);
    this.name = "RuntimeError";
  }
}

export class RenderError extends VeryfrontError {
  constructor(message: string, context?: unknown) {
    super(message, ErrorCode.RENDER_ERROR, context);
    this.name = "RenderError";
  }
}
