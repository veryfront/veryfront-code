import { assertEquals, assertObjectMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type NodeTelemetryLogRecord,
  type NodeTelemetryProvider,
  NodeTelemetryProviderName,
} from "#veryfront/extensions/observability/index.ts";
import { __resetLogRecordEmitterForTests } from "#veryfront/utils/logger/index.ts";
import {
  createNodeAgentServiceRuntimeInfrastructure,
  createNodeHostedAgentServiceRuntimeInfrastructure,
} from "./node-runtime-infrastructure.ts";

describe("createNodeAgentServiceRuntimeInfrastructure", () => {
  it("exposes a node agent service infrastructure alias without the hosted prefix", async () => {
    assertEquals(
      createNodeAgentServiceRuntimeInfrastructure,
      createNodeHostedAgentServiceRuntimeInfrastructure,
    );

    const infrastructure = createNodeAgentServiceRuntimeInfrastructure({
      serviceName: "custom-service",
      env: {
        VERYFRONT_API_URL: "https://api.example.com",
        OTEL_ENABLED: "false",
      },
    });

    assertEquals(infrastructure.getConfig().VERYFRONT_API_URL, "https://api.example.com");
    assertEquals(await infrastructure.initializeOpenTelemetry(), false);
  });

  it("binds agent service config, logging, tracing, and disabled telemetry startup", async () => {
    const infoMessages: string[] = [];
    const infrastructure = createNodeAgentServiceRuntimeInfrastructure({
      serviceName: "custom-service",
      env: {
        VERYFRONT_API_URL: "https://api.example.com",
        ALLOWED_ORIGINS: "https://studio.example.com",
        OTEL_ENABLED: "false",
      },
      telemetryLogger: {
        info(message) {
          infoMessages.push(message);
        },
        error(message) {
          throw new Error(message);
        },
      },
    });

    assertObjectMatch(infrastructure.getConfig(), {
      VERYFRONT_API_URL: "https://api.example.com",
      VERYFRONT_MCP_URL: "https://api.example.com/mcp",
      ALLOWED_ORIGINS: ["https://studio.example.com"],
    });
    assertEquals(typeof infrastructure.logger.info, "function");
    assertEquals(typeof infrastructure.tracer.trace, "function");
    assertEquals(infrastructure.getTraceContext(), {});
    assertEquals(await infrastructure.initializeOpenTelemetry(), false);
    assertEquals(infoMessages, ["OpenTelemetry disabled"]);
  });

  it("bridges structured logger records to the node telemetry provider", async () => {
    const records: NodeTelemetryLogRecord[] = [];
    const telemetryProvider: NodeTelemetryProvider = {
      initialize(options) {
        options.registerLogRecordEmitter?.((record) => records.push(record));
        return Promise.resolve(true);
      },
    };
    register(NodeTelemetryProviderName, telemetryProvider);

    try {
      const infrastructure = createNodeAgentServiceRuntimeInfrastructure({
        serviceName: "custom-service",
        env: {
          VERYFRONT_API_URL: "https://api.example.com",
          OTEL_ENABLED: "true",
        },
      });

      assertEquals(await infrastructure.initializeOpenTelemetry(), true);
      infrastructure.logger.info("agent run started", { run_id: "run-1" });

      assertObjectMatch(records[0] ?? {}, {
        level: "info",
        service: "agent",
        message: "agent run started",
        component: "custom-service",
        run_id: "run-1",
      });
    } finally {
      __resetLogRecordEmitterForTests();
      unregister(NodeTelemetryProviderName);
    }
  });
});
