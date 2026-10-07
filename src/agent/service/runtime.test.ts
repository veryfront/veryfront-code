import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import {
  combineAgentServiceLifecycle,
  createAgentServiceRuntime,
  createHostedAgentServiceRuntime,
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
      deploymentArtifact: "20261007183045-a1b2c3d4e5f6",
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
      "/version",
      "/api/ag-ui",
      "/api/runs/:runId",
      "/api/runs/:runId/resume",
      "/api/control-plane/runs/:runId/resume",
      "/api/runs",
      "/api/control-plane/runs/:runId/stream",
    ]);

    const version = await bundle.runtime.request("/version");
    assertEquals(version.status, 200);
    assertEquals(version.headers.get("Cache-Control"), "no-store");
    assertEquals(await version.json(), { artifact: "20261007183045-a1b2c3d4e5f6" });

    const ready = await bundle.runtime.request("/readiness");
    assertEquals(ready.status, 200);
  });

  it("serves null for unknown deployment artifact", async () => {
    const bundle = createHostedAgentServiceRuntime({
      serviceName: "test-agent-service",
      deploymentArtifact: null,
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

    const version = await bundle.runtime.request("/version");

    assertEquals(version.status, 200);
    assertEquals(version.headers.get("Cache-Control"), "no-store");
    assertEquals(await version.json(), { artifact: null });
  });

  it("snapshots deployment artifact at runtime startup", async () => {
    const options = {
      serviceName: "test-agent-service",
      deploymentArtifact: "20261007183045-a1b2c3d4e5f6",
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
    };
    const bundle = createHostedAgentServiceRuntime(options);
    options.deploymentArtifact = "20261007183100-bbbbbbbbbbbb";

    const version = await bundle.runtime.request("/version");

    assertEquals(await version.json(), { artifact: "20261007183045-a1b2c3d4e5f6" });
  });

  it("rejects invalid deployment artifact tags during startup", () => {
    assertThrows(
      () =>
        createHostedAgentServiceRuntime({
          serviceName: "test-agent-service",
          deploymentArtifact: "latest",
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
        }),
      TypeError,
      "deploymentArtifact must be null or an immutable artifact tag",
    );
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
        providerTools: ["web_search", "web_fetch"],
        deniedTools: ["load_skill", "web_search"],
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
    assertEquals(tools?.load_skill, false);
    assertEquals(typeof tools?.load_skill_reference, "object");
    assertEquals(typeof tools?.execute_skill_script, "object");
    assertEquals(serviceAgent?.config.providerTools, ["web_fetch"]);
  });

  it("suppresses skill infrastructure when an unrestricted selector with denials fails closed", () => {
    const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
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
        instructions: "Use every tool except denied tools.",
        tools: true,
        deniedTools: ["update_file"],
        skills: true,
      }),
      logger: {
        ...createLogger(),
        warn(message, metadata) {
          warnings.push({ message, metadata });
        },
      },
      prepareExecution: async () => ({ ok: true }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {},
    });

    assertEquals(warnings, [{
      message: "Agent tool selection failed closed",
      metadata: { agent_id: "assistant", denied_tool_count: 1 },
    }]);
    const serviceAgent = bundle.runtime.contract.agents.assistant;
    assertEquals(serviceAgent?.config.skills, false);
    assertEquals(serviceAgent?.config.tools, { update_file: false });
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
