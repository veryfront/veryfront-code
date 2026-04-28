import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AgentContract,
  type AgentServiceRegistryContract,
  type AgentServiceRoute,
  type AgentServiceSingleAgentContract,
  defineAgentService,
  type DurableRunSink,
} from "./index.ts";
import { agent } from "./factory.ts";

const assistant = agent({
  id: "phase-0-service-stub",
  system: "You are a hosted service stub test agent.",
});

describe("agent/agent-service", () => {
  it("exports a typed contract surface for future hosted service adoption", () => {
    const durableRunSink: DurableRunSink<
      { requestId: string },
      { runId: string },
      { type: string },
      { status: string }
    > = {
      startRun(input) {
        return { runId: input.requestId };
      },
      appendEvents() {},
      finalizeRun() {},
      cancelRun() {},
    };

    const contract: AgentContract<
      { requestId: string },
      { runId: string },
      { type: string },
      { status: string }
    > = {
      serviceName: "veryfront-agent",
      agents: { assistant },
      defaultAgentId: "assistant",
      server: { port: 3001, basePath: "/api/ag-ui" },
      durableRunSink,
    };

    assertEquals(contract.serviceName, "veryfront-agent");
    assertEquals(contract.agents.assistant?.id, "phase-0-service-stub");
    assertEquals(contract.defaultAgentId, "assistant");
    assertEquals(contract.server?.port, 3001);
    assertEquals(contract.durableRunSink?.startRun({ requestId: "run-123" }), {
      runId: "run-123",
    });
  });

  it("accepts single-agent convenience without replacing the multi-agent registry shape", () => {
    const registryContract: AgentServiceRegistryContract = {
      serviceName: "multi-agent-service",
      agents: {
        assistant,
        reviewer: agent({
          id: "reviewer",
          system: "Review implementation plans.",
        }),
      },
      defaultAgentId: "assistant",
    };

    const singleAgentContract: AgentServiceSingleAgentContract = {
      serviceName: "single-agent-service",
      agent: assistant,
    };

    assertEquals(registryContract.defaultAgentId, "assistant");
    assertEquals(registryContract.agents.reviewer?.id, "reviewer");
    assertEquals(singleAgentContract.agent.id, "phase-0-service-stub");
  });

  it("normalizes single-agent convenience into the registry contract", () => {
    const service = defineAgentService({
      serviceName: "veryfront-agent",
      agent: assistant,
    });

    assertEquals(service.contract.serviceName, "veryfront-agent");
    assertEquals(service.contract.defaultAgentId, assistant.id);
    assertEquals(service.contract.agents[assistant.id], assistant);
  });

  it("exports the host route type accepted by service runtimes", async () => {
    const routes: AgentServiceRoute[] = [
      {
        method: "GET",
        path: "/custom/:id",
        handler: (_request, params) => Response.json({ id: params.id }),
      },
    ];

    const runtime = defineAgentService({
      serviceName: "route-type-service",
      agent: assistant,
    }).createRuntime({ routes });

    const response = await runtime.fetch(new Request("https://agent.test/custom/route-1"));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { id: "route-1" });
  });

  it("creates a runtime with readiness and liveness routes", async () => {
    const runtime = defineAgentService({
      serviceName: "veryfront-agent",
      agent: assistant,
    }).createRuntime();

    const ready = await runtime.fetch(new Request("https://agent.test/readiness"));
    assertEquals(ready.status, 200);
    assertEquals(await ready.text(), "OK");

    const live = await runtime.fetch(new Request("https://agent.test/liveness"));
    assertEquals(live.status, 200);
    assertEquals(await live.text(), "OK");

    runtime.setShuttingDown();
    const shuttingDown = await runtime.fetch(new Request("https://agent.test/readiness"));
    assertEquals(shuttingDown.status, 503);
    assertEquals(await shuttingDown.text(), "Shutting down");
  });

  it("dispatches host-owned routes without taking over product policy", async () => {
    const runtime = defineAgentService({
      serviceName: "veryfront-agent",
      agents: { assistant },
      defaultAgentId: "assistant",
    }).createRuntime({
      routes: [
        {
          method: "DELETE",
          path: "/api/ag-ui/runs/:runId",
          handler: (_request, params) => Response.json({ runId: params.runId }),
        },
      ],
    });

    const response = await runtime.fetch(
      new Request("https://agent.test/api/ag-ui/runs/run-123", { method: "DELETE" }),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { runId: "run-123" });

    const missing = await runtime.fetch(new Request("https://agent.test/not-found"));
    assertEquals(missing.status, 404);
  });

  it("handles CORS preflight through the runtime shell", async () => {
    const runtime = defineAgentService({
      serviceName: "veryfront-agent",
      agent: assistant,
      server: {
        cors: {
          origins: ["http://localhost:3000"],
          credentials: true,
        },
      },
    }).createRuntime();

    const response = await runtime.fetch(
      new Request("https://agent.test/api/ag-ui/runs", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type,Authorization",
        },
      }),
    );

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
    assertEquals(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assertEquals(
      response.headers.get("Access-Control-Allow-Headers"),
      "Content-Type,Authorization",
    );
  });

  it("does not allow disallowed CORS origins", async () => {
    const runtime = defineAgentService({
      serviceName: "veryfront-agent",
      agent: assistant,
      server: {
        cors: {
          origins: ["http://localhost:3000"],
          credentials: true,
        },
      },
    }).createRuntime();

    const response = await runtime.fetch(
      new Request("https://agent.test/api/ag-ui/runs", {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
        },
      }),
    );

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("adds CORS headers to runtime responses for allowed origins", async () => {
    const runtime = defineAgentService({
      serviceName: "veryfront-agent",
      agent: assistant,
      server: {
        cors: {
          origins: ["http://localhost:3000"],
          credentials: true,
        },
      },
    }).createRuntime();

    const response = await runtime.fetch(
      new Request("https://agent.test/readiness", {
        headers: {
          Origin: "http://localhost:3000",
        },
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
    assertEquals(response.headers.get("Access-Control-Allow-Credentials"), "true");
  });
});
