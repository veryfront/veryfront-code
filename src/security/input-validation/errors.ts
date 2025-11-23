/**
 * Input Validation Errors
 * Custom error classes for validation failures
 */

/**
 * Custom validation error with details
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
