import { ErrorCode } from "../error-codes.js";
import type { PartialErrorCatalog } from "./types.js";
import { createErrorSolution, createSimpleError } from "./factory.js";

export const ROUTE_ERROR_CATALOG: PartialErrorCatalog = {
  [ErrorCode.ROUTE_CONFLICT]: createSimpleError(
    ErrorCode.ROUTE_CONFLICT,
    "Route conflict",
    "Multiple files are trying to handle the same route.",
    [
      "Check for duplicate route files",
      "Remove conflicting routes",
      "Use dynamic routes [id] carefully",
    ],
  ),

  [ErrorCode.INVALID_ROUTE_FILE]: createErrorSolution(ErrorCode.INVALID_ROUTE_FILE, {
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

  [ErrorCode.ROUTE_HANDLER_INVALID]: createSimpleError(
    ErrorCode.ROUTE_HANDLER_INVALID,
    "Invalid route handler",
    "Route handler does not return Response.",
    [
      "Ensure handler returns Response object",
      "Use Response.json() for JSON responses",
      "Check for missing return statement",
    ],
  ),

  [ErrorCode.DYNAMIC_ROUTE_ERROR]: createSimpleError(
    ErrorCode.DYNAMIC_ROUTE_ERROR,
    "Dynamic route error",
    "Error in dynamic route handling.",
    [
      "Check [param] syntax is correct",
      "Ensure params are accessed properly",
      "Verify dynamic segment names",
    ],
  ),

  [ErrorCode.ROUTE_PARAMS_ERROR]: createSimpleError(
    ErrorCode.ROUTE_PARAMS_ERROR,
    "Route parameters error",
    "Error accessing route parameters.",
    [
      "Check params object structure",
      "Ensure parameter names match route",
      "Verify params are strings",
    ],
  ),

  [ErrorCode.API_ROUTE_ERROR]: createSimpleError(
    ErrorCode.API_ROUTE_ERROR,
    "API route error",
    "Error in API route execution.",
    [
      "Check API handler code",
      "Ensure proper error handling",
      "Verify request parsing",
    ],
  ),
};
