import type { TriggerTarget } from "#veryfront/trigger/target.ts";
import { normalizeScheduleConfig } from "./validation.ts";

/** Policy applied when a scheduled run overlaps an active run. */
export type ScheduleConcurrencyPolicy = "Allow" | "Forbid" | "Replace";

/** Stable identity for an integration resource required by a schedule. */
export interface ScheduleIntegrationResourceIdentity {
  /** Lowercase resource category defined by the integration. */
  kind: string;
  /** Integration-owned resource identifier. */
  id: string;
}

/** Integration resource, optionally scoped under a parent resource. */
export interface ScheduleIntegrationResource extends ScheduleIntegrationResourceIdentity {
  /** Parent resource identity when the resource is nested. */
  parent?: ScheduleIntegrationResourceIdentity;
}

/** Canonical integration access required when a schedule runs. */
export interface ScheduleIntegrationRequirement {
  /** Lowercase integration identifier. */
  integration: string;
  /** Exact OAuth or provider scopes required by the target. */
  requiredScopes: string[];
  /** Exact integration resources required by the target. */
  resources: ScheduleIntegrationResource[];
}

/** Author input for one schedule integration requirement. */
export interface ScheduleIntegrationRequirementConfig {
  /** Lowercase integration identifier. */
  integration: string;
  /** Exact OAuth or provider scopes required by the target. */
  requiredScopes?: string[];
  /** Exact integration resources required by the target. */
  resources?: ScheduleIntegrationResource[];
}

/** Canonical source-defined schedule returned by validation and discovery. */
export interface ScheduleDefinition {
  /** Canonical schedule identifier. */
  id: string;
  /** Optional display name. */
  name?: string;
  /** Optional human-readable purpose. */
  description?: string;
  /** Valid five-field cron expression. */
  schedule: string;
  /** IANA time zone used to evaluate the cron expression. */
  timezone?: string;
  /** Runtime primitive started by the schedule. */
  target: TriggerTarget;
  /** Bounded JSON object passed to the target. */
  input?: Record<string, unknown>;
  /** Positive execution deadline in seconds. */
  timeoutSeconds?: number;
  /** Maximum retry count, including zero to disable retries. */
  backoffLimit?: number;
  /** Behavior when a run overlaps an active run. */
  concurrencyPolicy?: ScheduleConcurrencyPolicy;
  /** Positive maximum number of runs created by the definition. */
  maxRuns?: number;
  /** Integration access required by the target. */
  integrationRequirements?: ScheduleIntegrationRequirement[];
}

/** Author input accepted by the schedule factory. */
export type ScheduleConfig = Omit<ScheduleDefinition, "schedule" | "integrationRequirements"> & {
  /** Alias for `schedule`; define only one of the two fields. */
  cron?: string;
  /** Valid five-field cron expression. */
  schedule?: string;
  /** Integration requirements with optional empty collections. */
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
};

/** Return whether a value satisfies the complete schedule definition contract. */
export function isScheduleDefinition(value: unknown): value is ScheduleDefinition {
  try {
    normalizeScheduleConfig(value, { canonical: true });
    return true;
  } catch {
    return false;
  }
}
