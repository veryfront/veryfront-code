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

export const REDIRECT_DESTINATION_NOT_ALLOWED = defineError({
  slug: "redirect-destination-not-allowed",
  category: "RUNTIME",
  status: 500,
  title: "Redirect destination not allowed",
  suggestion:
    "Use a relative or same-origin destination, or add the origin to security.redirects.allowedOrigins",
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

export const LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE = defineError({
  slug: "local-integration-credential-unavailable",
  category: "RUNTIME",
  status: 503,
  title: "Local integration credential is unavailable",
  suggestion: "Check the local credential provider and retry",
});

export const LOCAL_INTEGRATION_REQUEST_FAILED = defineError({
  slug: "local-integration-request-failed",
  category: "RUNTIME",
  status: 502,
  title: "Local integration request failed",
  suggestion: "Check the provider status and local integration configuration, then retry",
});

export const LOCAL_INTEGRATION_RESPONSE_INVALID = defineError({
  slug: "local-integration-response-invalid",
  category: "RUNTIME",
  status: 502,
  title: "Local integration response is invalid",
  suggestion: "Check the provider response contract and retry",
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
  suggestion:
    "Use a workflow or task target for local trigger runs; agent targets require the Cloud runtime",
});

/** Registry fragment for RUNTIME errors (slug → definition). */
export const RUNTIME_REGISTRY = {
  "hydration-mismatch": HYDRATION_MISMATCH,
  "render-error": RENDER_ERROR,
  "redirect-destination-not-allowed": REDIRECT_DESTINATION_NOT_ALLOWED,
  "component-error": COMPONENT_ERROR,
  "layout-not-found": LAYOUT_NOT_FOUND,
  "page-not-found": PAGE_NOT_FOUND,
  "api-error": API_ERROR,
  "middleware-error": MIDDLEWARE_ERROR,
  "local-integration-credential-unavailable": LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE,
  "local-integration-request-failed": LOCAL_INTEGRATION_REQUEST_FAILED,
  "local-integration-response-invalid": LOCAL_INTEGRATION_RESPONSE_INVALID,
  "trigger-target-not-found": TRIGGER_TARGET_NOT_FOUND,
  "trigger-execution-failed": TRIGGER_EXECUTION_FAILED,
  "trigger-not-supported": TRIGGER_NOT_SUPPORTED,
} as const;
