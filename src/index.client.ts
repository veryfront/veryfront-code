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

// Re-export values from their owning leaf modules. Re-exporting through the
// public server-oriented barrels eagerly instantiates every sibling module in
// browser bundles even when this entry point exposes only one helper.
export { defineConfig, defineConfigWithEnv, mergeConfigs } from "./config/define-config.ts";
export type { VeryfrontConfig } from "./config/schemas/index.ts";

export { getEnv } from "./platform/compat/process/env.ts";

// NOTE: the server bootstrap value export (`createHandler`, `startServer`,
// `toNodeHandler` from the public server entrypoint) is intentionally omitted
// here because it pulls production-server.ts (top-level await) into client
// chunks. Types are erased at transform time, so re-exporting them is inert.
export type { StartServerOptions, VeryfrontHandler, VeryfrontServer } from "#veryfront/server";

export {
  badRequest,
  forbidden,
  internalServerError as serverError,
  jsonResponse as json,
  notFound as apiNotFound,
  redirectResponse as apiRedirect,
  unauthorized,
} from "./platform/compat/http/responses.ts";
export type { APIContext, APIHandler, APIResponse, APIRoute } from "./routing/api/handler.ts";

export { notFound, redirect } from "./data/helpers.ts";
export type {
  DataContext,
  InferGetServerDataProps,
  PageWithData,
  StaticPathsResult,
} from "./data/types.ts";

export type { MDXFrontmatter, PageContext } from "#veryfront/types";

export { CommonSchemas } from "./schemas/common.ts";
export {
  createValidatedHandler,
  type ValidatedHandlerConfig,
  type ValidatedHandlerFunction,
} from "./security/input-validation/handler.ts";
export {
  createValidationError,
  INPUT_VALIDATION_FAILED,
} from "./security/input-validation/errors.ts";
export {
  parseFormData,
  parseJsonBody,
  parseQueryParams,
} from "./security/input-validation/parsers.ts";
export { sanitizeData } from "./security/input-validation/sanitizers.ts";
