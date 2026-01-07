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

// Derive REST API base URL
// Production: VERYFRONT_API_URL is the API base (https://api.veryfront.com)
// Local dev: VERYFRONT_API_BASE_URL is the REST API URL (http://api.lvh.me:4000/api)
function getApiBaseUrl(): string {
  // Check for API URL first (production)
  const apiUrl = Deno.env.get("VERYFRONT_API_URL") || "";
  if (apiUrl) {
    // Handle both "https://api.veryfront.com" and "https://api.veryfront.com/graphql"
    const baseUrl = apiUrl.endsWith("/graphql")
      ? apiUrl.replace("/graphql", "")
      : apiUrl;
    // Ensure URL ends with /api
    return baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  }
  // Fall back to explicit base URL or env.local value
  return Deno.env.get("VERYFRONT_API_BASE_URL") || env.VERYFRONT_API_BASE_URL ||
    "http://api.lvh.me:4000/api";
}

const apiBaseUrl = getApiBaseUrl();
const apiToken = Deno.env.get("VERYFRONT_API_TOKEN") || env.VERYFRONT_API_TOKEN || "";
const projectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG") || env.VERYFRONT_PROJECT_SLUG || "";
const projectId = Deno.env.get("VERYFRONT_PROJECT_ID") || env.VERYFRONT_PROJECT_ID || "";
const releaseId = Deno.env.get("VERYFRONT_RELEASE_ID") || env.VERYFRONT_RELEASE_ID || "";

// In proxy mode, token comes from x-token header per-request
// In direct mode, require token and slug from env
// Skip check during tests or CI
const isTestEnv = Deno.env.get("DENO_JOBS") !== undefined || Deno.env.get("CI") !== undefined;
if (!isTestEnv && !proxyMode && (!apiToken || !projectSlug)) {
  console.error(`
❌ Missing required environment variables in .env.local:

   VERYFRONT_API_TOKEN=${apiToken ? "✓" : "missing"}
   VERYFRONT_PROJECT_SLUG=${projectSlug ? "✓" : "missing"}

To get started:
  Option A (Proxy mode): Set PROXY_MODE=1 and run behind veryfront-proxy
  Option B (Direct mode):
    1. Get an API key from veryfront.com settings
    2. Copy the token to .env.local
    3. Set your project slug in .env.local
  `);
  Deno.exit(1);
}

if (proxyMode) {
  console.log("[Config] Running in PROXY_MODE - tokens provided per-request via headers");
  console.log(`[Config] API Base URL: ${apiBaseUrl}`);
}

export default {
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
      origin: proxyMode ? "http://api.lvh.me:4000" : "https://api.veryfront.com",
    },
  },
};
