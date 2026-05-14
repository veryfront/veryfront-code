import * as api from "@opentelemetry/api";
import {
  createOpenTelemetryServiceTracer,
  type ServiceTracerAttributes,
} from "../../observability/tracing/service-tracer.ts";
import { agentLogger, type Logger } from "../../utils/logger/index.ts";
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

export type CreateNodeAgentServiceRuntimeInfrastructureOptions = {
  serviceName: string;
  env: AgentServiceConfigInput & NodeAgentServiceTelemetryEnv;
  telemetryLogger?: NodeAgentServiceTelemetryLogger;
  processTarget?: NodeAgentServiceTelemetryProcessTarget;
};

export type CreateNodeHostedAgentServiceRuntimeInfrastructureOptions =
  CreateNodeAgentServiceRuntimeInfrastructureOptions;

export type NodeAgentServiceRuntimeInfrastructure = {
  getConfig(): AgentServiceConfig;
  logger: Logger;
  tracer: ReturnType<typeof createOpenTelemetryServiceTracer>["tracer"];
  setActiveSpanAttributes(attributes: ServiceTracerAttributes): void;
  getTraceContext(): { traceId?: string; spanId?: string };
  initializeOpenTelemetry(): Promise<boolean>;
};

export type NodeHostedAgentServiceRuntimeInfrastructure = NodeAgentServiceRuntimeInfrastructure;

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
    initializeOpenTelemetry: () =>
      initializeNodeAgentServiceOpenTelemetry({
        ...telemetryConfig,
        logger: options.telemetryLogger,
        processTarget: options.processTarget,
      }),
  };
}

export const createNodeHostedAgentServiceRuntimeInfrastructure =
  createNodeAgentServiceRuntimeInfrastructure;
