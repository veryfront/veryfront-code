import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { webhook } from "#veryfront/webhook";
import { webhookHandler } from "./webhook-handler.ts";

describe("discovery/webhook-handler", () => {
  it("registers an owned canonical webhook snapshot", () => {
    const definition = webhook({
      id: "ticket-created",
      target: { kind: "agent", id: "support-agent" },
      eventFilter: {
        mode: "all",
        conditions: [
          {
            path: "project",
            operator: "equals",
            value: { id: "project-1" },
          },
        ],
      },
      agentMessage: {
        promptTemplate: "Triage {{payload.project.id}}.",
        conversationMode: "none",
      },
    });

    const registered = webhookHandler.register(
      definition.id,
      definition,
      "webhooks/ticket-created.ts",
      "webhooks",
    );
    definition.target.id = "mutated";
    const condition = definition.eventFilter!.conditions[0]!;
    condition.path = "mutated";
    (condition.value as { id: string }).id = "mutated";
    definition.agentMessage!.promptTemplate = "Mutated.";

    assertStrictEquals(registered === definition, false);
    assertEquals(registered, {
      id: "ticket-created",
      target: { kind: "agent", id: "support-agent" },
      eventFilter: {
        mode: "all",
        conditions: [
          {
            path: "project",
            operator: "equals",
            value: { id: "project-1" },
          },
        ],
      },
      agentMessage: {
        promptTemplate: "Triage {{payload.project.id}}.",
        conversationMode: "none",
      },
    });
  });
});
