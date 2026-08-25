import type { ScheduleConfig } from "veryfront/schedule";
import type {
  AgentTriggerTarget,
  RunTriggerTargetOptions,
  TriggerTargetConfig,
} from "veryfront/trigger";
import type { WebhookConfig } from "veryfront/webhook";

const storedAgentTarget = {
  kind: "agent" as const,
  id: "case-triage",
  conversationMode: undefined,
  conversationId: undefined,
};

export const agentTarget: AgentTriggerTarget = storedAgentTarget;
export const triggerTarget: TriggerTargetConfig = storedAgentTarget;
export const scheduleTarget: ScheduleConfig["target"] = storedAgentTarget;
export const webhookTarget: WebhookConfig["target"] = storedAgentTarget;
export const runTarget: RunTriggerTargetOptions["target"] = storedAgentTarget;

const storedTaskTarget = {
  kind: "task" as const,
  id: "sync-helpdesk",
  conversationMode: undefined,
};

// @ts-expect-error Non-agent targets cannot declare reserved conversation fields.
export const invalidTaskTarget: TriggerTargetConfig = storedTaskTarget;
