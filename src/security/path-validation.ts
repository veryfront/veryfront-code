/**
 * Path Validation - Re-export from modular implementation
 *
 * This file maintains backward compatibility by re-exporting
 * from the new modular path-validation/ directory.
 *
 * @module security/path-validation
 */

export {
  createValidator,
  getCanonicalPath,
  isAbsolutePath,
  isWithinDirectory,
  joinPaths,
  normalizeSeparators,
  PathValidationError,
  resolvePathSegments,
  sanitizePathForDisplay,
  validateAllowedDirs,
  validatePath,
  validatePathBasics,
  validatePathSync,
  type ValidationLevel,
  type ValidationOptions,
  ValidationPresets,
  type ValidationResult,
} from "./path-validation/index.ts";
