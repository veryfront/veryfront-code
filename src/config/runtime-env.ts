/**
 * Runtime Environment Configuration
 *
 * This module provides a typed, immutable snapshot of environment variables
 * read once at application startup. This enables:
 *
 * 1. Test isolation - tests can override config without env manipulation
 * 2. Type safety - all env access is typed
 * 3. Performance - env read once, not on every access
 * 4. Explicit dependencies - modules declare what config they need
 *
 * @module
 */

import { getEnv } from "#veryfront/platform/compat/process.ts";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";

/**
 * Core runtime environment configuration.
 * Read once at startup and frozen.
 */
export interface RuntimeEnv {
  // =========================================================================
  // Environment Mode
  // =========================================================================

  /** NODE_ENV value (development, production, test) */
  nodeEnv: "development" | "production" | "test" | string;

  /** VERYFRONT_ENV or NODE_ENV or DENO_ENV */
  veryfrontEnv: string;

  /** VERYFRONT_MODE (development, production) */
  veryfrontMode: string;

  // =========================================================================
  // Debug & Testing
  // =========================================================================

  /** VERYFRONT_DEBUG=1 enables debug logging */
  debug: boolean;

  /** CI=1 indicates CI environment */
  ci: boolean;

  /** DENO_TESTING=1 indicates Deno test runner */
  denoTesting: boolean;

  /** VERYFRONT_PERF=1 enables performance logging */
  perfEnabled: boolean;

  // =========================================================================
  // API Configuration
  // =========================================================================

  /** VERYFRONT_API_BASE_URL - API server URL */
  apiBaseUrl: string;

  /** VERYFRONT_API_URL - API GraphQL endpoint */
  apiUrl: string | undefined;

  /** VERYFRONT_API_TOKEN - API authentication token */
  apiToken: string | undefined;

  /** VERYFRONT_PROJECT_SLUG - Current project slug */
  projectSlug: string | undefined;

  // =========================================================================
  // System Paths
  // =========================================================================

  /** HOME or USERPROFILE - User home directory */
  homeDir: string | undefined;

  /** XDG_CONFIG_HOME - XDG config directory */
  xdgConfigHome: string | undefined;

  // =========================================================================
  // Environment Detection
  // =========================================================================

  /** CONTINUOUS_INTEGRATION - CI environment variant */
  continuousIntegration: boolean;

  /** SSH_CLIENT - SSH connection indicator */
  sshClient: string | undefined;

  /** SSH_TTY - SSH TTY indicator */
  sshTty: string | undefined;

  /** DISPLAY - X11 display */
  display: string | undefined;

  /** WAYLAND_DISPLAY - Wayland display */
  waylandDisplay: string | undefined;

  /** CURSOR_SESSION - Cursor editor session */
  cursorSession: string | undefined;

  /** VERYFRONT_SERVER_START_TIME - Server start timestamp */
  serverStartTime: string | undefined;

  /** VCR - Test recording mode (record/playback) */
  vcr: string | undefined;

  // =========================================================================
  // Experimental Features
  // =========================================================================

  /** VERYFRONT_EXPERIMENTAL_RSC=1 enables React Server Components */
  experimentalRsc: boolean;

  // =========================================================================
  // Cache & Storage
  // =========================================================================

  /** REDIS_URL - Redis connection URL */
  redisUrl: string | undefined;

  /** VERYFRONT_CACHE_DIR or VF_CACHE_DIR - Cache directory path */
  cacheDir: string | undefined;

  /** VF_DISABLE_LRU_INTERVAL=1 disables LRU cache cleanup intervals */
  disableLruInterval: boolean;

  // =========================================================================
  // Application URLs
  // =========================================================================

  /** APP_URL or NEXT_PUBLIC_APP_URL - Application base URL */
  appUrl: string | undefined;

  // =========================================================================
  // Server Configuration
  // =========================================================================

  /** PORT - Server port (default: 3001) */
  port: number;

