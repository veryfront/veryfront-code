import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";

export interface ParsedDomain {
  /** Project slug extracted from host (e.g., "my-project" from "my-project.preview.veryfront.dev") */
  slug: string | null;
  /** Branch name extracted from host (e.g., "feature" from "my-project--feature.preview.veryfront.dev") */
  branch: string | null;
  /** Environment inferred from domain pattern */
  environment: "preview" | "development" | "staging" | "production" | null;
  /** Whether this is a recognized veryfront domain */
  isVeryfrontDomain: boolean;
  /** Whether this is a draft (preview) environment */
  isDraft: boolean;
}

export interface SecurityConfig {
  cors?: boolean | {
    origin?: string | string[] | ((origin: string) => boolean);
    credentials?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    maxAge?: number;
  };
  csp?: Partial<Record<string, string | string[]>>;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface HandlerContext {
  projectDir: string;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  moduleServerUrl?: string;
  securityConfig: SecurityConfig | null;
  cspUserHeader: string | null;
  debug?: boolean;
  config?: VeryfrontConfig;
  /** Parsed domain info from request host header */
  parsedDomain?: ParsedDomain;
  /** Project slug (from URL or config) */
  projectSlug?: string;
  /** Project ID (from domain lookup or proxy header) */
  projectId?: string;
  /** Release ID (from domain lookup for production custom domains) */
  releaseId?: string;
  /** OAuth token from proxy (via x-token header) */
  proxyToken?: string;
  /** Environment scope from proxy (via x-environment header) */
  proxyEnvironment?: "preview" | "production";
  /** Actual environment name from API (e.g., "Development", "Production") */
  environmentName?: string;
  /** Route registry for handler chain inspection (dev dashboard) */
  routeRegistry?: {
    getHandlers(): ReadonlyArray<{ metadata: HandlerMetadata }>;
    getStats(): {
      totalHandlers: number;
      handlersByPriority: Record<string, number>;
      handlerNames: string[];
    };
  };
}

export interface HandlerResult {
  response?: Response;
  continue?: boolean;
  metadata?: Record<string, unknown>;
}

export enum HandlerPriority {
  CRITICAL = 0, // Auth, security checks
  HIGH = 100, // Health checks, metrics
  MEDIUM = 500, // Static files, API routes
  LOW = 1000, // SSR, fallbacks
  FALLBACK = 10000, // 404 handlers
}

export interface RoutePattern {
  pattern: string | RegExp;
  exact?: boolean;
  prefix?: boolean;
  method?: string | string[];
}

export interface HandlerMetadata {
  name: string;
  priority: HandlerPriority;
  patterns?: RoutePattern[];
  enabled?: (ctx: HandlerContext) => boolean;
}

export interface Handler {
  metadata: HandlerMetadata;
  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult>;
}

export type MiddlewareFunction = (
  req: Request,
  ctx: HandlerContext,
  next: () => Promise<Response>,
) => Promise<Response>;

export interface RouteRegistryConfig {
  debug?: boolean;
  enableMetrics?: boolean;
}

export interface RouteHandlerModule {
  GET?: (
    req: Request,
    ctx: { params: Record<string, string | string[]> },
  ) => Promise<Response> | Response;
  POST?: (
    req: Request,
    ctx: { params: Record<string, string | string[]> },
  ) => Promise<Response> | Response;
  PUT?: (
    req: Request,
    ctx: { params: Record<string, string | string[]> },
  ) => Promise<Response> | Response;
  PATCH?: (
    req: Request,
    ctx: { params: Record<string, string | string[]> },
  ) => Promise<Response> | Response;
  DELETE?: (
    req: Request,
    ctx: { params: Record<string, string | string[]> },
  ) => Promise<Response> | Response;
  HEAD?: (
    req: Request,
    ctx: { params: Record<string, string | string[]> },
  ) => Promise<Response> | Response;
  OPTIONS?: (
    req: Request,
    ctx: { params: Record<string, string | string[]> },
  ) => Promise<Response> | Response;
  [key: string]: unknown;
}

export interface AppRouteMatch {
  file: string;
  params: Record<string, string | string[]>;
}
