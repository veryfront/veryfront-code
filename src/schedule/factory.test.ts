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

  it("copies caller-owned input before retaining a schedule definition", () => {
    const input = { queue: { name: "priority" } };
    const definition = schedule({
      id: "daily-triage",
      schedule: "0 8 * * 1-5",
      target: { kind: "task", id: "sync-helpdesk" },
      input,
    });

    input.queue.name = "mutated";

    assertEquals(definition.input, { queue: { name: "priority" } });
    assertEquals(definition.input === input, false);
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

  it("treats undefined non-agent conversation fields as omitted", () => {
    const taskDefinition = schedule({
      id: "conditional-task",
      schedule: "0 */6 * * *",
      target: {
        kind: "task",
        id: "run-triage-sweep",
        conversationMode: undefined,
      },
    });
    const workflowDefinition = schedule({
      id: "conditional-workflow",
      schedule: "0 */6 * * *",
      target: {
        kind: "workflow",
        id: "billing/sync",
        conversationId: undefined,
      },
    });

    assertEquals(taskDefinition.target, { kind: "task", id: "run-triage-sweep" });
    assertEquals(workflowDefinition.target, { kind: "workflow", id: "billing/sync" });
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

  it("accepts bounded POSIX cron fields, IANA timezones, and zero retries", () => {
    const definition = schedule({
      id: "calendar-sweep",
      schedule: "*/15 0,12 1-15/2 jan,mar mon-fri",
      timezone: "Europe/Stockholm",
      target: { kind: "task", id: "run-calendar-sweep" },
      backoffLimit: 0,
    });

    assertEquals(definition.schedule, "*/15 0,12 1-15/2 JAN,MAR MON-FRI");
    assertEquals(definition.timezone, "Europe/Stockholm");
    assertEquals(definition.backoffLimit, 0);
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("canonicalizes authored metadata and cron whitespace", () => {
    const definition = schedule({
      id: "daily-triage",
      name: "  Daily triage  ",
      description: "  Review the priority queue.  ",
      schedule: "  0   8  *  *  1-5  ",
      timezone: "  Europe/Stockholm  ",
      target: { kind: "task", id: "sync-helpdesk" },
    });

    assertEquals(definition.name, "Daily triage");
    assertEquals(definition.description, "Review the priority queue.");
    assertEquals(definition.schedule, "0 8 * * 1-5");
    assertEquals(definition.timezone, "Europe/Stockholm");
  });

  it("rejects malformed cron expressions and unknown timezones", () => {
    for (
      const expression of [
        "not a cron",
        "60 0 * * *",
        "0 24 * * *",
        "0 0 0 * *",
        "0 0 * FOO *",
        "0 0 * * 8",
        "*/0 0 * * *",
        "10-5 0 * * *",
        "0,,1 0 * * *",
      ]
    ) {
      assertThrows(
        () =>
          schedule({
            id: "invalid-calendar",
            schedule: expression,
            target: { kind: "task", id: "run-calendar-sweep" },
          }),
        VeryfrontError,
        "Schedule schedule must be a five-field POSIX cron expression.",
      );
    }

    for (const timezone of ["Mars/Olympus", "+02:00"]) {
      assertThrows(
        () =>
          schedule({
            id: "invalid-timezone",
            schedule: "0 8 * * *",
            timezone,
            target: { kind: "task", id: "run-calendar-sweep" },
          }),
        VeryfrontError,
        "Schedule timezone must be a supported IANA timezone name.",
      );
    }
  });

  it("bounds schedule metadata and rejects unknown top-level fields", () => {
    const base = {
      id: "bounded-schedule",
      schedule: "0 8 * * *",
      target: { kind: "task", id: "run-bounded-schedule" },
    } as const;

    for (
      const [config, message] of [
        [{ ...base, name: "x".repeat(257) }, "Schedule name must be at most 256 characters."],
        [
          { ...base, description: "x".repeat(4_097) },
          "Schedule description must be at most 4096 characters.",
        ],
        [
          { ...base, timezone: "Europe/Stockholm\u0000" },
          "Schedule timezone must not contain control characters.",
        ],
        [
          { ...base, schedule: " ".repeat(257) },
          "Schedule schedule must be at most 256 characters.",
        ],
        [
          { ...base, owner: "runtime" },
          "Schedule configuration.owner is not supported.",
        ],
        [
          { ...base, ["line\nbreak"]: true },
          'Schedule configuration["line\\nbreak"] is not supported.',
        ],
      ] as const
    ) {
      assertThrows(
        () => schedule(config as never),
        VeryfrontError,
        message,
      );
    }
  });

  it("never executes accessors while reading public configuration", () => {
    let scheduleReads = 0;
    const config = Object.defineProperties({}, {
      id: { value: "accessor-schedule", enumerable: true },
      schedule: {
        get() {
          scheduleReads++;
          return "0 8 * * *";
        },
        enumerable: true,
      },
      target: {
        value: { kind: "task", id: "run-accessor-schedule" },
        enumerable: true,
      },
    });

    assertThrows(
      () => schedule(config as never),
      VeryfrontError,
      "Schedule configuration.schedule must be an own enumerable data property.",
    );
    assertEquals(scheduleReads, 0);

    let scopeReads = 0;
    const scopes: string[] = [];
    Object.defineProperty(scopes, "0", {
      get() {
        scopeReads++;
        return "read";
      },
      enumerable: true,
    });
    assertThrows(
      () =>
        schedule({
          id: "accessor-scopes",
          schedule: "0 8 * * *",
          target: { kind: "task", id: "run-accessor-schedule" },
          integrationRequirements: [{
            integration: "slack",
            requiredScopes: scopes,
          }],
        }),
      VeryfrontError,
      "Schedule integrationRequirements[0].requiredScopes[0] must be an enumerable data property.",
    );
    assertEquals(scopeReads, 0);
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

  it("copies nested integration requirements before retaining them", () => {
    const requirement = {
      integration: "slack",
      requiredScopes: ["channels:read"],
      resources: [{
        kind: "channel",
        id: "C012345",
        parent: { kind: "workspace", id: "T012345" },
      }],
    };
    const definition = schedule({
      id: "slack-digest",
      schedule: "0 9 * * 1-5",
      target: { kind: "workflow", id: "post-slack-digest" },
      integrationRequirements: [requirement],
    });

    requirement.requiredScopes[0] = "mutated";
    requirement.resources[0]!.id = "mutated";
    requirement.resources[0]!.parent.id = "mutated";

    assertEquals(definition.integrationRequirements, [{
      integration: "slack",
      requiredScopes: ["channels:read"],
      resources: [{
        kind: "channel",
        id: "C012345",
        parent: { kind: "workspace", id: "T012345" },
      }],
    }]);
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
      "Schedule id must be at most 256 characters",
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
      "Schedule input must be JSON-serializable.",
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

  it("rejects duplicate scopes and resource identities", () => {
    assertThrows(
      () =>
        schedule({
          id: "duplicate-scopes",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [{
            integration: "slack",
            requiredScopes: ["channels:read", "channels:read"],
          }],
        }),
      VeryfrontError,
      "Schedule integrationRequirements[0].requiredScopes contains duplicate scope channels:read.",
    );

    assertThrows(
      () =>
        schedule({
          id: "duplicate-resources",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: [{
            integration: "slack",
            resources: [
              { kind: "channel", id: "C012345" },
              { kind: "channel", id: "C012345" },
            ],
          }],
        }),
      VeryfrontError,
      "Schedule integrationRequirements[0].resources contains a duplicate resource identity.",
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
    const hostileConfig = new Proxy({
      id: "daily-triage",
      schedule: "0 8 * * 1-5",
      target: { kind: "workflow", id: "escalate-ticket" },
    }, {
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
          "Schedule integrationRequirements must not define custom properties.",
        ],
        [hostileConfig, "Schedule configuration is invalid."],
      ] as const
    ) {
      let error: unknown;
      try {
        schedule(config as never);
      } catch (cause) {
        error = cause;
      }
      assertEquals(error instanceof VeryfrontError, true);
      assertEquals((error as VeryfrontError).message.includes(message), true);
      assertEquals((error as VeryfrontError).slug, "schedule-config-invalid");
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
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          cron: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
        },
        {
          id: "daily-triage",
          schedule: "0 8 * * 1-5",
          target: { kind: "workflow", id: "escalate-ticket" },
          unsupported: true,
        },
        Object.assign(
          Object.create({ unsupported: true }) as Record<string, unknown>,
          {
            id: "daily-triage",
            schedule: "0 8 * * 1-5",
            target: { kind: "workflow", id: "escalate-ticket" },
          },
        ),
      ]
    ) {
      assertEquals(isScheduleDefinition(value), false);
    }
  });
});

describe("schedule/factory agent targets", () => {
  const conversationId = "11111111-1111-4111-8111-111111111111";

  it("carries agent conversation addressing and message content", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
      agentMessage: { prompt: "Triage every open case created since the last run." },
    });

    assertEquals(definition, {
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
      agentMessage: { prompt: "Triage every open case created since the last run." },
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("carries an existing conversation id alongside its mode", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: {
        kind: "agent",
        id: "case-triage",
        conversationMode: "existing",
        conversationId,
      },
    });

    assertEquals(definition.target, {
      kind: "agent",
      id: "case-triage",
      conversationMode: "existing",
      conversationId,
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("leaves an agent schedule without conversation or message fields unchanged", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage" },
    });

    assertEquals(definition, {
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage" },
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("keeps the legacy input._schedule_target conversation mapping working", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage" },
      input: { _schedule_target: { conversationMode: "create_new" } },
    });

    assertEquals(definition.target, { kind: "agent", id: "case-triage" });
    assertEquals(definition.input, {
      _schedule_target: { conversationMode: "create_new" },
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("preserves non-agent input fields named _schedule_target as ordinary JSON", () => {
    for (
      const [target, legacyValue] of [
        [{ kind: "task", id: "sync-helpdesk" }, "create_new"],
        [{ kind: "workflow", id: "billing/sync" }, ["create_new"]],
        [
          { kind: "task", id: "sync-helpdesk" },
          { conversationmode: "existing", applicationField: true },
        ],
      ] as const
    ) {
      const definition = schedule({
        id: "sync-helpdesk",
        schedule: "*/10 * * * *",
        target,
        input: { _schedule_target: legacyValue, applicationPayload: true },
      });

      assertEquals(definition.target, target);
      assertEquals(definition.input, {
        _schedule_target: legacyValue,
        applicationPayload: true,
      });
      assertEquals(isScheduleDefinition(definition), true);
    }
  });

  it("accepts the same conversation pair declared on target and input._schedule_target", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: {
        kind: "agent",
        id: "case-triage",
        conversationMode: "existing",
        conversationId,
      },
      input: {
        _schedule_target: { conversationMode: "existing", conversationId },
      },
    });

    assertEquals(definition.target, {
      kind: "agent",
      id: "case-triage",
      conversationMode: "existing",
      conversationId,
    });
    assertEquals(definition.input, {
      _schedule_target: { conversationMode: "existing", conversationId },
    });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("rejects a conversation mode that disagrees with input._schedule_target", () => {
    assertThrows(
      () =>
        schedule({
          id: "triage-new-cases",
          schedule: "*/10 * * * *",
          target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
          input: { _schedule_target: { conversationMode: "none" } },
        }),
      VeryfrontError,
      "Schedule target.conversationMode and input._schedule_target.conversationMode are both set to different values. Declare it in one place.",
    );
  });

  it("rejects a conversation id that disagrees with input._schedule_target", () => {
    assertThrows(
      () =>
        schedule({
          id: "triage-new-cases",
          schedule: "*/10 * * * *",
          target: {
            kind: "agent",
            id: "case-triage",
            conversationMode: "existing",
            conversationId,
          },
          input: {
            _schedule_target: {
              conversationMode: "existing",
              conversationId: "22222222-2222-4222-8222-222222222222",
            },
          },
        }),
      VeryfrontError,
      "Schedule target.conversationId and input._schedule_target.conversationId are both set to different values. Declare it in one place.",
    );
  });

  it("rejects invalid conversation addressing in the legacy input._schedule_target channel", () => {
    for (
      const [legacyTarget, message] of [
        [
          null,
          "Schedule input._schedule_target must be an object.",
        ],
        [
          "create_new",
          "Schedule input._schedule_target must be an object.",
        ],
        [
          ["create_new"],
          "Schedule input._schedule_target must be an object.",
        ],
        [
          { conversationMode: "bogus" },
          "Schedule input._schedule_target.conversationMode must be create_new, existing, or none.",
        ],
        [
          { conversationMode: "existing" },
          "Schedule input._schedule_target.conversationId is required when conversationMode is existing.",
        ],
        [
          { conversationmode: "existing" },
          "Schedule input._schedule_target.conversationmode is not supported.",
        ],
        [
          { conversationMode: "create_new", conversationId },
          "Schedule input._schedule_target.conversationId is allowed only when conversationMode is existing.",
        ],
        [
          { conversationMode: "existing", conversationId: "not-a-uuid" },
          "Schedule input._schedule_target.conversationId must be a UUID or null.",
        ],
      ] as const
    ) {
      assertThrows(
        () =>
          schedule({
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "agent", id: "case-triage" },
            input: { _schedule_target: legacyTarget },
          }),
        VeryfrontError,
        message,
      );
    }
  });

  it("keeps every well-formed legacy-only conversation declaration valid and unchanged", () => {
    for (
      const legacyTarget of [
        { conversationMode: "create_new" },
        { conversationMode: "none" },
        { conversationMode: "existing", conversationId },
        { conversationMode: "create_new", conversationId: null },
      ] as const
    ) {
      const definition = schedule({
        id: "triage-new-cases",
        schedule: "*/10 * * * *",
        target: { kind: "agent", id: "case-triage" },
        input: { _schedule_target: { ...legacyTarget } },
      });

      assertEquals(definition.target, { kind: "agent", id: "case-triage" });
      assertEquals(definition.input, { _schedule_target: { ...legacyTarget } });
      assertEquals(isScheduleDefinition(definition), true);
    }
  });

  it("accepts the same prompt declared on agentMessage and input", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage" },
      agentMessage: { prompt: "Triage every open case." },
      input: { prompt: "Triage every open case." },
    });

    assertEquals(definition.agentMessage, { prompt: "Triage every open case." });
    assertEquals(definition.input, { prompt: "Triage every open case." });
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("rejects a prompt that disagrees with the legacy input.prompt channel", () => {
    assertThrows(
      () =>
        schedule({
          id: "triage-new-cases",
          schedule: "*/10 * * * *",
          target: { kind: "agent", id: "case-triage" },
          agentMessage: { prompt: "Triage every open case." },
          input: { prompt: "Something else." },
        }),
      VeryfrontError,
      "Schedule agentMessage.prompt and input.prompt are both set to different values. Declare it in one place.",
    );
  });

  it("omits an agent message that carries no prompt", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage" },
      agentMessage: {},
    });

    assertEquals(definition, {
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage" },
    });
    assertEquals(Object.hasOwn(definition, "agentMessage"), false);
    assertEquals(isScheduleDefinition(definition), true);
  });

  it("rejects unsupported target keys instead of dropping them", () => {
    for (
      const [config, message] of [
        [
          {
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "agent", id: "case-triage", conversationmode: "create_new" },
          },
          "Schedule target.conversationmode is not supported.",
        ],
        [
          {
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "task", id: "sync-helpdesk", conversationMode: "create_new" },
          },
          "Schedule target.conversationMode is not supported.",
        ],
        [
          {
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "workflow", id: "escalate-ticket", conversationId },
          },
          "Schedule target.conversationId is not supported.",
        ],
      ] as const
    ) {
      assertThrows(() => schedule(config as never), VeryfrontError, message);
    }
  });

  it("rejects invalid agent conversation relationships", () => {
    for (
      const [target, message] of [
        [
          { kind: "agent", id: "case-triage", conversationMode: "resume" },
          "Schedule target.conversationMode must be create_new, existing, or none.",
        ],
        [
          { kind: "agent", id: "case-triage", conversationMode: "existing" },
          "Schedule target.conversationId is required when conversationMode is existing.",
        ],
        [
          { kind: "agent", id: "case-triage", conversationMode: "create_new", conversationId },
          "Schedule target.conversationId is allowed only when conversationMode is existing.",
        ],
        [
          {
            kind: "agent",
            id: "case-triage",
            conversationMode: "existing",
            conversationId: "not-a-uuid",
          },
          "Schedule target.conversationId must be a UUID or null.",
        ],
      ] as const
    ) {
      assertThrows(
        () =>
          schedule(
            { id: "triage-new-cases", schedule: "*/10 * * * *", target } as never,
          ),
        VeryfrontError,
        message,
      );
    }
  });

  it("rejects agent messages on non-agent targets and invalid prompts", () => {
    for (
      const [config, message] of [
        [
          {
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "workflow", id: "escalate-ticket" },
            agentMessage: { prompt: "Unused." },
          },
          "Schedule agentMessage is supported only for agent targets.",
        ],
        [
          {
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "agent", id: "case-triage" },
            agentMessage: { promptTemplate: "Unsupported." },
          },
          "Schedule agentMessage.promptTemplate is not supported.",
        ],
        [
          {
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "agent", id: "case-triage" },
            agentMessage: { prompt: "   " },
          },
          "Schedule agentMessage.prompt must be a non-empty string.",
        ],
        [
          {
            id: "triage-new-cases",
            schedule: "*/10 * * * *",
            target: { kind: "agent", id: "case-triage" },
            agentMessage: { prompt: "a".repeat(20_001) },
          },
          "Schedule agentMessage.prompt must be at most 20000 characters.",
        ],
      ] as const
    ) {
      assertThrows(() => schedule(config as never), VeryfrontError, message);
    }
  });

  it("keeps a multi-line prompt canonical across a definition round trip", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage" },
      agentMessage: { prompt: "Triage open cases.\nSummarize each one." },
    });

    assertEquals(isScheduleDefinition(definition), true);
    assertEquals(
      definition.agentMessage?.prompt,
      "Triage open cases.\nSummarize each one.",
    );
  });
});
