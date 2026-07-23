import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

/** Immutable error-solution catalog fragment. */
export const MODULE_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
  "cache-path-mismatch": createErrorSolution("cache-path-mismatch", {
    title: "Cache path mismatch",
    message: "Cached code references paths from a different project environment.",
    steps: [
      "Run 'veryfront clean --cache' in the affected project",
      "Restart 'veryfront dev' after the cache is cleared",
      "If the error returns, run 'veryfront doctor' and report the diagnostic code",
    ],
    example: `veryfront clean --cache
veryfront dev`,
  }),

  "module-not-found": createErrorSolution("module-not-found", {
    title: "Module not found",
    message: "Cannot find the imported module.",
    steps: [
      "Check that the file path is correct",
      "Ensure the module is installed or exists",
      "Add missing module to import map",
      "Check for typos in the import statement",
    ],
    example: `// Add to veryfront.config.ts
resolve: {
  importMap: {
    imports: {
      "missing-lib": "<MODULE_URL>"
    }
  }
}`,
  }),

  "import-resolution-error": createSimpleError(
    "import-resolution-error",
    "Import resolution failed",
    "Failed to resolve import specifier.",
    [
      "Check import paths are correct",
      "Ensure modules are in import map",
      "Verify network connectivity for remote imports",
    ],
  ),

  "circular-dependency": createSimpleError(
    "circular-dependency",
    "Circular dependency detected",
    "Files are importing each other in a circle.",
    [
      "Identify the circular import chain",
      "Extract shared code to separate file",
      "Use dependency injection or lazy imports",
    ],
  ),

  "invalid-import": createSimpleError(
    "invalid-import",
    "Invalid import statement",
    "Import statement has invalid syntax.",
    [
      'Check import syntax: import X from "y"',
      "Ensure quotes are properly closed",
      "Verify export exists in target module",
    ],
  ),

  "dependency-missing": createErrorSolution("dependency-missing", {
    title: "Required dependency not found",
    message: "A required dependency is missing.",
    steps: [
      "Add React and React DOM to your import map",
      "Include all required peer dependencies",
      "Run 'veryfront doctor' to verify setup",
    ],
    example: `// Minimum required imports
resolve: {
  importMap: {
    imports: {
      "react": "<REACT_MODULE_URL>",
      "react-dom": "<REACT_DOM_MODULE_URL>"
    }
  }
}`,
  }),

  "version-mismatch": createSimpleError(
    "version-mismatch",
    "Dependency version mismatch",
    "Incompatible versions of dependencies detected.",
    [
      "Ensure React and React-DOM versions match",
      "Check for multiple React instances",
      "Update dependencies to compatible versions",
    ],
  ),
});
