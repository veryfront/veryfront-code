import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import {
  combineAgentServiceLifecycle,
  createAgentServiceRuntime,
  createHostedAgentServiceRuntime,
  startNodeAgentService,
  startNodeHostedAgentService,
} from "./runtime.ts";

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

describe("agent/agent-service-runtime", () => {
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

    const allowed = await bundle.runtime.request("/readiness", {
      headers: { Origin: "https://studio.example.test" },
    });
    assertEquals(
      allowed.headers.get("Access-Control-Allow-Origin"),
      "https://studio.example.test",
      "the runtime allow-list must come from config.ALLOWED_ORIGINS",
    );
    assertEquals(
      allowed.headers.get("Access-Control-Allow-Credentials"),
      "true",
      "credentialed CORS stays enabled",
    );

    const denied = await bundle.runtime.request("/readiness", {
      headers: { Origin: "https://evil.example" },
    });
    assertEquals(
      denied.headers.get("Access-Control-Allow-Origin"),
      null,
      "an unlisted origin must never be reflected on a credentialed response",
    );
  });

  it("assembles agent service auth, routes, lifecycle, and runtime shell", async () => {
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
      "/api/ag-ui",
      "/api/runs/:runId",
      "/api/runs",
      "/api/control-plane/runs/:runId/stream",
    ]);

    const ready = await bundle.runtime.request("/readiness");
    assertEquals(ready.status, 200);
  });

  it("preserves configured skills and tools on the service agent", () => {
    skillRegistryInternal.clearAll();
    registerSkill("support-triage", {
      id: "support-triage",
      metadata: { name: "support-triage", description: "Triage support requests" },
      rootPath: "/test/skills/support-triage",
    });

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
        skills: ["support-triage"],
        tools: ["search_knowledge", "get_file"],
      }),
      logger: createLogger(),
      prepareExecution: async () => ({ ok: true }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
    });

    const serviceAgent = bundle.runtime.contract.agents.assistant;

    assertEquals(serviceAgent?.config.skills, ["support-triage"]);
    const tools = serviceAgent?.config.tools;
    assert(tools && tools !== true);
    assertEquals(tools?.search_knowledge, true);
    assertEquals(tools?.get_file, true);
    assertEquals(typeof tools?.load_skill, "object");
    assertEquals(typeof tools?.load_skill_reference, "object");
    assertEquals(typeof tools?.execute_skill_script, "object");
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

  it("runs secondary shutdown lifecycle even when primary stop fails", async () => {
    const events: string[] = [];
    const shutdownError = new Error("primary shutdown failed");
    const lifecycle = combineAgentServiceLifecycle(
      {
        stop: () => {
          events.push("primary-stop");
          throw shutdownError;
        },
      },
      {
        stop: () => {
          events.push("secondary-stop");
        },
      },
    );

    const rejected = await assertRejects(
      async () => {
        await lifecycle.stop?.();
      },
      Error,
      "primary shutdown failed",
    );

    assertEquals(rejected, shutdownError);
    assertEquals(events, ["primary-stop", "secondary-stop"]);
  });

  it("fans shutdown notice out to both lifecycles", () => {
    const events: string[] = [];
    const lifecycle = combineAgentServiceLifecycle(
      {
        setShuttingDown: () => {
          events.push("primary-setShuttingDown");
        },
      },
      {
        setShuttingDown: () => {
          events.push("secondary-setShuttingDown");
        },
      },
    );

    lifecycle.setShuttingDown?.();

    assertEquals(
      events,
      ["primary-setShuttingDown", "secondary-setShuttingDown"],
      "both lifecycles must learn the service is draining",
    );
  });

  it("fans shutdown notice out to both lifecycles even when the primary throws", () => {
    const events: string[] = [];
    const shutdownError = new Error("primary shutdown failed");
    const lifecycle = combineAgentServiceLifecycle(
      {
        setShuttingDown: () => {
          events.push("primary-setShuttingDown");
          throw shutdownError;
        },
      },
      {
        setShuttingDown: () => {
          events.push("secondary-setShuttingDown");
        },
      },
    );

    const thrown = assertThrows(
      () => {
        lifecycle.setShuttingDown?.();
      },
      Error,
      "primary shutdown failed",
    );

    assertEquals(thrown, shutdownError, "the primary failure must still surface to the caller");
    assertEquals(
      events,
      ["primary-setShuttingDown", "secondary-setShuttingDown"],
      "both lifecycles must learn the service is draining",
    );
  });
});