  /** REQUEST_TIMEOUT_MS - Request timeout in milliseconds */
  requestTimeoutMs: number | undefined;

  /** VF_HTTP_FETCH_TIMEOUT - HTTP fetch timeout for ESM imports (ms) */
  httpFetchTimeoutMs: number | undefined;

  /** SSR_MAX_CONCURRENT_TRANSFORMS - Max concurrent SSR transforms */
  ssrMaxConcurrentTransforms: number;

  // =========================================================================
  // Observability
  // =========================================================================

  /** VERYFRONT_OTEL or OTEL_TRACES_ENABLED - Enable OpenTelemetry */
  otelEnabled: boolean;

  /** OTEL_SERVICE_NAME - Service name for tracing */
  otelServiceName: string | undefined;

  /** OTEL_EXPORTER_OTLP_ENDPOINT - OTLP exporter endpoint */
  otelEndpoint: string | undefined;

  /** OTEL_EXPORTER_OTLP_TRACES_ENDPOINT - Traces-specific endpoint */
  otelTracesEndpoint: string | undefined;

  /** OTEL_EXPORTER_OTLP_METRICS_ENDPOINT - Metrics-specific endpoint */
  otelMetricsEndpoint: string | undefined;

  /** OTEL_TRACES_EXPORTER - Traces exporter type */
  otelTracesExporter: string | undefined;

  /** OTEL_METRICS_EXPORTER - Metrics exporter type */
  otelMetricsExporter: string | undefined;

  /** OTEL_METRICS_ENABLED - Enable metrics specifically */
  otelMetricsEnabled: boolean;

  // =========================================================================
  // AI Providers (for built-in AI features)
  // =========================================================================

  /** OPENAI_API_KEY */
  openaiApiKey: string | undefined;

  /** OPENAI_BASE_URL */
  openaiBaseUrl: string | undefined;

  /** ANTHROPIC_API_KEY */
  anthropicApiKey: string | undefined;

  /** ANTHROPIC_BASE_URL */
  anthropicBaseUrl: string | undefined;

  /** GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY */
  googleApiKey: string | undefined;

  // =========================================================================
  // GitHub Integration (for GitHub FS adapter)
  // =========================================================================

  /** GITHUB_TOKEN */
  githubToken: string | undefined;

  /** GITHUB_OWNER */
  githubOwner: string | undefined;

  /** GITHUB_REPO */
  githubRepo: string | undefined;

  /** GITHUB_REF */
  githubRef: string | undefined;

  // =========================================================================
  // Display & Terminal
  // =========================================================================

  /** NO_COLOR - Disable colored output */
  noColor: boolean;

  /** FORCE_COLOR - Force colored output */
  forceColor: boolean;

  // =========================================================================
  // Deno-specific
  // =========================================================================

  /** DENO_V8_FLAGS */
  denoV8Flags: string;

  /** V8_MAX_OLD_SPACE_SIZE - V8 heap size limit in MB */
  v8MaxOldSpaceSize: number | undefined;

  // =========================================================================
  // Versioning
  // =========================================================================

  /** VERYFRONT_VERSION */
  veryfrontVersion: string | undefined;
}

/**
 * Default values for RuntimeEnv.
 * Used when env vars are not set.
 */
const DEFAULTS: Partial<RuntimeEnv> = {
  nodeEnv: "development",
  veryfrontEnv: "development",
  veryfrontMode: "development",
  debug: false,
  ci: false,
  denoTesting: false,
  perfEnabled: false,
  apiBaseUrl: "http://api.lvh.me:4000",
  experimentalRsc: false,
  disableLruInterval: false,
  port: 3001,
  ssrMaxConcurrentTransforms: 3,
  otelEnabled: false,
  otelMetricsEnabled: false,
  noColor: false,
  forceColor: false,
  denoV8Flags: "",
};

/**
 * Singleton instance of RuntimeEnv.
 * Initialized once at startup.
 */
