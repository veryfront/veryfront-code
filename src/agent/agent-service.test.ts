import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type AgentContract, defineAgentService, type DurableRunSink } from "./index.ts";
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
      agent: assistant,
      server: { port: 3001, basePath: "/api/ag-ui" },
      durableRunSink,
    };

    assertEquals(contract.serviceName, "veryfront-agent");
    assertEquals(contract.agent.id, "phase-0-service-stub");
    assertEquals(contract.server?.port, 3001);
    assertEquals(contract.durableRunSink?.startRun({ requestId: "run-123" }), {
      runId: "run-123",
    });
  });

  it("throws until the hosted runtime service implementation lands", async () => {
    await assertRejects(
      async () => {
        defineAgentService({ serviceName: "veryfront-agent", agent: assistant });
      },
      Error,
      "Phase 0 stub",
    );
  });
});
