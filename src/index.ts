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
 *   return { props: { title: "Page" } };
 * }
 * ```
 */

export { defineConfig, defineConfigWithEnv, mergeConfigs } from "./config/define-config.ts";
export type { VeryfrontConfig } from "./config/schemas/index.ts";

export { getEnv } from "./platform/compat/process/env.ts";

export { createHandler, startServer, toNodeHandler } from "./server/index.ts";
export type { StartServerOptions, VeryfrontHandler, VeryfrontServer } from "./server/index.ts";

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

export type { MDXFrontmatter, MDXFrontmatterValue, PageContext } from "#veryfront/types";

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
