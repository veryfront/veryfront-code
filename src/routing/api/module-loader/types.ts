// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { APIContext } from "../context-builder.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export interface AppRouteContext {
  params: Record<string, string>;
}

export type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export type PagesRouteHandler = (ctx: APIContext) => Promise<Response> | Response;
export type AppRouteHandler = (
  request: Request,
  context: AppRouteContext,
) => Promise<Response> | Response;
export type RouteHandler = PagesRouteHandler | AppRouteHandler;

export interface APIRoute {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
  HEAD?: RouteHandler;
  OPTIONS?: RouteHandler;
  default?: RouteHandler;
}

export interface LoadModuleOptions {
  projectDir: string;
  modulePath: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
}
