import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { CreateScheduleRunFromSourceResult } from "#veryfront/runs";
import { schedule } from "#veryfront/schedule";
import type { ScheduleConfig, ScheduleDefinition } from "#veryfront/schedule";
import type {
  AgentConversationMode,
  RunTriggerTargetOptions,
  TriggerTarget,
  WorkflowTriggerTarget,
} from "#veryfront/trigger";
import type { WebhookConfig, WebhookDefinition } from "#veryfront/webhook";
import { resolveTriggerTarget } from "./target.ts";

const adapter = {} as RuntimeAdapter;

const acceptScheduleConfig = ((config: ScheduleConfig) => config) as unknown as typeof schedule;

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

interface CustomScheduleConfig extends ScheduleConfig {
  metadata: string;
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

    const customSchedule: CustomScheduleConfig = {
      id: "custom-schedule",
      schedule: "0 * * * *",
      target: ownedWorkflowTarget,
      metadata: "billing-owned",
    };

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
    assertEquals(customSchedule.metadata, "billing-owned");
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
      agentMessage: { prompt: "Triage open cases." },
    });

    const explicitlyUndefinedAgent = {
      kind: "agent" as const,
      id: "conditional-agent",
      conversationMode: undefined,
      conversationId: undefined,
    };
    const undefinedAgentSchedule = acceptScheduleConfig({
      id: "conditional-agent-schedule",
      schedule: "*/10 * * * *",
      target: explicitlyUndefinedAgent,
      agentMessage: { prompt: "Triage open cases." },
    });
    const undefinedAgentWebhook = acceptWebhookConfig({
      id: "conditional-agent-webhook",
      target: explicitlyUndefinedAgent,
      agentMessage: { promptTemplate: "Triage {{payload}}." },
    });
    const undefinedAgentRun = acceptRunTriggerTargetOptions({
      projectDir: "project",
      adapter,
      target: explicitlyUndefinedAgent,
    });

    // @ts-expect-error Task schedules cannot define an agent message.
    const invalidTaskMessage = acceptScheduleConfig({
      id: "bad-task-message",
      schedule: "0 * * * *",
      target: { kind: "task", id: "sync-helpdesk" },
      agentMessage: { prompt: "This target is not an agent." },
    });

    // @ts-expect-error Workflow schedules cannot define an agent message.
    const invalidWorkflowMessage = acceptScheduleConfig({
      id: "bad-workflow-message",
      schedule: "0 * * * *",
      target: { kind: "workflow", id: "billing/sync" },
      agentMessage: { prompt: "This target is not an agent." },
    });

    const storedTaskMessage = {
      id: "stored-bad-task-message",
      schedule: "0 * * * *",
      target: { kind: "task" as const, id: "sync-helpdesk" },
      agentMessage: { prompt: "This target is not an agent." },
    };

    // @ts-expect-error Stored task schedules cannot define an agent message.
    const invalidStoredTaskMessage = acceptScheduleConfig(storedTaskMessage);

    // @ts-expect-error Task schedule targets cannot carry conversation fields.
    const invalidTaskSchedule = acceptScheduleConfig({
      id: "bad-task",
      schedule: "0 * * * *",
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

    const storedWorkflowConversation = {
      kind: "workflow" as const,
      id: "billing/sync",
      conversationMode: "create_new" as const,
    };
    const storedWorkflowConversationId = {
      kind: "workflow" as const,
      id: "billing/sync",
      conversationId: null,
    };
    const storedTaskConversation = {
      kind: "task" as const,
      id: "sync-helpdesk",
      conversationMode: "create_new" as const,
    };
    const storedTaskConversationId = {
      kind: "task" as const,
      id: "sync-helpdesk",
      conversationId: null,
    };

    acceptScheduleConfig({
      id: "stored-bad-workflow-schedule",
      schedule: "0 * * * *",
      // @ts-expect-error Stored workflow schedule targets cannot carry conversation fields.
      target: storedWorkflowConversation,
    });

    acceptWebhookConfig({
      id: "stored-bad-workflow-webhook",
      // @ts-expect-error Stored workflow webhook targets cannot carry conversation fields.
      target: storedWorkflowConversation,
    });

    acceptRunTriggerTargetOptions({
      projectDir: "project",
      adapter,
      // @ts-expect-error Stored workflow runtime targets cannot carry conversation fields.
      target: storedWorkflowConversation,
    });

    acceptScheduleConfig({
      id: "stored-bad-workflow-id-schedule",
      schedule: "0 * * * *",
      // @ts-expect-error Stored workflow schedule targets cannot carry conversation fields.
      target: storedWorkflowConversationId,
    });
    acceptWebhookConfig({
      id: "stored-bad-workflow-id-webhook",
      // @ts-expect-error Stored workflow webhook targets cannot carry conversation fields.
      target: storedWorkflowConversationId,
    });
    acceptRunTriggerTargetOptions({
      projectDir: "project",
      adapter,
      // @ts-expect-error Stored workflow runtime targets cannot carry conversation fields.
      target: storedWorkflowConversationId,
    });

    acceptScheduleConfig({
      id: "stored-bad-task-mode-schedule",
      schedule: "0 * * * *",
      // @ts-expect-error Stored task schedule targets cannot carry conversation fields.
      target: storedTaskConversation,
    });
    acceptWebhookConfig({
      id: "stored-bad-task-mode-webhook",
      // @ts-expect-error Stored task webhook targets cannot carry conversation fields.
      target: storedTaskConversation,
    });
    acceptRunTriggerTargetOptions({
      projectDir: "project",
      adapter,
      // @ts-expect-error Stored task runtime targets cannot carry conversation fields.
      target: storedTaskConversation,
    });

    acceptScheduleConfig({
      id: "stored-bad-task-id-schedule",
      schedule: "0 * * * *",
      // @ts-expect-error Stored task schedule targets cannot carry conversation fields.
      target: storedTaskConversationId,
    });
    acceptWebhookConfig({
      id: "stored-bad-task-id-webhook",
      // @ts-expect-error Stored task webhook targets cannot carry conversation fields.
      target: storedTaskConversationId,
    });
    acceptRunTriggerTargetOptions({
      projectDir: "project",
      adapter,
      // @ts-expect-error Stored task runtime targets cannot carry conversation fields.
      target: storedTaskConversationId,
    });

    assertEquals(agentSchedule.target.kind, "agent");
    assertEquals(undefinedAgentSchedule.target.kind, "agent");
    assertEquals(undefinedAgentWebhook.target.kind, "agent");
    assertEquals(undefinedAgentRun.target.kind, "agent");
    assertEquals(invalidTaskMessage.target.kind, "task");
    assertEquals(invalidWorkflowMessage.target.kind, "workflow");
    assertEquals(invalidStoredTaskMessage.target.kind, "task");
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

    const resolution = resolveTriggerTarget("Trigger target", target);
    if (resolution.target?.kind !== "agent") {
      throw new Error("expected a resolved agent target");
    }
    assertEquals(resolution.target.conversationMode, "create_new");
  });
});
