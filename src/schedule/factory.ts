import { isTriggerTarget } from "#veryfront/trigger/target.ts";
import { assertSerializable, validateTriggerId } from "#veryfront/trigger/validation.ts";
import type {
  ScheduleConcurrencyPolicy,
  ScheduleConfig,
  ScheduleDefinition,
  ScheduleIntegrationRequirement,
  ScheduleIntegrationResource,
  ScheduleIntegrationResourceIdentity,
} from "./types.ts";

const CONCURRENCY_POLICIES = new Set<ScheduleConcurrencyPolicy>(["Allow", "Forbid", "Replace"]);
const INTEGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const REQUIREMENT_KIND_PATTERN = /^[a-z][a-z0-9_-]*$/;

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function validatePositiveInteger(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function requireContractString(value: unknown, label: string, maxLength: number): string {
  const normalized = requireString(value, label).trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function requireIntegrationName(value: unknown, label: string): string {
  const normalized = requireContractString(value, label, 255);
  if (!INTEGRATION_NAME_PATTERN.test(normalized)) {
    throw new Error(`${label} must use a lowercase integration identifier.`);
  }
  return normalized;
}

function requireRequirementKind(value: unknown, label: string): string {
  const normalized = requireContractString(value, label, 64);
  if (!REQUIREMENT_KIND_PATTERN.test(normalized)) {
    throw new Error(`${label} must use a lowercase resource kind.`);
  }
  return normalized;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new Error(`${label}.${unknownKey} is not supported.`);
  }
}

function normalizeIntegrationRequirements(
  value: unknown,
): ScheduleIntegrationRequirement[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Schedule integrationRequirements must be an array.");
  }
  if (value.length > 20) {
    throw new Error("Schedule integrationRequirements must contain at most 20 entries.");
  }

  const integrations = new Set<string>();
  return value.map((requirement, index) => {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      throw new Error(`Schedule integrationRequirements[${index}] must be an object.`);
    }

    const record = requirement as Record<string, unknown>;
    const label = `Schedule integrationRequirements[${index}]`;
    assertOnlyKeys(record, ["integration", "requiredScopes", "resources"], label);
    const integration = requireIntegrationName(
      record.integration,
      `${label}.integration`,
    );
    const integrationKey = integration.toLowerCase();
    if (integrations.has(integrationKey)) {
      throw new Error(
        `Schedule integrationRequirements contains duplicate integration ${integration}.`,
      );
    }
    integrations.add(integrationKey);

    const rawRequiredScopes = record.requiredScopes ?? [];
    if (!Array.isArray(rawRequiredScopes)) {
      throw new Error(
        `${label}.requiredScopes must be an array.`,
      );
    }
    if (rawRequiredScopes.length > 50) {
      throw new Error(
        `${label}.requiredScopes must contain at most 50 entries.`,
      );
    }
    const requiredScopes = rawRequiredScopes.map((scope, scopeIndex) =>
      requireContractString(
        scope,
        `${label}.requiredScopes[${scopeIndex}]`,
        255,
      )
    );

    const rawResources = record.resources ?? [];
    if (!Array.isArray(rawResources)) {
      throw new Error(`${label}.resources must be an array.`);
    }
    if (rawResources.length > 50) {
      throw new Error(
        `${label}.resources must contain at most 50 entries.`,
      );
    }
    const resources = rawResources.map((resource, resourceIndex) =>
      normalizeIntegrationResource(resource, index, resourceIndex)
    );

    return { integration, requiredScopes, resources };
  });
}

function normalizeIntegrationResource(
  resource: unknown,
  requirementIndex: number,
  resourceIndex: number,
): ScheduleIntegrationResource {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error(
      `Schedule integrationRequirements[${requirementIndex}].resources[${resourceIndex}] must be an object.`,
    );
  }

  const record = resource as Record<string, unknown>;
  const label = `Schedule integrationRequirements[${requirementIndex}].resources[${resourceIndex}]`;
  assertOnlyKeys(record, ["kind", "id", "parent"], label);
  const kind = requireRequirementKind(
    record.kind,
    `${label}.kind`,
  );
  const id = requireContractString(
    record.id,
    `${label}.id`,
    512,
  );
  const parent = record.parent;
  const normalizedParent = normalizeIntegrationResourceParent(
    parent,
    requirementIndex,
    resourceIndex,
  );

  return {
    kind,
    id,
    ...(normalizedParent === undefined ? {} : { parent: normalizedParent }),
  };
}

function normalizeIntegrationResourceParent(
  value: unknown,
  requirementIndex: number,
  resourceIndex: number,
): ScheduleIntegrationResourceIdentity | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Schedule integrationRequirements[${requirementIndex}].resources[${resourceIndex}].parent must be an object.`,
    );
  }

  const record = value as Record<string, unknown>;
  const label =
    `Schedule integrationRequirements[${requirementIndex}].resources[${resourceIndex}].parent`;
  assertOnlyKeys(record, ["kind", "id"], label);
  return {
    kind: requireRequirementKind(
      record.kind,
      `${label}.kind`,
    ),
    id: requireContractString(
      record.id,
      `${label}.id`,
      512,
    ),
  };
}

export function schedule(config: ScheduleConfig): ScheduleDefinition {
  const id = requireString(config.id, "Schedule id");
  validateTriggerId(id, "Schedule");

  const scheduleExpression = config.schedule ?? config.cron;
  const normalizedSchedule = requireString(scheduleExpression, "Schedule cron");

  if (!isTriggerTarget(config.target)) {
    throw new Error("Schedule target must specify a valid task, workflow, or agent id.");
  }

  if (
    config.concurrencyPolicy !== undefined &&
    !CONCURRENCY_POLICIES.has(config.concurrencyPolicy)
  ) {
    throw new Error("Schedule concurrencyPolicy must be Allow, Forbid, or Replace.");
  }

  validatePositiveInteger(config.timeoutSeconds, "Schedule timeoutSeconds");
  validatePositiveInteger(config.backoffLimit, "Schedule backoffLimit");
  validatePositiveInteger(config.maxRuns, "Schedule maxRuns");
  assertSerializable(config.input, "Schedule input");
  const integrationRequirements = normalizeIntegrationRequirements(config.integrationRequirements);

  return {
    id,
    ...(config.name === undefined ? {} : { name: config.name }),
    ...(config.description === undefined ? {} : { description: config.description }),
    schedule: normalizedSchedule,
    ...(config.timezone === undefined ? {} : { timezone: config.timezone }),
    target: { kind: config.target.kind, id: config.target.id },
    ...(config.input === undefined ? {} : { input: config.input }),
    ...(config.timeoutSeconds === undefined ? {} : { timeoutSeconds: config.timeoutSeconds }),
    ...(config.backoffLimit === undefined ? {} : { backoffLimit: config.backoffLimit }),
    ...(config.concurrencyPolicy === undefined
      ? {}
      : { concurrencyPolicy: config.concurrencyPolicy }),
    ...(config.maxRuns === undefined ? {} : { maxRuns: config.maxRuns }),
    ...(integrationRequirements === undefined ? {} : { integrationRequirements }),
  };
}
