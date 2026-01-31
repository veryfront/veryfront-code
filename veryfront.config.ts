/**
 * Veryfront Renderer Config
 *
 * Supports two modes:
 * 1. Proxy mode: Token and project slug provided per-request via headers
 * 2. Direct mode: Token and project slug from .env
 *
 * Usage:
 *   Proxy mode: Run behind veryfront-proxy (no env vars needed)
 *   Direct mode: Set VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG in .env
 */

// Default URLs
const DEFAULT_API_URL_LOCAL = "http://api.lvh.me:4000";
const DEFAULT_API_URL_PROD = "https://api.veryfront.com";
const DEFAULT_CORS_ORIGIN_LOCAL = "http://api.lvh.me:4000";

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// Load .env manually since config is evaluated before bootstrap
// In production, .env won't exist - that's fine, we use env vars
// IMPORTANT: Don't use export: true - it would overwrite env vars set by parent process
// (e.g., PROXY_MODE=1 set by server.ts would be overwritten by PROXY_MODE=0 from .env)
let env: Record<string, string> = {};
try {
  const { load } = await import("@std/dotenv");
  // examplePath: null skips validation against .env.example (which requires all vars)
  env = await load({ envPath: ".env", examplePath: null });
} catch {
  // .env doesn't exist (production) - use environment variables only
}

// Get env var from Deno.env or .env
const getEnv = (key: string, fallback = "") =>
  Deno.env.get(key) || env[key] || fallback;

const apiBaseUrl = getEnv("VERYFRONT_API_BASE_URL", DEFAULT_API_URL_LOCAL);
const apiToken = getEnv("VERYFRONT_API_TOKEN");
const projectSlug = getEnv("VERYFRONT_PROJECT_SLUG");

// Check for multi-project credentials (OAuth or API token)
const hasOAuthCredentials = !!(getEnv("OAUTH_CLIENT_ID") && getEnv("OAUTH_CLIENT_SECRET"));
const hasApiToken = !!apiToken;

// Proxy mode configuration:
// - Default: true if multi-project credentials present (OAuth or API token)
// - Can be explicitly set via PROXY_MODE env var to override default
// - PROXY_MODE=1 forces proxy mode on, PROXY_MODE=0 forces it off
const proxyModeEnv = Deno.env.get("PROXY_MODE");
const proxyMode = proxyModeEnv !== undefined
  ? proxyModeEnv === "1"
  : (hasOAuthCredentials || hasApiToken); // Default based on available credentials
const projectId = getEnv("VERYFRONT_PROJECT_ID");

// Content source configuration
// Type: "branch" (default), "environment", "domain", or "release"
const contentSourceType = getEnv("VERYFRONT_CONTENT_SOURCE", "branch") as
  | "branch"
  | "environment"
  | "domain"
  | "release";
const contentSourceBranch = getEnv("VERYFRONT_BRANCH", "main");
const contentSourceEnv = getEnv("VERYFRONT_ENVIRONMENT", "production");
const contentSourceDomain = getEnv("VERYFRONT_DOMAIN");
const contentSourceReleaseId = getEnv("VERYFRONT_RELEASE_ID");

// Build content source config
type ContentSource =
  | { type: "branch"; branch?: string }
  | { type: "environment"; name: string }
  | { type: "domain"; domain: string }
  | { type: "release"; releaseId?: string };

function buildContentSource(): ContentSource {
  switch (contentSourceType) {
    case "environment":
      return { type: "environment", name: contentSourceEnv };
    case "domain":
      if (!contentSourceDomain) {
        throw new ConfigError("VERYFRONT_DOMAIN is required when VERYFRONT_CONTENT_SOURCE=domain");
      }
      return { type: "domain", domain: contentSourceDomain };
    case "release":
      return { type: "release", releaseId: contentSourceReleaseId || "latest" };
    case "branch":
    default:
      return { type: "branch", branch: contentSourceBranch };
  }
}

const contentSource = buildContentSource();

// In proxy mode, token comes from x-token header per-request
// In direct mode, require token and slug from env
// Skip check during tests or CI
const isTestEnv = Deno.env.get("DENO_JOBS") !== undefined || Deno.env.get("CI") !== undefined;
if (!isTestEnv && !proxyMode && (!apiToken || !projectSlug)) {
  throw new ConfigError(`Missing required environment variables in .env:

   VERYFRONT_API_TOKEN=${apiToken ? "✓" : "missing"}
   VERYFRONT_PROJECT_SLUG=${projectSlug ? "✓" : "missing"}

To get started:
  Option A (Proxy mode): Set PROXY_MODE=1 and run behind veryfront-proxy
  Option B (Direct mode):
    1. Get an API key from veryfront.com settings
    2. Copy the token to .env
    3. Set your project slug in .env`);
}

// Proxy mode logging handled by server.ts startup banner

// GitHub test mode: Use GITHUB_TOKEN env var to enable
const useGitHub = !!Deno.env.get("GITHUB_TOKEN");

export default useGitHub ? {
  fs: {
    type: "github" as const,
    github: {
      token: Deno.env.get("GITHUB_TOKEN"),
      owner: Deno.env.get("GITHUB_OWNER") || "veryfront",
      repo: Deno.env.get("GITHUB_REPO") || "example-project",
      ref: Deno.env.get("GITHUB_REF") || "main",
      cache: { enabled: true, ttl: 60000 },
    },
  },
  dev: { port: 3001, host: "localhost", hmr: false },
} : {
  // Use veryfront-api filesystem adapter
  fs: {
    type: "veryfront-api" as const,
    veryfront: {
      baseUrl: apiBaseUrl,
      // Enable proxy mode for multi-project per-request handling
      proxyMode,
      // In proxy mode, token from header takes precedence, but still provide
      // a fallback token from env for local dev when proxy doesn't have OAuth
      // In direct mode, use the configured values directly
      apiToken: apiToken || undefined,
      projectSlug: proxyMode ? undefined : projectSlug,
      projectId: proxyMode ? undefined : projectId || undefined,
      // Content source configuration:
      // - branch: Draft content from git branch (for dev)
      // - environment: Published content from named environment (production, preview)
      // - domain: Resolve environment via domain lookup API
      // - release: Specific release by ID
      contentSource: proxyMode ? undefined : contentSource,
      cache: {
        enabled: true, // WebSocket pokes invalidate cache on file changes
        ttl: 60000, // 60s TTL as safety net
      },
      retry: {
        maxRetries: 3,
        initialDelay: 500,
        maxDelay: 5000,
      },
    },
  },

  // Dev server config (ignored in production)
  dev: {
    port: 3001,
    host: "lvh.me",
    hmr: contentSource.type === "branch", // Only enable HMR for branch mode
  },

  // Security - allow requests from local API (in proxy mode) or production
  security: {
    cors: {
      origin: proxyMode ? DEFAULT_CORS_ORIGIN_LOCAL : DEFAULT_API_URL_PROD,
    },
  },
};