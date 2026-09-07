import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AgentContract,
  type AgentServiceRegistryContract,
  type AgentServiceRoute,
  type AgentServiceSingleAgentContract,
  defineAgentService,
  type DurableRunSink,
} from "../index.ts";
import { agent } from "../factory.ts";

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

  it("provides a host request helper for relative runtime checks", async () => {
    const runtime = defineAgentService({
      serviceName: "veryfront-agent",
      agent: assistant,
    }).createRuntime({
      routes: [
        {
          method: "POST",
          path: "/echo",
          handler: async (request) =>
            Response.json({
              method: request.method,
              body: await request.text(),
            }),
        },
      ],
    });

    const ready = await runtime.request("/readiness");
    assertEquals(ready.status, 200);
    assertEquals(await ready.text(), "OK");

    const echo = await runtime.request("/echo", { method: "POST", body: "hello" });
    assertEquals(echo.status, 200);
    assertEquals(await echo.json(), { method: "POST", body: "hello" });
  });

  it("preserves a native Request body when it is used as RequestInit", async () => {
    const runtime = defineAgentService({
      serviceName: "request-init-service",
      agent: assistant,
    }).createRuntime({
      routes: [{
        method: "POST",
        path: "/echo",
        handler: async (request) =>
          Response.json({
            body: await request.text(),
            contentType: request.headers.get("Content-Type"),
          }),
      }],
    });
    const createInit = () =>
      new Request("https://source.example.test", {
        method: "POST",
        body: "hello",
      });
    const expectedRequest = new Request("http://localhost/echo", createInit());
    const expected = {
      body: await expectedRequest.text(),
      contentType: expectedRequest.headers.get("Content-Type"),
    };

    const response = await runtime.request("/echo", createInit());

    assertEquals(response.status, 200);
    assertEquals(await response.json(), expected);
  });

  it("uses only own slots from HeadersInit arrays and tuple entries", async () => {
    const runtime = defineAgentService({
      serviceName: "headers-init-own-slots-service",
      agent: assistant,
    }).createRuntime({
      routes: [{
        method: "GET",
        path: "/headers",
        handler: (request) =>
          Response.json({
            own: request.headers.get("X-Own"),
            inherited: request.headers.get("X-Inherited"),
            mutating: request.headers.get("X-Mutating"),
          }),
      }],
    });
    let inheritedReads = 0;
    const outerPrototype = Object.create(Array.prototype);
    Object.defineProperty(outerPrototype, "1", {
      configurable: true,
      get() {
        inheritedReads += 1;
        return ["X-Inherited", "outer"];
      },
    });
    const headers: [string, string][] = [["X-Own", "present"]];
    headers.length = 2;
    Object.setPrototypeOf(headers, outerPrototype);

    const response = await runtime.request("/headers", { headers });
    assertEquals(inheritedReads, 0);
    assertEquals(await response.json(), { own: "present", inherited: null, mutating: null });

    const entryPrototype = Object.create(Array.prototype);
    Object.defineProperty(entryPrototype, "1", {
      configurable: true,
      get() {
        inheritedReads += 1;
        return "inherited";
      },
    });
    const sparseEntry = ["X-Sparse"] as unknown as [string, string];
    sparseEntry.length = 2;
    Object.setPrototypeOf(sparseEntry, entryPrototype);
    await assertRejects(
      async () => await runtime.request("/headers", { headers: [sparseEntry] }),
      TypeError,
      "Header entry must contain a name and value",
    );
    const incompleteIterable = {
      *[Symbol.iterator]() {
        yield ["X-Only-Name"];
      },
    } as unknown as HeadersInit;
    await assertRejects(
      async () => await runtime.request("/headers", { headers: incompleteIterable }),
      TypeError,
      "Header entry must contain a name and value",
    );
    assertEquals(inheritedReads, 0);

    const mutatingEntry = ["X-Mutating", "captured"] as [string, string];
    const mutatingPrototype = Object.create(Array.prototype);
    Object.defineProperty(mutatingPrototype, "1", {
      configurable: true,
      get() {
        inheritedReads += 1;
        return "inherited";
      },
    });
    Object.setPrototypeOf(mutatingEntry, mutatingPrototype);
    Object.defineProperty(mutatingEntry, "0", {
      configurable: true,
      enumerable: true,
      get() {
        Reflect.deleteProperty(mutatingEntry, "1");
        return "X-Mutating";
      },
    });
    await assertRejects(
      async () => await runtime.request("/headers", { headers: [mutatingEntry] }),
      TypeError,
      "Header entry must contain a name and value",
    );
    assertEquals(inheritedReads, 0);

    const updatingEntry = ["X-Mutating", "original"] as [string, string];
    Object.defineProperty(updatingEntry, "0", {
      configurable: true,
      enumerable: true,
      get() {
        Object.defineProperty(updatingEntry, "1", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: "updated",
        });
        return "X-Mutating";
      },
    });
    const updatingResponse = await runtime.request("/headers", { headers: [updatingEntry] });
    assertEquals(await updatingResponse.json(), {
      own: null,
      inherited: null,
      mutating: "updated",
    });
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
          path: "/api/runs/:runId",
          handler: (_request, params) => Response.json({ runId: params.runId }),
        },
      ],
    });

    const response = await runtime.fetch(
      new Request("https://agent.test/api/runs/run-123", { method: "DELETE" }),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { runId: "run-123" });

    const missing = await runtime.fetch(new Request("https://agent.test/not-found"));
    assertEquals(missing.status, 404);

    const wrongMethod = await runtime.fetch(new Request("https://agent.test/api/runs/run-123"));
    assertEquals(
      wrongMethod.status,
      404,
      "a matching path with a different method must not dispatch the route",
    );
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
      new Request("https://agent.test/api/runs", {
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
    assertStringIncludes(
      response.headers.get("Vary") ?? "",
      "Origin",
      "per-origin CORS preflight responses must vary on Origin",
    );
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
      new Request("https://agent.test/api/runs", {
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
    assertStringIncludes(
      response.headers.get("Vary") ?? "",
      "Origin",
      "per-origin CORS responses must vary on Origin",
    );
  });
});
