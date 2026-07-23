import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { VeryfrontError, WEBHOOK_CONFIG_INVALID } from "#veryfront/errors";
import {
  discoverSourceTriggers,
  type SourceTriggerDiscoveryResult,
} from "#veryfront/trigger/discovery.ts";
import { isWebhookDefinition, type WebhookDefinition } from "./types.ts";
import { normalizeWebhookConfig } from "./validation.ts";

/** Options for discovering source-defined webhooks. */
export interface WebhookDiscoveryOptions {
  /** Project root used to resolve local webhook files. */
  projectDir: string;
  /** Runtime adapter used for filesystem and module operations. */
  adapter: RuntimeAdapter;
  /** Resolved Veryfront project configuration. */
  config?: VeryfrontConfig;
  /** Project-relative webhook directory. Defaults to `webhooks`. */
  webhooksDir?: string;
  /** Cancels discovery before another file is loaded. */
  signal?: AbortSignal;
}

/** Valid webhooks and contained source-file failures. */
export type WebhookDiscoveryResult = SourceTriggerDiscoveryResult<WebhookDefinition>;

function readOption(options: unknown, key: string): unknown {
  if (!options || typeof options !== "object") {
    throw WEBHOOK_CONFIG_INVALID.create({ detail: "Webhook discovery options are required." });
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(options, key);
  } catch {
    throw WEBHOOK_CONFIG_INVALID.create({
      detail: "Webhook discovery options could not be inspected safely.",
    });
  }
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw WEBHOOK_CONFIG_INVALID.create({
      detail: `Webhook discovery options.${key} must be a data property.`,
    });
  }
  return descriptor.value;
}

/** Discover, validate, and detach source-defined project webhooks. */
export async function discoverWebhooks(
  options: WebhookDiscoveryOptions,
): Promise<WebhookDiscoveryResult> {
  const projectDir = readOption(options, "projectDir");
  const adapter = readOption(options, "adapter");
  const config = readOption(options, "config");
  const webhooksDir = readOption(options, "webhooksDir");
  const signal = readOption(options, "signal");

  try {
    return await discoverSourceTriggers({
      projectDir: projectDir as string,
      adapter: adapter as RuntimeAdapter,
      config: config as VeryfrontConfig | undefined,
      triggerDir: webhooksDir === undefined ? "webhooks" : webhooksDir as string,
      sourceKind: "webhook",
      signal: signal as AbortSignal | undefined,
      validate: isWebhookDefinition,
      normalizeDefinition: normalizeWebhookConfig,
    });
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "trigger-config-invalid") {
      throw WEBHOOK_CONFIG_INVALID.create({
        detail: error.detail ?? "Webhook discovery options are invalid.",
      });
    }
    throw error;
  }
}
