import { defineError } from "../types.ts";

export const CONFIG_NOT_FOUND = defineError({
  slug: "config-not-found",
  category: "CONFIG",
  status: 404,
  title: "Configuration file not found",
  suggestion:
    "Create veryfront.config.js, veryfront.config.ts, or veryfront.config.mjs in the project root",
});

export const CONFIG_INVALID = defineError({
  slug: "config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid configuration format",
  suggestion: "Check the reported configuration path and validation details",
});

export const CONFIG_PARSE_ERROR = defineError({
  slug: "config-parse-error",
  category: "CONFIG",
  status: 400,
  title: "Failed to parse configuration",
  suggestion: "Ensure your configuration file contains valid JavaScript or TypeScript",
});

/** Schema-level config validation (e.g. Zod schema mismatch at runtime) */
export const CONFIG_VALIDATION_ERROR = defineError({
  slug: "config-validation-error",
  category: "CONFIG",
  status: 422,
  title: "Configuration validation failed",
  suggestion: "Check the configuration against the schema requirements",
});

export const CONFIG_TYPE_ERROR = defineError({
  slug: "config-type-error",
  category: "CONFIG",
  status: 400,
  title: "Configuration type mismatch",
  suggestion: "Ensure configuration values match expected types",
});

export const IMPORT_MAP_INVALID = defineError({
  slug: "import-map-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid import map configuration",
  suggestion: "Check your import map syntax and paths",
});

export const CORS_CONFIG_INVALID = defineError({
  slug: "cors-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid CORS configuration",
  suggestion: "Review CORS settings in your configuration",
});

/** Config file validation failures (replaces ConfigValidationError) */
export const CONFIG_VALIDATION_FAILED = defineError({
  slug: "config-validation-failed",
  category: "CONFIG",
  status: 400,
  title: "Configuration validation failed",
  suggestion: "Check configuration values against requirements",
});

/** Webhook definition validation failures (required fields, target, eventFilter) */
export const WEBHOOK_CONFIG_INVALID = defineError({
  slug: "webhook-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid webhook configuration",
  suggestion: "Check webhook definition fields, target settings, and eventFilter conditions",
});

/** Schedule definition validation failures (required fields, cron, concurrencyPolicy, target) */
export const SCHEDULE_CONFIG_INVALID = defineError({
  slug: "schedule-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid schedule configuration",
  suggestion:
    "Check schedule definition fields, cron expression, target settings, and positive-integer limits",
});

/** Trigger ID format and input serialization validation failures */
export const TRIGGER_CONFIG_INVALID = defineError({
  slug: "trigger-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid trigger configuration",
  suggestion:
    "Check trigger ID format (lowercase, alphanumeric, dots/slashes/hyphens) and ensure all input values are JSON-serializable",
});

/** Registry fragment for CONFIG errors (slug → definition). */
export const CONFIG_REGISTRY = {
  "config-not-found": CONFIG_NOT_FOUND,
  "config-invalid": CONFIG_INVALID,
  "config-parse-error": CONFIG_PARSE_ERROR,
  "config-validation-error": CONFIG_VALIDATION_ERROR,
  "config-type-error": CONFIG_TYPE_ERROR,
  "import-map-invalid": IMPORT_MAP_INVALID,
  "cors-config-invalid": CORS_CONFIG_INVALID,
  "config-validation-failed": CONFIG_VALIDATION_FAILED,
  "webhook-config-invalid": WEBHOOK_CONFIG_INVALID,
  "schedule-config-invalid": SCHEDULE_CONFIG_INVALID,
  "trigger-config-invalid": TRIGGER_CONFIG_INVALID,
} as const;
