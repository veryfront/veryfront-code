import * as api from "#veryfront/observability/tracing/api-shim.ts";
import {
  createOpenTelemetryServiceTracer,
  type ServiceTracerAttributes,
} from "../../observability/tracing/service-tracer.ts";
import { __registerLogRecordEmitter, agentLogger, type Logger } from "../../utils/logger/index.ts";
import {
  type AgentServiceConfig,
  type AgentServiceConfigInput,
  parseAgentServiceConfig,
} from "./config.ts";
import {
  initializeNodeAgentServiceOpenTelemetry,
  type NodeAgentServiceTelemetryEnv,
  type NodeAgentServiceTelemetryLogger,
  type NodeAgentServiceTelemetryProcessTarget,
  resolveNodeAgentServiceTelemetryConfig,
} from "./node-telemetry.ts";
import {
  initializeNodeAgentServiceApplicationErrors,
  type NodeAgentServiceApplicationErrorLifecycle,
} from "./node-application-errors.ts";
import type { ApplicationErrorReporterInitializer } from "../../observability/application-errors.ts";

/** Options accepted by create node agent service runtime infrastructure. */
export type CreateNodeAgentServiceRuntimeInfrastructureOptions = {
  serviceName: string;
  env: AgentServiceConfigInput & NodeAgentServiceTelemetryEnv;
  applicationErrorReporterInitializer?: ApplicationErrorReporterInitializer;
  telemetryLogger?: NodeAgentServiceTelemetryLogger;
  processTarget?: NodeAgentServiceTelemetryProcessTarget;
};

/** Options accepted by create node hosted agent service runtime infrastructure. */
export type CreateNodeHostedAgentServiceRuntimeInfrastructureOptions =
  CreateNodeAgentServiceRuntimeInfrastructureOptions;

/** Public API contract for node agent service runtime infrastructure. */
export type NodeAgentServiceRuntimeInfrastructure = {
  getConfig(): AgentServiceConfig;
  logger: Logger;
  tracer: ReturnType<typeof createOpenTelemetryServiceTracer>["tracer"];
  setActiveSpanAttributes(attributes: ServiceTracerAttributes): void;
  getTraceContext(): { traceId?: string; spanId?: string };
  initializeApplicationErrors(): Promise<NodeAgentServiceApplicationErrorLifecycle>;
  initializeOpenTelemetry(): Promise<boolean>;
};

/** Public API contract for node hosted agent service runtime infrastructure. */
export type NodeHostedAgentServiceRuntimeInfrastructure = NodeAgentServiceRuntimeInfrastructure;

/** Create node agent service runtime infrastructure. */
export function createNodeAgentServiceRuntimeInfrastructure(
  options: CreateNodeAgentServiceRuntimeInfrastructureOptions,
): NodeAgentServiceRuntimeInfrastructure {
  const telemetryConfig = resolveNodeAgentServiceTelemetryConfig({
    env: options.env,
    defaultServiceName: options.serviceName,
  });
  const serviceTracer = createOpenTelemetryServiceTracer({
    serviceName: telemetryConfig.serviceName,
    context: api.context,
    trace: api.trace,
    errorStatusCode: api.SpanStatusCode.ERROR,
  });

  return {
    getConfig: () => parseAgentServiceConfig(options.env),
    logger: agentLogger.component(options.serviceName),
    tracer: serviceTracer.tracer,
    setActiveSpanAttributes: serviceTracer.setActiveSpanAttributes,
    getTraceContext: serviceTracer.getTraceContext,
    initializeApplicationErrors: () =>
      initializeNodeAgentServiceApplicationErrors({
        initializer: options.applicationErrorReporterInitializer,
        defaultServiceName: telemetryConfig.serviceName,
      }),
    initializeOpenTelemetry: () =>
      initializeNodeAgentServiceOpenTelemetry({
        ...telemetryConfig,
        logger: options.telemetryLogger,
        processTarget: options.processTarget,
        registerLogRecordEmitter: __registerLogRecordEmitter,
      }),
  };
}

/** Create node hosted agent service runtime infrastructure. */
export const createNodeHostedAgentServiceRuntimeInfrastructure =
  createNodeAgentServiceRuntimeInfrastructure;
