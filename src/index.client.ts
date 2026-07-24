/**
 * Browser- and SSR-safe helpers from the `veryfront` package.
 *
 * This entrypoint exposes the root package's client-safe configuration,
 * platform, routing, data, and security helpers without server bootstrap
 * functions. Most app code can import these helpers from `veryfront`; use this
 * explicit entrypoint when a browser or SSR module needs to declare that
 * boundary directly.
 *
 * @example
 * ```ts
 * import { getEnv, json } from "veryfront/index.client";
 *
 * export function GET() {
 *   return json({ mode: getEnv("MODE") ?? "development" });
 * }
 * ```
 *
 * @module veryfront
 */

export { defineConfig, defineConfigWithEnv, mergeConfigs } from "#veryfront/config";
export type { VeryfrontConfig } from "#veryfront/config";

export { getEnv } from "#veryfront/platform";

// NOTE: the server bootstrap value export (`createHandler`, `startServer`,
// `toNodeHandler` from "#veryfront/server") is intentionally omitted here — it
// is server-only and pulls production-server.ts (top-level await) into client
// chunks. Types are erased at transform time, so re-exporting them is inert.
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
