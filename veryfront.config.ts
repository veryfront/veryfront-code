/**
 * Veryfront Renderer Config
 *
 * Supports two modes:
 * 1. Proxy mode: Token and project slug provided per-request via headers
 * 2. Direct mode: Token and project slug from .env.local
 *
 * Usage:
 *   Proxy mode: Run behind veryfront-proxy (no env vars needed)
 *   Direct mode: Set VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG in .env.local
 */

// Default URLs
const DEFAULT_API_URL_LOCAL = "http://api.lvh.me:4000/api";
const DEFAULT_API_URL_PROD = "https://api.veryfront.com";
const DEFAULT_CORS_ORIGIN_LOCAL = "http://api.lvh.me:4000";

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// Load .env.local manually since config is evaluated before bootstrap
// In production, .env.local won't exist - that's fine, we use env vars
let env: Record<string, string> = {};
try {
  const { load } = await import("https://deno.land/std@0.220.0/dotenv/mod.ts");
  env = await load({ envPath: ".env.local", export: true });
} catch {
  // .env.local doesn't exist (production) - use environment variables only
}

// Check if running behind proxy (PROXY_MODE=1) or direct mode
const proxyMode = Deno.env.get("PROXY_MODE") === "1";

// Production mode for serving published content (not draft)
// In production deployment, this should be true to fetch from releases
const productionMode = Deno.env.get("PRODUCTION_MODE") === "1";

// Get env var from Deno.env or .env.local
const getEnv = (key: string, fallback = "") =>
  Deno.env.get(key) || env[key] || fallback;

const apiBaseUrl = getEnv("VERYFRONT_API_BASE_URL", DEFAULT_API_URL_LOCAL);
const apiToken = getEnv("VERYFRONT_API_TOKEN");
const projectSlug = getEnv("VERYFRONT_PROJECT_SLUG");
const projectId = getEnv("VERYFRONT_PROJECT_ID");
const releaseId = getEnv("VERYFRONT_RELEASE_ID");

// In proxy mode, token comes from x-token header per-request
// In direct mode, require token and slug from env
// Skip check during tests or CI
const isTestEnv = Deno.env.get("DENO_JOBS") !== undefined || Deno.env.get("CI") !== undefined;
if (!isTestEnv && !proxyMode && (!apiToken || !projectSlug)) {
  throw new ConfigError(`Missing required environment variables in .env.local:

   VERYFRONT_API_TOKEN=${apiToken ? "✓" : "missing"}
   VERYFRONT_PROJECT_SLUG=${projectSlug ? "✓" : "missing"}

To get started:
  Option A (Proxy mode): Set PROXY_MODE=1 and run behind veryfront-proxy
  Option B (Direct mode):
    1. Get an API key from veryfront.com settings
    2. Copy the token to .env.local
    3. Set your project slug in .env.local`);
}

if (proxyMode) {
  console.log("[Config] Running in PROXY_MODE - tokens provided per-request via headers");
  console.log(`[Config] API Base URL: ${apiBaseUrl}`);
}

// GitHub test mode: Use GITHUB_TOKEN env var to enable
const useGitHub = !!Deno.env.get("GITHUB_TOKEN");

export default useGitHub ? {
  fs: {
    type: "github" as const,
    github: {
      token: Deno.env.get("GITHUB_TOKEN"),
      owner: "veryfront",
      repo: "codersociety",
      ref: "main",
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
      apiToken: apiToken || undefined, // Fallback for both modes
      projectSlug: proxyMode ? undefined : projectSlug,
      projectId: proxyMode ? undefined : projectId || undefined, // Skip listProjects lookup if set
      // Production mode fetches from releases (published content)
      // instead of draft files and skips WebSocket connection
      productionMode,
      // Specific release ID to fetch (defaults to "latest" if not set)
      releaseId: proxyMode ? undefined : releaseId || undefined,
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
    hmr: true, // Enables browser auto-reload on cache invalidation
  },

  // Security - allow requests from local API (in proxy mode) or production
  security: {
    cors: {
      origin: proxyMode ? DEFAULT_CORS_ORIGIN_LOCAL : DEFAULT_API_URL_PROD,
    },
  },
};
