import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const CONFIG_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
  "config-not-found": createErrorSolution("config-not-found", {
    title: "Configuration file not found",
    message: "Veryfront could not find a supported configuration file in your project root.",
    steps: [
      "Create veryfront.config.js, veryfront.config.ts, or veryfront.config.mjs in your project root",
      "Export the configuration object as the file's default export",
      "Copy a configuration from a compatible example project and adapt it",
    ],
    example: `// veryfront.config.ts
export default {
  title: "My App",
  dev: { port: 3002 }
}`,
    tips: [
      "Supported filenames are veryfront.config.js, veryfront.config.ts, and veryfront.config.mjs",
      "Start with an empty default export and add only the settings you need",
    ],
  }),

  "config-invalid": createErrorSolution("config-invalid", {
    title: "Invalid configuration",
    message: "Your configuration file has invalid values or structure.",
    steps: [
      "Check that the config exports a default object",
      "Ensure all values are valid JavaScript types",
      "Check for missing brackets, quotes, or delimiters near the reported location",
      "Verify property names match the schema",
    ],
    example: `// ✓ Valid config
export default {
  title: "My App",
  dev: {
    port: 3002,
    open: true,
  }
}`,
  }),

  "config-parse-error": createSimpleError(
    "config-parse-error",
    "Configuration parse error",
    "Failed to parse your configuration file.",
    [
      "Check for syntax errors (missing brackets, quotes, etc.)",
      "Ensure the file has valid JavaScript/TypeScript syntax",
      "Look for the specific parse error in the output above",
    ],
  ),

  "config-validation-error": createSimpleError(
    "config-validation-error",
    "Configuration validation failed",
    "Configuration values do not pass validation.",
    [
      "Check that port numbers are between 1-65535",
      "Ensure boolean flags are true/false (not strings)",
      "Verify URLs are properly formatted",
      "Check array/object structures match expected format",
    ],
  ),

  "config-type-error": createSimpleError(
    "config-type-error",
    "Configuration type error",
    "A configuration value has the wrong type.",
    [
      "Check that numbers are not in quotes",
      'Ensure booleans are true/false, not "true"/"false"',
      "Verify arrays use [] brackets",
      "Check objects use {} braces",
    ],
  ),

  "import-map-invalid": createErrorSolution("import-map-invalid", {
    title: "Invalid import map",
    message: "The import map in your configuration is invalid.",
    steps: [
      "Check import map structure: { imports: {}, scopes: {} }",
      "Ensure URLs are valid and accessible",
      "Verify package names are correct",
    ],
    example: `resolve: {
  importMap: {
    imports: {
      "react": "https://esm.sh/react@19",
      "@/utils": "./src/utils/index.ts"
    }
  }
}`,
  }),

  "cors-config-invalid": createErrorSolution("cors-config-invalid", {
    title: "Invalid CORS configuration",
    message: "The CORS configuration is invalid.",
    steps: [
      "Use true for default CORS settings",
      "Or provide an object with origin, methods, allowedHeaders, exposedHeaders, credentials, or maxAge",
      "Use a non-empty origin string, a non-empty string array, or a synchronous validator function",
    ],
    example: `security: {
  cors: true  // or { origin: "https://example.com" }
}`,
  }),
});
