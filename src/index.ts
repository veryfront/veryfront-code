/**
 * Configuration, server bootstrap, routing, data fetching, and input validation.
 *
 * @module veryfront
 *
 * @example Configuration
 * ```ts
 * import { defineConfig } from "veryfront";
 *
 * export default defineConfig({
 *   // your project config
 * });
 * ```
 *
 * @example API routes
 * ```ts
 * import { json } from "veryfront";
 * import type { APIContext, APIResponse } from "veryfront";
 *
 * export function GET(ctx: APIContext): APIResponse {
 *   return json({ message: "Hello" });
 * }
 * ```
 *
 * @example Data loading
 * ```ts
 * import { notFound } from "veryfront";
 * import type { DataContext } from "veryfront";
 *
 * export function getServerData(ctx: DataContext) {
 *   if (!ctx.params.id) throw notFound();
 *   return { title: "Page" };
 * }
 * ```
 */

export { defineConfig } from "#veryfront/config";
export type { VeryfrontConfig } from "#veryfront/config";

export { getEnv } from "#veryfront/platform";

export { createHandler, createVeryfrontHandler, startServer, toNodeHandler } from "#veryfront/server";
export type { StartServerOptions, VeryfrontHandler, VeryfrontServer } from "#veryfront/server";

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
