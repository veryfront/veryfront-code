import type {
  AgentTriggerTarget,
  ResolvedTriggerTarget,
  TriggerTargetConfig,
} from "#veryfront/trigger/target.ts";
import { isValidScheduleDefinition } from "./validation.ts";

/** Behavior when a scheduled occurrence overlaps an active run. */
export type ScheduleConcurrencyPolicy = "Allow" | "Forbid" | "Replace";

/** Marks a schedule unhealthy when it has not succeeded within the given budget. */
export interface ScheduleHealth {
  /** Maximum elapsed seconds since the most recent successful run. */
  maxStalenessSeconds: number;
}

/** Stable integration resource key used for source-owned access requirements. */
export interface ScheduleIntegrationResourceIdentity {
  /** Lowercase resource category, such as `workspace` or `channel`. */
  kind: string;
  /** Provider-owned resource identifier. */
  id: string;
}

/** Integration resource optionally scoped beneath a parent resource. */
export interface ScheduleIntegrationResource extends ScheduleIntegrationResourceIdentity {
  /** Optional parent identity, such as the workspace containing a channel. */
  parent?: ScheduleIntegrationResourceIdentity;
}

/** Canonical integration access required before a scheduled run can start. */
export interface ScheduleIntegrationRequirement {
  /** Lowercase integration identifier. */
  integration: string;
  /** Unique provider scopes required by the target. */
  requiredScopes: string[];
  /** Unique provider resources required by the target. */
  resources: ScheduleIntegrationResource[];
}

/** Author-facing integration requirement; omitted collections default to empty. */
export interface ScheduleIntegrationRequirementConfig {
  /** Lowercase integration identifier. */
  integration: string;
  /** Unique provider scopes required by the target. */
  requiredScopes?: string[];
  /** Unique provider resources required by the target. */
  resources?: ScheduleIntegrationResource[];
}

/** Contains the prompt that a schedule sends to an agent target. */
export interface ScheduleAgentMessage {
  /** The schedule sends this prompt. Veryfront generates a default when you omit it. */
  prompt?: string;
}

/** Validated, canonical source definition for one recurring schedule. */
export interface ScheduleDefinition {
  /** Canonical slash-separated source trigger identifier. */
  id: string;
  /** Optional human-readable display name. */
  name?: string;
  /** Optional operator-facing description. */
  description?: string;
  /** Canonical five-field POSIX cron expression. */
  schedule: string;
  /** Supported IANA timezone name; platform default when omitted. */
  timezone?: string;
  /** The schedule invokes this task, workflow, or agent on each occurrence. */
  target: ResolvedTriggerTarget;
  /** The schedule sends this prompt to an agent target. Other target kinds do not support this field. */
  agentMessage?: ScheduleAgentMessage;
  /** Bounded JSON object copied into each target run. */
  input?: Record<string, unknown>;
  /** Positive execution timeout in seconds. */
  timeoutSeconds?: number;
  /** Non-negative retry count; zero disables retries. */
  backoffLimit?: number;
  /** Policy applied when an earlier occurrence is still running. */
  concurrencyPolicy?: ScheduleConcurrencyPolicy;
  /** Positive lifetime cap on runs created by this schedule. */
  maxRuns?: number;
  /** Optional schedule-health monitoring budget. */
  health?: ScheduleHealth;
  /** Integration scopes and resources required by the target. */
  integrationRequirements?: ScheduleIntegrationRequirement[];
}

interface ScheduleConfigFields extends
  Omit<
    ScheduleDefinition,
    "schedule" | "integrationRequirements" | "target" | "agentMessage"
  > {
  /** Sets a five-field POSIX expression as an alias for `schedule`. */
  cron?: string;
  /** Sets the schedule to a five-field POSIX cron expression. */
  schedule?: string;
  /** Declares required integration access. Omitted collections default to empty. */
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
}

/**
 * Author-facing recurring schedule configuration.
 *
 * `cron` is an alias for `schedule`; the factory emits only `schedule`.
 */
export interface ScheduleConfig extends ScheduleConfigFields {
  /** The schedule invokes this task, workflow, or agent on each occurrence. */
  target: TriggerTargetConfig;
}

/** Configures an agent schedule with an optional prompt. */
export interface AgentScheduleConfig extends ScheduleConfig {
  /** The schedule invokes this agent on each occurrence. */
  target: AgentTriggerTarget;
  /** The schedule sends this prompt to the agent. */
  agentMessage?: ScheduleAgentMessage;
}

/** Return true only when every schedule field and nested invariant is valid. */
export function isScheduleDefinition(value: unknown): value is ScheduleDefinition {
  return isValidScheduleDefinition(value);
}
