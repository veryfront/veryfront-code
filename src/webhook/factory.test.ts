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

  it("rejects malformed public inputs with the webhook configuration error", () => {
    for (
      const [config, message] of [
        [null, "Webhook configuration must be an object."],
        [
          {
            id: "ticket-created",
            target: { kind: "workflow", id: "escalate-ticket" },
            eventFilter: { mode: "all", conditions: [null] },
          },
          "Webhook eventFilter condition 0 must be an object.",
        ],
        [
          {
            id: "agent-ticket-created",
            target: { kind: "agent", id: "support-agent" },
            agentMessage: { promptTemplate: 42 },
          },
          "Webhook agentMessage.promptTemplate is required.",
        ],
      ] as const
    ) {
      assertThrows(
        () => webhook(config as never),
        VeryfrontError,
        message,
      );
    }
  });

  it("rejects values that cannot be represented faithfully as JSON", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (
      const [value, message] of [
        [Number.NaN, "Webhook eventFilter condition 0 value must be JSON-serializable."],
        [
          Number.POSITIVE_INFINITY,
          "Webhook eventFilter condition 0 value must be JSON-serializable.",
        ],
        [cyclic, "Webhook eventFilter condition 0 value.self must be JSON-serializable."],
      ] as const
    ) {
      assertThrows(
        () =>
          webhook({
            id: "ticket-created",
            target: { kind: "workflow", id: "escalate-ticket" },
            eventFilter: {
              mode: "all",
              conditions: [{ path: "$.value", operator: "equals", value }],
            },
          }),
        VeryfrontError,
        message,
      );
    }
  });

  it("validates the complete discovery boundary without throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const inheritedRequiredFields = new Proxy({}, {
      get(_target, property): unknown {
        if (property === "id") return "ticket-created";
        if (property === "target") {
          return { kind: "workflow", id: "escalate-ticket" };
        }
        return undefined;
      },
    });

    for (
      const value of [
        null,
        [],
        inheritedRequiredFields,
        { id: "ticket-created", target: {} },
        {
          id: "Ticket Created",
          target: { kind: "workflow", id: "escalate-ticket" },
        },
        {
          id: "ticket-created",
          target: { kind: "queue", id: "priority" },
        },
        {
          id: "ticket-created",
          target: { kind: "workflow", id: "escalate-ticket" },
          eventFilter: { mode: "all", conditions: [null] },
        },
        {
          id: "ticket-created",
          target: { kind: "workflow", id: "escalate-ticket" },
          eventFilter: {
            mode: "all",
            conditions: [{ path: "$.value", operator: "equals", value: cyclic }],
          },
        },
        {
          id: "agent-ticket-created",
          target: { kind: "agent", id: "support-agent" },
        },
      ]
    ) {
      assertEquals(isWebhookDefinition(value), false);
    }
  });
});
