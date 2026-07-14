import type { TriggerTarget } from "#veryfront/trigger/target.ts";

export type ScheduleConcurrencyPolicy = "Allow" | "Forbid" | "Replace";

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
  integrationRequirements?: ScheduleIntegrationRequirement[];
}

export type ScheduleConfig = Omit<ScheduleDefinition, "schedule" | "integrationRequirements"> & {
  cron?: string;
  schedule?: string;
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
};

export function isScheduleDefinition(value: unknown): value is ScheduleDefinition {
  if (!value || typeof value !== "object") return false;
  const definition = value as Record<string, unknown>;
  return (
    typeof definition.id === "string" &&
    typeof definition.schedule === "string" &&
    definition.target !== null &&
    typeof definition.target === "object" &&
    isScheduleIntegrationRequirements(definition.integrationRequirements)
  );
}

function isScheduleIntegrationRequirements(
  value: unknown,
): value is ScheduleIntegrationRequirement[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 20) return false;

  const integrations = new Set<string>();
  for (const requirement of value) {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      return false;
    }

    const record = requirement as Record<string, unknown>;
    const integration = isIntegrationName(record.integration) ? record.integration : undefined;
    if (
      integration === undefined ||
      !hasOnlyKeys(record, ["integration", "requiredScopes", "resources"]) ||
      integrations.has(integration.toLowerCase()) ||
      !isStringArray(record.requiredScopes) ||
      !isScheduleIntegrationResources(record.resources)
    ) {
      return false;
    }

    integrations.add(integration.toLowerCase());
  }

  return true;
}

function isScheduleIntegrationResources(value: unknown): value is ScheduleIntegrationResource[] {
  if (!Array.isArray(value) || value.length > 50) return false;

  return value.every((resource) => {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) return false;

    const record = resource as Record<string, unknown>;
    return (
      hasOnlyKeys(record, ["kind", "id", "parent"]) &&
      isRequirementKind(record.kind) &&
      isBoundedString(record.id, 512) &&
      (record.parent === undefined || isScheduleIntegrationResourceIdentity(record.parent))
    );
  });
}

function isScheduleIntegrationResourceIdentity(
  value: unknown,
): value is ScheduleIntegrationResourceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  return hasOnlyKeys(record, ["kind", "id"]) &&
    isRequirementKind(record.kind) && isBoundedString(record.id, 512);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 50 &&
    value.every((item) => isBoundedString(item, 255));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isNonEmptyString(value) && value.trim().length <= maxLength;
}

function isIntegrationName(value: unknown): value is string {
  return isBoundedString(value, 255) && /^[a-z0-9][a-z0-9_-]*$/.test(value.trim());
}

function isRequirementKind(value: unknown): value is string {
  return isBoundedString(value, 64) && /^[a-z][a-z0-9_-]*$/.test(value.trim());
}
