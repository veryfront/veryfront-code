import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const MODULE_ERROR_CATALOG: PartialErrorCatalog = {
  "cache-path-mismatch": createErrorSolution("cache-path-mismatch", {
    title: "Cache path mismatch",
    message: "Cached code contains file paths from a different environment.",
    steps: [
      "This is a distributed cache issue - cached code has paths like 'file:///app/...' but local expects different paths",
      "Clear the project transform cache (see command below)",
      "If widespread, restart renderer pods to clear all caches",
      "This happens when local dev hits production cache or vice versa",
    ],
    example: `# Clear project cache:
curl -X DELETE "https://api.veryfront.com/internal/cache/project/{projectId}/transforms" \\
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Or restart pods:
kubectl rollout restart deployment/veryfront-server -n veryfront-production

# To reproduce locally with production cache:
VERYFRONT_PROXY_API_BASE_URL=https://api.veryfront.com PROXY_MODE=1 deno task start`,
  }),

  "module-not-found": createErrorSolution("module-not-found", {
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
};
