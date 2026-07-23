import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { SCHEDULE_CONFIG_INVALID, VeryfrontError } from "#veryfront/errors";
import {
  discoverSourceTriggers,
  type SourceTriggerDiscoveryResult,
} from "#veryfront/trigger/discovery.ts";
import { isScheduleDefinition, type ScheduleDefinition } from "./types.ts";
import { normalizeScheduleConfig } from "./validation.ts";

/** Options for discovering source-defined schedules. */
export interface ScheduleDiscoveryOptions {
  /** Project root used to resolve local schedule files. */
  projectDir: string;
  /** Runtime adapter used for filesystem and module operations. */
  adapter: RuntimeAdapter;
  /** Resolved Veryfront project configuration. */
  config?: VeryfrontConfig;
  /** Project-relative schedule directory. Defaults to `schedules`. */
  schedulesDir?: string;
  /** Cancels discovery before another file is loaded. */
  signal?: AbortSignal;
}

/** Valid schedules and contained source-file failures. */
export type ScheduleDiscoveryResult = SourceTriggerDiscoveryResult<ScheduleDefinition>;

function readOption(options: unknown, key: string): unknown {
  if (!options || typeof options !== "object") {
    throw SCHEDULE_CONFIG_INVALID.create({ detail: "Schedule discovery options are required." });
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) {
      throw SCHEDULE_CONFIG_INVALID.create({
        detail: `Schedule discovery options.${key} must be a data property.`,
      });
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw SCHEDULE_CONFIG_INVALID.create({
      detail: "Schedule discovery options could not be inspected safely.",
    });
  }
}

/** Discover, validate, and detach source-defined project schedules. */
export async function discoverSchedules(
  options: ScheduleDiscoveryOptions,
): Promise<ScheduleDiscoveryResult> {
  const projectDir = readOption(options, "projectDir");
  const adapter = readOption(options, "adapter");
  const config = readOption(options, "config");
  const schedulesDir = readOption(options, "schedulesDir");
  const signal = readOption(options, "signal");
  try {
    return await discoverSourceTriggers({
      projectDir: projectDir as string,
      adapter: adapter as RuntimeAdapter,
      config: config as VeryfrontConfig | undefined,
      triggerDir: schedulesDir === undefined ? "schedules" : schedulesDir as string,
      sourceKind: "schedule",
      signal: signal as AbortSignal | undefined,
      validate: isScheduleDefinition,
      normalizeDefinition: (value) => normalizeScheduleConfig(value, { canonical: true }),
    });
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "trigger-config-invalid") {
      throw SCHEDULE_CONFIG_INVALID.create({
        detail: error.detail ?? "Schedule discovery options are invalid.",
      });
    }
    throw error;
  }
}
