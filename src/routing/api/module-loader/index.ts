/**
 * Api - Module Loader
 *
 * @module routing/api/module-loader
 */

export { createHTTPPlugin } from "./esbuild-plugin.ts";
export { validateHTTPImports } from "./http-validator.ts";
export { loadHandlerModule } from "./loader.ts";
export { loadSecurityConfig } from "./security-config.ts";

export type {
  APIRoute,
  AppRouteContext,
  AppRouteHandler,
  LoadModuleOptions,
  PagesRouteHandler,
  RouteHandler,
} from "./types.ts";
