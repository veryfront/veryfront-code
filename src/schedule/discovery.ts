import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import {
  discoverSourceTriggers,
  type SourceTriggerDiscoveryResult,
} from "#veryfront/trigger/discovery.ts";
import { isScheduleDefinition, type ScheduleDefinition } from "./types.ts";
import { normalizeScheduleDefinition } from "./validation.ts";

/** Inputs for deterministic source schedule discovery. */
export interface ScheduleDiscoveryOptions {
  /** Project root containing configured schedule source directories. */
  projectDir: string;
  /** Runtime adapter used to enumerate and import project source. */
  adapter: RuntimeAdapter;
  /** Optional project configuration used during source loading. */
  config?: VeryfrontConfig;
  /** Explicit schedule directory override relative to `projectDir`. */
  schedulesDir?: string;
  /** Explicit host-owned capability for a trusted local or dedicated runtime. */
  allowHostProjectCodeExecution?: boolean;
}

/** Valid schedules and bounded per-file discovery diagnostics. */
export type ScheduleDiscoveryResult = SourceTriggerDiscoveryResult<ScheduleDefinition>;

/** Discover and validate canonical schedule definitions from a project directory. */
export async function discoverSchedules(
  options: ScheduleDiscoveryOptions,
): Promise<ScheduleDiscoveryResult> {
  const triggerDirs = options.schedulesDir === undefined
    ? createProjectDiscoveryConfig({
      projectDir: options.projectDir,
      config: options.config,
    }).scheduleDirs
    : [options.schedulesDir];
  return await discoverSourceTriggers({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    triggerDirs,
    sourceKind: "schedule",
    validate: isScheduleDefinition,
    normalize: normalizeScheduleDefinition,
    allowHostProjectCodeExecution: options.allowHostProjectCodeExecution,
  });
}
