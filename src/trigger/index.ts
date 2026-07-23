/**
 * Shared source-trigger discovery and local execution primitives.
 *
 * @module trigger
 *
 * @example Discover and run a source-defined trigger target
 * ```ts
 * import { discoverSchedules } from "veryfront/schedule";
 * import { runTriggerTarget } from "veryfront/trigger";
 *
 * const { items } = await discoverSchedules({ projectDir, adapter });
 * const dailyTriage = items.find((item) => item.id === "daily-support-triage");
 *
 * if (dailyTriage) {
 *   await runTriggerTarget({
 *     projectDir,
 *     adapter,
 *     target: dailyTriage.target,
 *     input: dailyTriage.input,
 *   });
 * }
 * ```
 */

export { discoverSourceTriggers } from "./discovery.ts";
export { runTriggerTarget } from "./local-runner.ts";
export type {
  SourceTriggerDiscoveryError,
  SourceTriggerDiscoveryErrorCode,
  SourceTriggerDiscoveryResult,
  SourceTriggerKind,
  TriggerDefinitionWithId,
  TriggerDiscoveryOptions,
} from "./discovery.ts";
export type { RunTriggerTargetOptions, TriggerTargetRunResult } from "./local-runner.ts";
export type { TriggerTarget, TriggerTargetKind } from "./target.ts";
