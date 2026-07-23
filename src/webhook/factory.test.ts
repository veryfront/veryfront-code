import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

  it("snapshots nested filters and message mappings", () => {
    const nested = { priority: "high" };
    const condition = { path: "$.ticket", operator: "equals" as const, value: nested };
    const eventFilter = { mode: "all" as const, conditions: [condition] };
    const agentMessage = { promptTemplate: "Handle {{event}}" };

    const definition = webhook({
      id: "agent-ticket-created",
      target: { kind: "agent", id: "support-agent" },
      eventFilter,
      agentMessage,
    });
    nested.priority = "changed";
    condition.path = "$.changed";
    agentMessage.promptTemplate = "changed";

    assertEquals(definition.eventFilter, {
      mode: "all",
      conditions: [{ path: "$.ticket", operator: "equals", value: { priority: "high" } }],
    });
    assertEquals(definition.agentMessage, { promptTemplate: "Handle {{event}}" });
    assertNotStrictEquals(definition.eventFilter, eventFilter);
    assertNotStrictEquals(definition.eventFilter?.conditions[0]?.value, nested);
  });

  it("does not execute accessors while validating definitions", () => {
    let reads = 0;
    const condition = { operator: "equals", value: "ticket.created" };
    Object.defineProperty(condition, "path", {
      enumerable: true,
      get() {
        reads += 1;
        return "$.type";
      },
    });

    const error = assertThrows(
      () =>
        webhook({
          id: "ticket-created",
          target: { kind: "workflow", id: "escalate-ticket" },
          eventFilter: { mode: "all", conditions: [condition] } as never,
        }),
      VeryfrontError,
    );

    assertEquals(error.slug, "webhook-config-invalid");
    assertEquals(reads, 0);
  });

  it("contains revoked proxies behind a typed configuration error", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    const error = assertThrows(
      () => webhook(proxy as never),
      VeryfrontError,
    );

    assertEquals(error.slug, "webhook-config-invalid");
  });

  it("uses webhook errors for invalid ids and rejects unknown fields", () => {
    const invalidId = assertThrows(
      () =>
        webhook({
          id: "Ticket Created",
          target: { kind: "workflow", id: "escalate-ticket" },
        }),
      VeryfrontError,
    );
    assertEquals(invalidId.slug, "webhook-config-invalid");

    const unknownField = assertThrows(
      () =>
        webhook({
          id: "ticket-created",
          target: { kind: "workflow", id: "escalate-ticket" },
          signingSecret: "unsupported",
        } as never),
      VeryfrontError,
    );
    assertEquals(unknownField.slug, "webhook-config-invalid");
  });

  it("enforces bounded exact filter and message contracts", () => {
    const base = {
      id: "ticket-created",
      target: { kind: "workflow", id: "escalate-ticket" },
    } as const;

    for (
      const config of [
        { ...base, name: "x".repeat(256) },
        {
          ...base,
          eventFilter: {
            mode: "all",
            conditions: new Array(257).fill({
              path: "$.type",
              operator: "exists",
            }),
          },
        },
        {
          ...base,
          eventFilter: {
            mode: "all",
            conditions: [{
              path: "$.type",
              operator: "equals",
              unsupported: true,
            }],
          },
        },
        { ...base, agentMessage: { promptTemplate: "ok", unsupported: true } },
      ]
    ) {
      const error = assertThrows(() => webhook(config as never), VeryfrontError);
      assertEquals(error.slug, "webhook-config-invalid");
    }
  });

  it("validates the complete definition instead of only id and target presence", () => {
    assertEquals(
      isWebhookDefinition({
        id: "ticket-created",
        target: { kind: "queue", id: "priority" },
      }),
      false,
    );
    assertEquals(
      isWebhookDefinition({
        id: "ticket-created",
        target: { kind: "workflow", id: "escalate-ticket" },
        eventFilter: { mode: "all", conditions: [{ path: "$.type", operator: "unknown" }] },
      }),
      false,
    );
    assertEquals(
      isWebhookDefinition({
        id: "agent-ticket-created",
        target: { kind: "agent", id: "support-agent" },
      }),
      false,
    );
  });
});
