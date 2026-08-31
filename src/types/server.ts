import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "../config/schemas/index.ts";
import type { PreparedHostedConfigContext } from "../config/loader.ts";
import type { RequestContext } from "../server/context/request-context.ts";
import type { EnrichedContext } from "../server/context/enriched-context-types.ts";
import type { ParsedDomain } from "../server/utils/domain-parser.ts";
import type { AuthConfig } from "../security/http/middleware/types.ts";
import type { ApplicationIdentity } from "../security/application-auth/types.ts";
export type { ParsedDomain } from "../server/utils/domain-parser.ts";

export interface SecurityConfig {
  auth?: AuthConfig;
  cors?:
    | boolean
    | {
      origin?: string | string[] | ((origin: string) => boolean | string);
      credentials?: boolean;
      methods?: string[];
      allowedHeaders?: string[];
      exposedHeaders?: string[];
      maxAge?: number;
    };
  csrf?: boolean | import("../security/csrf/helpers.ts").CsrfConfig;
  /**
   * Extra CSP sources, merged into the platform baseline. `null` drops the
   * baseline's optional sources for that directive while keeping the ones the
   * renderer requires.
   */
  csp?: Partial<Record<string, string | string[] | null>>;
  /**
   * Origins derived from the project's own released source, merged between the
   * platform floor and `csp`.
   *
   * Platform-owned: `deriveSecurityContext` overwrites whatever a project
   * config carries under this key, because `SecurityConfig` has an index
   * signature and would otherwise let a project declare its own derived layer.
   * Projects extend the policy through `csp`, which is merged on top of this.
   */
  derivedCsp?: import("../security/http/derived-csp-origins.ts").DerivedCspOrigins;
  coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  corp?: "same-origin" | "same-site" | "cross-origin";
  coep?: "require-corp" | "unsafe-none";
  hsts?: { maxAge: number; includeSubDomains?: boolean; preload?: boolean };
  remoteHosts?: string[];
  redirects?: {
    /** Exact external HTTP(S) origins allowed in addition to the request origin. */
    allowedOrigins: string[];
  };
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface HandlerContext {
  projectDir: string;
  adapter: RuntimeAdapter;
  moduleServerUrl?: string;
  securityConfig: SecurityConfig | null;
  /** Browser-visible HTTP(S) origin resolved at the trusted request boundary. */
  requestOrigin?: string | null;
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
  /** Canonical branch ID supplied by the operator-authenticated proxy. */
  branchId?: string;
  /** Canonical branch name paired with branchId by the operator-authenticated proxy. */
  branchName?: string;
  /** Canonical project default branch name supplied by the operator-authenticated proxy. */
  defaultBranchName?: string;
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
  /**
   * Host-owned capability for executing this runtime's project code in the
   * server process. Dedicated single-project runtimes may grant it without
   * enabling development-only local-project behavior.
   */
  allowHostProjectCodeExecution?: boolean;
  /** Whether this request is executing in the shared multi-project proxy runtime. */
  isProxyMode?: boolean;
  /** Environment ID for per-project env var resolution (from proxy x-environment-id header) */
  environmentId?: string;
  /** Verified application identity admitted by the host-owned auth boundary. */
  applicationIdentity?: ApplicationIdentity | null;
  /** Application-auth identity headers to strip before project code sees the request. */
  applicationIdentityHeaderNames?: readonly string[];
  /** Application-auth result already computed before project middleware. */
  applicationAuthResult?: {
    response?: Response;
    metadata?: {
      applicationIdentity?: ApplicationIdentity;
      applicationIdentityHeaderNames?: readonly string[];
    };
  } | null;
  /**
   * Prepares this request's authenticated hosted evaluation context.
   *
   * Present only for shared multi-project runtimes, where project config is
   * untrusted and must be evaluated declaratively. Handlers that load config
   * themselves must use this rather than deriving source or environment
   * identity, so every load in a request shares one identity.
   */
  prepareHostedConfigContext?: () => Promise<PreparedHostedConfigContext>;
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

type RouteHandler = (
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
