import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the config-not-found slug. */
export const CONFIG_NOT_FOUND: RegisteredError = defineError({
  slug: "config-not-found",
  category: "CONFIG",
  status: 404,
  title: "Configuration file not found",
  suggestion: "Run 'veryfront init' to create a configuration file",
});

/** Registered error definition for the config-invalid slug. */
export const CONFIG_INVALID: RegisteredError = defineError({
  slug: "config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid configuration format",
  suggestion: "Check your veryfront.config.ts for syntax errors",
});

/** Registered error definition for the config-parse-error slug. */
export const CONFIG_PARSE_ERROR: RegisteredError = defineError({
  slug: "config-parse-error",
  category: "CONFIG",
  status: 400,
  title: "Failed to parse configuration",
  suggestion: "Ensure your configuration file is valid TypeScript/JSON",
});

/** Schema-level config validation (e.g. Zod schema mismatch at runtime) */
/** Registered error definition for the config-validation-error slug. */
export const CONFIG_VALIDATION_ERROR: RegisteredError = defineError({
  slug: "config-validation-error",
  category: "CONFIG",
  status: 422,
  title: "Configuration validation failed",
  suggestion: "Check the configuration against the schema requirements",
});

/** Registered error definition for the config-type-error slug. */
export const CONFIG_TYPE_ERROR: RegisteredError = defineError({
  slug: "config-type-error",
  category: "CONFIG",
  status: 400,
  title: "Configuration type mismatch",
  suggestion: "Ensure configuration values match expected types",
});

/** Registered error definition for the import-map-invalid slug. */
export const IMPORT_MAP_INVALID: RegisteredError = defineError({
  slug: "import-map-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid import map configuration",
  suggestion: "Check your import map syntax and paths",
});

/** Registered error definition for the cors-config-invalid slug. */
export const CORS_CONFIG_INVALID: RegisteredError = defineError({
  slug: "cors-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid CORS configuration",
  suggestion: "Review CORS settings in your configuration",
});

/** Config file validation failures (replaces ConfigValidationError) */
/** Registered error definition for the config-validation-failed slug. */
export const CONFIG_VALIDATION_FAILED: RegisteredError = defineError({
  slug: "config-validation-failed",
  category: "CONFIG",
  status: 400,
  title: "Configuration validation failed",
  suggestion: "Check configuration values against requirements",
});

/** Webhook definition validation failures (required fields, target, eventFilter) */
/** Registered error definition for the webhook-config-invalid slug. */
export const WEBHOOK_CONFIG_INVALID: RegisteredError = defineError({
  slug: "webhook-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid webhook configuration",
  suggestion: "Check webhook definition fields, target settings, and eventFilter conditions",
});

/** Schedule definition validation failures (required fields, cron, concurrencyPolicy, target) */
/** Registered error definition for the schedule-config-invalid slug. */
export const SCHEDULE_CONFIG_INVALID: RegisteredError = defineError({
  slug: "schedule-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid schedule configuration",
  suggestion:
    "Check schedule definition fields, cron expression, target settings, and positive-integer limits",
});

/** Trigger ID format and input serialization validation failures */
/** Registered error definition for the trigger-config-invalid slug. */
export const TRIGGER_CONFIG_INVALID: RegisteredError = defineError({
  slug: "trigger-config-invalid",
  category: "CONFIG",
  status: 400,
  title: "Invalid trigger configuration",
  suggestion:
    "Check trigger ID format (lowercase, alphanumeric, dots/slashes/hyphens) and ensure all input values are JSON-serializable",
});

/** Registered error definition for the extension-validation slug. */
export const EXTENSION_VALIDATION_ERROR: RegisteredError = defineError({
  slug: "extension-validation",
  category: "CONFIG",
  status: 422,
  title: "Extension validation failed",
  suggestion: "Check the extension name, version, capabilities, and options",
});

/** Registered error definition for the extension-circular-dependency slug. */
export const CIRCULAR_DEPENDENCY_ERROR: RegisteredError = defineError({
  slug: "extension-circular-dependency",
  category: "CONFIG",
  status: 422,
  title: "Circular dependency detected between extensions",
  suggestion: "Review extension dependency declarations and break the cycle",
});

/** Registered error definition for the extension-conflict slug. */
export const EXTENSION_CONFLICT_ERROR: RegisteredError = defineError({
  slug: "extension-conflict",
  category: "CONFIG",
  status: 409,
  title: "Conflicting extensions detected",
  suggestion: "Remove or disable one of the conflicting extensions",
});

/** Registry fragment for CONFIG errors (slug → definition). */
export const CONFIG_REGISTRY: ErrorRegistryFragment<
  | "config-not-found"
  | "config-invalid"
  | "config-parse-error"
  | "config-validation-error"
  | "config-type-error"
  | "import-map-invalid"
  | "cors-config-invalid"
  | "config-validation-failed"
  | "webhook-config-invalid"
  | "schedule-config-invalid"
  | "trigger-config-invalid"
  | "extension-validation"
  | "extension-circular-dependency"
  | "extension-conflict"
> = Object.freeze(
  {
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
    "extension-validation": EXTENSION_VALIDATION_ERROR,
    "extension-circular-dependency": CIRCULAR_DEPENDENCY_ERROR,
    "extension-conflict": EXTENSION_CONFLICT_ERROR,
  } as const,
);
