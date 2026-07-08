import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  type NodeTelemetryInitializeOptions,
  type NodeTelemetryInstrumentationConfig,
  type NodeTelemetryLogger,
  type NodeTelemetryLogRecordEmitter,
  type NodeTelemetryProcessTarget,
  type NodeTelemetryProvider,
  NodeTelemetryProviderName,
} from "#veryfront/extensions/observability/index.ts";
import { VERSION } from "#veryfront/utils/version.ts";

/** Public API contract for node hosted agent service telemetry env. */
export type NodeHostedAgentServiceTelemetryEnv = Record<string, string | undefined>;

/** Public API contract for node agent service telemetry env. */
export type NodeAgentServiceTelemetryEnv = NodeHostedAgentServiceTelemetryEnv;

/** Configuration used by node hosted agent service instrumentation. */
export type NodeHostedAgentServiceInstrumentationConfig = NodeTelemetryInstrumentationConfig;

/** Configuration used by node agent service instrumentation. */
export type NodeAgentServiceInstrumentationConfig = NodeHostedAgentServiceInstrumentationConfig;

/** Configuration used by node hosted agent service telemetry. */
export type NodeHostedAgentServiceTelemetryConfig = {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
  samplingRatio: number;
  exporterHeaders?: Record<string, string>;
  tracesEnabled: boolean;
  metricsEnabled: boolean;
  logsEnabled: boolean;
  tracesEndpoint?: string;
  metricsEndpoint?: string;
  logsEndpoint?: string;
  tracesHeaders?: Record<string, string>;
  metricsHeaders?: Record<string, string>;
  logsHeaders?: Record<string, string>;
  metricsExportIntervalMillis: number;
  metricsTemporalityPreference: "delta" | "cumulative" | "lowmemory";
  instrumentation: NodeHostedAgentServiceInstrumentationConfig;
};

/** Configuration used by node agent service telemetry. */
export type NodeAgentServiceTelemetryConfig = NodeHostedAgentServiceTelemetryConfig;

/** Options accepted by resolve node hosted agent service telemetry config. */
export type ResolveNodeHostedAgentServiceTelemetryConfigOptions = {
  env: NodeHostedAgentServiceTelemetryEnv;
  defaultServiceName: string;
  defaultServiceVersion?: string;
  defaultEnabled?: boolean;
};

/** Options accepted by resolve node agent service telemetry config. */
export type ResolveNodeAgentServiceTelemetryConfigOptions =
  ResolveNodeHostedAgentServiceTelemetryConfigOptions;

/** Public API contract for node hosted agent service telemetry logger. */
export type NodeHostedAgentServiceTelemetryLogger = NodeTelemetryLogger;

/** Public API contract for node agent service telemetry logger. */
export type NodeAgentServiceTelemetryLogger = NodeHostedAgentServiceTelemetryLogger;

/** Public API contract for node hosted agent service telemetry process target. */
export type NodeHostedAgentServiceTelemetryProcessTarget = NodeTelemetryProcessTarget;

/** Public API contract for node agent service telemetry process target. */
export type NodeAgentServiceTelemetryProcessTarget = NodeHostedAgentServiceTelemetryProcessTarget;

/** Options accepted by initialize node hosted agent service telemetry. */
export type InitializeNodeHostedAgentServiceTelemetryOptions =
  & NodeHostedAgentServiceTelemetryConfig
  & {
    logger?: NodeHostedAgentServiceTelemetryLogger;
    processTarget?: NodeHostedAgentServiceTelemetryProcessTarget;
    telemetryProvider?: NodeTelemetryProvider;
    registerLogRecordEmitter?: (emitter: NodeTelemetryLogRecordEmitter) => void;
  };

/** Options accepted by initialize node agent service telemetry. */
export type InitializeNodeAgentServiceTelemetryOptions =
  InitializeNodeHostedAgentServiceTelemetryOptions;

function resolveEnabled(env: NodeHostedAgentServiceTelemetryEnv, defaultEnabled: boolean): boolean {
  const envValue = env.OTEL_ENABLED;
  if (envValue !== undefined) {
    return envValue !== "false" && envValue !== "0";
  }
  return defaultEnabled;
}

function isTruthySignalFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true" || value === "1";
}

function exporterIncludesOtlp(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return false;
  return value.split(",").map((part) => part.trim()).includes("otlp");
}

function resolveTraceSignalEnabled(
  env: NodeHostedAgentServiceTelemetryEnv,
  defaultEnabled: boolean,
): boolean {
  const enabledFlag = isTruthySignalFlag(env.OTEL_TRACES_ENABLED);
  if (enabledFlag !== undefined) return enabledFlag;
  const exporterFlag = exporterIncludesOtlp(env.OTEL_TRACES_EXPORTER);
  if (exporterFlag !== undefined) return exporterFlag;
  return defaultEnabled;
}

