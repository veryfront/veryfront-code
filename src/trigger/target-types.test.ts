import type { RuntimeAdapter } from "#veryfront/platform";
import type { ScheduleConfig } from "#veryfront/schedule";
import type {
  RunTriggerTargetOptions,
  TriggerTarget,
  WorkflowTriggerTarget,
} from "#veryfront/trigger";
import type { WebhookConfig } from "#veryfront/webhook";

const adapter = {} as RuntimeAdapter;

function acceptScheduleConfig(_config: ScheduleConfig): void {}
function acceptWebhookConfig(_config: WebhookConfig): void {}
function acceptRunTriggerTargetOptions(_options: RunTriggerTargetOptions): void {}

interface OwnedWorkflowTarget extends WorkflowTriggerTarget {
  owner: "billing";
}

const ownedWorkflowTarget: OwnedWorkflowTarget = {
  kind: "workflow",
  id: "billing/sync",
  owner: "billing",
};

const exportedTriggerTarget: TriggerTarget = {
  kind: "workflow",
  id: "billing/sync",
};

acceptScheduleConfig({
  id: "billing-sync",
  schedule: "0 * * * *",
  target: ownedWorkflowTarget,
});

acceptScheduleConfig({
  id: "exported-trigger-target-schedule",
  schedule: "0 * * * *",
  target: exportedTriggerTarget,
});

acceptWebhookConfig({
  id: "exported-trigger-target-webhook",
  target: exportedTriggerTarget,
});

acceptRunTriggerTargetOptions({
  projectDir: "/project",
  adapter,
  target: exportedTriggerTarget,
});

acceptScheduleConfig({
  id: "agent-triage",
  schedule: "*/10 * * * *",
  target: {
    kind: "agent",
    id: "case-triage",
    conversationMode: "existing",
    conversationId: "11111111-1111-4111-8111-111111111111",
  },
});

acceptScheduleConfig({
  id: "bad-task",
  schedule: "0 * * * *",
  // @ts-expect-error Task schedule targets cannot carry conversation fields.
  target: { kind: "task", id: "sync-helpdesk", conversationMode: "create_new" },
});

acceptWebhookConfig({
  id: "bad-workflow",
  // @ts-expect-error Workflow webhook targets cannot carry conversation fields.
  target: { kind: "workflow", id: "billing/sync", conversationId: null },
});

acceptRunTriggerTargetOptions({
  projectDir: "/project",
  adapter,
  // @ts-expect-error Task runtime targets cannot carry conversation fields.
  target: { kind: "task", id: "sync-helpdesk", conversationMode: "none" },
});
