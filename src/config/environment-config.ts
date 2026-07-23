import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
import { getHostTelemetryEnv } from "#veryfront/observability/tracing/telemetry-env.ts";
import { isTruthyEnvValue } from "#veryfront/utils/constants/env.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { hasEnvLoaded } from "#veryfront/utils/env-loader.ts";
import { DEFAULT_PORT } from "./defaults.ts";

/** Immutable process-wide environment snapshot used by framework infrastructure. */
export interface EnvironmentConfig {
  /** Node-compatible runtime environment name. */
  nodeEnv: "development" | "production" | "test" | string;
  /** Veryfront environment name, defaulting to the runtime environment. */
  veryfrontEnv: string;
  /** Veryfront runtime mode. */
  veryfrontMode: string;
  /** Whether the process serves multiple projects through proxy mode. */
  proxyMode: boolean;

  /** Whether framework debug logging is enabled. */
  debug: boolean;
  /** Whether the standard CI flag is enabled. */
  ci: boolean;
  /** Whether the Deno-specific test flag is enabled. */
  denoTesting: boolean;
  /** Whether performance diagnostics are enabled. */
  perfEnabled: boolean;

  /** Base URL for Veryfront control-plane API requests. */
  apiBaseUrl: string;
  /** Public-facing API URL for browser-injected scripts (WebSocket URLs, etc.). */
  publicApiBaseUrl: string;
  /** Optional GraphQL API URL. */
  apiUrl: string | undefined;
  /** Optional process-wide API credential. */
  apiToken: string | undefined;
  /** Optional process-owned project slug. */
  projectSlug: string | undefined;

  /** Process home directory, when exposed by the host. */
  homeDir: string | undefined;
  /** XDG configuration directory, when configured. */
  xdgConfigHome: string | undefined;

  /** Whether the legacy continuous-integration flag is enabled. */
  continuousIntegration: boolean;
  /** SSH client metadata exposed by the host. */
  sshClient: string | undefined;
  /** SSH terminal metadata exposed by the host. */
  sshTty: string | undefined;
  /** X11 display identifier exposed by the host. */
  display: string | undefined;
  /** Wayland display identifier exposed by the host. */
  waylandDisplay: string | undefined;
  /** Cursor session identifier exposed by the host. */
  cursorSession: string | undefined;
  /** Process start timestamp supplied by the launcher. */
  serverStartTime: string | undefined;
  /** VCR mode supplied by the test environment. */
  vcr: string | undefined;

  /** Whether experimental React Server Components support is enabled. */
  experimentalRsc: boolean;

  /** Redis connection URL used by host-owned caches. */
  redisUrl: string | undefined;
  /** Filesystem cache directory override. */
  cacheDir: string | undefined;
  /** Whether periodic LRU maintenance is disabled. */
  disableLruInterval: boolean;

  /** Application URL supplied by the host. */
  appUrl: string | undefined;

  /** HTTP application port. */
  port: number;
  /** Whether `port` came from a valid explicit `PORT` environment value. */
  portFromEnv?: boolean;
  /** Incoming request timeout in milliseconds. */
  requestTimeoutMs: number | undefined;
  /** Outbound HTTP timeout in milliseconds. */
  httpFetchTimeoutMs: number | undefined;
  /** Extension setup timeout in milliseconds. */
  extensionSetupTimeoutMs: number | undefined;
  /** Maximum number of concurrent SSR transforms. */
  ssrMaxConcurrentTransforms: number;

  /** Whether OpenTelemetry tracing is enabled. */
  otelEnabled: boolean;
  /** OpenTelemetry service name. */
  otelServiceName: string | undefined;
  /** Shared OpenTelemetry exporter endpoint. */
  otelEndpoint: string | undefined;
  /** OpenTelemetry traces endpoint. */
  otelTracesEndpoint: string | undefined;
  /** OpenTelemetry metrics endpoint. */
  otelMetricsEndpoint: string | undefined;
  /** OpenTelemetry traces exporter selection. */
  otelTracesExporter: string | undefined;
  /** OpenTelemetry metrics exporter selection. */
  otelMetricsExporter: string | undefined;
  /** Shared OpenTelemetry exporter headers. */
  otelHeaders: string | undefined;
  /** OpenTelemetry trace exporter headers. */
  otelTracesHeaders: string | undefined;
  /** OpenTelemetry metrics exporter headers. */
  otelMetricsHeaders: string | undefined;
  /** Whether OpenTelemetry metrics are enabled. */
  otelMetricsEnabled: boolean;

