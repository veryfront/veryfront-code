import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  agentServiceConfigSchema,
  parseAgentServiceConfig,
  parseHostedAgentServiceConfig,
} from "./hosted-agent-service-config.ts";

describe("agent/hosted-agent-service-config", () => {
  it("exposes agent service aliases without the hosted prefix", () => {
    const config = parseAgentServiceConfig({
      VERYFRONT_API_URL: "https://api.example.com",
    });

    assertEquals(config.VERYFRONT_MCP_URL, "https://api.example.com/mcp");
    assertEquals(agentServiceConfigSchema.parse({}).PORT, 3001);
  });

  it("builds hosted agent service config defaults", () => {
    const config = parseHostedAgentServiceConfig({});

    assertEquals(config.VERYFRONT_API_URL, "https://api.veryfront.com");
    assertEquals(config.VERYFRONT_MCP_URL, "https://api.veryfront.com/mcp");
    assertEquals(config.VERYFRONT_STUDIO_MCP_URL, "");
    assertEquals(config.NODE_ENV, "development");
    assertEquals(config.PORT, 3001);
    assertEquals(config.ALLOWED_ORIGINS, ["http://localhost:3000", "http://veryfront.me:3000"]);
    assertEquals(config.OTEL_ENABLED, false);
    assertEquals(config.VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT, false);
    assertEquals(config.VERYFRONT_ENABLE_DURABLE_TASK, false);
  });

  it("normalizes derived URLs, booleans, port, and origins", () => {
    const config = parseHostedAgentServiceConfig({
      VERYFRONT_API_URL: "https://api.example.com",
      NODE_ENV: "production",
      PORT: "4200",
      OAUTH_PUBLIC_KEY: "public-key",
      VERYFRONT_STUDIO_MCP_URL: "https://studio.example.com/mcp",
      VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: "true",
      VERYFRONT_ENABLE_DURABLE_TASK: "true",
      ALLOWED_ORIGINS: "https://a.example.com, https://b.example.com",
      OTEL_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com",
    });

    assertEquals(config.VERYFRONT_API_URL, "https://api.example.com");
    assertEquals(config.VERYFRONT_MCP_URL, "https://api.example.com/mcp");
    assertEquals(config.NODE_ENV, "production");
    assertEquals(config.PORT, 4200);
    assertEquals(config.OAUTH_PUBLIC_KEY, "public-key");
    assertEquals(config.VERYFRONT_STUDIO_MCP_URL, "https://studio.example.com/mcp");
    assertEquals(config.VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT, true);
    assertEquals(config.VERYFRONT_ENABLE_DURABLE_TASK, true);
    assertEquals(config.ALLOWED_ORIGINS, ["https://a.example.com", "https://b.example.com"]);
    assertEquals(config.OTEL_ENABLED, true);
    assertEquals(config.OTEL_EXPORTER_OTLP_ENDPOINT, "https://otel.example.com");
  });

  it("rejects invalid API URLs", () => {
    assertThrows(() => parseHostedAgentServiceConfig({ VERYFRONT_API_URL: "not-a-url" }));
  });
});
