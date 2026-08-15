import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { CreateScheduleRunFromSourceResult } from "#veryfront/runs";
import type { ScheduleConfig, ScheduleDefinition } from "#veryfront/schedule";
import type {
  AgentConversationMode,
  RunTriggerTargetOptions,
  TriggerTarget,
  WorkflowTriggerTarget,
} from "#veryfront/trigger";
import type { WebhookConfig, WebhookDefinition } from "#veryfront/webhook";

const adapter = {} as RuntimeAdapter;

function acceptScheduleConfig(config: ScheduleConfig): ScheduleConfig {
  return config;
}

function acceptWebhookConfig(config: WebhookConfig): WebhookConfig {
  return config;
}

function acceptRunTriggerTargetOptions(
  options: RunTriggerTargetOptions,
): RunTriggerTargetOptions {
  return options;
}

function readScheduleConversationMode(
  target: ScheduleDefinition["target"],
): AgentConversationMode | undefined {
  return target.kind === "agent" ? target.conversationMode : undefined;
}

function readWebhookConversationMode(
  target: WebhookDefinition["target"],
): AgentConversationMode | undefined {
  return target.kind === "agent" ? target.conversationMode : undefined;
}

function readRemoteScheduleConversationMode(
  target: CreateScheduleRunFromSourceResult["target"],
): AgentConversationMode | undefined {
  return target.kind === "agent" ? target.conversationMode : undefined;
}

interface OwnedWorkflowTarget extends WorkflowTriggerTarget {
  owner: "billing";
}

describe("trigger target public type contracts", () => {
  it("accepts extended workflow and exported TriggerTarget values on public authoring surfaces", () => {
    const ownedWorkflowTarget: OwnedWorkflowTarget = {
      kind: "workflow",
      id: "billing/sync",
      owner: "billing",
    };

    const exportedTriggerTarget: TriggerTarget = {
      kind: "workflow",
      id: "billing/sync",
    };

    const ownedSchedule = acceptScheduleConfig({
      id: "billing-sync",
      schedule: "0 * * * *",
      target: ownedWorkflowTarget,
    });

    const exportedSchedule = acceptScheduleConfig({
      id: "exported-trigger-target-schedule",
      schedule: "0 * * * *",
      target: exportedTriggerTarget,
    });

    const webhook = acceptWebhookConfig({
      id: "exported-trigger-target-webhook",
      target: exportedTriggerTarget,
    });

    const run = acceptRunTriggerTargetOptions({
      projectDir: "project",
      adapter,
      target: exportedTriggerTarget,
    });

    assertEquals(ownedSchedule.target, ownedWorkflowTarget);
    assertEquals(exportedSchedule.target, exportedTriggerTarget);
    assertEquals(webhook.target, exportedTriggerTarget);
    assertEquals(run.target, exportedTriggerTarget);
  });

  it("keeps agent conversation fields valid and task/workflow conversation fields rejected", () => {
    const agentSchedule = acceptScheduleConfig({
      id: "agent-triage",
      schedule: "*/10 * * * *",
      target: {
        kind: "agent",
        id: "case-triage",
        conversationMode: "existing",
        conversationId: "11111111-1111-4111-8111-111111111111",
      },
    });

    const invalidTaskSchedule = acceptScheduleConfig({
      id: "bad-task",
      schedule: "0 * * * *",
      // @ts-expect-error Task schedule targets cannot carry conversation fields.
      target: { kind: "task", id: "sync-helpdesk", conversationMode: "create_new" },
    });

    const invalidWorkflowWebhook = acceptWebhookConfig({
      id: "bad-workflow",
      // @ts-expect-error Workflow webhook targets cannot carry conversation fields.
      target: { kind: "workflow", id: "billing/sync", conversationId: null },
    });

    const invalidTaskRun = acceptRunTriggerTargetOptions({
      projectDir: "project",
      adapter,
      // @ts-expect-error Task runtime targets cannot carry conversation fields.
      target: { kind: "task", id: "sync-helpdesk", conversationMode: "none" },
    });

    assertEquals(agentSchedule.target.kind, "agent");
    assertEquals(invalidTaskSchedule.target.kind, "task");
    assertEquals(invalidWorkflowWebhook.target.kind, "workflow");
    assertEquals(invalidTaskRun.target.kind, "task");
  });

  it("narrows canonical output targets by kind", () => {
    const target = {
      kind: "agent" as const,
      id: "case-triage",
      conversationMode: "create_new" as const,
    };

    assertEquals(readScheduleConversationMode(target), "create_new");
    assertEquals(readWebhookConversationMode(target), "create_new");
    assertEquals(readRemoteScheduleConversationMode(target), "create_new");
  });
});
