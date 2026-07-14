import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
      Error,
      "Schedule id must start",
    );

    assertThrows(
      () =>
        schedule({
          id: "daily-triage",
          cron: "0 8 * * 1-5",
          target: { kind: "queue", id: "priority" } as never,
        }),
      Error,
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
      Error,
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
