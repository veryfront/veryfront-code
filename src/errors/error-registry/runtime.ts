import { defineError } from "../types.ts";

export const HYDRATION_MISMATCH = defineError({
  slug: "hydration-mismatch",
  category: "RUNTIME",
  status: 500,
  title: "Client/server hydration mismatch",
  suggestion: "Ensure server and client render the same content",
});

export const RENDER_ERROR = defineError({
  slug: "render-error",
  category: "RUNTIME",
  status: 500,
  title: "Component render failed",
  suggestion: "Check component for runtime errors",
});

export const COMPONENT_ERROR = defineError({
  slug: "component-error",
  category: "RUNTIME",
  status: 500,
  title: "Component execution error",
  suggestion: "Review component logic and props",
});

export const LAYOUT_NOT_FOUND = defineError({
  slug: "layout-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Layout component not found",
  suggestion: "Ensure layout file exists at the expected path",
});

export const PAGE_NOT_FOUND = defineError({
  slug: "page-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Page component not found",
  suggestion: "Check that the page file exists in the routes directory",
});

export const API_ERROR = defineError({
  slug: "api-error",
  category: "RUNTIME",
  status: 500,
  title: "API route handler error",
  suggestion: "Review API route handler for errors",
});

export const MIDDLEWARE_ERROR = defineError({
  slug: "middleware-error",
  category: "RUNTIME",
  status: 500,
  title: "Middleware execution error",
  suggestion: "Check middleware function for errors",
});

/** Trigger target (task or workflow) not found during local run */
export const TRIGGER_TARGET_NOT_FOUND = defineError({
  slug: "trigger-target-not-found",
  category: "RUNTIME",
  status: 404,
  title: "Trigger target not found",
  suggestion: "Ensure the referenced task or workflow ID is registered in the project",
});

/** Trigger target task or workflow failed during local run */
export const TRIGGER_EXECUTION_FAILED = defineError({
  slug: "trigger-execution-failed",
  category: "RUNTIME",
  status: 500,
  title: "Trigger target execution failed",
  suggestion: "Check the task or workflow for errors and review the trigger input",
});

/** Trigger target type is not supported in the current runtime context */
export const TRIGGER_NOT_SUPPORTED = defineError({
  slug: "trigger-not-supported",
  category: "RUNTIME",
  status: 501,
  title: "Trigger target type not supported in local runtime",
  suggestion: "Use a workflow or task target for local trigger runs; agent targets require the Cloud runtime",
});

/** Registry fragment for RUNTIME errors (slug → definition). */
export const RUNTIME_REGISTRY = {
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
} as const;
