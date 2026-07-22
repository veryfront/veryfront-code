import { SCHEDULE_CONFIG_INVALID, VeryfrontError } from "#veryfront/errors";
import { isTriggerTarget, type TriggerTarget } from "#veryfront/trigger/target.ts";
import { assertSerializable, isTriggerId } from "#veryfront/trigger/validation.ts";
import type {
  ScheduleConcurrencyPolicy,
  ScheduleDefinition,
  ScheduleHealth,
  ScheduleIntegrationRequirement,
  ScheduleIntegrationResource,
  ScheduleIntegrationResourceIdentity,
} from "./types.ts";

const CONCURRENCY_POLICIES = new Set<ScheduleConcurrencyPolicy>([
  "Allow",
  "Forbid",
  "Replace",
]);
const INTEGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const REQUIREMENT_KIND_PATTERN = /^[a-z][a-z0-9_-]*$/;
const MAX_INTEGRATION_REQUIREMENTS = 20;
const MAX_SCOPES_PER_REQUIREMENT = 50;
const MAX_RESOURCES_PER_REQUIREMENT = 50;
const MAX_INTEGRATION_NAME_LENGTH = 255;
const MAX_RESOURCE_KIND_LENGTH = 64;
const MAX_SCOPE_LENGTH = 255;
const MAX_RESOURCE_ID_LENGTH = 512;

type ValidationMode = "config" | "definition";

