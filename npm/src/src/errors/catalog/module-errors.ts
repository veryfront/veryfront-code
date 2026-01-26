import { ErrorCode } from "../error-codes.js";
import type { PartialErrorCatalog } from "./types.js";
import { createErrorSolution, createSimpleError } from "./factory.js";

export const MODULE_ERROR_CATALOG: PartialErrorCatalog = {
  [ErrorCode.MODULE_NOT_FOUND]: createErrorSolution(ErrorCode.MODULE_NOT_FOUND, {
    title: "Module not found",
    message: "Cannot find the imported module.",
    steps: [
      "Check that the file path is correct",
      "Ensure the module is installed or exists",
      "Add missing module to import map",
      "Check for typos in import statement",
    ],
    example: `// Add to veryfront.config.js
resolve: {
  importMap: {
    imports: {
      "missing-lib": "https://esm.sh/missing-lib@1.0.0"
    }
  }
}`,
  }),

  [ErrorCode.IMPORT_RESOLUTION_ERROR]: createSimpleError(
    ErrorCode.IMPORT_RESOLUTION_ERROR,
    "Import resolution failed",
    "Failed to resolve import specifier.",
    [
      "Check import paths are correct",
      "Ensure modules are in import map",
      "Verify network connectivity for remote imports",
    ],
  ),

  [ErrorCode.CIRCULAR_DEPENDENCY]: createSimpleError(
    ErrorCode.CIRCULAR_DEPENDENCY,
    "Circular dependency detected",
    "Files are importing each other in a circle.",
    [
      "Identify the circular import chain",
      "Extract shared code to separate file",
      "Use dependency injection or lazy imports",
    ],
  ),

  [ErrorCode.INVALID_IMPORT]: createSimpleError(
    ErrorCode.INVALID_IMPORT,
    "Invalid import statement",
    "Import statement has invalid syntax.",
    [
      'Check import syntax: import X from "y"',
      "Ensure quotes are properly closed",
      "Verify export exists in target module",
    ],
  ),

  [ErrorCode.DEPENDENCY_MISSING]: createErrorSolution(
    ErrorCode.DEPENDENCY_MISSING,
    {
      title: "Required dependency not found",
      message: "A required dependency is missing.",
      steps: [
        "Add React to your import map",
        "Ensure all peer dependencies are included",
        "Run 'veryfront doctor' to verify setup",
      ],
      example: `// Minimum required imports
resolve: {
  importMap: {
    imports: {
      "react": "https://esm.sh/react@19",
      "react-dom": "https://esm.sh/react-dom@19"
    }
  }
}`,
    },
  ),

  [ErrorCode.VERSION_MISMATCH]: createSimpleError(
    ErrorCode.VERSION_MISMATCH,
    "Dependency version mismatch",
    "Incompatible versions of dependencies detected.",
    [
      "Ensure React and React-DOM versions match",
      "Check for multiple React instances",
      "Update dependencies to compatible versions",
    ],
  ),
};
