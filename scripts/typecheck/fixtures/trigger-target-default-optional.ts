import type { ScheduleConfig } from "veryfront/schedule";
import type {
  RunTriggerTargetOptions,
  TriggerTargetConfig,
} from "veryfront/trigger";
import type { WebhookConfig } from "veryfront/webhook";

const storedWorkflowTarget = {
  kind: "workflow" as const,
  id: "billing/sync",
  conversationMode: undefined,
};
const storedTaskTarget = {
  kind: "task" as const,
  id: "sync-helpdesk",
  conversationId: undefined,
};

export const workflowTrigger: TriggerTargetConfig = storedWorkflowTarget;
export const workflowSchedule: ScheduleConfig["target"] = storedWorkflowTarget;
export const workflowWebhook: WebhookConfig["target"] = storedWorkflowTarget;
export const workflowRun: RunTriggerTargetOptions["target"] =
  storedWorkflowTarget;

export const taskTrigger: TriggerTargetConfig = storedTaskTarget;
export const taskSchedule: ScheduleConfig["target"] = storedTaskTarget;
export const taskWebhook: WebhookConfig["target"] = storedTaskTarget;
export const taskRun: RunTriggerTargetOptions["target"] = storedTaskTarget;
