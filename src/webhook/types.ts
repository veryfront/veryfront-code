import type { TriggerTarget } from "#veryfront/trigger/target.ts";

export type WebhookEventFilterMode = "all" | "any";

export type WebhookEventFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "exists";

export interface WebhookEventFilterCondition {
  path: string;
  operator: WebhookEventFilterOperator;
  value?: unknown;
}

export interface WebhookEventFilter {
  mode: WebhookEventFilterMode;
  conditions: WebhookEventFilterCondition[];
}

export interface WebhookAgentMessageMapping {
  promptTemplate: string;
}

export interface WebhookDefinition {
  id: string;
  name?: string;
  description?: string;
  target: TriggerTarget;
  eventFilter?: WebhookEventFilter;
  agentMessage?: WebhookAgentMessageMapping;
}

export type WebhookConfig = WebhookDefinition;

export function isWebhookDefinition(value: unknown): value is WebhookDefinition {
  if (!value || typeof value !== "object") return false;
  const definition = value as Record<string, unknown>;
  return (
    typeof definition.id === "string" &&
    definition.target !== null &&
    typeof definition.target === "object"
  );
}