function resolveMetricSignalEnabled(env: NodeHostedAgentServiceTelemetryEnv): boolean {
  const enabledFlag = isTruthySignalFlag(env.OTEL_METRICS_ENABLED);
  if (enabledFlag !== undefined) return enabledFlag;
  return exporterIncludesOtlp(env.OTEL_METRICS_EXPORTER) ?? false;
}

function resolveLogSignalEnabled(env: NodeHostedAgentServiceTelemetryEnv): boolean {
  const enabledFlag = isTruthySignalFlag(env.OTEL_LOGS_ENABLED);
  if (enabledFlag !== undefined) return enabledFlag;
  return exporterIncludesOtlp(env.OTEL_LOGS_EXPORTER) ?? false;
}

function resolveSamplingRatio(env: NodeHostedAgentServiceTelemetryEnv): number {
  const ratio = Number.parseFloat(env.OTEL_SAMPLING_RATIO ?? "");
  if (Number.isNaN(ratio)) return 1.0;
  return Math.min(Math.max(ratio, 0), 1);
}

function parseResourceAttributes(value: string | undefined): Record<string, string> {
  if (!value) return {};

  const attributes: Record<string, string> = {};
  for (const part of value.split(",")) {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = rawKey?.trim();
    if (!key || rawValueParts.length === 0) continue;
    const rawValue = rawValueParts.join("=").trim();
    attributes[key] = rawValue;
  }
  return attributes;
}

function resolveServiceName(
  env: NodeHostedAgentServiceTelemetryEnv,
  defaultServiceName: string,
): string {
  const resourceAttributes = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
  return env.OTEL_SERVICE_NAME ?? resourceAttributes["service.name"] ?? env.DD_SERVICE ??
    defaultServiceName;
}

function resolveServiceVersion(
  env: NodeHostedAgentServiceTelemetryEnv,
  defaultServiceVersion: string | undefined,
): string {
  const resourceAttributes = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
  return resourceAttributes["service.version"] ??
    env.OTEL_SERVICE_VERSION ??
    env.DD_VERSION ??
    env.VERYFRONT_VERSION ??
    env.RELEASE_VERSION ??
    env.npm_package_version ??
    defaultServiceVersion ??
    VERSION;
}

function resolveDeploymentEnvironment(env: NodeHostedAgentServiceTelemetryEnv): string {
  const resourceAttributes = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
  return resourceAttributes["deployment.environment.name"] ??
    resourceAttributes["deployment.environment"] ??
    env.OTEL_DEPLOYMENT_ENVIRONMENT ??
    env.DD_ENV ??
    env.APP_ENVIRONMENT ??
    env.VERYFRONT_ENVIRONMENT ??
    env.NODE_ENV ??
    "development";
}

