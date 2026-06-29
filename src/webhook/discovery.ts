import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  discoverSourceTriggers,
  type SourceTriggerDiscoveryResult,
} from "#veryfront/trigger/discovery.ts";
import { isWebhookDefinition, type WebhookDefinition } from "./types.ts";

export interface WebhookDiscoveryOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  webhooksDir?: string;
}

export type WebhookDiscoveryResult = SourceTriggerDiscoveryResult<WebhookDefinition>;

export async function discoverWebhooks(
  options: WebhookDiscoveryOptions,
): Promise<WebhookDiscoveryResult> {
  return await discoverSourceTriggers({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    triggerDir: options.webhooksDir ?? "webhooks",
    sourceKind: "webhook",
    validate: isWebhookDefinition,
  });
}
