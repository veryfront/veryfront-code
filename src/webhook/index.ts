/**
 * Source-defined webhooks for Veryfront projects.
 *
 * @module webhook
 *
 * @example Run a workflow for urgent customer events
 * ```ts
 * import { webhook } from "veryfront/webhook";
 *
 * export default webhook({
 *   id: "customer-escalation",
 *   target: { kind: "workflow", id: "escalate-ticket" },
 *   eventFilter: {
 *     mode: "any",
 *     conditions: [
 *       { path: "severity", operator: "equals", value: "high" },
 *       { path: "priority", operator: "equals", value: "urgent" },
 *     ],
 *   },
 * });
 * ```
 */

export { webhook } from "./factory.ts";
export { discoverWebhooks } from "./discovery.ts";
export type {
  WebhookAgentMessageMapping,
  WebhookConfig,
  WebhookDefinition,
  WebhookEventFilter,
  WebhookEventFilterCondition,
  WebhookEventFilterMode,
  WebhookEventFilterOperator,
} from "./types.ts";
export { isWebhookDefinition } from "./types.ts";
export type { WebhookDiscoveryOptions, WebhookDiscoveryResult } from "./discovery.ts";
