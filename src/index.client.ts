/**
 * Client/SSR-safe mirror of the `veryfront` root barrel ({@link file://./index.ts}).
 *
 * The root barrel re-exports the server bootstrap surface (`createHandler`,
 * `startServer`, `toNodeHandler`) from `#veryfront/server`. Because the browser
 * and SSR pipelines transform modules per-file (no cross-module tree-shaking),
 * an ESM re-export eagerly loads its source module — so pulling the root barrel
 * into a client chunk drags the entire server graph in, including
 * `src/server/production-server.ts`, which has module top-level `await` and
 * cannot be transformed to the es2020 browser target (→ HTTP 500 on that chunk,
 * which aborts hydration).
 *
 * A client-reachable module doing a *used* value import from the barrel (e.g.
 * `import { getEnv } from "veryfront"`) is not dead-stripped, so it keeps the
 * barrel — and the leak. This barrel exposes exactly the same browser-safe
 * surface minus the server bootstrap functions, which no client/SSR page code
 * ever legitimately calls. The import rewriter redirects `veryfront` to this
 * module for the `browser` and `ssr` targets (see
 * `src/transforms/import-rewriter/strategies/veryfront-strategy.ts`), the same
 * mechanism `veryfront/workflow` already uses.
 *
 * Keep the exports below in sync with {@link file://./index.ts} — everything
 * except the `createHandler` / `startServer` / `toNodeHandler` value export.
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
