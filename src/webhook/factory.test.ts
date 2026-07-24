import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { webhook } from "./factory.ts";
import { isWebhookDefinition } from "./types.ts";

describe("webhook/factory", () => {
  it("normalizes workflow webhooks without a prompt template", () => {
    const definition = webhook({
      id: "ticket-created",
      name: "Ticket created",
      target: { kind: "workflow", id: "escalate-ticket" },
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "$.type", operator: "equals", value: "ticket.created" },
        ],
      },
    });

    assertEquals(definition, {
      id: "ticket-created",
      name: "Ticket created",
      target: { kind: "workflow", id: "escalate-ticket" },
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "$.type", operator: "equals", value: "ticket.created" },
        ],
      },
    });
    assertEquals(isWebhookDefinition(definition), true);
  });

  it("requires an agent message mapping for agent targets", () => {
    assertThrows(
      () =>
        webhook({
          id: "agent-ticket-created",
          target: { kind: "agent", id: "support-agent" },
        }),
      VeryfrontError,
      "Agent webhooks must define agentMessage.promptTemplate.",
    );
  });

  it("rejects non-serializable filter values", () => {
    assertThrows(
      () =>
        webhook({
          id: "ticket-created",
          target: { kind: "workflow", id: "escalate-ticket" },
          eventFilter: {
            mode: "all",
            conditions: [
              { path: "$.createdAt", operator: "equals", value: new Date() },
            ],
          },
        }),
      VeryfrontError,
      "Webhook eventFilter condition 0 value must be JSON-serializable.",
    );
  });
});
