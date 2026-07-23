import type { TriggerTarget } from "#veryfront/trigger/target.ts";
import { normalizeWebhookConfig } from "./validation.ts";

/** Combination rule applied to webhook filter conditions. */
export type WebhookEventFilterMode = "all" | "any";

/** Supported comparison applied to one webhook event field. */
export type WebhookEventFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "exists";

/** One bounded event-field condition evaluated before a webhook starts its target. */
export interface WebhookEventFilterCondition {
  /** Event field or provider-defined field path. */
  path: string;
  /** Comparison performed against the selected event field. */
  operator: WebhookEventFilterOperator;
  /** Bounded JSON comparison value, when the operator uses one. */
  value?: unknown;
}

/** Filter evaluated before a webhook starts its target. */
export interface WebhookEventFilter {
  /** Whether every condition or at least one condition must match. */
  mode: WebhookEventFilterMode;
  /** Bounded ordered condition list. */
  conditions: WebhookEventFilterCondition[];
}

/** Prompt mapping required when a webhook starts an agent. */
export interface WebhookAgentMessageMapping {
  /** Template used to map the received event into an agent message. */
  promptTemplate: string;
}

/** Canonical source-defined webhook returned by validation and discovery. */
export interface WebhookDefinition {
  /** Canonical webhook identifier. */
  id: string;
  /** Optional display name. */
  name?: string;
  /** Optional human-readable purpose. */
  description?: string;
  /** Runtime primitive started when the webhook matches. */
  target: TriggerTarget;
  /** Optional event filter applied before starting the target. */
  eventFilter?: WebhookEventFilter;
  /** Event-to-message mapping used by agent targets. */
  agentMessage?: WebhookAgentMessageMapping;
}

/** Author input accepted by the webhook factory. */
export type WebhookConfig = WebhookDefinition;

/** Return whether a value satisfies the complete webhook definition contract. */
export function isWebhookDefinition(value: unknown): value is WebhookDefinition {
  try {
    normalizeWebhookConfig(value);
    return true;
  } catch {
    return false;
  }
}
