import { assertEquals, assertObjectMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createNodeHostedAgentServiceRuntimeInfrastructure } from "./node-hosted-agent-service-runtime-infrastructure.ts";

describe("createNodeHostedAgentServiceRuntimeInfrastructure", () => {
  it("binds hosted service config, logging, tracing, and disabled telemetry startup", async () => {
    const infoMessages: string[] = [];
    const infrastructure = createNodeHostedAgentServiceRuntimeInfrastructure({
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
});
