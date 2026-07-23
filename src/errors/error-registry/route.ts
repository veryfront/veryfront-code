import { defineError, type ErrorRegistryFragment, type RegisteredError } from "../types.ts";

/** Registered error definition for the route-conflict slug. */
export const ROUTE_CONFLICT: RegisteredError = defineError({
  slug: "route-conflict",
  category: "ROUTE",
  status: 409,
  title: "Conflicting route definitions",
  suggestion: "Rename or reorganize conflicting route files",
});

/** Registered error definition for the invalid-route-file slug. */
export const INVALID_ROUTE_FILE: RegisteredError = defineError({
  slug: "invalid-route-file",
  category: "ROUTE",
  status: 400,
  title: "Invalid route file structure",
  suggestion: "Ensure route file exports required functions",
});

/** Registered error definition for the route-handler-invalid slug. */
export const ROUTE_HANDLER_INVALID: RegisteredError = defineError({
  slug: "route-handler-invalid",
  category: "ROUTE",
  status: 400,
  title: "Invalid route handler export",
  suggestion: "Export a valid handler function from the route file",
});

/** Registered error definition for the dynamic-route-error slug. */
export const DYNAMIC_ROUTE_ERROR: RegisteredError = defineError({
  slug: "dynamic-route-error",
  category: "ROUTE",
  status: 500,
  title: "Dynamic route parsing failed",
  suggestion: "Check dynamic route segment syntax",
});

/** Registered error definition for the route-params-error slug. */
export const ROUTE_PARAMS_ERROR: RegisteredError = defineError({
  slug: "route-params-error",
  category: "ROUTE",
  status: 400,
  title: "Route parameters invalid",
  suggestion: "Validate route parameter values",
});

/** Registered error definition for the api-route-error slug. */
export const API_ROUTE_ERROR: RegisteredError = defineError({
  slug: "api-route-error",
  category: "ROUTE",
  status: 500,
  title: "API route definition error",
  suggestion: "Review API route configuration",
});

/** Registry fragment for ROUTE errors (slug → definition). */
export const ROUTE_REGISTRY: ErrorRegistryFragment<
  | "route-conflict"
  | "invalid-route-file"
  | "route-handler-invalid"
  | "dynamic-route-error"
  | "route-params-error"
  | "api-route-error"
> = Object.freeze(
  {
    "route-conflict": ROUTE_CONFLICT,
    "invalid-route-file": INVALID_ROUTE_FILE,
    "route-handler-invalid": ROUTE_HANDLER_INVALID,
    "dynamic-route-error": DYNAMIC_ROUTE_ERROR,
    "route-params-error": ROUTE_PARAMS_ERROR,
    "api-route-error": API_ROUTE_ERROR,
  } as const,
);
