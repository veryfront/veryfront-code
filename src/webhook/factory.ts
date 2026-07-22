import type { WebhookConfig, WebhookDefinition } from "./types.ts";
import { normalizeWebhookDefinition } from "./validation.ts";

/**
 * Validate and normalize a source-defined webhook configuration.
 *
 * Invalid top-level or nested fields fail with `webhook-config-invalid` before
 * the definition can enter discovery or trigger execution.
 */
export function webhook(config: WebhookConfig): WebhookDefinition {
  return normalizeWebhookDefinition(config);
}
