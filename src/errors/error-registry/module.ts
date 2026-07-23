import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the module-not-found slug. */
export const MODULE_NOT_FOUND: RegisteredError = defineError({
  slug: "module-not-found",
  category: "MODULE",
  status: 404,
  title: "Module could not be resolved",
  suggestion: "Check the import path and ensure the module is installed",
});

/** Registered error definition for the import-resolution-error slug. */
export const IMPORT_RESOLUTION_ERROR: RegisteredError = defineError({
  slug: "import-resolution-error",
  category: "MODULE",
  status: 500,
  title: "Import path resolution failed",
  suggestion: "Verify import paths and module configuration",
});

/** Registered error definition for the circular-dependency slug. */
export const CIRCULAR_DEPENDENCY: RegisteredError = defineError({
  slug: "circular-dependency",
  category: "MODULE",
  status: 500,
  title: "Circular dependency detected",
  suggestion: "Refactor imports to break the circular dependency",
});

/** Registered error definition for the invalid-import slug. */
export const INVALID_IMPORT: RegisteredError = defineError({
  slug: "invalid-import",
  category: "MODULE",
  status: 400,
  title: "Invalid import statement",
  suggestion: "Fix import syntax or path",
});

/** Registered error definition for the dependency-missing slug. */
export const DEPENDENCY_MISSING: RegisteredError = defineError({
  slug: "dependency-missing",
  category: "MODULE",
  status: 404,
  title: "Required dependency not installed",
  suggestion: "Install the missing dependency with your package manager",
});

/** Registered error definition for the version-mismatch slug. */
export const VERSION_MISMATCH: RegisteredError = defineError({
  slug: "version-mismatch",
  category: "MODULE",
  status: 409,
  title: "Dependency version mismatch",
  suggestion: "Update dependencies to compatible versions",
});

/** Registry fragment for MODULE errors (slug → definition). */
export const MODULE_REGISTRY: ErrorRegistryFragment<
  | "module-not-found"
  | "import-resolution-error"
  | "circular-dependency"
  | "invalid-import"
  | "dependency-missing"
  | "version-mismatch"
> = Object.freeze(
  {
    "module-not-found": MODULE_NOT_FOUND,
    "import-resolution-error": IMPORT_RESOLUTION_ERROR,
    "circular-dependency": CIRCULAR_DEPENDENCY,
    "invalid-import": INVALID_IMPORT,
    "dependency-missing": DEPENDENCY_MISSING,
    "version-mismatch": VERSION_MISMATCH,
  } as const,
);
