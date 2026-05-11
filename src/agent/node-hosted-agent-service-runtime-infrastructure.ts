import * as api from "@opentelemetry/api";
import {
  createOpenTelemetryServiceTracer,
  type ServiceTracerAttributes,
} from "../observability/tracing/service-tracer.ts";
import { agentLogger, type Logger } from "../utils/logger/index.ts";
import {
  type HostedAgentServiceConfig,
  type HostedAgentServiceConfigInput,
  parseHostedAgentServiceConfig,
} from "./hosted-agent-service-config.ts";
import {
  initializeNodeHostedAgentServiceOpenTelemetry,
  type NodeHostedAgentServiceTelemetryEnv,
  type NodeHostedAgentServiceTelemetryLogger,
  type NodeHostedAgentServiceTelemetryProcessTarget,
  resolveNodeHostedAgentServiceTelemetryConfig,
} from "./node-hosted-agent-service-telemetry.ts";

export type CreateNodeHostedAgentServiceRuntimeInfrastructureOptions = {
  serviceName: string;
  env: HostedAgentServiceConfigInput & NodeHostedAgentServiceTelemetryEnv;
  telemetryLogger?: NodeHostedAgentServiceTelemetryLogger;
  processTarget?: NodeHostedAgentServiceTelemetryProcessTarget;
};

export type NodeHostedAgentServiceRuntimeInfrastructure = {
  getConfig(): HostedAgentServiceConfig;
  logger: Logger;
  tracer: ReturnType<typeof createOpenTelemetryServiceTracer>["tracer"];
  setActiveSpanAttributes(attributes: ServiceTracerAttributes): void;
  getTraceContext(): { traceId?: string; spanId?: string };
  initializeOpenTelemetry(): Promise<boolean>;
};

export function createNodeHostedAgentServiceRuntimeInfrastructure(
  options: CreateNodeHostedAgentServiceRuntimeInfrastructureOptions,
): NodeHostedAgentServiceRuntimeInfrastructure {
  const telemetryConfig = resolveNodeHostedAgentServiceTelemetryConfig({
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
    getConfig: () => parseHostedAgentServiceConfig(options.env),
    logger: agentLogger.component(options.serviceName),
    tracer: serviceTracer.tracer,
    setActiveSpanAttributes: serviceTracer.setActiveSpanAttributes,
    getTraceContext: serviceTracer.getTraceContext,
    initializeOpenTelemetry: () =>
      initializeNodeHostedAgentServiceOpenTelemetry({
        ...telemetryConfig,
        logger: options.telemetryLogger,
        processTarget: options.processTarget,
      }),
  };
}
