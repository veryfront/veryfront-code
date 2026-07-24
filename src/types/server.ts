import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "../config/schemas/index.ts";
import type { RequestContext } from "../server/context/request-context.ts";
import type { EnrichedContext } from "../server/context/enriched-context-types.ts";
import type { ParsedDomain } from "../server/utils/domain-parser.ts";
export type { ParsedDomain } from "../server/utils/domain-parser.ts";

/** HTTP security controls resolved for a project runtime. */
export interface SecurityConfig {
  /** Basic and bearer authentication settings. */
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
  /** Cross-origin resource sharing policy. */
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
  /** Cross-site request forgery protection settings. */
  csrf?: boolean | import("../security/csrf/helpers.ts").CsrfConfig;
  /** Content Security Policy directives keyed by directive name. */
  csp?: Partial<Record<string, string | string[]>>;
  /** Cross-Origin-Opener-Policy value. */
  coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  /** Cross-Origin-Resource-Policy value. */
  corp?: "same-origin" | "same-site" | "cross-origin";
  /** Cross-Origin-Embedder-Policy value. */
  coep?: "require-corp" | "unsafe-none";
  /** HTTP Strict Transport Security settings. */
  hsts?: { maxAge: number; includeSubDomains?: boolean; preload?: boolean };
  /** Remote hosts allowed by project security policy. */
  remoteHosts?: string[];
  /** Top-level project directories allowed as module import roots. */
  allowedImportDirs?: string[];
  /** Additional response headers applied by the security layer. */
  headers?: Record<string, string>;
  /** Extension-specific security settings. */
  [key: string]: unknown;
}

/** Request-scoped dependencies and resolved project data available to server handlers. */
export interface HandlerContext {
  /** Absolute project directory used by the active runtime adapter. */
  projectDir: string;
  /** Runtime adapter selected for this request. */
  adapter: RuntimeAdapter;
  /** Optional module server URL used for development module loading. */
  moduleServerUrl?: string;
  /** Resolved HTTP security configuration, or `null` when security is disabled. */
  securityConfig: SecurityConfig | null;
  /** User-provided Content Security Policy header, when present. */
  cspUserHeader: string | null;
  /** Whether request diagnostics are enabled. */
  debug?: boolean;
  /** Validated project configuration for this request. */
  config?: VeryfrontConfig;
  /** Parsed domain information derived from the trusted request host. */
  parsedDomain?: ParsedDomain;
  /** Project slug resolved from the URL or project configuration. */
  projectSlug?: string;
  /** Project identifier resolved from domain lookup or a trusted proxy header. */
  projectId?: string;
  /** Release identifier resolved for a production custom domain. */
  releaseId?: string;
  /** Trusted proxy credential for internal requests. Do not log this value. */
  proxyToken?: string;
  /** Environment display name returned by the control plane. */
  environmentName?: string;
  /**
   * Resolved environment from domain lookup or proxy headers.
   * This takes precedence over requestContext.mode for cache isolation.
   * The supported values are `preview` and `production`.
   */
  resolvedEnvironment?: "preview" | "production";
  /** Unified project request context containing credential, slug, branch, and mode. */
  requestContext?: RequestContext;
  /** Whether the request targets a local filesystem project. */
  isLocalProject?: boolean;
  /** Environment identifier used to resolve per-project environment variables. */
  environmentId?: string;
  /** Read-only route registry view used by development diagnostics. */
  routeRegistry?: {
    /** Returns registered handler metadata in execution order. */
    getHandlers(): ReadonlyArray<{ metadata: HandlerMetadata }>;
    /** Returns aggregate registry statistics. */
    getStats(): {
      /** Number of registered handlers. */
      totalHandlers: number;
      /** Handler counts keyed by numeric priority. */
      handlersByPriority: Record<string, number>;
      /** Registered handler names. */
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

/** Result returned by one server handler in the runtime handler chain. */
export interface HandlerResult {
  /** Response produced by the handler. */
  response?: Response;
  /** Whether the handler chain continues after this result. */
  continue?: boolean;
  /** Sanitized diagnostic metadata attached to the result. */
  metadata?: Record<string, unknown>;
}

/** Stable execution order used by the runtime handler registry. */
export enum HandlerPriority {
  /** Authentication and security checks. */
  CRITICAL = 0,
  /** Hot module reload and WebSocket handlers. */
  EARLY = 25,
  /** Health and metrics handlers. */
  HIGH = 100,
  /** Static file and API route handlers. */
  MEDIUM = 500,
  /** Server rendering handlers. */
  LOW = 1000,
  /** Final not-found handlers. */
  FALLBACK = 10000,
}

/** Request pattern matched by a runtime handler. */
export interface RoutePattern {
  /** String or regular expression matched against the request path. */
  pattern: string | RegExp;
  /**
   * Whether a string pattern must match the complete request path.
   * `false` is retained as a legacy alias for prefix matching.
   */
  exact?: boolean;
  /** Whether a string pattern matches a request path prefix. Takes precedence over `exact`. */
  prefix?: boolean;
  /** Allowed HTTP method or methods. */
  method?: string | string[];
}

/** Registration metadata that controls handler matching and execution order. */
export interface HandlerMetadata {
  /** Stable, human-readable handler name. */
  name: string;
  /** Finite handler-chain sort order. Lower values run first. */
  priority: number;
  /** Request patterns handled by this handler. */
  patterns?: RoutePattern[];
  /** Optional request-scoped predicate that enables the handler. */
  enabled?: (ctx: HandlerContext) => boolean;
}

/** One request handler registered with the runtime handler chain. */
export interface Handler {
  /** Metadata used to register and match the handler. */
  metadata: HandlerMetadata;
  /** Handles one request and returns the handler-chain result. */
  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult>;
}

/** Request middleware that can delegate to the next runtime handler. */
export type MiddlewareFunction = (
  req: Request,
  ctx: HandlerContext,
  next: () => Promise<Response>,
) => Promise<Response>;

/** Runtime handler registry feature flags. */
export interface RouteRegistryConfig {
  /** Whether registry diagnostics are enabled. */
  debug?: boolean;
  /** Whether handler execution metrics are collected. */
  enableMetrics?: boolean;
}

/** Function exported by an application route module for one HTTP method. */
export type RouteHandler = (
  req: Request,
  ctx: { params: Record<string, string | string[]> },
) => Promise<Response> | Response;

/** Supported exports from an application route source module. */
export interface RouteHandlerModule {
  /** Handles GET requests. */
  GET?: RouteHandler;
  /** Handles POST requests. */
  POST?: RouteHandler;
  /** Handles PUT requests. */
  PUT?: RouteHandler;
  /** Handles PATCH requests. */
  PATCH?: RouteHandler;
  /** Handles DELETE requests. */
  DELETE?: RouteHandler;
  /** Handles HEAD requests. */
  HEAD?: RouteHandler;
  /** Handles OPTIONS requests. */
  OPTIONS?: RouteHandler;
  /** Additional exports preserved from the application route module. */
  [key: string]: unknown;
}

/** Match result for an application route source file. */
export interface AppRouteMatch {
  /** Matched application route file. */
  file: string;
  /** Dynamic route parameters extracted from the request path. */
  params: Record<string, string | string[]>;
}
