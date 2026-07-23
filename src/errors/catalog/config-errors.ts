import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

/** Immutable error-solution catalog fragment. */
export const CONFIG_ERROR_CATALOG: PartialErrorCatalog = Object.freeze({
  "config-not-found": createErrorSolution("config-not-found", {
    title: "Configuration file not found",
    message: "Veryfront could not find veryfront.config.ts in your project root.",
    steps: [
      "Create veryfront.config.ts in your project root",
      "Run 'veryfront init' to generate a default configuration",
      "Copy the configuration from a trusted project template",
    ],
    example: `// veryfront.config.ts
export default {
  title: "My App"
}`,
    tips: ["Configuration is optional for projects that use the defaults"],
  }),

  "config-invalid": createErrorSolution("config-invalid", {
    title: "Invalid configuration",
    message: "Your configuration file has invalid values or structure.",
    steps: [
      "Check that the config exports a default object",
      "Ensure all values are valid JavaScript types",
      "Verify property names match the schema",
    ],
    example: `// Valid configuration
export default {
  title: "My App",
  dev: {
    port: 3000,
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
      "Use the reported location to find the invalid syntax",
    ],
  ),

  "config-validation-error": createSimpleError(
    "config-validation-error",
    "Configuration validation failed",
    "Configuration values do not pass validation.",
    [
      "Check that port numbers are between 1-65535",
      "Use boolean values instead of strings for boolean fields",
      "Use valid URLs for URL fields",
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

  "config-validation-failed": createSimpleError(
    "config-validation-failed",
    "Configuration validation failed",
    "Veryfront rejected one or more configuration values.",
    [
      "Read the reported field path and expected value",
      "Update the value in veryfront.config.ts",
      "Run 'veryfront dev' again to verify the configuration",
    ],
  ),

  "webhook-config-invalid": createSimpleError(
    "webhook-config-invalid",
    "Invalid webhook configuration",
    "A webhook definition does not match the supported schema.",
    [
      "Check the webhook ID, target, and event filter",
      "Remove fields that are not part of the webhook schema",
      "Run 'veryfront schema --json' to inspect the current schema",
    ],
  ),

  "schedule-config-invalid": createSimpleError(
    "schedule-config-invalid",
    "Invalid schedule configuration",
    "A schedule definition does not match the supported schema.",
    [
      "Check the schedule target and cron expression",
      "Use positive integers for retry and concurrency limits",
      "Run 'veryfront schema --json' to inspect the current schema",
    ],
  ),

  "trigger-config-invalid": createSimpleError(
    "trigger-config-invalid",
    "Invalid trigger configuration",
    "A trigger definition does not match the supported schema.",
    [
      "Check the trigger ID and target definition",
      "Use only JSON-serializable trigger input values",
      "Run 'veryfront schema --json' to inspect the current schema",
    ],
  ),

  "extension-validation": createSimpleError(
    "extension-validation",
    "Extension validation failed",
    "An extension definition, option, capability, or lifecycle result is invalid.",
    [
      "Check the extension name, version, and capability declarations",
      "Validate extension options against the extension's documented contract",
      "Ensure setup and teardown return supported values",
    ],
  ),

  "extension-circular-dependency": createSimpleError(
    "extension-circular-dependency",
    "Circular extension dependency",
    "Two or more extensions form a dependency cycle.",
    [
      "Review each extension's dependency declarations",
      "Remove the dependency that closes the cycle",
      "Restart Veryfront and verify the resolved extension order",
    ],
  ),

  "extension-conflict": createSimpleError(
    "extension-conflict",
    "Conflicting extensions",
    "Enabled extensions declare incompatible capabilities or identities.",
    [
      "Review the conflicting extension names in the error context",
      "Disable or remove one conflicting extension",
      "Use compatible extension versions before restarting Veryfront",
    ],
  ),
});
