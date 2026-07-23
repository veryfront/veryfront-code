import type { WebhookConfig, WebhookDefinition } from "./types.ts";
import { normalizeWebhookConfig } from "./validation.ts";

/** Create a validated, detached source-defined webhook. */
export function webhook(config: WebhookConfig): WebhookDefinition {
  return normalizeWebhookConfig(config);
}
