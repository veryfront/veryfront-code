import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  discoverSourceTriggers,
  type SourceTriggerDiscoveryResult,
} from "#veryfront/trigger/discovery.ts";
import { isScheduleDefinition, type ScheduleDefinition } from "./types.ts";
import { normalizeScheduleDefinition } from "./validation.ts";

/** Inputs for deterministic source schedule discovery. */
export interface ScheduleDiscoveryOptions {
  /** Project root containing the schedule source directory. */
  projectDir: string;
  /** Runtime adapter used to enumerate and import project source. */
  adapter: RuntimeAdapter;
  /** Optional project configuration used during source loading. */
  config?: VeryfrontConfig;
  /** Schedule directory relative to `projectDir`; defaults to `schedules`. */
  schedulesDir?: string;
}

/** Valid schedules and bounded per-file discovery diagnostics. */
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
    normalize: normalizeScheduleDefinition,
  });
}
