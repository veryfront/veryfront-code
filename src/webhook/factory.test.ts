import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
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
          { path: "type", operator: "equals", value: "ticket.created" },
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
          { path: "type", operator: "equals", value: "ticket.created" },
        ],
      },
    });
    assertEquals(isWebhookDefinition(definition), true);
  });

  it("treats undefined non-agent conversation fields as omitted", () => {
    const taskDefinition = webhook({
      id: "conditional-task",
      target: {
        kind: "task",
        id: "sync-helpdesk",
        conversationMode: undefined,
      },
    });
    const workflowDefinition = webhook({
      id: "conditional-workflow",
      target: {
        kind: "workflow",
        id: "billing/sync",
        conversationId: undefined,
      },
    });

    assertEquals(taskDefinition.target, { kind: "task", id: "sync-helpdesk" });
    assertEquals(workflowDefinition.target, { kind: "workflow", id: "billing/sync" });
  });

  it("copies caller-owned filter values before retaining a webhook definition", () => {
    const filterValue = { project: { id: "project-1" } };
    const definition = webhook({
      id: "ticket-created",
      target: { kind: "workflow", id: "escalate-ticket" },
      eventFilter: {
        mode: "all",
        conditions: [{ path: "$.project", operator: "equals", value: filterValue }],
      },
    });

    filterValue.project.id = "mutated";

    assertEquals(definition.eventFilter?.conditions[0]?.value, {
      project: { id: "project-1" },
    });
    assertEquals(definition.eventFilter?.conditions[0]?.value === filterValue, false);
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

  it("normalizes cloud-compatible agent conversation metadata", () => {
    const definition = webhook({
      id: "agent-ticket-created",
      target: { kind: "agent", id: "support-agent" },
      agentMessage: {
        promptTemplate: "Triage {{payload.summary}}.",
        conversationMode: "existing",
        conversationId: "11111111-1111-4111-8111-111111111111",
      },
    });

    assertEquals(definition.agentMessage, {
      promptTemplate: "Triage {{payload.summary}}.",
      conversationMode: "existing",
      conversationId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("supports every hosted filter operator and an empty match-all filter", () => {
    const definition = webhook({
      id: "ticket-created",
      target: { kind: "task", id: "process-ticket" },
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "action", operator: "equals", value: "opened" },
          { path: "draft", operator: "not_equals", value: true },
          { path: "action", operator: "in", value: ["opened", "reopened"] },
          { path: "number", operator: "exists" },
          { path: "labels", operator: "contains", value: "backend" },
        ],
      },
    });
    const matchAll = webhook({
      id: "all-events",
      target: { kind: "workflow", id: "process-event" },
      eventFilter: { mode: "any", conditions: [] },
    });

    assertEquals(
      definition.eventFilter?.conditions.map((condition) => condition.operator),
      ["equals", "not_equals", "in", "exists", "contains"],
    );
    assertEquals(matchAll.eventFilter, { mode: "any", conditions: [] });
  });

  it("trims filter paths before enforcing the hosted length bound", () => {
    const definition = webhook({
      id: "ticket-created",
      target: { kind: "task", id: "process-ticket" },
      eventFilter: {
        mode: "all",
        conditions: [{
          path: ` ${"p".repeat(255)} `,
          operator: "exists",
        }],
      },
    });

    assertEquals(
      definition.eventFilter?.conditions[0]?.path,
      "p".repeat(255),
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
        [cyclic, "Webhook eventFilter condition 0 value must be JSON-serializable."],
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

  it("rejects unsupported fields, accessors, custom prototypes, and sparse arrays", () => {
    let getterCalls = 0;
    const accessorConfig = {
      target: { kind: "workflow", id: "escalate-ticket" },
    };
    Object.defineProperty(accessorConfig, "id", {
      enumerable: true,
      get() {
        getterCalls++;
        return "ticket-created";
      },
    });
    const inheritedCondition = Object.create({
      path: "action",
      operator: "equals",
      value: "opened",
    });
    const sparseConditions = Array(1);

    for (
      const [config, message] of [
        [
          {
            id: "ticket-created",
            target: { kind: "workflow", id: "escalate-ticket" },
            unsupported: true,
          },
          "Webhook configuration.unsupported is not supported.",
        ],
        [
          accessorConfig,
          "Webhook configuration.id must be an own enumerable data property.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "workflow", id: "escalate-ticket", extra: true },
          },
          "Webhook target.extra is not supported.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "workflow", id: "escalate-ticket" },
            eventFilter: {
              mode: "all",
              conditions: [inheritedCondition],
            },
          },
          "Webhook eventFilter condition 0 must be a plain object.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "workflow", id: "escalate-ticket" },
            eventFilter: { mode: "all", conditions: sparseConditions },
          },
          "Webhook eventFilter conditions[0] must be an enumerable data property.",
        ],
      ] as const
    ) {
      assertThrows(
        () => webhook(config as never),
        VeryfrontError,
        message,
      );
    }
    assertEquals(getterCalls, 0);
  });

  it("enforces hosted reconciliation bounds", () => {
    const condition = { path: "action", operator: "exists" } as const;
    for (
      const [config, message] of [
        [
          {
            id: "a".repeat(129),
            target: { kind: "task", id: "process-ticket" },
          },
          "Webhook id must be at most 128 characters.",
        ],
        [
          {
            id: "ticket-created",
            name: "n".repeat(121),
            target: { kind: "task", id: "process-ticket" },
          },
          "Webhook name must be at most 120 characters.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "task", id: "t".repeat(256) },
          },
          "Webhook target must specify a task, workflow, or agent id of at most 255 characters",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "task", id: "process-ticket" },
            eventFilter: {
              mode: "all",
              conditions: [{ path: "p".repeat(256), operator: "exists" }],
            },
          },
          "Webhook eventFilter condition 0 path must be at most 255 characters.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "task", id: "process-ticket" },
            eventFilter: {
              mode: "all",
              conditions: Array.from({ length: 51 }, () => condition),
            },
          },
          "Webhook eventFilter conditions must contain at most 50 entries.",
        ],
        [
          {
            id: "agent-ticket-created",
            target: { kind: "agent", id: "support-agent" },
            agentMessage: { promptTemplate: "p".repeat(20_001) },
          },
          "Webhook agentMessage.promptTemplate must be at most 20000 characters.",
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

  it("rejects control characters in identifiers, labels, and filter paths", () => {
    for (
      const [config, message] of [
        [
          {
            id: "ticket-created\u0000",
            target: { kind: "task", id: "process-ticket" },
          },
          "Webhook id must not contain control characters.",
        ],
        [
          {
            id: "ticket-created",
            name: "Ticket\u0007created",
            target: { kind: "task", id: "process-ticket" },
          },
          "Webhook name must not contain control characters.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "task", id: "process-ticket" },
            eventFilter: {
              mode: "all",
              conditions: [{ path: "action\nkind", operator: "exists" }],
            },
          },
          "Webhook eventFilter condition 0 path must not contain control characters.",
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

  it("rejects misleading agent mappings and invalid conversation relationships", () => {
    for (
      const [config, message] of [
        [
          {
            id: "ticket-created",
            target: { kind: "task", id: "process-ticket" },
            agentMessage: { promptTemplate: "Unused." },
          },
          "Webhook agentMessage is supported only for agent targets.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "agent", id: "support-agent" },
            agentMessage: {
              promptTemplate: "Triage.",
              conversationMode: "existing",
            },
          },
          "Webhook agentMessage.conversationId is required when conversationMode is existing.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "agent", id: "support-agent" },
            agentMessage: {
              promptTemplate: "Triage.",
              conversationMode: "none",
              conversationId: "11111111-1111-4111-8111-111111111111",
            },
          },
          "Webhook agentMessage.conversationId is allowed only when conversationMode is existing.",
        ],
        [
          {
            id: "ticket-created",
            target: { kind: "agent", id: "support-agent" },
            agentMessage: {
              promptTemplate: "Triage.",
              conversationMode: "existing",
              conversationId: "not-a-uuid",
            },
          },
          "Webhook agentMessage.conversationId must be a UUID or null.",
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

  it("owns nested target, filter, and agent mapping state", () => {
    const target = { kind: "agent" as const, id: "support-agent" };
    const conditions = [
      { path: "action", operator: "equals" as const, value: "opened" },
    ];
    const agentMessage = {
      promptTemplate: "Review {{payload.action}}.",
      conversationMode: "none" as const,
    };
    const definition = webhook({
      id: "ticket-created",
      target,
      eventFilter: { mode: "all", conditions },
      agentMessage,
    });

    target.id = "mutated-agent";
    conditions[0]!.path = "mutated";
    conditions.push({
      path: "extra",
      operator: "equals",
      value: "extra",
    });
    agentMessage.promptTemplate = "Mutated.";

    assertEquals(definition, {
      id: "ticket-created",
      target: { kind: "agent", id: "support-agent" },
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "action", operator: "equals", value: "opened" },
        ],
      },
      agentMessage: {
        promptTemplate: "Review {{payload.action}}.",
        conversationMode: "none",
      },
    });
  });
});

describe("webhook/factory agent targets", () => {
  const conversationId = "11111111-1111-4111-8111-111111111111";

  it("carries agent conversation addressing on the target", () => {
    const definition = webhook({
      id: "support-escalation",
      target: { kind: "agent", id: "support-agent", conversationMode: "create_new" },
      agentMessage: { promptTemplate: "Triage {{payload.summary}}" },
    });

    assertEquals(definition, {
      id: "support-escalation",
      target: { kind: "agent", id: "support-agent", conversationMode: "create_new" },
      agentMessage: { promptTemplate: "Triage {{payload.summary}}" },
    });
    assertEquals(isWebhookDefinition(definition), true);
  });

  it("keeps the legacy agentMessage conversation mapping working", () => {
    const definition = webhook({
      id: "support-escalation",
      target: { kind: "agent", id: "support-agent" },
      agentMessage: {
        promptTemplate: "Triage {{payload.summary}}",
        conversationMode: "existing",
        conversationId,
      },
    });

    assertEquals(definition.target, { kind: "agent", id: "support-agent" });
    assertEquals(definition.agentMessage, {
      promptTemplate: "Triage {{payload.summary}}",
      conversationMode: "existing",
      conversationId,
    });
  });

  it("accepts the same conversation pair declared on target and agentMessage", () => {
    const definition = webhook({
      id: "support-escalation",
      target: {
        kind: "agent",
        id: "support-agent",
        conversationMode: "existing",
        conversationId,
      },
      agentMessage: {
        promptTemplate: "Triage {{payload.summary}}",
        conversationMode: "existing",
        conversationId,
      },
    });

    assertEquals(definition.target, {
      kind: "agent",
      id: "support-agent",
      conversationMode: "existing",
      conversationId,
    });
    assertEquals(definition.agentMessage, {
      promptTemplate: "Triage {{payload.summary}}",
      conversationMode: "existing",
      conversationId,
    });
    assertEquals(isWebhookDefinition(definition), true);
  });

  it("rejects a conversation mode that disagrees with agentMessage", () => {
    assertThrows(
      () =>
        webhook({
          id: "support-escalation",
          target: { kind: "agent", id: "support-agent", conversationMode: "create_new" },
          agentMessage: {
            promptTemplate: "Triage {{payload.summary}}",
            conversationMode: "existing",
            conversationId,
          },
        }),
      VeryfrontError,
      "Webhook target.conversationMode and agentMessage.conversationMode are both set to different values. Declare it in one place.",
    );
  });

  it("rejects a conversation id that disagrees with agentMessage", () => {
    assertThrows(
      () =>
        webhook({
          id: "support-escalation",
          target: {
            kind: "agent",
            id: "support-agent",
            conversationMode: "existing",
            conversationId,
          },
          agentMessage: {
            promptTemplate: "Triage {{payload.summary}}",
            conversationMode: "existing",
            conversationId: "22222222-2222-4222-8222-222222222222",
          },
        }),
      VeryfrontError,
      "Webhook target.conversationId and agentMessage.conversationId are both set to different values. Declare it in one place.",
    );
  });

  it("reports the conflict with the webhook-config-invalid slug", () => {
    const error = assertThrows(
      () =>
        webhook({
          id: "support-escalation",
          target: { kind: "agent", id: "support-agent", conversationMode: "none" },
          agentMessage: {
            promptTemplate: "Triage {{payload.summary}}",
            conversationMode: "create_new",
          },
        }),
      VeryfrontError,
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "webhook-config-invalid");
  });

  it("rejects unsupported target keys instead of dropping them", () => {
    for (
      const [target, message] of [
        [
          { kind: "agent", id: "support-agent", conversationmode: "create_new" },
          "Webhook target.conversationmode is not supported.",
        ],
        [
          { kind: "workflow", id: "escalate-ticket", conversationMode: "create_new" },
          "Webhook target.conversationMode is not supported.",
        ],
      ] as const
    ) {
      assertThrows(
        () =>
          webhook(
            {
              id: "support-escalation",
              target,
              agentMessage: { promptTemplate: "Triage." },
            } as never,
          ),
        VeryfrontError,
        message,
      );
    }
  });

  it("rejects invalid agent conversation relationships on the target", () => {
    for (
      const [target, message] of [
        [
          { kind: "agent", id: "support-agent", conversationMode: "resume" },
          "Webhook target.conversationMode must be create_new, existing, or none.",
        ],
        [
          { kind: "agent", id: "support-agent", conversationMode: "existing" },
          "Webhook target.conversationId is required when conversationMode is existing.",
        ],
        [
          { kind: "agent", id: "support-agent", conversationMode: "none", conversationId },
          "Webhook target.conversationId is allowed only when conversationMode is existing.",
        ],
        [
          {
            kind: "agent",
            id: "support-agent",
            conversationMode: "existing",
            conversationId: "not-a-uuid",
          },
          "Webhook target.conversationId must be a UUID or null.",
        ],
      ] as const
    ) {
      assertThrows(
        () =>
          webhook(
            {
              id: "support-escalation",
              target,
              agentMessage: { promptTemplate: "Triage." },
            } as never,
          ),
        VeryfrontError,
        message,
      );
    }
  });
});