function parseExporterHeaders(headersEnv: string | undefined): Record<string, string> | undefined {
  if (!headersEnv) return undefined;

  const headers: Record<string, string> = {};

  if (headersEnv.startsWith("Basic ")) {
    headers.Authorization = headersEnv;
  } else {
    for (const part of headersEnv.split(",")) {
      const [key, ...valueParts] = part.split("=");
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join("=").trim();
      }
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function mergeHeaders(
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}

function resolveSignalHeaders(
  env: NodeHostedAgentServiceTelemetryEnv,
  signal: "TRACES" | "METRICS" | "LOGS",
): Record<string, string> | undefined {
  return mergeHeaders(
    parseExporterHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    parseExporterHeaders(env[`OTEL_EXPORTER_OTLP_${signal}_HEADERS`]),
  );
}

function resolveOtlpSignalEndpoint(
  endpoint: string | undefined,
  signal: "traces" | "metrics" | "logs",
): string | undefined {
  if (!endpoint) return undefined;
  const trimmed = endpoint.replace(/\/$/, "");
  const suffix = `/v1/${signal}`;
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}

function resolveMetricsExportIntervalMillis(env: NodeHostedAgentServiceTelemetryEnv): number {
  const value = Number.parseInt(env.OTEL_METRIC_EXPORT_INTERVAL ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

function resolveMetricsTemporalityPreference(
  env: NodeHostedAgentServiceTelemetryEnv,
): "delta" | "cumulative" | "lowmemory" {
  const value = env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE?.toLowerCase();
  if (value === "cumulative" || value === "lowmemory") return value;
  return "delta";
}

function resolveInstrumentationConfig(
  env: NodeHostedAgentServiceTelemetryEnv,
): NodeHostedAgentServiceInstrumentationConfig {
  return {
    http: env.OTEL_INSTRUMENTATION_HTTP !== "false",
    express: env.OTEL_INSTRUMENTATION_EXPRESS !== "false",
    fs: env.OTEL_INSTRUMENTATION_FS === "true",
  };
}

/** Configuration used by resolve node hosted agent service telemetry. */
export function resolveNodeHostedAgentServiceTelemetryConfig(
  options: ResolveNodeHostedAgentServiceTelemetryConfigOptions,
): NodeHostedAgentServiceTelemetryConfig {
  const defaultEnabled = options.defaultEnabled ?? options.env.NODE_ENV === "production";
  const tracesEnabled = resolveTraceSignalEnabled(
    options.env,
    resolveEnabled(options.env, defaultEnabled),
  );
  const metricsEnabled = resolveMetricSignalEnabled(options.env);
  const logsEnabled = resolveLogSignalEnabled(options.env);
  const baseEndpoint = options.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const exporterHeaders = parseExporterHeaders(options.env.OTEL_EXPORTER_OTLP_HEADERS);

  return {
    enabled: tracesEnabled || metricsEnabled || logsEnabled,
    serviceName: resolveServiceName(options.env, options.defaultServiceName),
    serviceVersion: resolveServiceVersion(options.env, options.defaultServiceVersion),
    deploymentEnvironment: resolveDeploymentEnvironment(options.env),
    samplingRatio: resolveSamplingRatio(options.env),
    exporterHeaders,
    tracesEnabled,
    metricsEnabled,
    logsEnabled,
    tracesEndpoint: resolveOtlpSignalEndpoint(
      options.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? baseEndpoint,
      "traces",
    ),
    metricsEndpoint: resolveOtlpSignalEndpoint(
      options.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? baseEndpoint,
      "metrics",
    ),
    logsEndpoint: resolveOtlpSignalEndpoint(
      options.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? baseEndpoint,
      "logs",
    ),
    tracesHeaders: resolveSignalHeaders(options.env, "TRACES"),
    metricsHeaders: resolveSignalHeaders(options.env, "METRICS"),
    logsHeaders: resolveSignalHeaders(options.env, "LOGS"),
    metricsExportIntervalMillis: resolveMetricsExportIntervalMillis(options.env),
    metricsTemporalityPreference: resolveMetricsTemporalityPreference(options.env),
    instrumentation: resolveInstrumentationConfig(options.env),
  };
}

/** Configuration used by resolve node agent service telemetry. */
export function resolveNodeAgentServiceTelemetryConfig(
  options: ResolveNodeAgentServiceTelemetryConfigOptions,
): NodeAgentServiceTelemetryConfig {
  return resolveNodeHostedAgentServiceTelemetryConfig(options);
}

function logInfo(
  logger: NodeHostedAgentServiceTelemetryLogger | undefined,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  if (logger) {
    logger.info(message, metadata);
    return;
  }
  console.log(JSON.stringify({ level: "info", msg: message, ...metadata }));
}

function logError(
  logger: NodeHostedAgentServiceTelemetryLogger | undefined,
  message: string,
  error: unknown,
): void {
  if (logger) {
    logger.error(message, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  console.error(
    JSON.stringify({
      level: "error",
      msg: message,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** Initialize node hosted agent service open telemetry. */
export async function initializeNodeHostedAgentServiceOpenTelemetry(
  options: InitializeNodeHostedAgentServiceTelemetryOptions,
): Promise<boolean> {
  if (!options.enabled) {
    logInfo(options.logger, "OpenTelemetry disabled");
    return false;
  }

  try {
    const telemetryProvider = options.telemetryProvider ??
      tryResolve<NodeTelemetryProvider>(NodeTelemetryProviderName);
    if (!telemetryProvider) {
      logError(
        options.logger,
        "Failed to initialize OpenTelemetry",
        'Missing extension for contract "NodeTelemetryProvider"',
      );
      return false;
    }

    const initializeOptions: NodeTelemetryInitializeOptions = {
      serviceName: options.serviceName,
      serviceVersion: options.serviceVersion,
      deploymentEnvironment: options.deploymentEnvironment,
      samplingRatio: options.samplingRatio,
      exporterHeaders: options.exporterHeaders,
      tracesEnabled: options.tracesEnabled,
      metricsEnabled: options.metricsEnabled,
      logsEnabled: options.logsEnabled,
      tracesEndpoint: options.tracesEndpoint,
      metricsEndpoint: options.metricsEndpoint,
      logsEndpoint: options.logsEndpoint,
      tracesHeaders: options.tracesHeaders,
      metricsHeaders: options.metricsHeaders,
      logsHeaders: options.logsHeaders,
      metricsExportIntervalMillis: options.metricsExportIntervalMillis,
      metricsTemporalityPreference: options.metricsTemporalityPreference,
      instrumentation: options.instrumentation,
      logger: options.logger,
      processTarget: options.processTarget,
      registerLogRecordEmitter: options.registerLogRecordEmitter,
    };

    return await telemetryProvider.initialize(initializeOptions);
  } catch (error) {
    logError(options.logger, "Failed to initialize OpenTelemetry", error);
    return false;
  }
}

/** Initialize node agent service open telemetry. */
export async function initializeNodeAgentServiceOpenTelemetry(
  options: InitializeNodeAgentServiceTelemetryOptions,
): Promise<boolean> {
  return initializeNodeHostedAgentServiceOpenTelemetry(options);
}
