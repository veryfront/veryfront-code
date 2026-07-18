/**
 * Source-defined schedules for Veryfront projects.
 *
 * @module schedule
 *
 * @example Run a workflow every weekday morning
 * ```ts
 * import { schedule } from "veryfront/schedule";
 *
 * export default schedule({
 *   id: "daily-support-triage",
 *   schedule: "0 9 * * 1-5",
 *   timezone: "Europe/Stockholm",
 *   target: { kind: "workflow", id: "escalate-ticket" },
 *   input: { severity: "high" },
 * });
 * ```
 */

export { schedule } from "./factory.ts";
export type {
  ScheduleConcurrencyPolicy,
  ScheduleConfig,
  ScheduleDefinition,
  ScheduleIntegrationRequirement,
  ScheduleIntegrationRequirementConfig,
  ScheduleIntegrationResource,
  ScheduleIntegrationResourceIdentity,
} from "./types.ts";
export { isScheduleDefinition } from "./types.ts";
export { discoverSchedules } from "./discovery.ts";
export type { ScheduleDiscoveryOptions, ScheduleDiscoveryResult } from "./discovery.ts";