let _runtimeEnv: RuntimeEnv | null = null;

/**
 * Read all environment variables and create RuntimeEnv snapshot.
 */
function readEnvSnapshot(): RuntimeEnv {
  const nodeEnv = getEnv("NODE_ENV") || getEnv("DENO_ENV") || "development";
  const veryfrontEnv = getEnv("VERYFRONT_ENV") || nodeEnv;

  // Parse numeric env vars
  const parseNumber = (value: string | undefined, defaultVal: number): number => {
    if (!value) return defaultVal;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultVal;
  };

  return {
    // Environment Mode
    nodeEnv,
    veryfrontEnv,
    veryfrontMode: getEnv("VERYFRONT_MODE") || "development",

    // Debug & Testing
    debug: isTruthyEnvValue(getEnv("VERYFRONT_DEBUG")),
    ci: getEnv("CI") === "1",
    denoTesting: getEnv("DENO_TESTING") === "1",
    perfEnabled: getEnv("VERYFRONT_PERF") === "1",

    // API Configuration
    apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") ||
      getEnv("VERYFRONT_API_URL")?.replace("/graphql", "/api") ||
      DEFAULTS.apiBaseUrl!,
    apiUrl: getEnv("VERYFRONT_API_URL") || undefined,
    apiToken: getEnv("VERYFRONT_API_TOKEN") || undefined,
    projectSlug: getEnv("VERYFRONT_PROJECT_SLUG") || undefined,

    // System Paths
    homeDir: getEnv("HOME") || getEnv("USERPROFILE") || undefined,
    xdgConfigHome: getEnv("XDG_CONFIG_HOME") || undefined,

    // Environment Detection
    continuousIntegration: !!getEnv("CONTINUOUS_INTEGRATION"),
    sshClient: getEnv("SSH_CLIENT") || undefined,
    sshTty: getEnv("SSH_TTY") || undefined,
    display: getEnv("DISPLAY") || undefined,
    waylandDisplay: getEnv("WAYLAND_DISPLAY") || undefined,
    cursorSession: getEnv("CURSOR_SESSION") || undefined,
    serverStartTime: getEnv("VERYFRONT_SERVER_START_TIME") || undefined,
    vcr: getEnv("VCR") || undefined,

    // Experimental Features
    experimentalRsc: getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1",

    // Cache & Storage
    redisUrl: getEnv("REDIS_URL") || undefined,
    cacheDir: getEnv("VERYFRONT_CACHE_DIR") || getEnv("VF_CACHE_DIR") || undefined,
    disableLruInterval: getEnv("VF_DISABLE_LRU_INTERVAL") === "1",

    // Application URLs
    appUrl: getEnv("APP_URL") || getEnv("NEXT_PUBLIC_APP_URL") || undefined,

    // Server Configuration
    port: parseNumber(getEnv("PORT"), DEFAULTS.port!),
    requestTimeoutMs: getEnv("REQUEST_TIMEOUT_MS")
      ? parseNumber(getEnv("REQUEST_TIMEOUT_MS"), 30000)
      : undefined,
    httpFetchTimeoutMs: getEnv("VF_HTTP_FETCH_TIMEOUT")
      ? parseNumber(getEnv("VF_HTTP_FETCH_TIMEOUT"), 30000)
      : undefined,
    ssrMaxConcurrentTransforms: parseNumber(
      getEnv("SSR_MAX_CONCURRENT_TRANSFORMS"),
      DEFAULTS.ssrMaxConcurrentTransforms!,
    ),

    // Observability
    otelEnabled: isTruthyEnvValue(getEnv("VERYFRONT_OTEL")) ||
      isTruthyEnvValue(getEnv("OTEL_TRACES_ENABLED")),
    otelServiceName: getEnv("OTEL_SERVICE_NAME") || undefined,
    otelEndpoint: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || undefined,
    otelTracesEndpoint: getEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") || undefined,
    otelMetricsEndpoint: getEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") || undefined,
    otelTracesExporter: getEnv("OTEL_TRACES_EXPORTER") || undefined,
    otelMetricsExporter: getEnv("OTEL_METRICS_EXPORTER") || undefined,
    otelMetricsEnabled: isTruthyEnvValue(getEnv("OTEL_METRICS_ENABLED")),

    // AI Providers
    openaiApiKey: getEnv("OPENAI_API_KEY") || undefined,
    openaiBaseUrl: getEnv("OPENAI_BASE_URL") || undefined,
    anthropicApiKey: getEnv("ANTHROPIC_API_KEY") || undefined,
    anthropicBaseUrl: getEnv("ANTHROPIC_BASE_URL") || undefined,
    googleApiKey: getEnv("GOOGLE_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY") || undefined,

    // GitHub Integration
    githubToken: getEnv("GITHUB_TOKEN") || undefined,
    githubOwner: getEnv("GITHUB_OWNER") || undefined,
    githubRepo: getEnv("GITHUB_REPO") || undefined,
    githubRef: getEnv("GITHUB_REF") || undefined,

    // Display & Terminal
    noColor: !!getEnv("NO_COLOR"),
    forceColor: !!getEnv("FORCE_COLOR"),

    // Deno-specific
    denoV8Flags: getEnv("DENO_V8_FLAGS") ?? "",
    v8MaxOldSpaceSize: getEnv("V8_MAX_OLD_SPACE_SIZE")
      ? parseNumber(getEnv("V8_MAX_OLD_SPACE_SIZE"), 0) || undefined
      : undefined,

    // Versioning
    veryfrontVersion: getEnv("VERYFRONT_VERSION") || undefined,
  };
}

