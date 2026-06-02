import { defineError } from "../types.ts";

export const MODULE_NOT_FOUND = defineError({
  slug: "module-not-found",
  category: "MODULE",
  status: 404,
  title: "Module could not be resolved",
  suggestion: "Check the import path and ensure the module is installed",
});

export const IMPORT_RESOLUTION_ERROR = defineError({
  slug: "import-resolution-error",
  category: "MODULE",
  status: 500,
  title: "Import path resolution failed",
  suggestion: "Verify import paths and module configuration",
});

export const CIRCULAR_DEPENDENCY = defineError({
  slug: "circular-dependency",
  category: "MODULE",
  status: 500,
  title: "Circular dependency detected",
  suggestion: "Refactor imports to break the circular dependency",
});

export const INVALID_IMPORT = defineError({
  slug: "invalid-import",
  category: "MODULE",
  status: 400,
  title: "Invalid import statement",
  suggestion: "Fix import syntax or path",
});

export const DEPENDENCY_MISSING = defineError({
  slug: "dependency-missing",
  category: "MODULE",
  status: 404,
  title: "Required dependency not installed",
  suggestion: "Install the missing dependency with your package manager",
});

export const VERSION_MISMATCH = defineError({
  slug: "version-mismatch",
  category: "MODULE",
  status: 409,
  title: "Dependency version mismatch",
  suggestion: "Update dependencies to compatible versions",
});

/** Registry fragment for MODULE errors (slug → definition). */
export const MODULE_REGISTRY = {
  "module-not-found": MODULE_NOT_FOUND,
  "import-resolution-error": IMPORT_RESOLUTION_ERROR,
  "circular-dependency": CIRCULAR_DEPENDENCY,
  "invalid-import": INVALID_IMPORT,
  "dependency-missing": DEPENDENCY_MISSING,
  "version-mismatch": VERSION_MISMATCH,
} as const;
