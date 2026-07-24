/**
 * ext-observability-opentelemetry: OpenTelemetry observability extension backed by the
 * official OpenTelemetry JS SDK.
 *
 * Provides the `TracingExporter` and `NodeTelemetryProvider` contracts:
 *  - `start(config)`: builds the SDK provider and OTLP HTTP exporter
 *  - `export(spans)`: no-op, the SDK handles export via BatchSpanProcessor
 *  - `shutdown()`: flushes and shuts down the provider
 *  - `getProvider()`: returns the SDK TracerProvider for shim wiring
 *  - `initialize(options)`: starts NodeSDK auto-instrumentation
 *
 * Configuration is read from standard OTEL environment variables.
 *
 * @module extensions/ext-observability-opentelemetry
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type {
  NodeTelemetryInitializeOptions,
  NodeTelemetryLogRecord,
  NodeTelemetryProvider,
  SpanData,
  TracingExporter,
} from "veryfront/extensions/observability";
import { VERSION } from "veryfront/utils";

/**
 * The TracerProvider interface as expected by the core shim.
 * Using structural typing because the real SDK provider satisfies this shape.
 */
interface ShimTracerProvider {
  getTracer(name: string, version?: string): unknown;
}

type OpenTelemetryRuntime = {
  api: typeof import("@opentelemetry/api");
  autoInstrumentations: typeof import("@opentelemetry/auto-instrumentations-node");
  apiLogs: typeof import("@opentelemetry/api-logs");
  core: typeof import("@opentelemetry/core");
  contextAsyncHooks: typeof import("@opentelemetry/context-async-hooks");
  logsExporter: typeof import("@opentelemetry/exporter-logs-otlp-http");
  sdkNode: typeof import("@opentelemetry/sdk-node");
  sdkLogs: typeof import("@opentelemetry/sdk-logs");
  metricsExporter: typeof import("@opentelemetry/exporter-metrics-otlp-http");
  sdkMetrics: typeof import("@opentelemetry/sdk-metrics");
  sdkTraceBase: typeof import("@opentelemetry/sdk-trace-base");
  traceExporter: typeof import("@opentelemetry/exporter-trace-otlp-http");
  resources: typeof import("@opentelemetry/resources");
  semanticConventions: typeof import("@opentelemetry/semantic-conventions");
};

type SdkMeterProvider = InstanceType<
  typeof import("@opentelemetry/sdk-metrics").MeterProvider
>;
type SdkTracerProvider = InstanceType<
  typeof import("@opentelemetry/sdk-trace-base").BasicTracerProvider
>;
type SdkLoggerProvider = InstanceType<
  typeof import("@opentelemetry/sdk-logs").LoggerProvider
>;
type MetricsAPI = { getMeter(name: string | undefined, version?: string): unknown };
type TraceAPI = {
  getActiveSpan(): unknown;
  getSpan(ctx: unknown): unknown;
  setSpan(ctx: unknown, span: unknown): unknown;
};
type ContextAPI = {
  active(): unknown;
  with<T>(ctx: unknown, fn: () => T): T;
};

const NOOP_SPAN = {
  setAttribute() {
    return NOOP_SPAN;
  },
  setAttributes() {
    return NOOP_SPAN;
  },
  setStatus() {
    return NOOP_SPAN;
  },
  recordException() {},
  addEvent() {
    return NOOP_SPAN;
  },
  end() {},
  spanContext() {
    return {
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
      traceFlags: 0,
    };
  },
  updateName() {},
};

const NOOP_TRACER = {
  startSpan() {
    return NOOP_SPAN;
  },
  startActiveSpan(
    _name: string,
    optionsOrFn:
      | { kind?: number; attributes?: Record<string, string | number | boolean | undefined> }
      | ((span: typeof NOOP_SPAN) => unknown),
    contextOrFn?: unknown,
    fn?: (span: typeof NOOP_SPAN) => unknown,
  ) {
    const callback = typeof optionsOrFn === "function"
      ? optionsOrFn
      : typeof contextOrFn === "function"
      ? contextOrFn
      : fn;
    return callback?.(NOOP_SPAN);
  },
};

const NOOP_TRACER_PROVIDER: ShimTracerProvider = {
  getTracer() {
    return NOOP_TRACER;
  },
};

