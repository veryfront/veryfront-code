import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "./factory.ts";
import { defineAgentService } from "./agent-service.ts";
import { createAgentServiceServerRuntime } from "./agent-service-server.ts";

const assistant = agent({
  id: "server-runtime-test-agent",
  system: "You verify agent service server runtime behavior.",
});

describe("agent/agent-service-server", () => {
  it("wraps an agent service runtime in a Veryfront service server runtime", async () => {
    const serviceRuntime = defineAgentService({
      serviceName: "agent-service-server-test",
      agent: assistant,
    }).createRuntime({
      routes: [
        {
          method: "GET",
          path: "/custom",
          handler: () => new Response("custom response"),
        },
      ],
    });

    const serverRuntime = createAgentServiceServerRuntime({
      runtime: serviceRuntime,
    });

    const response = await serverRuntime.fetch(new Request("https://agent.test/custom"));

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "custom response");
  });

  it("runs host lifecycle hooks during graceful shutdown", async () => {
    const serviceRuntime = defineAgentService({
      serviceName: "agent-service-shutdown-test",
      agent: assistant,
    }).createRuntime();
    const lifecycleEvents: string[] = [];

    const serverRuntime = createAgentServiceServerRuntime({
      runtime: serviceRuntime,
      lifecycle: {
        setShuttingDown: () => {
          lifecycleEvents.push("host-set-shutting-down");
        },
        stop: () => {
          lifecycleEvents.push("host-stop");
        },
      },
    });

    serverRuntime.setShuttingDown();
    const readiness = await serviceRuntime.fetch(new Request("https://agent.test/readiness"));
    await serverRuntime.stop();

    assertEquals(readiness.status, 503);
    assertEquals(lifecycleEvents, ["host-set-shutting-down", "host-stop"]);
  });
});
