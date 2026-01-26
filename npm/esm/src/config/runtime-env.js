import { getEnv } from "../platform/compat/process.js";
import { isTruthyEnvValue } from "../utils/constants/env.js";
const DEFAULTS = {
    apiBaseUrl: "http://api.lvh.me:4000",
    port: 3001,
    ssrMaxConcurrentTransforms: 3,
};
let _runtimeEnv = null;
function parseNumber(value, defaultVal) {
    if (!value)
        return defaultVal;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultVal;
}
function readEnvSnapshot() {
    const nodeEnv = getEnv("NODE_ENV") || getEnv("DENO_ENV") || "development";
    const veryfrontEnv = getEnv("VERYFRONT_ENV") || nodeEnv;
    const requestTimeoutRaw = getEnv("REQUEST_TIMEOUT_MS");
    const httpFetchTimeoutRaw = getEnv("VF_HTTP_FETCH_TIMEOUT");
    const v8MaxOldSpaceSizeRaw = getEnv("V8_MAX_OLD_SPACE_SIZE");
    return {
        nodeEnv,
        veryfrontEnv,
        veryfrontMode: getEnv("VERYFRONT_MODE") || "development",
        debug: isTruthyEnvValue(getEnv("VERYFRONT_DEBUG")),
        ci: getEnv("CI") === "1",
        denoTesting: getEnv("DENO_TESTING") === "1",
        perfEnabled: getEnv("VERYFRONT_PERF") === "1",
        apiBaseUrl: getEnv("VERYFRONT_API_BASE_URL") ||
            getEnv("VERYFRONT_API_URL")?.replace("/graphql", "/api") ||
            DEFAULTS.apiBaseUrl,
        apiUrl: getEnv("VERYFRONT_API_URL") || undefined,
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
        requestTimeoutMs: requestTimeoutRaw ? parseNumber(requestTimeoutRaw, 30000) : undefined,
        httpFetchTimeoutMs: httpFetchTimeoutRaw ? parseNumber(httpFetchTimeoutRaw, 30000) : undefined,
        ssrMaxConcurrentTransforms: parseNumber(getEnv("SSR_MAX_CONCURRENT_TRANSFORMS"), DEFAULTS.ssrMaxConcurrentTransforms),
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
        veryfrontVersion: getEnv("VERYFRONT_VERSION") || undefined,
    };
}
export function initRuntimeEnv() {
    if (_runtimeEnv)
        return _runtimeEnv;
    _runtimeEnv = Object.freeze(readEnvSnapshot());
    return _runtimeEnv;
}
export function getRuntimeEnv() {
    return _runtimeEnv ?? initRuntimeEnv();
}
export function isRuntimeEnvInitialized() {
    return _runtimeEnv !== null;
}
export function createTestRuntimeEnv(overrides = {}) {
    const base = _runtimeEnv ?? readEnvSnapshot();
    return {
        ...base,
        nodeEnv: "test",
        debug: false,
        ci: false,
        denoTesting: false,
        ...overrides,
    };
}
export function _setRuntimeEnvForTesting(env) {
    const base = _runtimeEnv ?? readEnvSnapshot();
    _runtimeEnv = Object.freeze({ ...base, ...env });
}
export function _resetRuntimeEnv() {
    _runtimeEnv = null;
}
