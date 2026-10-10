import { assertEquals } from "#veryfront/testing/assert.ts";
import { startNodeAgentService, startNodeHostedAgentService } from "#veryfront/agent";

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

Deno.test("node agent service serves the immutable deployment artifact over HTTP", async () => {
  const service = await startNodeAgentService({
    serviceName: "node-test-agent-service",
    deploymentArtifact: "20261007183045-a1b2c3d4e5f6",
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

    const response = await fetch(`http://127.0.0.1:${service.nodeServer.port}/version`);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(await response.json(), { artifact: "20261007183045-a1b2c3d4e5f6" });
  } finally {
    await service.nodeServer.stop();
  }
});

Deno.test("node hosted agent service start alias opens the same server shape", async () => {
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