  /** Process-wide OpenAI API credential. */
  openaiApiKey: string | undefined;
  /** Process-wide OpenAI-compatible base URL. */
  openaiBaseUrl: string | undefined;
  /** Process-wide Anthropic API credential. */
  anthropicApiKey: string | undefined;
  /** Process-wide Anthropic-compatible base URL. */
  anthropicBaseUrl: string | undefined;
  /** Process-wide Google AI API credential. */
  googleApiKey: string | undefined;

  /** Process-wide GitHub API credential. */
  githubToken: string | undefined;
  /** Default GitHub repository owner. */
  githubOwner: string | undefined;
  /** Default GitHub repository name. */
  githubRepo: string | undefined;
  /** Default GitHub revision. */
  githubRef: string | undefined;

  /** Whether ANSI colors are disabled. */
  noColor: boolean;
  /** Whether ANSI colors are forced. */
  forceColor: boolean;

  /** V8 flags passed through to Deno subprocesses. */
  denoV8Flags: string;
  /** V8 maximum old-space size in megabytes. */
  v8MaxOldSpaceSize: number | undefined;

  /** Framework version supplied by the release environment. */
  veryfrontVersion: string | undefined;
}

/** Default timeout for incoming HTTP requests (used when REQUEST_TIMEOUT_MS is set but unparseable) */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default timeout for outgoing HTTP fetch calls (used when VF_HTTP_FETCH_TIMEOUT is set but unparseable) */
const DEFAULT_HTTP_FETCH_TIMEOUT_MS = 30_000;
const MAX_PORT = 65_535;

const DEFAULTS = {
  apiBaseUrl: "https://api.veryfront.com",
  port: DEFAULT_PORT,
  ssrMaxConcurrentTransforms: 3,
} as const;

let _environmentConfig: EnvironmentConfig | null = null;
let warnedEarlyEnvConfig = false;

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  return parsePositiveIntegerValue(value, maximum) ?? defaultValue;
}

function parsePositiveIntegerValue(
  value: string | undefined,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (value === undefined || !/^[0-9]+$/.test(value)) return undefined;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : undefined;
}

