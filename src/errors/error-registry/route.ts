import { defineError } from "../types.ts";

export const ROUTE_CONFLICT = defineError({
  slug: "route-conflict",
  category: "ROUTE",
  status: 409,
  title: "Conflicting route definitions",
  suggestion: "Rename or reorganize conflicting route files",
});

export const INVALID_ROUTE_FILE = defineError({
  slug: "invalid-route-file",
  category: "ROUTE",
  status: 400,
  title: "Invalid route file structure",
  suggestion: "Ensure route file exports required functions",
});

export const ROUTE_HANDLER_INVALID = defineError({
  slug: "route-handler-invalid",
  category: "ROUTE",
  status: 400,
  title: "Invalid route handler export",
  suggestion: "Export a valid handler function from the route file",
});

export const DYNAMIC_ROUTE_ERROR = defineError({
  slug: "dynamic-route-error",
  category: "ROUTE",
  status: 500,
  title: "Dynamic route parsing failed",
  suggestion: "Check dynamic route segment syntax",
});

export const ROUTE_PARAMS_ERROR = defineError({
  slug: "route-params-error",
  category: "ROUTE",
  status: 400,
  title: "Route parameters invalid",
  suggestion: "Validate route parameter values",
});

export const API_ROUTE_ERROR = defineError({
  slug: "api-route-error",
  category: "ROUTE",
  status: 500,
  title: "API route definition error",
  suggestion: "Review API route configuration",
});

/** Registry fragment for ROUTE errors (slug → definition). */
export const ROUTE_REGISTRY = {
  "route-conflict": ROUTE_CONFLICT,
  "invalid-route-file": INVALID_ROUTE_FILE,
  "route-handler-invalid": ROUTE_HANDLER_INVALID,
  "dynamic-route-error": DYNAMIC_ROUTE_ERROR,
  "route-params-error": ROUTE_PARAMS_ERROR,
  "api-route-error": API_ROUTE_ERROR,
} as const;
