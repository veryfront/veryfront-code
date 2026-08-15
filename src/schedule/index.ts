/**
 * Source-defined recurring schedules for Veryfront projects.
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
 *   health: { maxStalenessSeconds: 1800 },
 * });
 * ```
 */

export { schedule } from "./factory.ts";
export type {
  ScheduleAgentMessage,
  ScheduleConcurrencyPolicy,
  ScheduleConfig,
  ScheduleDefinition,
  ScheduleHealth,
  ScheduleIntegrationRequirement,
  ScheduleIntegrationRequirementConfig,
  ScheduleIntegrationResource,
  ScheduleIntegrationResourceIdentity,
} from "./types.ts";
export { isScheduleDefinition } from "./types.ts";
export { discoverSchedules } from "./discovery.ts";
export type { ScheduleDiscoveryOptions, ScheduleDiscoveryResult } from "./discovery.ts";
/**
 * Validate the legacy `input._schedule_target` channel's shape.
 *
 * Exported because `veryfront schedule run --input <file>` replaces the
 * authored input without passing back through {@link schedule}, so the CLI is
 * the only place that can apply this rule to an operator-supplied file. Sharing
 * the one implementation keeps both entry points rejecting the same shapes.
 *
 * @example
 * ```ts
 * const detail = legacyScheduleTargetDiagnostic(input, conversation);
 * if (detail !== null) throw INVALID_ARGUMENT.create({ detail });
 * ```
 */
export { legacyScheduleTargetDiagnostic } from "./validation.ts";
