import type { TriggerTarget } from "#veryfront/trigger/target.ts";
import { isValidWebhookDefinition } from "./validation.ts";

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

/** Return true only when every webhook field and nested invariant is valid. */
export function isWebhookDefinition(value: unknown): value is WebhookDefinition {
  return isValidWebhookDefinition(value);
}