async function loadOpenTelemetryRuntime(): Promise<OpenTelemetryRuntime> {
  try {
    const [
      api,
      autoInstrumentations,
      apiLogs,
      core,
      contextAsyncHooks,
      logsExporter,
      sdkNode,
      sdkLogs,
      metricsExporter,
      sdkMetrics,
      sdkTraceBase,
      traceExporter,
      resources,
      semanticConventions,
    ] = await Promise.all([
      import("@opentelemetry/api"),
      import("@opentelemetry/auto-instrumentations-node"),
      import("@opentelemetry/api-logs"),
      import("@opentelemetry/core"),
      import("@opentelemetry/context-async-hooks"),
      import("@opentelemetry/exporter-logs-otlp-http"),
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/sdk-logs"),
      import("@opentelemetry/exporter-metrics-otlp-http"),
      import("@opentelemetry/sdk-metrics"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
    ]);

    return {
      api,
      autoInstrumentations,
      apiLogs,
      core,
      contextAsyncHooks,
      logsExporter,
      sdkNode,
      sdkLogs,
      metricsExporter,
      sdkMetrics,
      sdkTraceBase,
      traceExporter,
      resources,
      semanticConventions,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenTelemetry observability requires the optional @opentelemetry packages to be installed. ${detail}`,
    );
  }
}

type EnvReader = (name: string) => string | undefined;

export interface ResolvedOtlpExtensionConfig {
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
  headers: Record<string, string>;
  tracesHeaders: Record<string, string>;
  metricsHeaders: Record<string, string>;
  logsHeaders: Record<string, string>;
  tracesEnabled: boolean;
  llmObservabilityEnabled: boolean;
  metricsEnabled: boolean;
  logsEnabled: boolean;
  tracesUrl: string | undefined;
  llmObservabilityUrl: string | undefined;
  metricsUrl: string | undefined;
  logsUrl: string | undefined;
  llmObservabilityHeaders: Record<string, string>;
  metricsExportIntervalMillis: number;
  metricsTemporalityPreference: "delta" | "cumulative" | "lowmemory";
}

function readEnv(name: string): string | undefined {
  try {
    return (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env
      .get(name);
  } catch {
    return undefined;
  }
}

function parseHeaders(headerInput: string | Record<string, string> | undefined): Record<
  string,
  string
> {
  if (!headerInput) return {};
  if (typeof headerInput !== "string") return headerInput;

  // "Basic xxx" or "Authorization=Basic xxx"
  if (headerInput.startsWith("Basic ")) return { Authorization: headerInput };
  if (headerInput.startsWith("Authorization=")) {
    return { Authorization: headerInput.slice("Authorization=".length) };
  }

  const result: Record<string, string> = {};
  for (const part of headerInput.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (key && valueParts.length > 0) result[key.trim()] = valueParts.join("=").trim();
  }
  return result;
}

function parseResourceAttributes(value: string | undefined): Record<string, string> {
  if (!value) return {};

  const attributes: Record<string, string> = {};
  for (const part of value.split(",")) {
    const [rawKey, ...rawValueParts] = part.split("=");
    const key = rawKey?.trim();
    if (!key || rawValueParts.length === 0) continue;
    attributes[key] = rawValueParts.join("=").trim();
  }
  return attributes;
}

function resolveServiceName(read: EnvReader, resourceAttributes: Record<string, string>): string {
  return read("OTEL_SERVICE_NAME") ?? resourceAttributes["service.name"] ??
    read("DD_SERVICE") ?? "veryfront";
}

function resolveServiceVersion(
  read: EnvReader,
  resourceAttributes: Record<string, string>,
): string {
  return resourceAttributes["service.version"] ??
    read("OTEL_SERVICE_VERSION") ??
    read("DD_VERSION") ??
    read("VERYFRONT_VERSION") ??
    read("RELEASE_VERSION") ??
    read("npm_package_version") ??
    VERSION;
}

function resolveDeploymentEnvironment(
  read: EnvReader,
  resourceAttributes: Record<string, string>,
): string {
  return resourceAttributes["deployment.environment.name"] ??
    resourceAttributes["deployment.environment"] ??
    read("OTEL_DEPLOYMENT_ENVIRONMENT") ??
    read("DD_ENV") ??
    read("APP_ENVIRONMENT") ??
    read("VERYFRONT_ENVIRONMENT") ??
    read("NODE_ENV") ??
    "development";
}

export function unifiedServiceResourceAttributes(options: {
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
}): Record<string, string> {
  return {
    "service.name": options.serviceName,
    "service.version": options.serviceVersion,
    "deployment.environment": options.deploymentEnvironment,
    "deployment.environment.name": options.deploymentEnvironment,
    service: options.serviceName,
    version: options.serviceVersion,
    env: options.deploymentEnvironment,
  };
}

function headersOrDefault(
  signalHeaders: Record<string, string> | undefined,
  defaultHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return signalHeaders ?? defaultHeaders;
}

function getHeaderValue(
  headers: Record<string, string> | undefined,
  headerName: string,
): string | undefined {
  const normalizedName = headerName.toLowerCase();
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName)?.[1];
}

function setHeaderValue(headers: Record<string, string>, headerName: string, value: string): void {
  const normalizedName = headerName.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedName && key !== headerName) {
      delete headers[key];
    }
  }
  headers[headerName] = value;
}

function resolveLlmObservabilityEnabled(
  read: EnvReader,
  tracesHeaders: Record<string, string>,
): boolean {
  const explicitFlag = isTruthySignalFlag(read("DD_LLMOBS_ENABLED") ?? read("OTEL_LLMOBS_ENABLED"));
  if (explicitFlag !== undefined) return explicitFlag;
  return getHeaderValue(tracesHeaders, "dd-otlp-source") === "llmobs";
}

function resolveLlmObservabilityHeaders(
  read: EnvReader,
  tracesHeaders: Record<string, string>,
  mlAppFallback: string | undefined,
): Record<string, string> {
  const headers = { ...tracesHeaders };
  const datadogApiKey = getHeaderValue(headers, "dd-api-key") ??
    read("DD_API_KEY") ??
    read("DATADOG_OTLP_API_KEY");
  if (datadogApiKey) {
    setHeaderValue(headers, "dd-api-key", datadogApiKey);
  }
  setHeaderValue(headers, "dd-otlp-source", "llmobs");

  const mlApp = read("DD_LLMOBS_ML_APP")?.trim() ||
    getHeaderValue(headers, "dd-ml-app")?.trim() ||
    mlAppFallback?.trim();
  if (mlApp) {
    setHeaderValue(headers, "dd-ml-app", mlApp);
  }

  return headers;
}

function metricTemporalityPreference(
  otel: OpenTelemetryRuntime,
  preference: NodeTelemetryInitializeOptions["metricsTemporalityPreference"],
): number {
  const enumValue = otel.metricsExporter.AggregationTemporalityPreference;
  if (preference === "cumulative") return enumValue.CUMULATIVE;
  if (preference === "lowmemory") return enumValue.LOWMEMORY;
  return enumValue.DELTA;
}

function logSeverityNumber(
  otel: OpenTelemetryRuntime,
  level: string | undefined,
): number {
  switch (level) {
    case "debug":
      return otel.apiLogs.SeverityNumber.DEBUG;
    case "warn":
      return otel.apiLogs.SeverityNumber.WARN;
    case "error":
      return otel.apiLogs.SeverityNumber.ERROR;
    case "info":
    default:
      return otel.apiLogs.SeverityNumber.INFO;
  }
}

const TRACE_ID_LOG_ALIASES = ["trace.id", "otel.trace_id"] as const;
const SPAN_ID_LOG_ALIASES = ["span.id", "otel.span_id"] as const;
const PROJECT_ID_LOG_ALIASES = ["project.id"] as const;
const RUN_ID_LOG_ALIASES = ["run.id"] as const;
const AGENT_ID_LOG_ALIASES = ["agent.id", "gen_ai.agent.id"] as const;
const THREAD_ID_LOG_ALIASES = ["thread.id"] as const;
const SCHEDULE_ID_LOG_ALIASES = ["schedule.id", "run.trigger.id"] as const;
const SCHEDULE_NAME_LOG_ALIASES = ["schedule.name"] as const;
const TOOL_NAME_LOG_ALIASES = ["tool.name", "gen_ai.tool.name"] as const;
const TOOL_CALL_ID_LOG_ALIASES = ["tool.call.id", "gen_ai.tool.call.id"] as const;

const LOG_ATTRIBUTE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  trace_id: TRACE_ID_LOG_ALIASES,
  span_id: SPAN_ID_LOG_ALIASES,
  project_id: PROJECT_ID_LOG_ALIASES,
  run_id: RUN_ID_LOG_ALIASES,
  agent_id: AGENT_ID_LOG_ALIASES,
  thread_id: THREAD_ID_LOG_ALIASES,
  schedule_id: SCHEDULE_ID_LOG_ALIASES,
  schedule_name: SCHEDULE_NAME_LOG_ALIASES,
  tool_name: TOOL_NAME_LOG_ALIASES,
  tool_call_id: TOOL_CALL_ID_LOG_ALIASES,
};

const CONTEXT_LOG_ATTRIBUTE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  traceId: TRACE_ID_LOG_ALIASES,
  trace_id: TRACE_ID_LOG_ALIASES,
  spanId: SPAN_ID_LOG_ALIASES,
  span_id: SPAN_ID_LOG_ALIASES,
  projectId: PROJECT_ID_LOG_ALIASES,
  project_id: PROJECT_ID_LOG_ALIASES,
  runId: RUN_ID_LOG_ALIASES,
  run_id: RUN_ID_LOG_ALIASES,
  agentId: AGENT_ID_LOG_ALIASES,
  agent_id: AGENT_ID_LOG_ALIASES,
  threadId: THREAD_ID_LOG_ALIASES,
  thread_id: THREAD_ID_LOG_ALIASES,
  scheduleId: SCHEDULE_ID_LOG_ALIASES,
  schedule_id: SCHEDULE_ID_LOG_ALIASES,
  scheduleName: SCHEDULE_NAME_LOG_ALIASES,
  schedule_name: SCHEDULE_NAME_LOG_ALIASES,
  toolName: TOOL_NAME_LOG_ALIASES,
  tool_name: TOOL_NAME_LOG_ALIASES,
  toolCallId: TOOL_CALL_ID_LOG_ALIASES,
  tool_call_id: TOOL_CALL_ID_LOG_ALIASES,
};

function isLogAttributeValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function hexToUnsignedDecimal(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^0x/, "");
  if (!normalized || !/^[0-9a-f]+$/i.test(normalized)) return undefined;
  try {
    return BigInt(`0x${normalized}`).toString(10);
  } catch {
    return undefined;
  }
}

function addLogAttributeAliases(
  attributes: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean,
): void {
  const aliases = LOG_ATTRIBUTE_ALIASES[key] ?? CONTEXT_LOG_ATTRIBUTE_ALIASES[key];
  for (const alias of aliases ?? []) {
    attributes[alias] ??= value;
  }

  if (key === "trace_id" || key === "traceId") {
    const traceId = typeof value === "string" ? value : String(value);
    attributes["dd.trace_id"] ??= hexToUnsignedDecimal(traceId.slice(-16)) ?? traceId;
  }
  if (key === "span_id" || key === "spanId") {
    const spanId = typeof value === "string" ? value : String(value);
    attributes["dd.span_id"] ??= hexToUnsignedDecimal(spanId) ?? spanId;
  }
}

export function logAttributes(
  record: NodeTelemetryLogRecord,
): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      key === "timestamp" ||
      key === "level" ||
      key === "message" ||
      key === "context" ||
      key === "error"
    ) {
      continue;
    }
    if (isLogAttributeValue(value)) {
      attributes[key] = value;
      addLogAttributeAliases(attributes, key, value);
    }
  }

  if (record.context) {
    for (const [key, value] of Object.entries(record.context)) {
      if (isLogAttributeValue(value)) {
        attributes[`context.${key}`] = value;
        addLogAttributeAliases(attributes, key, value);
      }
    }
  }

  if (record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    if (typeof error.name === "string") attributes["error.type"] = error.name;
    if (typeof error.message === "string") attributes["error.message"] = error.message;
  }

  return attributes;
}

export function resolveOtlpSignalUrl(
  endpoint: string | undefined,
  signal: "traces" | "metrics" | "logs",
): string | undefined {
  if (!endpoint) return undefined;
  const trimmed = endpoint.replace(/\/$/, "");
  const suffix = `/v1/${signal}`;
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
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

function resolveSignalEnabled(
  enabledValue: string | undefined,
  exporterValue: string | undefined,
): boolean {
  const enabledFlag = isTruthySignalFlag(enabledValue);
  if (enabledFlag !== undefined) return enabledFlag;
  return exporterIncludesOtlp(exporterValue) ?? false;
}

function mergeHeaders(
  base: Record<string, string>,
  override: Record<string, string>,
): Record<string, string> {
  return { ...base, ...override };
}

function resolveMetricsTemporalityPreference(
  value: string | undefined,
): "delta" | "cumulative" | "lowmemory" {
  const normalized = value?.toLowerCase();
  if (normalized === "cumulative" || normalized === "lowmemory") return normalized;
  return "delta";
}

export function resolveOtlpExtensionConfig(
  read: EnvReader = readEnv,
): ResolvedOtlpExtensionConfig {
  const resourceAttributes = parseResourceAttributes(read("OTEL_RESOURCE_ATTRIBUTES"));
  const endpoint = read("OTEL_EXPORTER_OTLP_ENDPOINT");
  const tracesEndpoint = read("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ?? endpoint;
  const llmObservabilityEndpoint = read("OTEL_EXPORTER_OTLP_LLMOBS_ENDPOINT") ??
    read("DD_LLMOBS_OTLP_ENDPOINT") ??
    tracesEndpoint;
  const metricsEndpoint = read("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ?? endpoint;
  const logsEndpoint = read("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT") ?? endpoint;
  const metricsExportIntervalMillis = Number.parseInt(
    read("OTEL_METRIC_EXPORT_INTERVAL") ?? "60000",
    10,
  );
  const headers = parseHeaders(read("OTEL_EXPORTER_OTLP_HEADERS"));
  const tracesHeaders = mergeHeaders(
    headers,
    parseHeaders(read("OTEL_EXPORTER_OTLP_TRACES_HEADERS")),
  );
  const metricsHeaders = mergeHeaders(
    headers,
    parseHeaders(read("OTEL_EXPORTER_OTLP_METRICS_HEADERS")),
  );
  const logsHeaders = mergeHeaders(
    headers,
    parseHeaders(read("OTEL_EXPORTER_OTLP_LOGS_HEADERS")),
  );
  const serviceName = resolveServiceName(read, resourceAttributes);
  const serviceVersion = resolveServiceVersion(read, resourceAttributes);
  const deploymentEnvironment = resolveDeploymentEnvironment(read, resourceAttributes);
  const llmObservabilityHeaders = resolveLlmObservabilityHeaders(read, tracesHeaders, serviceName);

  return {
    serviceName,
    serviceVersion,
    deploymentEnvironment,
    headers,
    tracesHeaders,
    metricsHeaders,
    logsHeaders,
    llmObservabilityHeaders,
    tracesEnabled: resolveSignalEnabled(read("OTEL_TRACES_ENABLED"), read("OTEL_TRACES_EXPORTER")),
    llmObservabilityEnabled: resolveLlmObservabilityEnabled(read, tracesHeaders),
    metricsEnabled: resolveSignalEnabled(
      read("OTEL_METRICS_ENABLED"),
      read("OTEL_METRICS_EXPORTER"),
    ),
    logsEnabled: resolveSignalEnabled(read("OTEL_LOGS_ENABLED"), read("OTEL_LOGS_EXPORTER")),
    tracesUrl: resolveOtlpSignalUrl(tracesEndpoint, "traces"),
    llmObservabilityUrl: resolveOtlpSignalUrl(llmObservabilityEndpoint, "traces"),
    metricsUrl: resolveOtlpSignalUrl(metricsEndpoint, "metrics"),
    logsUrl: resolveOtlpSignalUrl(logsEndpoint, "logs"),
    metricsExportIntervalMillis: Number.isFinite(metricsExportIntervalMillis)
      ? metricsExportIntervalMillis
      : 60_000,
    metricsTemporalityPreference: resolveMetricsTemporalityPreference(
      read("OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE"),
    ),
  };
}

type SpanExporterLike = {
  export(spans: unknown[], resultCallback: (result: { code: number; error?: Error }) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
};

type ReadableSpanLike = {
  attributes?: Record<string, unknown>;
  resource?: {
    attributes?: Record<string, unknown>;
  };
  instrumentationScope?: {
    name?: string;
    version?: string;
    schemaUrl?: string;
  };
  spanContext?: (() => { traceId?: string }) | { traceId?: string };
};

function isGenAiSpan(span: unknown): boolean {
  const attributes = (span as ReadableSpanLike).attributes;
  return typeof attributes?.["gen_ai.operation.name"] === "string";
}

type LlmObservabilityServiceIdentity = {
  serviceName: string;
  serviceVersion: string;
  deploymentEnvironment: string;
};

function getStringAttribute(
  attributes: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = attributes?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getSpanTraceId(span: unknown): string | undefined {
  const context = (span as ReadableSpanLike).spanContext;
  const spanContext = typeof context === "function" ? context.call(span) : context;
  return typeof spanContext?.traceId === "string" ? spanContext.traceId : undefined;
}

function resolveLlmObservabilityServiceIdentity(
  span: unknown,
  fallback?: LlmObservabilityServiceIdentity,
): LlmObservabilityServiceIdentity | null {
  const readableSpan = span as ReadableSpanLike;
  const spanAttributes = readableSpan.attributes;
  const resourceAttributes = readableSpan.resource?.attributes;
  const serviceName = getStringAttribute(spanAttributes, "service.name") ??
    getStringAttribute(spanAttributes, "service") ??
    fallback?.serviceName;
  if (!serviceName) return null;

  const serviceVersion = getStringAttribute(spanAttributes, "service.version") ??
    getStringAttribute(spanAttributes, "version") ??
    fallback?.serviceVersion ??
    getStringAttribute(resourceAttributes, "service.version") ??
    getStringAttribute(resourceAttributes, "version") ??
    VERSION;
  const deploymentEnvironment = getStringAttribute(spanAttributes, "deployment.environment.name") ??
    getStringAttribute(spanAttributes, "deployment.environment") ??
    getStringAttribute(spanAttributes, "env") ??
    fallback?.deploymentEnvironment ??
    getStringAttribute(resourceAttributes, "deployment.environment.name") ??
    getStringAttribute(resourceAttributes, "deployment.environment") ??
    getStringAttribute(resourceAttributes, "env") ??
    "development";

  return { serviceName, serviceVersion, deploymentEnvironment };
}

function cloneResourceWithAttributes(
  resource: ReadableSpanLike["resource"],
  attributes: Record<string, string>,
): ReadableSpanLike["resource"] {
  if (!resource) return { attributes };
  const clone = Object.create(Object.getPrototypeOf(resource)) as ReadableSpanLike["resource"];
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(resource));
  Object.defineProperty(clone, "attributes", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: {
      ...(resource.attributes ?? {}),
      ...attributes,
    },
  });
  return clone;
}

function cloneInstrumentationScopeWithName(
  instrumentationScope: ReadableSpanLike["instrumentationScope"],
  name: string,
): ReadableSpanLike["instrumentationScope"] {
  return {
    ...(instrumentationScope ?? {}),
    name,
  };
}

function cloneReadableSpanWithResource(
  span: unknown,
  resource: ReadableSpanLike["resource"],
  instrumentationScope: ReadableSpanLike["instrumentationScope"],
): unknown {
  const clone = Object.create(Object.getPrototypeOf(span));
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(span));
  Object.defineProperty(clone, "resource", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: resource,
  });
  Object.defineProperty(clone, "instrumentationScope", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: instrumentationScope,
  });
  return clone;
}

export function rewriteLlmObservabilitySpanResource(
  span: unknown,
  fallback?: LlmObservabilityServiceIdentity,
): unknown {
  const identity = resolveLlmObservabilityServiceIdentity(span, fallback);
  if (!identity) return span;

  const readableSpan = span as ReadableSpanLike;
  const resource = cloneResourceWithAttributes(
    readableSpan.resource,
    unifiedServiceResourceAttributes(identity),
  );
  const instrumentationScope = cloneInstrumentationScopeWithName(
    readableSpan.instrumentationScope,
    identity.serviceName,
  );
  return cloneReadableSpanWithResource(span, resource, instrumentationScope);
}

function rewriteLlmObservabilitySpanResources(spans: unknown[]): unknown[] {
  const identitiesByTraceId = new Map<string, LlmObservabilityServiceIdentity>();
  for (const span of spans) {
    const traceId = getSpanTraceId(span);
    if (!traceId) continue;
    const identity = resolveLlmObservabilityServiceIdentity(span);
    if (identity) identitiesByTraceId.set(traceId, identity);
  }

  return spans.map((span) =>
    rewriteLlmObservabilitySpanResource(span, identitiesByTraceId.get(getSpanTraceId(span) ?? ""))
  );
}

class FilteringSpanExporter {
  constructor(
    private readonly delegate: SpanExporterLike,
    private readonly includeSpan: (span: unknown) => boolean,
    private readonly successCode: number,
  ) {}

  export(
    spans: unknown[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void {
    const includedSpans = rewriteLlmObservabilitySpanResources(spans.filter(this.includeSpan));
    if (includedSpans.length === 0) {
      resultCallback({ code: this.successCode });
      return;
    }

    this.delegate.export(includedSpans, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }
}

class OtlpTracingExporter implements TracingExporter {
  private sdkProvider: SdkTracerProvider | null = null;
  private meterProvider: SdkMeterProvider | null = null;
  private logProvider: SdkLoggerProvider | null = null;
  private metricsApi: MetricsAPI | null = null;
  private traceApi: TraceAPI | null = null;
  private contextApi: ContextAPI | null = null;
  private logRecordEmitter: ((record: NodeTelemetryLogRecord) => void) | null = null;

  async start(_ctxConfig: Record<string, unknown>): Promise<void> {
    const cfg = resolveOtlpExtensionConfig(readEnv);

    // Honor signal gates: when unset/false, skip exporter wiring so deployments
    // opting out never create OTLP traffic or set globals.
    if (
      !cfg.tracesEnabled && !cfg.llmObservabilityEnabled && !cfg.metricsEnabled && !cfg.logsEnabled
    ) {
      return;
    }

    const otel = await loadOpenTelemetryRuntime();
    const resource = otel.resources.resourceFromAttributes(unifiedServiceResourceAttributes({
      serviceName: cfg.serviceName,
      serviceVersion: cfg.serviceVersion,
      deploymentEnvironment: cfg.deploymentEnvironment,
    }));

    if (cfg.tracesEnabled || cfg.llmObservabilityEnabled) {
      if (cfg.tracesEnabled && !cfg.tracesUrl) {
        throw new Error(
          "OTEL_TRACES_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        );
      }

      if (cfg.llmObservabilityEnabled && !cfg.llmObservabilityUrl) {
        throw new Error(
          "DD_LLMOBS_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, or OTEL_EXPORTER_OTLP_LLMOBS_ENDPOINT",
        );
      }

      const spanProcessors = [];

      if (cfg.tracesEnabled && cfg.tracesUrl) {
        spanProcessors.push(
          new otel.sdkTraceBase.BatchSpanProcessor(
            new otel.traceExporter.OTLPTraceExporter({
              url: cfg.tracesUrl,
              headers: cfg.tracesHeaders,
            }),
          ),
        );
      }

      if (cfg.llmObservabilityEnabled && cfg.llmObservabilityUrl) {
        spanProcessors.push(
          new otel.sdkTraceBase.BatchSpanProcessor(
            new FilteringSpanExporter(
              new otel.traceExporter.OTLPTraceExporter({
                url: cfg.llmObservabilityUrl,
                headers: cfg.llmObservabilityHeaders,
              }) as SpanExporterLike,
              isGenAiSpan,
              otel.core.ExportResultCode.SUCCESS,
            ) as never,
          ),
        );
      }

      const provider = new otel.sdkTraceBase.BasicTracerProvider({
        resource,
        spanProcessors,
      });

      // Wire OTel SDK globals so the real API delegates to this provider.
      // The shim also gets wired separately in bootstrap.ts via getProvider().
      otel.api.trace.setGlobalTracerProvider(provider);

      const contextManager = new otel.contextAsyncHooks.AsyncLocalStorageContextManager();
      contextManager.enable();

      const propagator = new otel.core.W3CTraceContextPropagator();

      otel.api.propagation.setGlobalPropagator(propagator);
      otel.api.context.setGlobalContextManager(contextManager);

      this.sdkProvider = provider;
      this.traceApi = {
        getActiveSpan: () => otel.api.trace.getActiveSpan(),
        getSpan: (ctx) =>
          otel.api.trace.getSpan(ctx as Parameters<typeof otel.api.trace.getSpan>[0]),
        setSpan: (ctx, span) =>
          otel.api.trace.setSpan(
            ctx as Parameters<typeof otel.api.trace.setSpan>[0],
            span as Parameters<typeof otel.api.trace.setSpan>[1],
          ),
      };
      this.contextApi = {
        active: () => otel.api.context.active(),
        with: (ctx, fn) =>
          otel.api.context.with(
            ctx as Parameters<typeof otel.api.context.with>[0],
            fn,
          ),
      };
    }

    if (cfg.metricsEnabled) {
      if (!cfg.metricsUrl) {
        throw new Error(
          "OTEL_METRICS_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
        );
      }

      const metricReader = new otel.sdkMetrics.PeriodicExportingMetricReader({
        exporter: new otel.metricsExporter.OTLPMetricExporter({
          url: cfg.metricsUrl,
          headers: cfg.metricsHeaders,
          temporalityPreference: metricTemporalityPreference(
            otel,
            cfg.metricsTemporalityPreference,
          ),
        }),
        exportIntervalMillis: cfg.metricsExportIntervalMillis,
      });

      this.meterProvider = new otel.sdkMetrics.MeterProvider({
        resource,
        readers: [metricReader],
      });
      otel.api.metrics.setGlobalMeterProvider(this.meterProvider);
      this.metricsApi = otel.api.metrics;
    }

    if (cfg.logsEnabled) {
      if (!cfg.logsUrl) {
        throw new Error(
          "OTEL_LOGS_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
        );
      }

      this.logProvider = new otel.sdkLogs.LoggerProvider({
        resource,
        processors: [
          new otel.sdkLogs.BatchLogRecordProcessor({
            exporter: new otel.logsExporter.OTLPLogExporter({
              url: cfg.logsUrl,
              headers: cfg.logsHeaders,
            }),
          }),
        ],
      });
      otel.apiLogs.logs.setGlobalLoggerProvider(this.logProvider);
      const otelLogger = otel.apiLogs.logs.getLogger(cfg.serviceName, cfg.serviceVersion);
      this.logRecordEmitter = (record) => {
        otelLogger.emit({
          timestamp: record.timestamp ? new Date(record.timestamp) : new Date(),
          severityNumber: logSeverityNumber(otel, record.level),
          severityText: record.level?.toUpperCase() ?? "INFO",
          body: record.message,
          attributes: logAttributes(record),
        });
      };
      otelLogger.emit({
        severityNumber: otel.apiLogs.SeverityNumber.INFO,
        severityText: "INFO",
        body: "OpenTelemetry log export initialized",
        attributes: {
          "service.name": cfg.serviceName,
          "service.version": cfg.serviceVersion,
          "deployment.environment.name": cfg.deploymentEnvironment,
          service: cfg.serviceName,
          version: cfg.serviceVersion,
          env: cfg.deploymentEnvironment,
        },
      });
    }
  }

  // eslint-disable-next-line require-await
  async export(_spans: SpanData[]): Promise<void> {
    // BatchSpanProcessor handles export automatically; this method is a no-op.
    // Callers that want to push custom SpanData batches can extend this.
  }

  async shutdown(): Promise<void> {
    if (this.logProvider) {
      try {
        await this.logProvider.shutdown();
      } finally {
        this.logProvider = null;
        this.logRecordEmitter = null;
      }
    }

    if (this.meterProvider) {
      try {
        await this.meterProvider.shutdown();
      } finally {
        this.meterProvider = null;
      }
    }

    if (this.sdkProvider) {
      try {
        await this.sdkProvider.shutdown();
      } finally {
        this.sdkProvider = null;
        this.traceApi = null;
        this.contextApi = null;
      }
    }
  }

  getProvider(): ShimTracerProvider {
    if (this.sdkProvider) return this.sdkProvider;
    return NOOP_TRACER_PROVIDER;
  }

  getMetricsAPI(): MetricsAPI | null {
    return this.metricsApi;
  }

  getTraceAPI(): TraceAPI | null {
    return this.traceApi;
  }

  getContextAPI(): ContextAPI | null {
    return this.contextApi;
  }

  getLogRecordEmitter(): ((record: NodeTelemetryLogRecord) => void) | null {
    return this.logRecordEmitter;
  }
}

class OpenTelemetryNodeTelemetryProvider implements NodeTelemetryProvider {
  private sdk: { shutdown(): Promise<void> } | null = null;

  async initialize(options: NodeTelemetryInitializeOptions): Promise<boolean> {
    const tracesEnabled = options.tracesEnabled ?? true;
    const llmObservabilityEnabled = options.llmObservabilityEnabled ?? false;
    const metricsEnabled = options.metricsEnabled ?? false;
    const logsEnabled = options.logsEnabled ?? false;

    if (!tracesEnabled && !llmObservabilityEnabled && !metricsEnabled && !logsEnabled) return false;

    const otel = await loadOpenTelemetryRuntime();
    const resource = otel.resources.resourceFromAttributes(unifiedServiceResourceAttributes({
      serviceName: options.serviceName,
      serviceVersion: options.serviceVersion,
      deploymentEnvironment: options.deploymentEnvironment,
    }));

    const spanProcessors = [];

    if (tracesEnabled) {
      spanProcessors.push(
        new otel.sdkTraceBase.BatchSpanProcessor(
          new otel.traceExporter.OTLPTraceExporter({
            url: options.tracesEndpoint,
            headers: headersOrDefault(options.tracesHeaders, options.exporterHeaders),
          }),
          {
            maxExportBatchSize: 100,
            scheduledDelayMillis: 500,
          },
        ),
      );
    }

    if (llmObservabilityEnabled) {
      spanProcessors.push(
        new otel.sdkTraceBase.BatchSpanProcessor(
          new FilteringSpanExporter(
            new otel.traceExporter.OTLPTraceExporter({
              url: options.llmObservabilityEndpoint ?? options.tracesEndpoint,
              headers: headersOrDefault(options.llmObservabilityHeaders, options.tracesHeaders),
            }) as SpanExporterLike,
            isGenAiSpan,
            otel.core.ExportResultCode.SUCCESS,
          ) as never,
          {
            maxExportBatchSize: 100,
            scheduledDelayMillis: 500,
          },
        ),
      );
    }

    const metricReaders = metricsEnabled
      ? [
        new otel.sdkMetrics.PeriodicExportingMetricReader({
          exporter: new otel.metricsExporter.OTLPMetricExporter({
            url: options.metricsEndpoint,
            headers: headersOrDefault(options.metricsHeaders, options.exporterHeaders),
            temporalityPreference: metricTemporalityPreference(
              otel,
              options.metricsTemporalityPreference,
            ),
          }),
          exportIntervalMillis: options.metricsExportIntervalMillis ?? 60_000,
        }),
      ]
      : [];

    const logRecordProcessors = logsEnabled
      ? [
        new otel.sdkLogs.BatchLogRecordProcessor({
          exporter: new otel.logsExporter.OTLPLogExporter({
            url: options.logsEndpoint,
            headers: headersOrDefault(options.logsHeaders, options.exporterHeaders),
          }),
        }),
      ]
      : [];

    const sdk = new otel.sdkNode.NodeSDK({
      resource,
      sampler: new otel.sdkTraceBase.ParentBasedSampler({
        root: new otel.sdkTraceBase.TraceIdRatioBasedSampler(options.samplingRatio),
      }),
      spanProcessors,
      metricReaders,
      logRecordProcessors,
      instrumentations: [
        otel.autoInstrumentations.getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: options.instrumentation.fs },
          "@opentelemetry/instrumentation-http": { enabled: options.instrumentation.http },
          "@opentelemetry/instrumentation-express": { enabled: options.instrumentation.express },
        }),
      ],
    });

    sdk.start();
    this.sdk = sdk;

    if (metricsEnabled) {
      otel.api.metrics
        .getMeter(options.serviceName, options.serviceVersion)
        .createCounter("veryfront.agent.telemetry.startups")
        .add(1, {
          "deployment.environment": options.deploymentEnvironment,
          "service.name": options.serviceName,
        });
    }

    if (logsEnabled) {
      const otelLogger = otel.apiLogs.logs.getLogger(options.serviceName, options.serviceVersion);
      options.registerLogRecordEmitter?.((record) => {
        otelLogger.emit({
          timestamp: record.timestamp ? new Date(record.timestamp) : new Date(),
          severityNumber: logSeverityNumber(otel, record.level),
          severityText: record.level?.toUpperCase() ?? "INFO",
          body: record.message,
          attributes: logAttributes(record),
        });
      });
      otelLogger.emit({
        severityNumber: otel.apiLogs.SeverityNumber.INFO,
        severityText: "INFO",
        body: "OpenTelemetry log export initialized",
        attributes: {
          "deployment.environment": options.deploymentEnvironment,
          "service.name": options.serviceName,
        },
      });
    }

    options.logger?.info("OpenTelemetry initialized", {
      serviceName: options.serviceName,
      samplingRatio: options.samplingRatio,
      tracesEnabled,
      metricsEnabled,
      logsEnabled,
      llmObservabilityEnabled,
    });

    options.processTarget?.on("SIGTERM", async () => {
      await this.shutdown();
      options.logger?.info("OpenTelemetry shutdown complete");
    });

    return true;
  }

  async shutdown(): Promise<void> {
    if (!this.sdk) return;
    try {
      await this.sdk.shutdown();
    } finally {
      this.sdk = null;
    }
  }
}

/**
 * Default export for the ext-observability-opentelemetry extension factory.
 *
 * Produces an extension that registers a `TracingExporter` contract
 * implementation backed by the OpenTelemetry JS SDK.
 */
const extOpenTelemetry: ExtensionFactory = () => {
  const exporterImpl = new OtlpTracingExporter();
  const nodeTelemetryProvider = new OpenTelemetryNodeTelemetryProvider();

  return {
    name: "ext-observability-opentelemetry",
    version: "0.1.0",
    contracts: {
      provides: ["TracingExporter", "NodeTelemetryProvider"],
    },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "OTEL_EXPORTER_OTLP_ENDPOINT",
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
          "OTEL_EXPORTER_OTLP_LLMOBS_ENDPOINT",
          "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
          "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
          "OTEL_EXPORTER_OTLP_HEADERS",
          "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
          "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
          "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
          "OTEL_RESOURCE_ATTRIBUTES",
          "OTEL_SERVICE_NAME",
          "OTEL_SERVICE_VERSION",
          "OTEL_DEPLOYMENT_ENVIRONMENT",
          "DD_SERVICE",
          "DD_VERSION",
          "DD_ENV",
          "DD_API_KEY",
          "DATADOG_OTLP_API_KEY",
          "DD_LLMOBS_ENABLED",
          "DD_LLMOBS_ML_APP",
          "DD_LLMOBS_OTLP_ENDPOINT",
          "OTEL_LLMOBS_ENABLED",
          "VERYFRONT_VERSION",
          "RELEASE_VERSION",
          "APP_ENVIRONMENT",
          "VERYFRONT_ENVIRONMENT",
          "NODE_ENV",
          "OTEL_TRACES_ENABLED",
          "OTEL_METRICS_ENABLED",
          "OTEL_LOGS_ENABLED",
          "OTEL_TRACES_EXPORTER",
          "OTEL_METRICS_EXPORTER",
          "OTEL_LOGS_EXPORTER",
          "OTEL_METRIC_EXPORT_INTERVAL",
          "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE",
        ],
      },
    ],
    async setup(ctx) {
      await exporterImpl.start(ctx.config);
      ctx.provide("TracingExporter", exporterImpl);
      ctx.provide("NodeTelemetryProvider", nodeTelemetryProvider);
      ctx.logger.info("[ext-observability-opentelemetry] TracingExporter registered");
    },
    async teardown() {
      await nodeTelemetryProvider.shutdown();
      await exporterImpl.shutdown();
    },
  };
};

export default extOpenTelemetry;
export { OpenTelemetryNodeTelemetryProvider, OtlpTracingExporter };
