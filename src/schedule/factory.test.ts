import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

  it("accepts standard cron lists, ranges, steps, names, and zero retries", () => {
    const definition = schedule({
      id: "business-hours",
      cron: "*/15 8-17 * JAN,MAR MON-FRI",
      timezone: "UTC",
      target: { kind: "task", id: "sync-helpdesk" },
      backoffLimit: 0,
    });

    assertEquals(definition.schedule, "*/15 8-17 * JAN,MAR MON-FRI");
    assertEquals(definition.backoffLimit, 0);
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

  it("snapshots input and integration requirements", () => {
    const nested = { queue: "priority" };
    const input = { nested };
    const scopes = ["chat:write"];
    const resources = [{ kind: "channel", id: "C012345" }];
    const definition = schedule({
      id: "daily-triage",
      cron: "0 8 * * 1-5",
      target: { kind: "task", id: "sync-helpdesk" },
      input,
      integrationRequirements: [{ integration: "slack", requiredScopes: scopes, resources }],
    });

    nested.queue = "changed";
    scopes[0] = "changed";
    resources[0]!.id = "changed";

    assertEquals(definition.input, { nested: { queue: "priority" } });
    assertEquals(definition.integrationRequirements, [{
      integration: "slack",
      requiredScopes: ["chat:write"],
      resources: [{ kind: "channel", id: "C012345" }],
    }]);
    assertNotStrictEquals(definition.input, input);
  });

  it("rejects invalid cron, timezone, aliases, and integer limits", () => {
    const base = {
      id: "daily-triage",
      target: { kind: "task", id: "sync-helpdesk" },
    } as const;

    for (
      const config of [
        { ...base, cron: "not a cron expression" },
        { ...base, cron: "60 8 * * *" },
        { ...base, cron: "*/0 8 * * *" },
        { ...base, cron: "0 17-8 * * *" },
        { ...base, cron: "0 8 * * * extra" },
        { ...base, cron: "0 8 * * *", timezone: "Not/A_Timezone" },
        { ...base, cron: "0 8 * * *", schedule: "0 9 * * *" },
        { ...base, cron: "0 8 * * *", timeoutSeconds: Number.MAX_VALUE },
        { ...base, cron: "0 8 * * *", maxRuns: Number.POSITIVE_INFINITY },
      ]
    ) {
      const error = assertThrows(() => schedule(config as never), VeryfrontError);
      assertEquals(error.slug, "schedule-config-invalid");
    }
  });

  it("does not invoke accessors while validating schedule definitions", () => {
    let reads = 0;
    const config = {
      cron: "0 8 * * *",
      target: { kind: "task", id: "sync-helpdesk" },
    };
    Object.defineProperty(config, "id", {
      enumerable: true,
      get() {
        reads += 1;
        return "daily-triage";
      },
    });

    const error = assertThrows(() => schedule(config as never), VeryfrontError);
    assertEquals(error.slug, "schedule-config-invalid");
    assertEquals(isScheduleDefinition(config), false);
    assertEquals(reads, 0);
  });

  it("validates every canonical schedule definition field", () => {
    assertEquals(
      isScheduleDefinition({
        id: "daily-triage",
        schedule: "0 8 * * *",
        target: { kind: "workflow", id: "escalate-ticket" },
        timeoutSeconds: Number.NaN,
      }),
      false,
    );
    assertEquals(
      isScheduleDefinition({
        id: "daily-triage",
        schedule: "0 8 * * *",
        target: { kind: "workflow", id: "invalid/../target" },
      }),
      false,
    );
    assertEquals(
      isScheduleDefinition({
        id: "daily-triage",
        schedule: "0 8 * * *",
        target: { kind: "workflow", id: "escalate-ticket" },
        unsupported: true,
      }),
      false,
    );
  });

  it("rejects duplicate scopes and resources", () => {
    for (
      const requirement of [
        {
          integration: "slack",
          requiredScopes: ["chat:write", "chat:write"],
        },
        {
          integration: "slack",
          resources: [
            { kind: "channel", id: "C012345" },
            { kind: "channel", id: "C012345" },
          ],
        },
      ]
    ) {
      const error = assertThrows(
        () =>
          schedule({
            id: "slack-digest",
            schedule: "0 9 * * 1-5",
            target: { kind: "workflow", id: "post-slack-digest" },
            integrationRequirements: [requirement],
          }),
        VeryfrontError,
      );
      assertEquals(error.slug, "schedule-config-invalid");
    }
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

  it("rejects decorated collection arrays without invoking accessors", () => {
    let reads = 0;
    const requirements = [{
      integration: "slack",
      requiredScopes: [],
      resources: [],
    }];
    Object.defineProperty(requirements, "metadata", {
      enumerable: true,
      get() {
        reads += 1;
        return "must-not-run";
      },
    });

    const error = assertThrows(
      () =>
        schedule({
          id: "slack-digest",
          schedule: "0 9 * * 1-5",
          target: { kind: "workflow", id: "post-slack-digest" },
          integrationRequirements: requirements,
        }),
      VeryfrontError,
    );

    assertEquals(error.slug, "schedule-config-invalid");
    assertEquals(reads, 0);
  });

  it("does not treat malformed integration requirements as schedule definitions", () => {
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
});
