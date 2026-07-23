import { SCHEDULE_CONFIG_INVALID, VeryfrontError } from "#veryfront/errors";
import { snapshotTriggerTarget } from "#veryfront/trigger/target.ts";
import { snapshotSerializable, validateTriggerId } from "#veryfront/trigger/validation.ts";
import { snapshotDenseArray, snapshotExactRecord } from "#veryfront/trigger/contract-snapshot.ts";
import type {
  ScheduleConcurrencyPolicy,
  ScheduleDefinition,
  ScheduleIntegrationRequirement,
  ScheduleIntegrationResource,
  ScheduleIntegrationResourceIdentity,
} from "./types.ts";

const TOP_LEVEL_CONFIG_KEYS = [
  "id",
  "name",
  "description",
  "schedule",
  "cron",
  "timezone",
  "target",
  "input",
  "timeoutSeconds",
  "backoffLimit",
  "concurrencyPolicy",
  "maxRuns",
  "integrationRequirements",
] as const;
const TOP_LEVEL_DEFINITION_KEYS = TOP_LEVEL_CONFIG_KEYS.filter((key) => key !== "cron");
const INTEGRATION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const REQUIREMENT_KIND_PATTERN = /^[a-z][a-z0-9_-]*$/;
const MAX_CRON_LENGTH = 256;
const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_TIMEZONE_LENGTH = 255;
const MAX_INTEGRATION_REQUIREMENTS = 20;
const MAX_REQUIREMENT_ITEMS = 50;

interface CronFieldContract {
  min: number;
  max: number;
  names?: ReadonlyMap<string, number>;
}

const MONTH_NAMES = new Map([
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["may", 5],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
]);
const WEEKDAY_NAMES = new Map([
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["wed", 3],
  ["thu", 4],
  ["fri", 5],
  ["sat", 6],
]);
const CRON_FIELDS: readonly CronFieldContract[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTH_NAMES },
  { min: 0, max: 7, names: WEEKDAY_NAMES },
];

function invalid(detail: string): never {
  throw SCHEDULE_CONFIG_INVALID.create({ detail });
}

