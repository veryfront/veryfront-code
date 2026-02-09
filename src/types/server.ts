import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RequestContext } from "../server/context/request-context.ts";
import type { EnrichedContext } from "../server/context/enriched-context.ts";

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
  /** Whether this domain allows iframe embedding (veryfront, localhost, xip.io, zip.io) */
  allowIframeEmbed: boolean;
}

export interface SecurityConfig {
  auth?: {
    basic?: {
      username: string;
      password: string;
      realm?: string;
    };
    bearer?: {
      token: string;
    };
  };
  cors?:
    | boolean
    | {
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
  /** Actual environment name from API (e.g., "Development", "Production") */
  environmentName?: string;
  /**
   * Resolved environment from domain lookup or proxy headers.
   * This takes precedence over requestContext.mode for cache isolation.
   * Values: "preview" | "production"
   */
  resolvedEnvironment?: "preview" | "production";
  /** Unified request context (token, slug, branch, mode) */
  requestContext?: RequestContext;
  /** Whether this request targets a local filesystem project (per-request, from adapter resolution). */
  isLocalProject?: boolean;
  /** Environment ID for per-project env var resolution (from proxy x-environment-id header) */
  environmentId?: string;
  /** Route registry for handler chain inspection (dev dashboard) */
  routeRegistry?: {
    getHandlers(): ReadonlyArray<{ metadata: HandlerMetadata }>;
    getStats(): {
      totalHandlers: number;
      handlersByPriority: Record<string, number>;
      handlerNames: string[];
    };
  };
  /**
   * Enriched context containing all resolved request data.
   * Built once at request entry, passed through all stages.
   * When present, use this instead of individual fields for better performance.
   */
  enriched?: EnrichedContext;
}

export interface HandlerResult {
  response?: Response;
  continue?: boolean;
  metadata?: Record<string, unknown>;
}

export enum HandlerPriority {
  CRITICAL = 0, // Auth, security checks
  EARLY = 25, // HMR, WebSocket handlers (between auth and cors)
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

export type RouteHandler = (
  req: Request,
  ctx: { params: Record<string, string | string[]> },
) => Promise<Response> | Response;

export interface RouteHandlerModule {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
  HEAD?: RouteHandler;
  OPTIONS?: RouteHandler;
  [key: string]: unknown;
}

export interface AppRouteMatch {
  file: string;
  params: Record<string, string | string[]>;
}