function invalid(detail: string, cause?: unknown): never {
  throw SCHEDULE_CONFIG_INVALID.create({
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function getOwn(
  record: Record<string, unknown>,
  key: string,
  mode: ValidationMode = "config",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    if (mode === "definition" && key in record) {
      invalid(`Schedule ${key} must be an own property.`);
    }
    return undefined;
  }
  if (mode === "definition") {
    if (!("value" in descriptor)) {
      invalid(`Schedule ${key} must be a data property.`);
    }
    return descriptor.value;
  }
  return record[key];
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${label} is required.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalid(`${label} must be a positive integer within the safe integer range.`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requirePositiveInteger(value, label);
}

function requireContractString(
  value: unknown,
  label: string,
  maxLength: number,
  mode: ValidationMode,
): string {
  const original = requireString(value, label);
  const normalized = original.trim();
  if (normalized.length > maxLength) {
    invalid(`${label} must be at most ${maxLength} characters.`);
  }
  if (mode === "definition" && normalized !== original) {
    invalid(`${label} must not include leading or trailing whitespace.`);
  }
  return normalized;
}

function requireIntegrationName(
  value: unknown,
  label: string,
  mode: ValidationMode,
): string {
  const normalized = requireContractString(
    value,
    label,
    MAX_INTEGRATION_NAME_LENGTH,
    mode,
  );
  if (!INTEGRATION_NAME_PATTERN.test(normalized)) {
    invalid(`${label} must use a lowercase integration identifier.`);
  }
  return normalized;
}

function requireRequirementKind(
  value: unknown,
  label: string,
  mode: ValidationMode,
): string {
  const normalized = requireContractString(value, label, MAX_RESOURCE_KIND_LENGTH, mode);
  if (!REQUIREMENT_KIND_PATTERN.test(normalized)) {
    invalid(`${label} must use a lowercase resource kind.`);
  }
  return normalized;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) invalid(`${label}.${unknownKey} is not supported.`);
}

function mapArray<T>(
  values: unknown[],
  mode: ValidationMode,
  label: string,
  mapValue: (value: unknown, index: number) => T,
): T[] {
  if (mode === "definition") {
    if (Object.getPrototypeOf(values) !== Array.prototype) {
      invalid(`${label} must be a plain array.`);
    }
    const allowedKeys = new Set<PropertyKey>(["length"]);
    for (let index = 0; index < values.length; index++) {
      allowedKeys.add(String(index));
    }
    if (Reflect.ownKeys(values).some((key) => !allowedKeys.has(key))) {
      invalid(`${label} must not define custom properties.`);
    }
  }

  const mapped: T[] = [];
  for (let index = 0; index < values.length; index++) {
    let value: unknown;
    if (mode === "definition") {
      const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
      if (descriptor === undefined || !("value" in descriptor)) {
        invalid(`${label}[${index}] must be a data property.`);
      }
      value = descriptor.value;
    } else {
      value = values[index];
    }
    mapped.push(mapValue(value, index));
  }
  return mapped;
}

function normalizeTarget(value: unknown, mode: ValidationMode): TriggerTarget {
  const target = requireRecord(value, "Schedule target");
  const candidate = {
    kind: getOwn(target, "kind", mode),
    id: getOwn(target, "id", mode),
  };
  if (!isTriggerTarget(candidate)) {
    invalid("Schedule target must specify a valid task, workflow, or agent id.");
  }
  return candidate;
}

function normalizeInput(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const input = requireRecord(value, "Schedule input");
  try {
    assertSerializable(input, "Schedule input");
  } catch (error) {
    const detail = error instanceof VeryfrontError && error.detail
      ? error.detail
      : "Schedule input must be JSON-serializable.";
    invalid(detail, error);
  }
  return input;
}

function normalizeScheduleHealth(
  value: unknown,
  mode: ValidationMode,
): ScheduleHealth | undefined {
  if (value === undefined) return undefined;
  const health = requireRecord(value, "Schedule health");
  assertOnlyKeys(health, ["maxStalenessSeconds"], "Schedule health");
  return {
    maxStalenessSeconds: requirePositiveInteger(
      getOwn(health, "maxStalenessSeconds", mode),
      "Schedule health.maxStalenessSeconds",
    ),
  };
}

function normalizeIntegrationResourceParent(
  value: unknown,
  requirementIndex: number,
  resourceIndex: number,
  mode: ValidationMode,
): ScheduleIntegrationResourceIdentity | undefined {
  if (value === undefined) return undefined;

  const label =
    `Schedule integrationRequirements[${requirementIndex}].resources[${resourceIndex}].parent`;
  const parent = requireRecord(value, label);
  assertOnlyKeys(parent, ["kind", "id"], label);
  return {
    kind: requireRequirementKind(getOwn(parent, "kind", mode), `${label}.kind`, mode),
    id: requireContractString(
      getOwn(parent, "id", mode),
      `${label}.id`,
      MAX_RESOURCE_ID_LENGTH,
      mode,
    ),
  };
}

function normalizeIntegrationResource(
  value: unknown,
  requirementIndex: number,
  resourceIndex: number,
  mode: ValidationMode,
): ScheduleIntegrationResource {
  const label = `Schedule integrationRequirements[${requirementIndex}].resources[${resourceIndex}]`;
  const resource = requireRecord(value, label);
  assertOnlyKeys(resource, ["kind", "id", "parent"], label);

  const parent = normalizeIntegrationResourceParent(
    getOwn(resource, "parent", mode),
    requirementIndex,
    resourceIndex,
    mode,
  );
  return {
    kind: requireRequirementKind(getOwn(resource, "kind", mode), `${label}.kind`, mode),
    id: requireContractString(
      getOwn(resource, "id", mode),
      `${label}.id`,
      MAX_RESOURCE_ID_LENGTH,
      mode,
    ),
    ...(parent === undefined ? {} : { parent }),
  };
}

function normalizeIntegrationRequirements(
  value: unknown,
  mode: ValidationMode,
): ScheduleIntegrationRequirement[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) invalid("Schedule integrationRequirements must be an array.");
  if (value.length > MAX_INTEGRATION_REQUIREMENTS) {
    invalid(
      `Schedule integrationRequirements must contain at most ${MAX_INTEGRATION_REQUIREMENTS} entries.`,
    );
  }

  const integrations = new Set<string>();
  return mapArray(value, mode, "Schedule integrationRequirements", (value, index) => {
    const label = `Schedule integrationRequirements[${index}]`;
    const requirement = requireRecord(value, label);
    assertOnlyKeys(requirement, ["integration", "requiredScopes", "resources"], label);

    const integration = requireIntegrationName(
      getOwn(requirement, "integration", mode),
      `${label}.integration`,
      mode,
    );
    if (integrations.has(integration)) {
      invalid(`Schedule integrationRequirements contains duplicate integration ${integration}.`);
    }
    integrations.add(integration);

    const requiredScopesValue = getOwn(requirement, "requiredScopes", mode);
    if (mode === "definition" && requiredScopesValue === undefined) {
      invalid(`${label}.requiredScopes must be an array.`);
    }
    const requiredScopes = requiredScopesValue === undefined ? [] : requiredScopesValue;
    if (!Array.isArray(requiredScopes)) invalid(`${label}.requiredScopes must be an array.`);
    if (requiredScopes.length > MAX_SCOPES_PER_REQUIREMENT) {
      invalid(
        `${label}.requiredScopes must contain at most ${MAX_SCOPES_PER_REQUIREMENT} entries.`,
      );
    }

    const resourcesValue = getOwn(requirement, "resources", mode);
    if (mode === "definition" && resourcesValue === undefined) {
      invalid(`${label}.resources must be an array.`);
    }
    const resources = resourcesValue === undefined ? [] : resourcesValue;
    if (!Array.isArray(resources)) invalid(`${label}.resources must be an array.`);
    if (resources.length > MAX_RESOURCES_PER_REQUIREMENT) {
      invalid(
        `${label}.resources must contain at most ${MAX_RESOURCES_PER_REQUIREMENT} entries.`,
      );
    }

    return {
      integration,
      requiredScopes: mapArray(
        requiredScopes,
        mode,
        `${label}.requiredScopes`,
        (scope, scopeIndex) =>
          requireContractString(
            scope,
            `${label}.requiredScopes[${scopeIndex}]`,
            MAX_SCOPE_LENGTH,
            mode,
          ),
      ),
      resources: mapArray(
        resources,
        mode,
        `${label}.resources`,
        (resource, resourceIndex) =>
          normalizeIntegrationResource(resource, index, resourceIndex, mode),
      ),
    };
  });
}

function normalizeScheduleUnsafe(value: unknown, mode: ValidationMode): ScheduleDefinition {
  const config = requireRecord(value, "Schedule configuration");

  const id = requireString(getOwn(config, "id", mode), "Schedule id");
  if (!isTriggerId(id)) {
    invalid(
      "Schedule id must start with a lowercase letter or number and use lowercase letters, numbers, dots, underscores, slashes, or hyphens.",
    );
  }

  const scheduleValue = getOwn(config, "schedule", mode);
  const cronValue = getOwn(config, "cron", mode);
  if (scheduleValue !== undefined && cronValue !== undefined && scheduleValue !== cronValue) {
    invalid("Schedule schedule and cron must match when both are provided.");
  }
  const scheduleExpression = mode === "definition" ? scheduleValue : scheduleValue ?? cronValue;
  const schedule = requireString(
    scheduleExpression,
    mode === "definition" ? "Schedule schedule" : "Schedule schedule or cron",
  );

  const name = optionalString(getOwn(config, "name", mode), "Schedule name");
  const description = optionalString(
    getOwn(config, "description", mode),
    "Schedule description",
  );
  const timezoneValue = getOwn(config, "timezone", mode);
  const timezone = timezoneValue === undefined
    ? undefined
    : requireString(timezoneValue, "Schedule timezone");
  const target = normalizeTarget(getOwn(config, "target", mode), mode);
  const input = normalizeInput(getOwn(config, "input", mode));

  const timeoutSeconds = optionalPositiveInteger(
    getOwn(config, "timeoutSeconds", mode),
    "Schedule timeoutSeconds",
  );
  const backoffLimit = optionalPositiveInteger(
    getOwn(config, "backoffLimit", mode),
    "Schedule backoffLimit",
  );
  const maxRuns = optionalPositiveInteger(
    getOwn(config, "maxRuns", mode),
    "Schedule maxRuns",
  );

  const concurrencyPolicy = getOwn(config, "concurrencyPolicy", mode);
  if (
    concurrencyPolicy !== undefined &&
    !CONCURRENCY_POLICIES.has(concurrencyPolicy as ScheduleConcurrencyPolicy)
  ) {
    invalid("Schedule concurrencyPolicy must be Allow, Forbid, or Replace.");
  }

  const health = normalizeScheduleHealth(getOwn(config, "health", mode), mode);
  const integrationRequirements = normalizeIntegrationRequirements(
    getOwn(config, "integrationRequirements", mode),
    mode,
  );

  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    schedule,
    ...(timezone === undefined ? {} : { timezone }),
    target,
    ...(input === undefined ? {} : { input }),
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    ...(backoffLimit === undefined ? {} : { backoffLimit }),
    ...(concurrencyPolicy === undefined
      ? {}
      : { concurrencyPolicy: concurrencyPolicy as ScheduleConcurrencyPolicy }),
    ...(maxRuns === undefined ? {} : { maxRuns }),
    ...(health === undefined ? {} : { health }),
    ...(integrationRequirements === undefined ? {} : { integrationRequirements }),
  };
}

function normalizeSchedule(value: unknown, mode: ValidationMode): ScheduleDefinition {
  try {
    return normalizeScheduleUnsafe(value, mode);
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === SCHEDULE_CONFIG_INVALID.slug) {
      throw error;
    }
    invalid("Schedule configuration is invalid.", error);
  }
}

export function normalizeScheduleConfig(value: unknown): ScheduleDefinition {
  return normalizeSchedule(value, "config");
}

export function isValidScheduleDefinition(value: unknown): value is ScheduleDefinition {
  try {
    normalizeSchedule(value, "definition");
    return true;
  } catch {
    return false;
  }
}
