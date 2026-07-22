import type { TriggerTarget } from "#veryfront/trigger/target.ts";
import { isValidScheduleDefinition } from "./validation.ts";

export type ScheduleConcurrencyPolicy = "Allow" | "Forbid" | "Replace";

/** Marks a schedule unhealthy when it has not succeeded within the given budget. */
export interface ScheduleHealth {
  maxStalenessSeconds: number;
}

export interface ScheduleIntegrationResourceIdentity {
  kind: string;
  id: string;
}

export interface ScheduleIntegrationResource extends ScheduleIntegrationResourceIdentity {
  parent?: ScheduleIntegrationResourceIdentity;
}

export interface ScheduleIntegrationRequirement {
  integration: string;
  requiredScopes: string[];
  resources: ScheduleIntegrationResource[];
}

export interface ScheduleIntegrationRequirementConfig {
  integration: string;
  requiredScopes?: string[];
  resources?: ScheduleIntegrationResource[];
}

export interface ScheduleDefinition {
  id: string;
  name?: string;
  description?: string;
  schedule: string;
  timezone?: string;
  target: TriggerTarget;
  input?: Record<string, unknown>;
  timeoutSeconds?: number;
  backoffLimit?: number;
  concurrencyPolicy?: ScheduleConcurrencyPolicy;
  maxRuns?: number;
  health?: ScheduleHealth;
  integrationRequirements?: ScheduleIntegrationRequirement[];
}

export type ScheduleConfig = Omit<ScheduleDefinition, "schedule" | "integrationRequirements"> & {
  cron?: string;
  schedule?: string;
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
};

/** Return true only when every schedule field and nested invariant is valid. */
export function isScheduleDefinition(value: unknown): value is ScheduleDefinition {
  return isValidScheduleDefinition(value);
}
