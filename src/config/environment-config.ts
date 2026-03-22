import { getEnv } from "#veryfront/platform/compat/process.ts";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { hasEnvLoaded } from "#veryfront/utils/env-loader.ts";

export interface EnvironmentConfig {
  nodeEnv: "development" | "production" | "test" | string;
  veryfrontEnv: string;
  veryfrontMode: string;

  debug: boolean;
  ci: boolean;
  denoTesting: boolean;
  perfEnabled: boolean;

  apiBaseUrl: string;
  /** Public-facing API URL for browser-injected scripts (WebSocket URLs, etc.). */
  publicApiBaseUrl: string;
  apiUrl: string | undefined;
  apiToken: string | undefined;
  projectSlug: string | undefined;

  homeDir: string | undefined;
  xdgConfigHome: string | undefined;

  continuousIntegration: boolean;
  sshClient: string | undefined;
  sshTty: string | undefined;
  display: string | undefined;
  waylandDisplay: string | undefined;
  cursorSession: string | undefined;
  serverStartTime: string | undefined;
  vcr: string | undefined;

  experimentalRsc: boolean;

  redisUrl: string | undefined;
  cacheDir: string | undefined;
  disableLruInterval: boolean;

  appUrl: string | undefined;

  port: number;
  requestTimeoutMs: number | undefined;
  httpFetchTimeoutMs: number | undefined;
  ssrMaxConcurrentTransforms: number;

  otelEnabled: boolean;
  otelServiceName: string | undefined;
  otelEndpoint: string | undefined;
  otelTracesEndpoint: string | undefined;
  otelMetricsEndpoint: string | undefined;
  otelTracesExporter: string | undefined;
  otelMetricsExporter: string | undefined;
  otelHeaders: string | undefined;
  otelMetricsEnabled: boolean;

  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  anthropicApiKey: string | undefined;
  anthropicBaseUrl: string | undefined;
  googleApiKey: string | undefined;

  githubToken: string | undefined;
  githubOwner: string | undefined;
  githubRepo: string | undefined;
  githubRef: string | undefined;

  noColor: boolean;
  forceColor: boolean;

  denoV8Flags: string;
  v8MaxOldSpaceSize: number | undefined;

  veryfrontVersion: string | undefined;
}

/** Default timeout for incoming HTTP requests (used when REQUEST_TIMEOUT_MS is set but unparseable) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default timeout for outgoing HTTP fetch calls (used when VF_HTTP_FETCH_TIMEOUT is set but unparseable) */
const DEFAULT_HTTP_FETCH_TIMEOUT_MS = 30_000;

const DEFAULTS = {
  apiBaseUrl: "https://api.veryfront.com",
  port: 3001,
  ssrMaxConcurrentTransforms: 3,
} as const;

let _environmentConfig: EnvironmentConfig | null = null;
let envConfigInitializedBeforeEnvLoad = false;
let warnedEarlyEnvConfig = false;