function readEnvSnapshot(): EnvironmentConfig {
  const nodeEnv = getHostEnv("NODE_ENV") ?? getHostEnv("DENO_ENV") ?? "development";
  const veryfrontEnv = getHostEnv("VERYFRONT_ENV") ?? nodeEnv;

  const requestTimeoutRaw = getHostEnv("REQUEST_TIMEOUT_MS");
  const httpFetchTimeoutRaw = getHostEnv("VF_HTTP_FETCH_TIMEOUT");
  const extensionSetupTimeoutRaw = getHostEnv("VF_EXTENSION_SETUP_TIMEOUT_MS");
  const v8MaxOldSpaceSizeRaw = getHostEnv("V8_MAX_OLD_SPACE_SIZE");
  const portRaw = getHostEnv("PORT");
  const explicitPort = parsePositiveIntegerValue(portRaw, MAX_PORT);
  const port = explicitPort ?? DEFAULTS.port;
  const portFromEnv = explicitPort !== undefined;

  const apiUrl = getHostEnv("VERYFRONT_API_URL") || undefined;

  return {
    nodeEnv,
    veryfrontEnv,
    veryfrontMode: getHostEnv("VERYFRONT_MODE") ?? "development",
    proxyMode: isTruthyEnvValue(getHostEnv("PROXY_MODE")),

    debug: isTruthyEnvValue(getHostEnv("VERYFRONT_DEBUG")),
    ci: isTruthyEnvValue(getHostEnv("CI")),
    denoTesting: isTruthyEnvValue(getHostEnv("DENO_TESTING")),
    perfEnabled: isTruthyEnvValue(getHostEnv("VERYFRONT_PERF")),

    apiBaseUrl: getHostEnv("VERYFRONT_API_BASE_URL") ||
      apiUrl?.replace("/graphql", "/api") ||
      DEFAULTS.apiBaseUrl,
    publicApiBaseUrl: getHostEnv("VERYFRONT_PUBLIC_API_BASE_URL") ||
      DEFAULTS.apiBaseUrl,
    apiUrl,
    apiToken: getHostEnv("VERYFRONT_API_TOKEN") || undefined,
    projectSlug: getHostEnv("VERYFRONT_PROJECT_SLUG") || undefined,

    homeDir: getHostEnv("HOME") || getHostEnv("USERPROFILE") || undefined,
    xdgConfigHome: getHostEnv("XDG_CONFIG_HOME") || undefined,

    continuousIntegration: isTruthyEnvValue(getHostEnv("CONTINUOUS_INTEGRATION")),
    sshClient: getHostEnv("SSH_CLIENT") || undefined,
    sshTty: getHostEnv("SSH_TTY") || undefined,
    display: getHostEnv("DISPLAY") || undefined,
    waylandDisplay: getHostEnv("WAYLAND_DISPLAY") || undefined,
    cursorSession: getHostEnv("CURSOR_SESSION") || undefined,
    serverStartTime: getHostEnv("VERYFRONT_SERVER_START_TIME") || undefined,
    vcr: getHostEnv("VCR") || undefined,

    experimentalRsc: isTruthyEnvValue(getHostEnv("VERYFRONT_EXPERIMENTAL_RSC")),

    redisUrl: getHostEnv("REDIS_URL") || undefined,
    cacheDir: getHostEnv("VERYFRONT_CACHE_DIR") || getHostEnv("VF_CACHE_DIR") || undefined,
    disableLruInterval: isTruthyEnvValue(getHostEnv("VF_DISABLE_LRU_INTERVAL")),

    appUrl: getHostEnv("APP_URL") || getHostEnv("NEXT_PUBLIC_APP_URL") || undefined,

    port,
    portFromEnv,
    requestTimeoutMs: requestTimeoutRaw
      ? parsePositiveInteger(requestTimeoutRaw, DEFAULT_REQUEST_TIMEOUT_MS)
      : undefined,
    httpFetchTimeoutMs: httpFetchTimeoutRaw
      ? parsePositiveInteger(httpFetchTimeoutRaw, DEFAULT_HTTP_FETCH_TIMEOUT_MS)
      : undefined,
    extensionSetupTimeoutMs: extensionSetupTimeoutRaw
      ? parsePositiveInteger(extensionSetupTimeoutRaw, 30_000)
      : undefined,
    ssrMaxConcurrentTransforms: parsePositiveInteger(
      getHostEnv("SSR_MAX_CONCURRENT_TRANSFORMS"),
      DEFAULTS.ssrMaxConcurrentTransforms,
    ),

    otelEnabled: isTruthyEnvValue(getHostTelemetryEnv("VERYFRONT_OTEL")) ||
      isTruthyEnvValue(getHostTelemetryEnv("OTEL_TRACES_ENABLED")),
    otelServiceName: getHostTelemetryEnv("OTEL_SERVICE_NAME") || undefined,
    otelEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || undefined,
    otelTracesEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") || undefined,
    otelMetricsEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") || undefined,
    otelTracesExporter: getHostTelemetryEnv("OTEL_TRACES_EXPORTER") || undefined,
    otelMetricsExporter: getHostTelemetryEnv("OTEL_METRICS_EXPORTER") || undefined,
    otelHeaders: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS") || undefined,
    otelTracesHeaders: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_TRACES_HEADERS") || undefined,
    otelMetricsHeaders: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_METRICS_HEADERS") || undefined,
    otelMetricsEnabled: isTruthyEnvValue(getHostTelemetryEnv("OTEL_METRICS_ENABLED")),

    openaiApiKey: getHostEnv("OPENAI_API_KEY") || undefined,
    openaiBaseUrl: getHostEnv("OPENAI_BASE_URL") || undefined,
    anthropicApiKey: getHostEnv("ANTHROPIC_API_KEY") || undefined,
    anthropicBaseUrl: getHostEnv("ANTHROPIC_BASE_URL") || undefined,
    googleApiKey: getHostEnv("GOOGLE_API_KEY") || getHostEnv("GOOGLE_GENERATIVE_AI_API_KEY") ||
      undefined,

    githubToken: getHostEnv("GITHUB_TOKEN") || undefined,
    githubOwner: getHostEnv("GITHUB_OWNER") || undefined,
    githubRepo: getHostEnv("GITHUB_REPO") || undefined,
    githubRef: getHostEnv("GITHUB_REF") || undefined,

    noColor: getHostEnv("NO_COLOR") !== undefined,
    forceColor: isTruthyEnvValue(getHostEnv("FORCE_COLOR")),

    denoV8Flags: getHostEnv("DENO_V8_FLAGS") ?? "",
    v8MaxOldSpaceSize: v8MaxOldSpaceSizeRaw
      ? parsePositiveInteger(v8MaxOldSpaceSizeRaw, 0) || undefined
      : undefined,

    veryfrontVersion: getHostEnv("VERYFRONT_VERSION") || getHostEnv("RELEASE_VERSION") || undefined,
  };
}

