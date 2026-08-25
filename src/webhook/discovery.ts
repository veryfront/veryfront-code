import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import {
  discoverSourceTriggers,
  type SourceTriggerDiscoveryResult,
} from "#veryfront/trigger/discovery.ts";
import { isWebhookDefinition, type WebhookDefinition } from "./types.ts";
import { normalizeWebhookDefinition } from "./validation.ts";

/** Inputs for deterministic source webhook discovery. */
export interface WebhookDiscoveryOptions {
  /** Project root containing configured webhook source directories. */
  projectDir: string;
  /** Runtime adapter used to enumerate and import project source. */
  adapter: RuntimeAdapter;
  /** Optional project configuration used during source loading. */
  config?: VeryfrontConfig;
  /** Explicit webhook directory override relative to `projectDir`. */
  webhooksDir?: string;
  /** Explicit host-owned capability for a trusted local or dedicated runtime. */
  allowHostProjectCodeExecution?: boolean;
}

/** Valid webhooks and bounded per-file discovery diagnostics. */
export type WebhookDiscoveryResult = SourceTriggerDiscoveryResult<WebhookDefinition>;

/** Discover and validate source-defined webhooks across configured directories. */
export async function discoverWebhooks(
  options: WebhookDiscoveryOptions,
): Promise<WebhookDiscoveryResult> {
  const triggerDirs = options.webhooksDir === undefined
    ? createProjectDiscoveryConfig({
      projectDir: options.projectDir,
      config: options.config,
    }).webhookDirs
    : [options.webhooksDir];
  return await discoverSourceTriggers({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    triggerDirs,
    sourceKind: "webhook",
    validate: isWebhookDefinition,
    normalize: normalizeWebhookDefinition,
    allowHostProjectCodeExecution: options.allowHostProjectCodeExecution,
  });
}
