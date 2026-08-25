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

// Source `getEnv` from its browser-safe leaf, not the `#veryfront/platform`
// barrel: that barrel statically re-exports the eager runtime-adapter singletons
// (`detect.ts` → Deno/Node/Bun adapters), which drags the server filesystem
// adapter graph into the client bundle and crashes hydration on a browser-absent
// `fs.constants.O_NOFOLLOW` (#3661).
export { getEnv } from "#veryfront/platform/compat/process/env.ts";

// NOTE: the server bootstrap value export (`createHandler`, `startServer`,
// `toNodeHandler` from the public server entrypoint) is intentionally omitted
// here because it pulls production-server.ts (top-level await) into client
// chunks. Types are erased at transform time, so re-exporting them is inert.
export type { StartServerOptions, VeryfrontHandler, VeryfrontServer } from "#veryfront/server";

// Sourced from the compat module directly: the routing barrel's value graph
// reaches the server-only API handler (VFS adapter, sandbox worker pool).
export {
  badRequest,
  forbidden,
  internalServerError as serverError,
  jsonResponse as json,
  notFound as apiNotFound,
  redirectResponse as apiRedirect,
  unauthorized,
} from "#veryfront/http/responses";
export type { APIContext, APIHandler, APIResponse, APIRoute } from "#veryfront/routing";

export { notFound, redirect } from "#veryfront/data";
export type {
  DataContext,
  DataResponseMetadata,
  DataResult,
  InferGetServerDataProps,
  PageWithData,
  ResponseCookie,
  StaticDataResult,
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

export { csrfMutationHeaders } from "#veryfront/security/csrf/browser-mutation-headers.ts";
export type { CsrfMutationHeadersOptions } from "#veryfront/security/csrf/browser-mutation-headers.ts";
