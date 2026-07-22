import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { schedule } from "./factory.ts";
import { isScheduleDefinition } from "./types.ts";

describe("schedule/factory", () => {
  it("normalizes cron into schedule", () => {
    const definition = schedule({
      id: "daily-triage",
      name: "Daily triage",
      cron: "0 8 * * 1-5",
      timezone: "Europe/Stockholm",
      target: { kind: "workflow", id: "escalate-ticket" },
      input: { queue: "priority" },
      concurrencyPolicy: "Forbid",
    });

    assertEquals(definition, {
      id: "daily-triage",
      name: "Daily triage",
      schedule: "0 8 * * 1-5",
      timezone: "Europe/Stockholm",
      target: { kind: "workflow", id: "escalate-ticket" },
      input: { queue: "priority" },
      concurrencyPolicy: "Forbid",
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("preserves task targets for scheduled tasks", () => {
    const definition = schedule({
      id: "triage-sweep",
      name: "Triage sweep",
      schedule: "0 */6 * * *",
      timezone: "Etc/UTC",
      target: { kind: "task", id: "run-triage-sweep" },
      input: { windowHours: 6 },
      timeoutSeconds: 900,
      backoffLimit: 1,
      concurrencyPolicy: "Forbid",
    });

    assertEquals(definition, {
      id: "triage-sweep",
      name: "Triage sweep",
      schedule: "0 */6 * * *",
      timezone: "Etc/UTC",
      target: { kind: "task", id: "run-triage-sweep" },
      input: { windowHours: 6 },
      timeoutSeconds: 900,
      backoffLimit: 1,
      concurrencyPolicy: "Forbid",
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("preserves optional execution controls", () => {
    const definition = schedule({
      id: "bounded-sweep",
      description: "Stop after three runs.",
      schedule: "0 */6 * * *",
      target: { kind: "task", id: "run-bounded-sweep" },
      maxRuns: 3,
    });

    assertEquals(definition.description, "Stop after three runs.");
    assertEquals(definition.maxRuns, 3);
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("normalizes schedule health configuration", () => {
    const definition = schedule({
      id: "triage-sweep",
      schedule: "0 */6 * * *",
      target: { kind: "task", id: "run-triage-sweep" },
      health: { maxStalenessSeconds: 1_800 },
    });

    assertEquals(definition.health, { maxStalenessSeconds: 1_800 });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("rejects malformed schedule health configuration", () => {
    for (
      const health of [
        {},
        { maxStalenessSeconds: 0 },
        { maxStalenessSeconds: 1.5 },
        { maxStalenessSeconds: 60, unexpected: true },
      ]
    ) {
      assertThrows(
        () =>
          schedule({
            id: "triage-sweep",
            schedule: "0 */6 * * *",
            target: { kind: "task", id: "run-triage-sweep" },
            health: health as never,
          }),
        Error,
      );
    }
  });

  it("preserves integration requirements", () => {
    const definition = schedule({
      id: "slack-digest",
      schedule: "0 9 * * 1-5",
      target: { kind: "workflow", id: "post-slack-digest" },
      integrationRequirements: [
        {
          integration: "slack",
          requiredScopes: ["channels:read", "chat:write"],
          resources: [
            { kind: "workspace", id: "T012345" },
            { kind: "channel", id: "C012345", parent: { kind: "workspace", id: "T012345" } },
          ],
        },
        {
          integration: "linear",
          requiredScopes: ["read"],
          resources: [{ kind: "workspace", id: "acme" }],
        },
      ],
    });

    assertEquals(definition.integrationRequirements, [
      {
        integration: "slack",
        requiredScopes: ["channels:read", "chat:write"],
        resources: [
          { kind: "workspace", id: "T012345" },
          { kind: "channel", id: "C012345", parent: { kind: "workspace", id: "T012345" } },
        ],
      },
      {
        integration: "linear",
        requiredScopes: ["read"],
        resources: [{ kind: "workspace", id: "acme" }],
      },
    ]);
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("allows empty required scopes and resources", () => {
    const definition = schedule({
      id: "empty-requirements",
      schedule: "0 9 * * 1-5",
      target: { kind: "workflow", id: "post-empty-digest" },
      integrationRequirements: [
        {
          integration: "slack",
        },
      ],
    });

    assertEquals(definition.integrationRequirements, [
      {
        integration: "slack",
        requiredScopes: [],
        resources: [],
      },
    ]);
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("rejects invalid ids and targets", () => {
    assertThrows(
      () =>
        schedule({
          id: "Daily Triage",
          cron: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
        }),
      VeryfrontError,
      "Schedule id must start",
    );

    assertThrows(
      () =>
        schedule({
          id: "daily-triage",
          cron: "0 8 * * 1-5",
          target: { kind: "queue", id: "priority" } as never,
        }),
      VeryfrontError,
      "Schedule target",
    );
  });

  it("rejects non-serializable input", () => {
    assertThrows(
      () =>
        schedule({
          id: "daily-triage",
          cron: "0 8 * * 1-5",
          target: { kind: "task", id: "sync-helpdesk" },
          input: { now: new Date() },
        }),
      VeryfrontError,
      "Schedule input.now must be JSON-serializable.",
    );
  });

  it("rejects malformed integration requirements", () => {
    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [
            {
              integration: "slack",
              requiredScopes: ["chat:write"],
              resources: [{ kind: "channel", id: 123 }],
            },
          ] as never,
        }),
      Error,
      "resources[0].id is required.",
    );

    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [
            {
              integration: "slack",
              requiredScopes: ["chat:write"],
              resources: [{ kind: "channel", id: "C012345", parent: "T012345" }],
            },
          ] as never,
        }),
      Error,
      "resources[0].parent must be an object.",
    );

    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [
            {
              integration: "slack",
              requiredScopes: ["chat:write"],
              resources: [{ kind: "channel", id: "C012345", parent: { kind: "", id: "T012345" } }],
            },
          ],
        }),
      Error,
      "resources[0].parent.kind is required.",
    );

    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [
            {
              integration: "slack",
              requiredScopes: ["chat:write"],
              resources: [{
                kind: "channel",
                id: "C012345",
                parent: { kind: "workspace", id: "" },
              }],
            },
          ],
        }),
      Error,
      "resources[0].parent.id is required.",
    );

    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [
            {
              integration: "Slack",
              requiredScopes: ["chat:write"],
              resources: [{ kind: "channel", id: "C012345" }],
            },
          ],
        }),
      Error,
      "integration must use a lowercase integration identifier",
    );

    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [
            {
              integration: "slack",
              requiredScopes: ["chat:write"],
              resources: [{ kind: "Channel", id: "C012345" }],
            },
          ],
        }),
      Error,
      "resources[0].kind must use a lowercase resource kind",
    );
  });

  it("rejects duplicate integration requirements", () => {
    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [
            {
              integration: "slack",
              requiredScopes: ["channels:read"],
              resources: [{ kind: "workspace", id: "T012345" }],
            },
            {
              integration: "slack",
              requiredScopes: ["chat:write"],
              resources: [{ kind: "channel", id: "C012345" }],
            },
          ],
        }),
      Error,
      "duplicate integration slack",
    );
  });

  it("enforces bounded integration declarations", () => {
    const base = {
      id: "bounded-integrations",
      schedule: "0 9 * * 1-5",
      target: { kind: "workflow", id: "post-digest" } as const,
    };

    for (
      const [integrationRequirements, message] of [
        [
          Array.from({ length: 21 }, (_, index) => ({ integration: `provider-${index}` })),
          "Schedule integrationRequirements must contain at most 20 entries.",
        ],
        [
          [{ integration: "slack", requiredScopes: Array(51).fill("chat:write") }],
          "Schedule integrationRequirements[0].requiredScopes must contain at most 50 entries.",
        ],
        [
          [{
            integration: "slack",
            resources: Array(51).fill({ kind: "channel", id: "C012345" }),
          }],
          "Schedule integrationRequirements[0].resources must contain at most 50 entries.",
        ],
      ] as const
    ) {
      assertThrows(
        () => schedule({ ...base, integrationRequirements } as never),
        VeryfrontError,
        message,
      );
    }
  });

  it("rejects unknown integration requirement fields", () => {
    assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [{
            integration: "slack",
            requiredScopes: [],
            resources: [],
            tokenId: "must-not-be-source-owned",
          }] as never,
        }),
      Error,
      "integrationRequirements[0].tokenId is not supported",
    );
  });

  it("does not treat malformed integration requirements as schedule definitions", () => {
    assertEquals(
      isScheduleDefinition({
        id: "triage-sweep",
        schedule: "0 */6 * * *",
        target: { kind: "task", id: "run-triage-sweep" },
        health: { maxStalenessSeconds: 0 },
      }),
      false,
    );

    assertEquals(
      isScheduleDefinition({
        id: "slack-digest",
        schedule: "0 9 * * 1-5",
        target: { kind: "workflow", id: "post-slack-digest" },
        integrationRequirements: [
          {
            integration: "slack",
            requiredScopes: ["channels:read"],
            resources: [{ kind: "workspace", id: "T012345" }],
          },
          {
            integration: "slack",
            requiredScopes: ["chat:write"],
            resources: [{ kind: "channel", id: "C012345" }],
          },
        ],
      }),
      false,
    );

    assertEquals(
      isScheduleDefinition({
        id: "slack-digest",
        schedule: "0 9 * * 1-5",
        target: { kind: "workflow", id: "post-slack-digest" },
        integrationRequirements: [
          {
            integration: "slack",
            requiredScopes: ["channels:read"],
            resources: [{ kind: "channel", id: "C012345", parent: "T012345" }],
          },
        ],
      }),
      false,
    );
  });

  it("rejects malformed public inputs with a structured schedule error", () => {
    const forgedRequirements = [{
      integration: 42,
      requiredScopes: [],
      resources: [],
    }];
    Object.defineProperty(forgedRequirements, "map", {
      value: () => [],
    });
    const hostileConfig = new Proxy({}, {
      getOwnPropertyDescriptor(): PropertyDescriptor {
        throw new Error("hostile descriptor");
      },
    });
    const customSerializationInput = Object.defineProperty({}, "toJSON", {
      value: () => 1n,
    });

    for (
      const [config, message] of [
        [null, "Schedule configuration must be an object."],
        [
          {
            id: "daily-triage",
            target: { kind: "workflow", id: "escalate-ticket" },
          },
          "Schedule schedule or cron is required.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            cron: "0 9 * * 1-5",
            target: { kind: "workflow", id: "escalate-ticket" },
          },
          "Schedule schedule and cron must match when both are provided.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            name: 42,
            target: { kind: "workflow", id: "escalate-ticket" },
          },
          "Schedule name must be a string.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            timezone: "",
            target: { kind: "workflow", id: "escalate-ticket" },
          },
          "Schedule timezone is required.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            target: { kind: "workflow", id: "escalate-ticket" },
            input: [],
          },
          "Schedule input must be an object.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            target: { kind: "workflow", id: "escalate-ticket" },
            input: customSerializationInput,
          },
          "Schedule input must be JSON-serializable.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            target: { kind: "workflow", id: "escalate-ticket" },
            timeoutSeconds: Number.MAX_SAFE_INTEGER + 1,
          },
          "Schedule timeoutSeconds must be a positive integer within the safe integer range.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            target: { kind: "workflow", id: "escalate-ticket" },
            integrationRequirements: [{ integration: "slack", requiredScopes: null }],
          },
          "Schedule integrationRequirements[0].requiredScopes must be an array.",
        ],
        [
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            target: { kind: "workflow", id: "escalate-ticket" },
            integrationRequirements: forgedRequirements,
          },
          "Schedule integrationRequirements[0].integration is required.",
        ],
        [hostileConfig, "Schedule configuration is invalid."],
      ] as const
    ) {
      const error = assertThrows(
        () => schedule(config as never),
        VeryfrontError,
        message,
      );
      assertEquals(error.slug, "schedule-config-invalid");
    }
  });

  it("validates the complete discovery boundary without throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const inheritedRequiredFields = new Proxy({}, {
      get(_target, property): unknown {
        if (property === "id") return "daily-triage";
        if (property === "schedule") return "0 8 * * 1-5";
        if (property === "target") {
          return { kind: "workflow", id: "escalate-ticket" };
        }
        return undefined;
      },
    });
    const inheritedOptionalField = Object.assign(
      Object.create({ maxRuns: 0 }) as Record<string, unknown>,
      {
        id: "daily-triage",
        schedule: "0 8 * * 1-5",
        target: { kind: "workflow", id: "escalate-ticket" },
      },
    );
    const requirementsWithCustomProperty = [{
      integration: "slack",
      requiredScopes: [],
      resources: [],
    }];
    Object.defineProperty(requirementsWithCustomProperty, "map", {
      value: Array.prototype.map,
    });
    const requirementWithMissingResources = [{
      integration: "slack",
      requiredScopes: [],
    }];

    for (
      const value of [
        null,
        [],
        inheritedRequiredFields,
        inheritedOptionalField,
        {
          id: "Daily Triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: {},
        },
        {
          id: "daily-triage",
          cron: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          timeoutSeconds: 0,
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          concurrencyPolicy: "Queue",
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          input: { value: cyclic },
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          integrationRequirements: [{ integration: "slack" }],
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          integrationRequirements: requirementWithMissingResources,
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          integrationRequirements: requirementsWithCustomProperty,
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          integrationRequirements: [{
            integration: " slack",
            requiredScopes: [],
            resources: [],
          }],
        },
        Object.defineProperties({}, {
          id: { value: "daily-triage", enumerable: true },
          schedule: { get: () => "0 8 * * 1-5", enumerable: true },
          target: {
            value: { kind: "workflow", id: "escalate-ticket" },
            enumerable: true,
          },
        }),
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          health: { maxStalenessSeconds: Number.MAX_SAFE_INTEGER + 1 },
        },
      ]
    ) {
      assertEquals(isScheduleDefinition(value), false);
    }
  });
});
