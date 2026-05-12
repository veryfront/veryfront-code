import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgentServiceRuntime,
  createHostedAgentServiceRuntime,
  startNodeAgentService,
  startNodeHostedAgentService,
} from "./hosted-agent-service-runtime.ts";

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

describe("agent/hosted-agent-service-runtime", () => {
  it("exposes agent service aliases without the hosted prefix for developer-facing APIs", async () => {
    const bundle = createAgentServiceRuntime({
      serviceName: "test-agent-service",
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.example.test",
        NODE_ENV: "test",
        PORT: 3180,
        ALLOWED_ORIGINS: ["https://studio.example.test"],
      }),
      getAgentConfig: () => ({
        id: "assistant",
        name: "Assistant",
        description: "",
        instructions: "You are a test assistant.",
      }),
      logger: createLogger(),
      prepareExecution: async () => ({ ok: true }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
    });

    const ready = await bundle.runtime.request("/readiness");

    assertEquals(bundle.runtime.contract.serviceName, "test-agent-service");
    assertEquals(ready.status, 200);
  });

  it("assembles hosted service auth, routes, lifecycle, and runtime shell", async () => {
    const bundle = createHostedAgentServiceRuntime({
      serviceName: "test-agent-service",
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.example.test",
        NODE_ENV: "test",
        PORT: 3180,
        ALLOWED_ORIGINS: ["https://studio.example.test"],
      }),
      getAgentConfig: () => ({
        id: "assistant",
        name: "Assistant",
        description: "",
        instructions: "You are a test assistant.",
        model: "test/model",
        maxSteps: 4,
      }),
      logger: createLogger(),
      prepareExecution: async () => ({ ok: true }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
    });

    assertEquals(bundle.config.PORT, 3180);
    assertEquals(bundle.runtime.contract.serviceName, "test-agent-service");
    assertEquals(bundle.runtime.contract.defaultAgentId, "assistant");
    assertEquals(bundle.routes.map((route) => route.path), [
      "/api/ag-ui/messages/stream",
      "/api/ag-ui",
      "/api/runs/:runId",
      "/api/runs",
      "/api/control-plane/agents/stream",
    ]);

    const ready = await bundle.runtime.request("/readiness");
    assertEquals(ready.status, 200);
  });

  it("starts the node agent service server from the assembled runtime", async () => {
    const service = await startNodeAgentService({
      serviceName: "node-test-agent-service",
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.example.test",
        NODE_ENV: "test",
        PORT: 0,
        ALLOWED_ORIGINS: ["*"],
      }),
      getAgentConfig: () => ({
        id: "assistant",
        name: "Assistant",
        description: "",
        instructions: "You are a test assistant.",
      }),
      logger: createLogger(),
      prepareExecution: async () => ({ ok: true }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
      signals: [],
      hardShutdownTimeoutMs: 50,
    });

    try {
      assertEquals(service.runtime.contract.serviceName, "node-test-agent-service");
      assertEquals(typeof service.nodeServer.port, "number");
    } finally {
      await service.nodeServer.stop();
    }
  });

  it("keeps the hosted-prefixed start function as a compatibility alias", async () => {
    const service = await startNodeHostedAgentService({
      serviceName: "node-hosted-test-agent-service",
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.example.test",
        NODE_ENV: "test",
        PORT: 0,
        ALLOWED_ORIGINS: ["*"],
      }),
      getAgentConfig: () => ({
        id: "assistant",
        name: "Assistant",
        description: "",
        instructions: "You are a test assistant.",
      }),
      logger: createLogger(),
      prepareExecution: async () => ({ ok: true }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
      signals: [],
      hardShutdownTimeoutMs: 50,
    });

    try {
      assertEquals(service.runtime.contract.serviceName, "node-hosted-test-agent-service");
      assertEquals(typeof service.nodeServer.port, "number");
    } finally {
      await service.nodeServer.stop();
    }
  });
});
