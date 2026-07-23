import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the hydration-mismatch slug. */
export const HYDRATION_MISMATCH: RegisteredError = defineError({
  slug: "hydration-mismatch",
  category: "RUNTIME",
  status: 500,
  title: "Client/server hydration mismatch",
  suggestion: "Ensure server and client render the same content",
});

/** Registered error definition for the render-error slug. */
export const RENDER_ERROR: RegisteredError = defineError({
  slug: "render-error",
  category: "RUNTIME",
  status: 500,
  title: "Component render failed",
  suggestion: "Check component for runtime errors",
});

/** Registered error definition for the component-error slug. */
export const COMPONENT_ERROR: RegisteredError = defineError({
  slug: "component-error",
  category: "RUNTIME",
  status: 500,
  title: "Component execution error",
  suggestion: "Review component logic and props",
});

/** Registered error definition for the layout-not-found slug. */
export const LAYOUT_NOT_FOUND: RegisteredError = defineError({
  slug: "layout-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Layout component not found",
  suggestion: "Ensure layout file exists at the expected path",
});

/** Registered error definition for the page-not-found slug. */
export const PAGE_NOT_FOUND: RegisteredError = defineError({
  slug: "page-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Page component not found",
  suggestion: "Check that the page file exists in the routes directory",
});

/** Registered error definition for the api-error slug. */
export const API_ERROR: RegisteredError = defineError({
  slug: "api-error",
  category: "RUNTIME",
  status: 500,
  title: "API route handler error",
  suggestion: "Review API route handler for errors",
});

/** Registered error definition for the middleware-error slug. */
export const MIDDLEWARE_ERROR: RegisteredError = defineError({
  slug: "middleware-error",
  category: "RUNTIME",
  status: 500,
  title: "Middleware execution error",
  suggestion: "Check middleware function for errors",
});

/** Trigger target (task or workflow) not found during local run */
/** Registered error definition for the trigger-target-not-found slug. */
export const TRIGGER_TARGET_NOT_FOUND: RegisteredError = defineError({
  slug: "trigger-target-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Trigger target not found",
  suggestion: "Ensure the referenced task or workflow ID is registered in the project",
});

/** Trigger target task or workflow failed during local run */
/** Registered error definition for the trigger-execution-failed slug. */
export const TRIGGER_EXECUTION_FAILED: RegisteredError = defineError({
  slug: "trigger-execution-failed",
  category: "RUNTIME",
  status: 500,
  title: "Trigger target execution failed",
  suggestion: "Check the task or workflow for errors and review the trigger input",
});

/** Trigger target type is not supported in the current runtime context */
/** Registered error definition for the trigger-not-supported slug. */
export const TRIGGER_NOT_SUPPORTED: RegisteredError = defineError({
  slug: "trigger-not-supported",
  category: "RUNTIME",
  status: 501,
  title: "Trigger target type not supported in local runtime",
  suggestion:
    "Use a workflow or task target for local trigger runs; agent targets require the Cloud runtime",
});

/** Registered error definition for the missing-extension slug. */
export const MISSING_EXTENSION_ERROR: RegisteredError = defineError({
  slug: "missing-extension",
  category: "RUNTIME",
  status: 500,
  title: "Required extension not found",
  suggestion: "Install the extension package and add it to your configuration",
});

/** Registered error definition for the extension-setup-timeout slug. */
export const EXTENSION_SETUP_TIMEOUT_ERROR: RegisteredError = defineError({
  slug: "extension-setup-timeout",
  category: "RUNTIME",
  status: 500,
  title: "Extension setup timed out",
  suggestion: "Remove blocking setup work or increase the extension setup timeout",
});

/** Registry fragment for RUNTIME errors (slug → definition). */
export const RUNTIME_REGISTRY: ErrorRegistryFragment<
  | "hydration-mismatch"
  | "render-error"
  | "component-error"
  | "layout-not-found"
  | "page-not-found"
  | "api-error"
  | "middleware-error"
  | "trigger-target-not-found"
  | "trigger-execution-failed"
  | "trigger-not-supported"
  | "missing-extension"
  | "extension-setup-timeout"
> = Object.freeze(
  {
    "hydration-mismatch": HYDRATION_MISMATCH,
    "render-error": RENDER_ERROR,
    "component-error": COMPONENT_ERROR,
    "layout-not-found": LAYOUT_NOT_FOUND,
    "page-not-found": PAGE_NOT_FOUND,
    "api-error": API_ERROR,
    "middleware-error": MIDDLEWARE_ERROR,
    "trigger-target-not-found": TRIGGER_TARGET_NOT_FOUND,
    "trigger-execution-failed": TRIGGER_EXECUTION_FAILED,
    "trigger-not-supported": TRIGGER_NOT_SUPPORTED,
    "missing-extension": MISSING_EXTENSION_ERROR,
    "extension-setup-timeout": EXTENSION_SETUP_TIMEOUT_ERROR,
  } as const,
);
