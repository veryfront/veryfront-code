import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  discoverSourceTriggers,
  type SourceTriggerDiscoveryResult,
} from "#veryfront/trigger/discovery.ts";
import { isScheduleDefinition, type ScheduleDefinition } from "./types.ts";

export interface ScheduleDiscoveryOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  schedulesDir?: string;
}

export type ScheduleDiscoveryResult = SourceTriggerDiscoveryResult<ScheduleDefinition>;

/** Discover and validate canonical schedule definitions from a project directory. */
export async function discoverSchedules(
  options: ScheduleDiscoveryOptions,
): Promise<ScheduleDiscoveryResult> {
  return await discoverSourceTriggers({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    triggerDir: options.schedulesDir ?? "schedules",
    sourceKind: "schedule",
    validate: isScheduleDefinition,
  });
}