function requireText(
  value: unknown,
  label: string,
  maxLength: number,
  options: { multiline?: boolean } = {},
): string {
  if (typeof value !== "string") invalid(`${label} is required.`);
  if (value.length > maxLength) {
    invalid(`${label} must be at most ${maxLength} characters.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) invalid(`${label} is required.`);
  let invalidControls = false;
  for (let index = 0; index < normalized.length; index++) {
    const code = normalized.charCodeAt(index);
    if (
      code === 127 ||
      (code <= 31 && (!options.multiline || (code !== 9 && code !== 10 && code !== 13)))
    ) {
      invalidControls = true;
      break;
    }
  }
  if (invalidControls) invalid(`${label} contains unsupported control characters.`);
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
  options?: { multiline?: boolean },
): string | undefined {
  return value === undefined ? undefined : requireText(value, label, maxLength, options);
}

function parseCronValue(value: string, contract: CronFieldContract): number | undefined {
  const named = contract.names?.get(value.toLowerCase());
  if (named !== undefined) return named;
  if (!/^\d{1,2}$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= contract.min && parsed <= contract.max ? parsed : undefined;
}

function isCronField(value: string, contract: CronFieldContract): boolean {
  const entries = value.split(",");
  if (entries.length === 0 || entries.length > 64 || entries.some((entry) => entry.length === 0)) {
    return false;
  }

  return entries.every((entry) => {
    const stepParts = entry.split("/");
    if (stepParts.length > 2) return false;
    const [base, rawStep] = stepParts;
    if (!base) return false;
    if (rawStep !== undefined) {
      if (!/^\d{1,3}$/.test(rawStep)) return false;
      const step = Number(rawStep);
      if (step < 1 || step > contract.max - contract.min + 1) return false;
    }
    if (base === "*") return true;

    const rangeParts = base.split("-");
    if (rangeParts.length === 1) return parseCronValue(base, contract) !== undefined;
    if (rangeParts.length !== 2) return false;
    const start = parseCronValue(rangeParts[0]!, contract);
    const end = parseCronValue(rangeParts[1]!, contract);
    return start !== undefined && end !== undefined && start <= end;
  });
}

function normalizeCron(value: unknown): string {
  const expression = requireText(value, "Schedule cron", MAX_CRON_LENGTH);
  const fields = expression.split(/\s+/);
  if (
    fields.length !== CRON_FIELDS.length ||
    !fields.every((field, index) => isCronField(field, CRON_FIELDS[index]!))
  ) {
    invalid("Schedule cron must be a valid five-field cron expression.");
  }
  return fields.join(" ");
}

function normalizeTimezone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const timezone = requireText(value, "Schedule timezone", MAX_TIMEZONE_LENGTH);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    invalid("Schedule timezone must be a valid IANA time zone.");
  }
  return timezone;
}

function normalizeSafeInteger(
  value: unknown,
  label: string,
  minimum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    invalid(
      `${label} must be ${minimum === 0 ? "a non-negative" : "a positive"} safe integer.`,
    );
  }
  return value;
}

function isConcurrencyPolicy(value: unknown): value is ScheduleConcurrencyPolicy {
  return value === "Allow" || value === "Forbid" || value === "Replace";
}

function normalizeInput(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  let snapshot: unknown;
  try {
    snapshot = snapshotSerializable(value, "Schedule input");
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "trigger-config-invalid") {
      invalid(error.detail ?? "Schedule input must be JSON-serializable.");
    }
    invalid("Schedule input must be JSON-serializable.");
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    invalid("Schedule input must be a JSON object.");
  }
  return snapshot as Record<string, unknown>;
}

function normalizeIntegrationName(value: unknown, label: string): string {
  const integration = requireText(value, label, 255);
  if (!INTEGRATION_NAME_PATTERN.test(integration)) {
    invalid(`${label} must use a lowercase integration identifier.`);
  }
  return integration;
}

function normalizeRequirementKind(value: unknown, label: string): string {
  const kind = requireText(value, label, 64);
  if (!REQUIREMENT_KIND_PATTERN.test(kind)) {
    invalid(`${label} must use a lowercase resource kind.`);
  }
  return kind;
}

function normalizeResourceIdentity(
  value: unknown,
  label: string,
): ScheduleIntegrationResourceIdentity {
  const record = snapshotExactRecord(value, label, ["kind", "id"], invalid);
  return {
    kind: normalizeRequirementKind(record.kind, `${label}.kind`),
    id: requireText(record.id, `${label}.id`, 512),
  };
}

function normalizeResource(value: unknown, label: string): ScheduleIntegrationResource {
  const record = snapshotExactRecord(value, label, ["kind", "id", "parent"], invalid);
  const kind = normalizeRequirementKind(record.kind, `${label}.kind`);
  const id = requireText(record.id, `${label}.id`, 512);
  const parent = record.parent === undefined
    ? undefined
    : normalizeResourceIdentity(record.parent, `${label}.parent`);
  return { kind, id, ...(parent === undefined ? {} : { parent }) };
}

function resourceKey(resource: ScheduleIntegrationResource): string {
  return [
    resource.kind,
    resource.id,
    resource.parent?.kind ?? "",
    resource.parent?.id ?? "",
  ].join("\0");
}

function normalizeIntegrationRequirements(
  value: unknown,
  canonical: boolean,
): ScheduleIntegrationRequirement[] | undefined {
  if (value === undefined) return undefined;
  const rawRequirements = snapshotDenseArray(
    value,
    "Schedule integrationRequirements",
    MAX_INTEGRATION_REQUIREMENTS,
    invalid,
  );
  const integrations = new Set<string>();

  return rawRequirements.map((requirement, requirementIndex) => {
    const label = `Schedule integrationRequirements[${requirementIndex}]`;
    const record = snapshotExactRecord(
      requirement,
      label,
      ["integration", "requiredScopes", "resources"],
      invalid,
    );
    if (
      canonical &&
      (!Object.hasOwn(record, "requiredScopes") || !Object.hasOwn(record, "resources"))
    ) {
      invalid(`${label} must define requiredScopes and resources arrays.`);
    }

    const integration = normalizeIntegrationName(record.integration, `${label}.integration`);
    if (integrations.has(integration)) {
      invalid(`Schedule integrationRequirements contains duplicate integration ${integration}.`);
    }
    integrations.add(integration);

    const rawScopes = snapshotDenseArray(
      record.requiredScopes ?? [],
      `${label}.requiredScopes`,
      MAX_REQUIREMENT_ITEMS,
      invalid,
    );
    const scopes = new Set<string>();
    const requiredScopes = rawScopes.map((scope, scopeIndex) => {
      const normalized = requireText(scope, `${label}.requiredScopes[${scopeIndex}]`, 255);
      if (scopes.has(normalized)) {
        invalid(`${label}.requiredScopes contains duplicate scope ${normalized}.`);
      }
      scopes.add(normalized);
      return normalized;
    });

    const rawResources = snapshotDenseArray(
      record.resources ?? [],
      `${label}.resources`,
      MAX_REQUIREMENT_ITEMS,
      invalid,
    );
    const resourceKeys = new Set<string>();
    const resources = rawResources.map((resource, resourceIndex) => {
      const normalized = normalizeResource(resource, `${label}.resources[${resourceIndex}]`);
      const key = resourceKey(normalized);
      if (resourceKeys.has(key)) {
        invalid(`${label}.resources contains a duplicate resource.`);
      }
      resourceKeys.add(key);
      return normalized;
    });

    return { integration, requiredScopes, resources };
  });
}

export function normalizeScheduleConfig(
  value: unknown,
  options: { canonical?: boolean } = {},
): ScheduleDefinition {
  const canonical = options.canonical ?? false;
  const config = snapshotExactRecord(
    value,
    "Schedule",
    canonical ? TOP_LEVEL_DEFINITION_KEYS : TOP_LEVEL_CONFIG_KEYS,
    invalid,
  );

  const id = requireText(config.id, "Schedule id", 255);
  try {
    validateTriggerId(id, "Schedule");
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "trigger-config-invalid") {
      invalid(error.detail ?? "Schedule id is invalid.");
    }
    invalid("Schedule id is invalid.");
  }

  const hasSchedule = config.schedule !== undefined;
  const hasCron = config.cron !== undefined;
  if (hasSchedule && hasCron) {
    invalid("Schedule must define either schedule or cron, not both.");
  }
  if (canonical && !hasSchedule) invalid("Schedule cron is required.");
  const scheduleExpression = normalizeCron(hasSchedule ? config.schedule : config.cron);

  const target = snapshotTriggerTarget(config.target);
  if (!target) {
    invalid("Schedule target must specify a valid task, workflow, or agent id.");
  }

  const name = optionalText(config.name, "Schedule name", MAX_NAME_LENGTH);
  const description = optionalText(
    config.description,
    "Schedule description",
    MAX_DESCRIPTION_LENGTH,
    { multiline: true },
  );
  const timezone = normalizeTimezone(config.timezone);
  const input = normalizeInput(config.input);
  const timeoutSeconds = normalizeSafeInteger(
    config.timeoutSeconds,
    "Schedule timeoutSeconds",
    1,
  );
  const backoffLimit = normalizeSafeInteger(config.backoffLimit, "Schedule backoffLimit", 0);
  const maxRuns = normalizeSafeInteger(config.maxRuns, "Schedule maxRuns", 1);
  const concurrencyPolicy = config.concurrencyPolicy;
  if (concurrencyPolicy !== undefined && !isConcurrencyPolicy(concurrencyPolicy)) {
    invalid("Schedule concurrencyPolicy must be Allow, Forbid, or Replace.");
  }
  const integrationRequirements = normalizeIntegrationRequirements(
    config.integrationRequirements,
    canonical,
  );

  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    schedule: scheduleExpression,
    ...(timezone === undefined ? {} : { timezone }),
    target,
    ...(input === undefined ? {} : { input }),
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    ...(backoffLimit === undefined ? {} : { backoffLimit }),
    ...(concurrencyPolicy === undefined ? {} : { concurrencyPolicy }),
    ...(maxRuns === undefined ? {} : { maxRuns }),
    ...(integrationRequirements === undefined ? {} : { integrationRequirements }),
  };
}
