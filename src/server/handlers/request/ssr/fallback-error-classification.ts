import {
  CIRCULAR_DEPENDENCY,
  COMPILATION_ERROR,
  COMPONENT_ERROR,
  DEPENDENCY_MISSING,
  IMPORT_RESOLUTION_ERROR,
  INVALID_IMPORT,
  MODULE_NOT_FOUND,
  VERSION_MISMATCH,
  VeryfrontError,
} from "#veryfront/errors";

const FALLBACK_DEFINITION_ERROR_SLUGS: ReadonlySet<string> = new Set([
  COMPILATION_ERROR.slug,
  COMPONENT_ERROR.slug,
  MODULE_NOT_FOUND.slug,
  IMPORT_RESOLUTION_ERROR.slug,
  CIRCULAR_DEPENDENCY.slug,
  INVALID_IMPORT.slug,
  DEPENDENCY_MISSING.slug,
  VERSION_MISMATCH.slug,
]);

/** Return whether an error identifies invalid user-authored fallback code. */
export function isFallbackDefinitionError(error: unknown): boolean {
  try {
    if (error instanceof SyntaxError) return true;
    return error instanceof VeryfrontError &&
      FALLBACK_DEFINITION_ERROR_SLUGS.has(error.slug);
  } catch {
    return false;
  }
}
