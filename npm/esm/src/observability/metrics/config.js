import { memoryUsage as platformMemoryUsage } from "../../platform/compat/process.js";
import { getOtelMetricsConfig } from "../../config/env.js";
const DEFAULT_METRICS_COLLECT_INTERVAL_MS = 60000;
export const DEFAULT_CONFIG = {
    enabled: false,
    exporter: "console",
    prefix: "veryfront",
    collectInterval: DEFAULT_METRICS_COLLECT_INTERVAL_MS,
    debug: false,
};
function getEnvVar(env, key) {
    const envObj = env;
    const getter = envObj?.get;
    if (typeof getter === "function") {
        return getter(key);
    }
    const value = envObj?.[key];
    return typeof value === "string" ? value : undefined;
}
function isValidExporter(exporter) {
    return exporter === "prometheus" || exporter === "otlp" ||
        exporter === "console";
}
export function loadConfig(config, adapter) {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const applyEnvConfig = (opts) => {
        finalConfig.enabled = opts.enabledFlag === "true" ||
            opts.veryfrontFlag === "1" ||
            finalConfig.enabled;
        finalConfig.endpoint = opts.endpoint || opts.metricsEndpoint ||
            finalConfig.endpoint;
        if (isValidExporter(opts.exporter)) {
            finalConfig.exporter = opts.exporter;
        }
    };
    if (adapter?.env) {
        const env = adapter.env;
        applyEnvConfig({
            enabledFlag: getEnvVar(env, "OTEL_METRICS_ENABLED"),
            veryfrontFlag: getEnvVar(env, "VERYFRONT_OTEL"),
            endpoint: getEnvVar(env, "OTEL_EXPORTER_OTLP_ENDPOINT"),
            metricsEndpoint: getEnvVar(env, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
            exporter: getEnvVar(env, "OTEL_METRICS_EXPORTER"),
        });
        return finalConfig;
    }
    try {
        const metricsConfig = getOtelMetricsConfig();
        applyEnvConfig({
            enabledFlag: metricsConfig.enabledFlag,
            veryfrontFlag: metricsConfig.veryfrontFlag,
            endpoint: metricsConfig.endpoint,
            metricsEndpoint: metricsConfig.metricsEndpoint,
            exporter: metricsConfig.exporter,
        });
    }
    catch {
        // getEnv access may fail, silently continue
    }
    return finalConfig;
}
export function getMemoryUsage() {
    try {
        return platformMemoryUsage();
    }
    catch {
        return null;
    }
}
