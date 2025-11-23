/**
 * Re-export from centralized HTTP response factory.
 * This file exists for backward compatibility.
 *
 * @deprecated Use imports from "../../http/responses.ts" directly
 * Will be removed in v1.0.0
 */
export {
  badRequest,
  forbidden,
  internalServerError as serverError,
  jsonResponse as json,
  notFound,
  redirectResponse as redirect,
  unauthorized,
} from "../../http/responses.ts";
