import type { ScheduleConfig, ScheduleDefinition } from "./types.ts";
import { normalizeScheduleConfig } from "./validation.ts";

/** Create a validated, detached source-defined schedule. */
export function schedule(config: ScheduleConfig): ScheduleDefinition {
  return normalizeScheduleConfig(config);
}
