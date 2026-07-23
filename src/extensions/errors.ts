/**
 * Canonical extension-system error definitions.
 *
 * @module extensions/errors
 */

import { VeryfrontError as VeryfrontErrorClass } from "#veryfront/errors";

/** @internal Match a typed error without trusting a thrown object's prototype traps. */
export function isVeryfrontErrorWithSlug(
  error: unknown,
  slug: string,
): error is VeryfrontErrorClass {
  try {
    return error instanceof VeryfrontErrorClass && error.slug === slug;
  } catch {
    return false;
  }
}

export {
  CIRCULAR_DEPENDENCY_ERROR,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_SETUP_TIMEOUT_ERROR,
  EXTENSION_VALIDATION_ERROR,
  MISSING_EXTENSION_ERROR,
} from "#veryfront/errors";

export type {
  ErrorCategory,
  ErrorCreateOptions,
  ErrorDefinition,
  RegisteredError,
  RFC9457Response,
  VeryfrontError,
  VeryfrontErrorOptions,
} from "#veryfront/errors";
