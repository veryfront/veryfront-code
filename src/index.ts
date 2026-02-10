/**
 * Root entry point re-exporting the user-facing framework API — configuration,
 * server bootstrap, routing helpers, data fetching, and input validation.
 *
 * @module veryfront
 */

export { defineConfig } from "#veryfront/config";
export type { VeryfrontConfig } from "#veryfront/config";

export { getEnv } from "#veryfront/platform";

export { createVeryfrontHandler, startVeryfrontServer } from "#veryfront/server";
export type { StartVeryfrontServerOptions, VeryfrontServerHandle } from "#veryfront/server";

export {
  badRequest,
  forbidden,
  json,
  notFound as apiNotFound,
  redirect as apiRedirect,
  serverError,
  unauthorized,
} from "#veryfront/routing";
export type { APIContext, APIHandler, APIResponse, APIRoute } from "#veryfront/routing";

export { notFound, redirect } from "#veryfront/data";
export type {
  DataContext,
  InferGetServerDataProps,
  PageWithData,
  StaticPathsResult,
} from "#veryfront/data";

export type { MDXFrontmatter, PageContext } from "#veryfront/types";

export {
  CommonSchemas,
  createValidatedHandler,
  createValidationError,
  INPUT_VALIDATION_FAILED,
  parseFormData,
  parseJsonBody,
  parseQueryParams,
  sanitizeData,
} from "#veryfront/security";
export type { ValidatedHandlerConfig, ValidatedHandlerFunction } from "#veryfront/security";
