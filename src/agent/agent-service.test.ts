import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AgentContract,
  type AgentServiceRegistryContract,
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
    assertEquals(contract.agents.assistant.id, "phase-0-service-stub");
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
    assertEquals(registryContract.agents.reviewer.id, "reviewer");
    assertEquals(singleAgentContract.agent.id, "phase-0-service-stub");
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
