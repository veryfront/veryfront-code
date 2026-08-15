import type { AgentConversationMode, TriggerTarget } from "#veryfront/trigger/target.ts";
import { isValidWebhookDefinition } from "./validation.ts";

/** Whether every filter condition or at least one condition must match. */
export type WebhookEventFilterMode = "all" | "any";

/** Comparisons supported by hosted and local webhook filtering. */
export type WebhookEventFilterOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "contains"
  | "exists";

/** One dot-path comparison against the webhook JSON payload. */
export interface WebhookEventFilterCondition {
  /** Dot-separated object path, for example `pull_request.state`. */
  path: string;
  /** Comparison applied to the value found at `path`. */
  operator: WebhookEventFilterOperator;
  /** Expected JSON value; ignored by `exists`. */
  value?: unknown;
}

/** Optional gate evaluated before a webhook target starts. */
export interface WebhookEventFilter {
  /** Combine condition results with logical AND (`all`) or OR (`any`). */
  mode: WebhookEventFilterMode;
  /** At most 50 conditions. An empty collection matches every payload. */
  conditions: WebhookEventFilterCondition[];
}

/** Hosted conversation behavior for an agent-target webhook. */
export type WebhookAgentConversationMode = AgentConversationMode;

/** Prompt and optional hosted conversation mapping for an agent target. */
export interface WebhookAgentMessageMapping {
  /** Agent prompt supporting `{{payload}}` and `{{payload.dot.path}}` placeholders. */
  promptTemplate: string;
  /**
   * Hosted conversation behavior; defaults to `none`.
   *
   * @deprecated Set `conversationMode` on the target instead. Setting both
   * locations is rejected as an authoring error, and this field is removed in
   * the next major.
   */
  conversationMode?: WebhookAgentConversationMode;
  /**
   * Existing conversation UUID, required only with `conversationMode: "existing"`.
   *
   * @deprecated Set `conversationId` on the target instead. Setting both
   * locations is rejected as an authoring error, and this field is removed in
   * the next major.
   */
  conversationId?: string | null;
}

/** Validated source definition for one webhook trigger. */
export interface WebhookDefinition {
  /** Stable source identifier used during hosted reconciliation. */
  id: string;
  /** Optional display name; hosted reconciliation falls back to `id`. */
  name?: string;
  /** Optional operator-facing description. */
  description?: string;
  /** Canonical task, workflow, or agent target. */
  target: TriggerTarget;
  /** Optional payload filter evaluated before target execution. */
  eventFilter?: WebhookEventFilter;
  /** Required for agent targets and unsupported for other targets. */
  agentMessage?: WebhookAgentMessageMapping;
}

/** Author-facing webhook configuration accepted by {@link webhook}. */
export type WebhookConfig = WebhookDefinition;

/** Return true only when every webhook field and nested invariant is valid. */
export function isWebhookDefinition(
  value: unknown,
): value is WebhookDefinition {
  return isValidWebhookDefinition(value);
}
