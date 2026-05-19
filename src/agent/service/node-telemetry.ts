import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  type NodeTelemetryInitializeOptions,
  type NodeTelemetryInstrumentationConfig,
  type NodeTelemetryLogger,
  type NodeTelemetryProcessTarget,
  type NodeTelemetryProvider,
  NodeTelemetryProviderName,
} from "#veryfront/extensions/observability/index.ts";

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

function resolveSamplingRatio(env: NodeHostedAgentServiceTelemetryEnv): number {
  const ratio = Number.parseFloat(env.OTEL_SAMPLING_RATIO ?? "");
  if (Number.isNaN(ratio)) return 1.0;
  return Math.min(Math.max(ratio, 0), 1);
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

  return {
    enabled: resolveEnabled(options.env, defaultEnabled),
    serviceName: options.env.OTEL_SERVICE_NAME ?? options.defaultServiceName,
    serviceVersion: options.env.npm_package_version ?? options.defaultServiceVersion ?? "0.1.0",
    deploymentEnvironment: options.env.NODE_ENV ?? "development",
    samplingRatio: resolveSamplingRatio(options.env),
    exporterHeaders: parseExporterHeaders(options.env.OTEL_EXPORTER_OTLP_HEADERS),
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
      instrumentation: options.instrumentation,
      logger: options.logger,
      processTarget: options.processTarget,
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
