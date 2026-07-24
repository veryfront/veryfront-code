import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getHostTelemetryEnv } from "#veryfront/observability/tracing/telemetry-env.ts";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { DEFAULT_DEV_SERVER_PORT, MAX_PORT, MIN_PORT } from "#veryfront/utils/constants/network.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { hasEnvLoaded } from "#veryfront/utils/env-loader.ts";

export interface EnvironmentConfig {
  nodeEnv: "development" | "production" | "test" | string;
  veryfrontEnv: string;
  veryfrontMode: string;
  proxyMode: boolean;

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
  /**
   * Whether `port` came from a valid `PORT` value or the built-in default.
   * Omitted values from custom callers retain the legacy env-override behavior.
   */
  portSource?: "default" | "environment";
  requestTimeoutMs: number | undefined;
  httpFetchTimeoutMs: number | undefined;
  extensionSetupTimeoutMs: number | undefined;
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

/**
 * Default incoming request deadline. This must remain above the renderer's
 * 60-second pipeline deadline and below the proxy's 90-second upstream one.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 75_000;
/** Default timeout for outgoing HTTP fetch calls (used when VF_HTTP_FETCH_TIMEOUT is set but unparseable) */
const DEFAULT_HTTP_FETCH_TIMEOUT_MS = 30_000;
const DEFAULTS = {
  apiBaseUrl: "https://api.veryfront.com",
  port: DEFAULT_DEV_SERVER_PORT,
  ssrMaxConcurrentTransforms: 3,
} as const;

let _environmentConfig: EnvironmentConfig | null = null;
let envConfigInitializedBeforeEnvLoad = false;
let warnedEarlyEnvConfig = false;

function parseBoundedIntegerValue(
  value: string | undefined,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (value === undefined) return undefined;

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return undefined;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function parseBoundedInteger(
  value: string | undefined,
  defaultVal: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  return parseBoundedIntegerValue(value, min, max) ?? defaultVal;
}

type EnvReader = (key: string) => string | undefined;
const readEmptyEnv: EnvReader = () => undefined;

function readEnvSnapshot(
  readEnv: EnvReader = getEnv,
  readHostEnv: EnvReader = getHostEnv,
  readTelemetryEnv: EnvReader = getHostTelemetryEnv,
): EnvironmentConfig {
  const nodeEnv = readEnv("NODE_ENV") ?? readEnv("DENO_ENV") ?? "development";
  const veryfrontEnv = readEnv("VERYFRONT_ENV") ?? nodeEnv;

  const requestTimeoutRaw = readEnv("REQUEST_TIMEOUT_MS");
  const httpFetchTimeoutRaw = readEnv("VF_HTTP_FETCH_TIMEOUT");
  const extensionSetupTimeoutRaw = readEnv("VF_EXTENSION_SETUP_TIMEOUT_MS");
  const v8MaxOldSpaceSizeRaw = readEnv("V8_MAX_OLD_SPACE_SIZE");
  const forceColorRaw = readEnv("FORCE_COLOR");
  const portOverride = parseBoundedIntegerValue(readEnv("PORT"), MIN_PORT, MAX_PORT);

  const apiUrl = readEnv("VERYFRONT_API_URL") || undefined;

  return {
    nodeEnv,
    veryfrontEnv,
    veryfrontMode: readEnv("VERYFRONT_MODE") ?? "development",
    proxyMode: readHostEnv("PROXY_MODE") === "1",

    debug: isTruthyEnvValue(readEnv("VERYFRONT_DEBUG")),
    ci: isTruthyEnvValue(readEnv("CI")),
    denoTesting: readEnv("DENO_TESTING") === "1",
    perfEnabled: readEnv("VERYFRONT_PERF") === "1",

    apiBaseUrl: readEnv("VERYFRONT_API_BASE_URL") ||
      apiUrl?.replace("/graphql", "/api") ||
      DEFAULTS.apiBaseUrl,
    publicApiBaseUrl: readEnv("VERYFRONT_PUBLIC_API_BASE_URL") ||
      DEFAULTS.apiBaseUrl,
    apiUrl,
    apiToken: readEnv("VERYFRONT_API_TOKEN") || undefined,
    projectSlug: readEnv("VERYFRONT_PROJECT_SLUG") || undefined,

    homeDir: readEnv("HOME") || readEnv("USERPROFILE") || undefined,
    xdgConfigHome: readEnv("XDG_CONFIG_HOME") || undefined,

    continuousIntegration: isTruthyEnvValue(readEnv("CONTINUOUS_INTEGRATION")),
    sshClient: readEnv("SSH_CLIENT") || undefined,
    sshTty: readEnv("SSH_TTY") || undefined,
    display: readEnv("DISPLAY") || undefined,
    waylandDisplay: readEnv("WAYLAND_DISPLAY") || undefined,
    cursorSession: readEnv("CURSOR_SESSION") || undefined,
    serverStartTime: readEnv("VERYFRONT_SERVER_START_TIME") || undefined,
    vcr: readEnv("VCR") || undefined,

    experimentalRsc: readEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1",

    redisUrl: readEnv("REDIS_URL") || undefined,
    cacheDir: readEnv("VERYFRONT_CACHE_DIR") || readEnv("VF_CACHE_DIR") || undefined,
    disableLruInterval: readEnv("VF_DISABLE_LRU_INTERVAL") === "1",

    appUrl: readEnv("APP_URL") || readEnv("NEXT_PUBLIC_APP_URL") || undefined,

    port: portOverride ?? DEFAULTS.port,
    portSource: portOverride === undefined ? "default" : "environment",
    requestTimeoutMs: requestTimeoutRaw
      ? parseBoundedInteger(
        requestTimeoutRaw,
        DEFAULT_REQUEST_TIMEOUT_MS,
        1,
        MAX_TIMER_DELAY_MS,
      )
      : undefined,
    httpFetchTimeoutMs: httpFetchTimeoutRaw
      ? parseBoundedInteger(
        httpFetchTimeoutRaw,
        DEFAULT_HTTP_FETCH_TIMEOUT_MS,
        1,
        MAX_TIMER_DELAY_MS,
      )
      : undefined,
    extensionSetupTimeoutMs: extensionSetupTimeoutRaw
      ? parseBoundedInteger(extensionSetupTimeoutRaw, 30_000, 0, MAX_TIMER_DELAY_MS)
      : undefined,
    ssrMaxConcurrentTransforms: parseBoundedInteger(
      readEnv("SSR_MAX_CONCURRENT_TRANSFORMS"),
      DEFAULTS.ssrMaxConcurrentTransforms,
      0,
    ),

    otelEnabled: isTruthyEnvValue(readTelemetryEnv("VERYFRONT_OTEL")) ||
      isTruthyEnvValue(readTelemetryEnv("OTEL_TRACES_ENABLED")),
    otelServiceName: readTelemetryEnv("OTEL_SERVICE_NAME") || undefined,
    otelEndpoint: readTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || undefined,
    otelTracesEndpoint: readTelemetryEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") || undefined,
    otelMetricsEndpoint: readTelemetryEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") || undefined,
    otelTracesExporter: readTelemetryEnv("OTEL_TRACES_EXPORTER") || undefined,
    otelMetricsExporter: readTelemetryEnv("OTEL_METRICS_EXPORTER") || undefined,
    otelHeaders: readTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS") || undefined,
    otelMetricsEnabled: isTruthyEnvValue(readTelemetryEnv("OTEL_METRICS_ENABLED")),

    openaiApiKey: readEnv("OPENAI_API_KEY") || undefined,
    openaiBaseUrl: readEnv("OPENAI_BASE_URL") || undefined,
    anthropicApiKey: readEnv("ANTHROPIC_API_KEY") || undefined,
    anthropicBaseUrl: readEnv("ANTHROPIC_BASE_URL") || undefined,
    googleApiKey: readEnv("GOOGLE_API_KEY") ||
      readEnv("GOOGLE_GENERATIVE_AI_API_KEY") ||
      undefined,

    githubToken: readEnv("GITHUB_TOKEN") || undefined,
    githubOwner: readEnv("GITHUB_OWNER") || undefined,
    githubRepo: readEnv("GITHUB_REPO") || undefined,
    githubRef: readEnv("GITHUB_REF") || undefined,

    noColor: readEnv("NO_COLOR") !== undefined,
    forceColor: forceColorRaw !== undefined && forceColorRaw !== "" && forceColorRaw !== "0",

    denoV8Flags: readEnv("DENO_V8_FLAGS") ?? "",
    v8MaxOldSpaceSize: v8MaxOldSpaceSizeRaw
      ? parseBoundedInteger(v8MaxOldSpaceSizeRaw, 0, 1) || undefined
      : undefined,

    veryfrontVersion: readEnv("VERYFRONT_VERSION") || readEnv("RELEASE_VERSION") || undefined,
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
  const base = readEnvSnapshot(readEmptyEnv, readEmptyEnv, readEmptyEnv);
  const portSource = overrides.portSource ??
    (Object.hasOwn(overrides, "port") ? "environment" : base.portSource);

  return {
    ...base,
    nodeEnv: "test",
    veryfrontEnv: "test",
    debug: false,
    ci: false,
    denoTesting: false,
    ...overrides,
    portSource,
  };
}

export function _setEnvironmentConfigForTesting(env: Partial<EnvironmentConfig>): void {
  const base = _environmentConfig ??
    readEnvSnapshot(readEmptyEnv, readEmptyEnv, readEmptyEnv);
  const portSource = env.portSource ??
    (Object.hasOwn(env, "port") ? "environment" : base.portSource);
  _environmentConfig = Object.freeze({ ...base, ...env, portSource });
}

export function _resetEnvironmentConfig(): void {
  _environmentConfig = null;
  envConfigInitializedBeforeEnvLoad = false;
  warnedEarlyEnvConfig = false;
}