function parseNumber(value: string | undefined, defaultVal: number): number {
  if (!value) return defaultVal;

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

function readEnvSnapshot(): EnvironmentConfig {
  const nodeEnv = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  const veryfrontEnv = getEnv("VERYFRONT_ENV") ?? nodeEnv;

  const requestTimeoutRaw = getEnv("REQUEST_TIMEOUT_MS");
  const httpFetchTimeoutRaw = getEnv("VF_HTTP_FETCH_TIMEOUT");
  const v8MaxOldSpaceSizeRaw = getEnv("V8_MAX_OLD_SPACE_SIZE");

  const apiUrl = getEnv("VERYFRONT_API_URL") || undefined;

  return {
    nodeEnv,
    veryfrontEnv,
    veryfrontMode: getEnv("VERYFRONT_MODE") ?? "development",

    debug: isTruthyEnvValue(getEnv("VERYFRONT_DEBUG")),
    ci: getEnv("CI") === "1",
    denoTesting: getEnv("DENO_TESTING") === "1",
    perfEnabled: getEnv("VERYFRONT_PERF") === "1",

    apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") ||
      apiUrl?.replace("/graphql", "/api") ||
      DEFAULTS.apiBaseUrl,
    publicApiBaseUrl: getEnv("VERYFRONT_PUBLIC_API_BASE_URL") ||
      DEFAULTS.apiBaseUrl,
    apiUrl,
    apiToken: getEnv("VERYFRONT_API_TOKEN") || undefined,
    projectSlug: getEnv("VERYFRONT_PROJECT_SLUG") || undefined,

    homeDir: getEnv("HOME") || getEnv("USERPROFILE") || undefined,
    xdgConfigHome: getEnv("XDG_CONFIG_HOME") || undefined,

    continuousIntegration: !!getEnv("CONTINUOUS_INTEGRATION"),
    sshClient: getEnv("SSH_CLIENT") || undefined,
    sshTty: getEnv("SSH_TTY") || undefined,
    display: getEnv("DISPLAY") || undefined,
    waylandDisplay: getEnv("WAYLAND_DISPLAY") || undefined,
    cursorSession: getEnv("CURSOR_SESSION") || undefined,
    serverStartTime: getEnv("VERYFRONT_SERVER_START_TIME") || undefined,
    vcr: getEnv("VCR") || undefined,

    experimentalRsc: getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1",

    redisUrl: getEnv("REDIS_URL") || undefined,
    cacheDir: getEnv("VERYFRONT_CACHE_DIR") || getEnv("VF_CACHE_DIR") || undefined,
    disableLruInterval: getEnv("VF_DISABLE_LRU_INTERVAL") === "1",

    appUrl: getEnv("APP_URL") || getEnv("NEXT_PUBLIC_APP_URL") || undefined,

    port: parseNumber(getEnv("PORT"), DEFAULTS.port),
    requestTimeoutMs: requestTimeoutRaw
      ? parseNumber(requestTimeoutRaw, DEFAULT_REQUEST_TIMEOUT_MS)
      : undefined,
    httpFetchTimeoutMs: httpFetchTimeoutRaw
      ? parseNumber(httpFetchTimeoutRaw, DEFAULT_HTTP_FETCH_TIMEOUT_MS)
      : undefined,
    ssrMaxConcurrentTransforms: parseNumber(
      getEnv("SSR_MAX_CONCURRENT_TRANSFORMS"),
      DEFAULTS.ssrMaxConcurrentTransforms,
    ),

    otelEnabled: isTruthyEnvValue(getEnv("VERYFRONT_OTEL")) ||
      isTruthyEnvValue(getEnv("OTEL_TRACES_ENABLED")),
    otelServiceName: getEnv("OTEL_SERVICE_NAME") || undefined,
    otelEndpoint: getEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || undefined,
    otelTracesEndpoint: getEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") || undefined,
    otelMetricsEndpoint: getEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") || undefined,
    otelTracesExporter: getEnv("OTEL_TRACES_EXPORTER") || undefined,
    otelMetricsExporter: getEnv("OTEL_METRICS_EXPORTER") || undefined,
    otelHeaders: getEnv("OTEL_EXPORTER_OTLP_HEADERS") || undefined,
    otelMetricsEnabled: isTruthyEnvValue(getEnv("OTEL_METRICS_ENABLED")),

    openaiApiKey: getEnv("OPENAI_API_KEY") || undefined,
    openaiBaseUrl: getEnv("OPENAI_BASE_URL") || undefined,
    anthropicApiKey: getEnv("ANTHROPIC_API_KEY") || undefined,
    anthropicBaseUrl: getEnv("ANTHROPIC_BASE_URL") || undefined,
    googleApiKey: getEnv("GOOGLE_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY") || undefined,

    githubToken: getEnv("GITHUB_TOKEN") || undefined,
    githubOwner: getEnv("GITHUB_OWNER") || undefined,
    githubRepo: getEnv("GITHUB_REPO") || undefined,
    githubRef: getEnv("GITHUB_REF") || undefined,

    noColor: !!getEnv("NO_COLOR"),
    forceColor: !!getEnv("FORCE_COLOR"),

    denoV8Flags: getEnv("DENO_V8_FLAGS") ?? "",
    v8MaxOldSpaceSize: v8MaxOldSpaceSizeRaw
      ? parseNumber(v8MaxOldSpaceSizeRaw, 0) || undefined
      : undefined,

    veryfrontVersion: getEnv("VERYFRONT_VERSION") || getEnv("RELEASE_VERSION") || undefined,
  };
}

export function initEnvironmentConfig(): EnvironmentConfig {
  if (_environmentConfig) return _environmentConfig;

  if (!hasEnvLoaded()) {
    envConfigInitializedBeforeEnvLoad = true;
    return readEnvSnapshot();
  }

  _environmentConfig = Object.freeze(readEnvSnapshot());
  envConfigInitializedBeforeEnvLoad = false;
  return _environmentConfig;
}

export function refreshEnvironmentConfig(): EnvironmentConfig {
  _environmentConfig = Object.freeze(readEnvSnapshot());
  envConfigInitializedBeforeEnvLoad = false;
  return _environmentConfig;
}

function warnEarlyAccess(): void {
  if (warnedEarlyEnvConfig) return;
  warnedEarlyEnvConfig = true;

  const message = "[EnvironmentConfig] getEnvironmentConfig called before .env load. " +
    "Returning uncached snapshot; ensure loadEnv runs before environment config access.";
  const debugStack = getEnv("VERYFRONT_DEBUG_RUNTIME_ENV");
  if (debugStack === "1" || debugStack === "true") {
    logger.warn(message, { stack: new Error().stack });
  } else {
    logger.warn(message);
  }
}

export function getEnvironmentConfig(): EnvironmentConfig {
  // If cached and env has loaded since init, refresh to pick up .env values
  if (_environmentConfig && envConfigInitializedBeforeEnvLoad && hasEnvLoaded()) {
    return refreshEnvironmentConfig();
  }
  if (_environmentConfig) {
    return _environmentConfig;
  }

  // Env not loaded yet - return uncached snapshot with warning
  if (!hasEnvLoaded()) {
    warnEarlyAccess();
    return readEnvSnapshot();
  }

  return initEnvironmentConfig();
}

export function isEnvironmentConfigInitialized(): boolean {
  return _environmentConfig !== null;
}

export function createTestEnvironmentConfig(
  overrides: Partial<EnvironmentConfig> = {},
): EnvironmentConfig {
  const base = _environmentConfig ?? readEnvSnapshot();

  return {
    ...base,
    nodeEnv: "test",
    debug: false,
    ci: false,
    denoTesting: false,
    ...overrides,
  };
}

export function _setEnvironmentConfigForTesting(env: Partial<EnvironmentConfig>): void {
  const base = _environmentConfig ?? readEnvSnapshot();
  _environmentConfig = Object.freeze({ ...base, ...env });
}

export function _resetEnvironmentConfig(): void {
  _environmentConfig = null;
  envConfigInitializedBeforeEnvLoad = false;
  warnedEarlyEnvConfig = false;
}
