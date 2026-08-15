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

/** Prompt content sent to an agent target on each occurrence. */
export interface ScheduleAgentMessage {
  /** Agent prompt; the platform generates a default when omitted. */
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
  /** Task, workflow, or agent invoked by each occurrence. */
  target: ResolvedTriggerTarget;
  /** Prompt content for an agent target; unsupported for other targets. */
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

type ScheduleConfigFields =
  & Omit<
    ScheduleDefinition,
    "schedule" | "integrationRequirements" | "target" | "agentMessage"
  >
  & {
    /** Alias for a five-field POSIX `schedule` expression. */
    cron?: string;
    /** Five-field POSIX cron expression. */
    schedule?: string;
    /** Integration requirements; omitted collections default to empty. */
    integrationRequirements?: ScheduleIntegrationRequirementConfig[];
  };

/**
 * Author-facing recurring schedule configuration.
 *
 * `cron` is an alias for `schedule`; the factory emits only `schedule`.
 */
export type ScheduleConfig =
  & ScheduleConfigFields
  & (
    | {
      /** Agent invoked by each occurrence. */
      target: AgentTriggerTarget;
      /** Prompt content sent to the agent. */
      agentMessage?: ScheduleAgentMessage;
    }
    | {
      /** Task, workflow, or agent invoked by each occurrence. */
      target: TriggerTargetConfig;
      /** Agent messages are not accepted without a statically known agent target. */
      agentMessage?: never;
    }
  );

/** Return true only when every schedule field and nested invariant is valid. */
export function isScheduleDefinition(value: unknown): value is ScheduleDefinition {
  return isValidScheduleDefinition(value);
}
