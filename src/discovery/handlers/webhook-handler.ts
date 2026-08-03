import type { WebhookDefinition } from "#veryfront/webhook";
import { isWebhookDefinition } from "#veryfront/webhook";
import { normalizeWebhookDefinition } from "#veryfront/webhook/validation.ts";
import type { DiscoveryHandler, DiscoveryResult } from "../types.ts";

export const webhookHandler: DiscoveryHandler<WebhookDefinition> = {
  typeName: "webhook",
  validate: (item): item is WebhookDefinition => isWebhookDefinition(item),
  getId: (definition) => definition.id,
  register: (_id, definition) => normalizeWebhookDefinition(definition),
  getResultMap: (result: DiscoveryResult) => result.webhooks,
};