function readFrozenEnvSnapshot(): EnvironmentConfig {
  return Object.freeze(readEnvSnapshot());
}

/** Initialize and cache the host environment snapshot after environment loading. */
export function initEnvironmentConfig(): EnvironmentConfig {
  if (_environmentConfig) return _environmentConfig;

  if (!hasEnvLoaded()) {
    return readFrozenEnvSnapshot();
  }

  _environmentConfig = readFrozenEnvSnapshot();
  return _environmentConfig;
}

/** Replace the cached host environment snapshot with current host values. */
export function refreshEnvironmentConfig(): EnvironmentConfig {
  _environmentConfig = readFrozenEnvSnapshot();
  return _environmentConfig;
}

function warnEarlyAccess(): void {
  if (warnedEarlyEnvConfig) return;
  warnedEarlyEnvConfig = true;

  const message = "[EnvironmentConfig] getEnvironmentConfig called before .env load. " +
    "Returning uncached snapshot; ensure loadEnv runs before environment config access.";
  logger.warn(message);
}

/** Return the cached host snapshot, or an uncached snapshot before environment loading. */
export function getEnvironmentConfig(): EnvironmentConfig {
  if (_environmentConfig) {
    return _environmentConfig;
  }

  // Env not loaded yet - return uncached snapshot with warning
  if (!hasEnvLoaded()) {
    warnEarlyAccess();
    return readFrozenEnvSnapshot();
  }

  return initEnvironmentConfig();
}

/** Return whether a host environment snapshot is currently cached. */
export function isEnvironmentConfigInitialized(): boolean {
  return _environmentConfig !== null;
}

export function createTestEnvironmentConfig(
  overrides: Partial<EnvironmentConfig> = {},
): EnvironmentConfig {
  const base = _environmentConfig ?? readEnvSnapshot();
  const portFromEnv = Object.hasOwn(overrides, "port") ? true : base.portFromEnv;

  return Object.freeze({
    ...base,
    nodeEnv: "test",
    debug: false,
    ci: false,
    denoTesting: false,
    portFromEnv,
    ...overrides,
  });
}

export function _setEnvironmentConfigForTesting(env: Partial<EnvironmentConfig>): void {
  const base = _environmentConfig ?? readEnvSnapshot();
  const portFromEnv = Object.hasOwn(env, "port") ? true : base.portFromEnv;
  _environmentConfig = Object.freeze({ ...base, portFromEnv, ...env });
}

export function _resetEnvironmentConfig(): void {
  _environmentConfig = null;
  warnedEarlyEnvConfig = false;
}

registerProcessStateReset("environment config", _resetEnvironmentConfig);
