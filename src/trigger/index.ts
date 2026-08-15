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
export {
  conversationConflictDiagnostic,
  declarationConflictDiagnostic,
  isTriggerTarget,
} from "./target.ts";
export { isTriggerId } from "./validation.ts";
export type {
  SourceTriggerDiscoveryError,
  SourceTriggerDiscoveryErrorCode,
  SourceTriggerDiscoveryOptions,
  SourceTriggerDiscoveryResult,
  SourceTriggerKind,
  TriggerDefinitionWithId,
  TriggerDiscoveryOptions,
} from "./discovery.ts";
export type { RunTriggerTargetOptions, TriggerTargetRunResult } from "./local-runner.ts";
export type {
  AgentConversationMode,
  AgentTriggerTarget,
  TaskTriggerTarget,
  TriggerTarget,
  TriggerTargetKind,
  WorkflowTriggerTarget,
} from "./target.ts";
