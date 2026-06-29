import type { TriggerTarget } from "#veryfront/trigger/target.ts";

export type ScheduleConcurrencyPolicy = "Allow" | "Forbid" | "Replace";

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
}

export type ScheduleConfig = Omit<ScheduleDefinition, "schedule"> & {
  cron?: string;
  schedule?: string;
};

export function isScheduleDefinition(value: unknown): value is ScheduleDefinition {
  if (!value || typeof value !== "object") return false;
  const definition = value as Record<string, unknown>;
  return (
    typeof definition.id === "string" &&
    typeof definition.schedule === "string" &&
    definition.target !== null &&
    typeof definition.target === "object"
  );
}
