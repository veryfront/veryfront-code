import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const CONFIG_ERROR_CATALOG: PartialErrorCatalog = {
  "config-not-found": createErrorSolution("config-not-found", {
    title: "Configuration file not found",
    message: "Veryfront could not find veryfront.config.js in your project root.",
    steps: [
      "Create veryfront.config.js in your project root directory",
      "Run 'veryfront init' to generate a default configuration",
      "Or copy from an example project",
    ],
    example: `// veryfront.config.js
export default {
  title: "My App",
  dev: { port: 3002 }
}`,
    tips: ["You can use .ts or .mjs extensions too", "Config is optional for simple projects"],
  }),

  "config-invalid": createErrorSolution("config-invalid", {
    title: "Invalid configuration",
    message: "Your configuration file has invalid values or structure.",
    steps: [
      "Check that the config exports a default object",
      "Ensure all values are valid JavaScript types",
      "Remove any trailing commas",
      "Verify property names match the schema",
    ],
    example: `// ✓ Valid config
export default {
  title: "My App",
  dev: {
    port: 3002,
    open: true
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
      "Or provide an object with origin, methods, headers",
      "Ensure origin is a string, not an array",
    ],
    example: `security: {
  cors: true  // or { origin: "https://example.com" }
}`,
  }),
};