/**
 * Initialize RuntimeEnv from environment variables.
 * Should be called once at application startup.
 *
 * @returns Frozen RuntimeEnv object
 */
export function initRuntimeEnv(): RuntimeEnv {
  if (_runtimeEnv) return _runtimeEnv;

  _runtimeEnv = Object.freeze(readEnvSnapshot());
  return _runtimeEnv;
}

/**
 * Get the current RuntimeEnv.
 * Throws if not initialized.
 *
 * @returns RuntimeEnv object
 * @throws Error if RuntimeEnv not initialized
 */
export function getRuntimeEnv(): RuntimeEnv {
  if (!_runtimeEnv) {
    // Auto-initialize on first access for backwards compatibility
    return initRuntimeEnv();
  }
  return _runtimeEnv;
}

/**
 * Check if RuntimeEnv has been initialized.
 */
export function isRuntimeEnvInitialized(): boolean {
  return _runtimeEnv !== null;
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a RuntimeEnv with custom values for testing.
 * Does NOT affect the global singleton.
 *
 * @param overrides - Partial RuntimeEnv to merge with defaults
 * @returns New RuntimeEnv object (not frozen, for test flexibility)
 */
export function createTestRuntimeEnv(overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  const base = _runtimeEnv ?? readEnvSnapshot();
  return {
    ...base,
    // Test-specific defaults
    nodeEnv: "test",
    debug: false,
    ci: false,
    denoTesting: false,
    // Apply overrides
    ...overrides,
  };
}

/**
 * Override the global RuntimeEnv for testing.
 * Use with caution - affects all code using getRuntimeEnv().
 *
 * @param env - Full or partial RuntimeEnv to set
 * @internal Test use only
 */
export function _setRuntimeEnvForTesting(env: Partial<RuntimeEnv>): void {
  const base = _runtimeEnv ?? readEnvSnapshot();
  _runtimeEnv = Object.freeze({ ...base, ...env });
}

/**
 * Reset RuntimeEnv to uninitialized state.
 * Next call to getRuntimeEnv() will re-read from environment.
 *
 * @internal Test use only
 */
export function _resetRuntimeEnv(): void {
  _runtimeEnv = null;
}
