import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  type NodeTelemetryInitializeOptions,
  type NodeTelemetryInstrumentationConfig,
  type NodeTelemetryLogger,
  type NodeTelemetryProcessTarget,
  type NodeTelemetryProvider,
  NodeTelemetryProviderName,
} from "#veryfront/extensions/observability/index.ts";

export type NodeHostedAgentServiceTelemetryEnv = Record<string, string | undefined>;

export type NodeAgentServiceTelemetryEnv = NodeHostedAgentServiceTelemetryEnv;

export type NodeHostedAgentServiceInstrumentationConfig = NodeTelemetryInstrumentationConfig;

export type NodeAgentServiceInstrumentationConfig = NodeHostedAgentServiceInstrumentationConfig;

export type NodeHostedAgentServiceTelemetryConfig = {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
  samplingRatio: number;
  exporterHeaders?: Record<string, string>;
  instrumentation: NodeHostedAgentServiceInstrumentationConfig;
};

export type NodeAgentServiceTelemetryConfig = NodeHostedAgentServiceTelemetryConfig;

export type ResolveNodeHostedAgentServiceTelemetryConfigOptions = {
  env: NodeHostedAgentServiceTelemetryEnv;
  defaultServiceName: string;
  defaultServiceVersion?: string;
  defaultEnabled?: boolean;
};

export type ResolveNodeAgentServiceTelemetryConfigOptions =
  ResolveNodeHostedAgentServiceTelemetryConfigOptions;

export type NodeHostedAgentServiceTelemetryLogger = NodeTelemetryLogger;

export type NodeAgentServiceTelemetryLogger = NodeHostedAgentServiceTelemetryLogger;

export type NodeHostedAgentServiceTelemetryProcessTarget = NodeTelemetryProcessTarget;

export type NodeAgentServiceTelemetryProcessTarget = NodeHostedAgentServiceTelemetryProcessTarget;

export type InitializeNodeHostedAgentServiceTelemetryOptions =
  & NodeHostedAgentServiceTelemetryConfig
  & {
    logger?: NodeHostedAgentServiceTelemetryLogger;
    processTarget?: NodeHostedAgentServiceTelemetryProcessTarget;
    telemetryProvider?: NodeTelemetryProvider;
  };

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

export async function initializeNodeAgentServiceOpenTelemetry(
  options: InitializeNodeAgentServiceTelemetryOptions,
): Promise<boolean> {
  return initializeNodeHostedAgentServiceOpenTelemetry(options);
}
