import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

export { INPUT_VALIDATION_FAILED, VeryfrontError };

/**
 * Create an input validation error.
 * Convenience wrapper around INPUT_VALIDATION_FAILED.create().
 *
 * The `details` are stored in `error.context` for catch-site access.
 */
export function createValidationError(message: string, details?: unknown): VeryfrontError {
  return INPUT_VALIDATION_FAILED.create({
    detail: message,
    context: details != null ? { details } : undefined,
  });
}
