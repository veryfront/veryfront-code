import type { PartialErrorCatalog } from "./types.ts";
import { createErrorSolution, createSimpleError } from "./factory.ts";

export const ROUTE_ERROR_CATALOG: PartialErrorCatalog = {
  "route-conflict": createSimpleError(
    "route-conflict",
    "Route conflict",
    "Multiple files are trying to handle the same route.",
    [
      "Check for duplicate route files",
      "Remove conflicting routes",
      "Use dynamic routes [id] carefully",
    ],
  ),

  "invalid-route-file": createErrorSolution("invalid-route-file", {
    title: "Invalid route file",
    message: "Route file has invalid structure or exports.",
    steps: [
      "API routes must export GET, POST, etc. functions",
      "Page routes must export default component",
      "Check for syntax errors",
    ],
    example: `// app/api/users/route.ts
export async function GET() {
  return Response.json({ users: [] })
}`,
  }),

  "route-handler-invalid": createSimpleError(
    "route-handler-invalid",
    "Invalid route handler",
    "Route handler does not return Response.",
    [
      "Ensure handler returns Response object",
      "Use Response.json() for JSON responses",
      "Check for missing return statement",
    ],
  ),

  "dynamic-route-error": createSimpleError(
    "dynamic-route-error",
    "Dynamic route error",
    "Error in dynamic route handling.",
    [
      "Check [param] syntax is correct",
      "Ensure params are accessed properly",
      "Verify dynamic segment names",
    ],
  ),

  "route-params-error": createSimpleError(
    "route-params-error",
    "Route parameters error",
    "Error accessing route parameters.",
    [
      "Check params object structure",
      "Ensure parameter names match route",
      "Verify params are strings",
    ],
  ),

  "api-route-error": createSimpleError(
    "api-route-error",
    "API route error",
    "Error in API route execution.",
    ["Check API handler code", "Ensure proper error handling", "Verify request parsing"],
  ),
};
