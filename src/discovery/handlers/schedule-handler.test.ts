import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { schedule } from "#veryfront/schedule";
import { scheduleHandler } from "./schedule-handler.ts";

describe("discovery/schedule-handler", () => {
  it("registers an owned canonical schedule snapshot", () => {
    const definition = schedule({
      id: "daily-triage",
      schedule: "0 8 * * 1-5",
      target: { kind: "workflow", id: "escalate-ticket" },
      input: { queue: "priority" },
      integrationRequirements: [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }],
    });

    const registered = scheduleHandler.register(
      definition.id,
      definition,
      "schedules/daily-triage.ts",
      "schedules",
    );
    definition.input!.queue = "mutated";
    definition.target.id = "mutated";
    definition.integrationRequirements![0]!.requiredScopes[0] = "mutated";
    definition.integrationRequirements![0]!.resources[0]!.id = "mutated";

    assertStrictEquals(registered === definition, false);
    assertEquals(registered, {
      id: "daily-triage",
      schedule: "0 8 * * 1-5",
      target: { kind: "workflow", id: "escalate-ticket" },
      input: { queue: "priority" },
      integrationRequirements: [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }],
    });
  });
});

describe("discovery/schedule-handler agent targets", () => {
  it("registers canonical agent conversation addressing and message content", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
      agentMessage: { prompt: "Triage every open case created since the last run." },
    });

    const registered = scheduleHandler.register(
      definition.id,
      definition,
      "schedules/triage-new-cases.ts",
      "schedules",
    );

    assertEquals(registered, {
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
      agentMessage: { prompt: "Triage every open case created since the last run." },
    });
  });
});
