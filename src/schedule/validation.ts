import { SCHEDULE_CONFIG_INVALID, VeryfrontError } from "#veryfront/errors";
import {
  agentConversationDiagnostic,
  conversationConflictDiagnostic,
  declarationConflictDiagnostic,
  resolveTriggerTarget,
  type TriggerTarget,
  type TriggerTargetConfig,
  triggerTargetKeys,
} from "#veryfront/trigger/target.ts";
import { snapshotSerializable, validateTriggerId } from "#veryfront/trigger/validation.ts";
import { isSupportedIanaTimezone, normalizeCronExpression } from "./calendar.ts";
import type {
  ScheduleAgentMessage,
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
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_SCHEDULE_EXPRESSION_LENGTH = 256;
const MAX_TIMEZONE_LENGTH = 255;
const MAX_AGENT_PROMPT_LENGTH = 20_000;
const MAX_DIAGNOSTIC_KEY_LENGTH = 80;
const SIMPLE_DIAGNOSTIC_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;
const LEGACY_TARGET_KEYS = new Set(["conversationMode", "conversationId"]);

const CONFIG_KEYS = [
  "id",
  "name",
  "description",
  "schedule",
  "cron",
  "timezone",
  "target",
  "agentMessage",
  "input",
  "timeoutSeconds",
  "backoffLimit",
  "concurrencyPolicy",
  "maxRuns",
  "health",
  "integrationRequirements",
] as const;
const DEFINITION_KEYS = CONFIG_KEYS.filter((key) => key !== "cron");

type ValidationMode = "config" | "definition";

function invalid(detail: string, cause?: unknown): never {
  throw SCHEDULE_CONFIG_INVALID.create({
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function truncateDiagnosticKey(key: string): string {
  if (key.length <= MAX_DIAGNOSTIC_KEY_LENGTH) return key;
  let prefix = key.slice(0, MAX_DIAGNOSTIC_KEY_LENGTH);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}…`;
}

function formatDiagnosticProperty(label: string, key: string): string {
  const boundedKey = truncateDiagnosticKey(key);
  return SIMPLE_DIAGNOSTIC_KEY_PATTERN.test(boundedKey)
    ? `${label}.${boundedKey}`
    : `${label}[${JSON.stringify(boundedKey)}]`;
}

function snapshotDataRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }

  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${label} must be a plain object.`);
  }

  const allowed = new Set(allowedKeys);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key === "symbol") {
      invalid(`${label} must not define symbol properties.`);
    }
    if (!allowed.has(key)) {
      invalid(`${formatDiagnosticProperty(label, key)} is not supported.`);
    }
  }

  const listedKeys = new Set(ownKeys);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of allowedKeys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    const listed = listedKeys.has(key);
    const descriptorExists = descriptor !== undefined;
    if (listed !== descriptorExists) {
      invalid(`${label} is invalid.`);
    }
    if (descriptor === undefined) continue;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      invalid(`${label}.${key} must be an own enumerable data property.`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${label} is required.`);
  }
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

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${label} must be a non-negative integer within the safe integer range.`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : requireNonNegativeInteger(value, label);
}

function assertNoControlCharacters(value: string, label: string): void {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      invalid(`${label} must not contain control characters.`);
    }
  }
}

function requireContractString(
  value: unknown,
  label: string,
  maxLength: number,
  mode: ValidationMode,
): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${label} is required.`);
  }
  if (value.length > maxLength) {
    invalid(`${label} must be at most ${maxLength} characters.`);
  }
  const original = value;
  const normalized = original.trim();
  if (normalized.length === 0) invalid(`${label} is required.`);
  assertNoControlCharacters(normalized, label);
  if (mode === "definition" && normalized !== original) {
    invalid(`${label} must not include leading or trailing whitespace.`);
  }
  return normalized;
}

function optionalContractString(
  value: unknown,
  label: string,
  maxLength: number,
  mode: ValidationMode,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  return requireContractString(value, label, maxLength, mode);
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

function snapshotDataArray(
  value: unknown,
  label: string,
  maxLength: number,
): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  if (Reflect.getPrototypeOf(value) !== Array.prototype) {
    invalid(`${label} must be a plain array.`);
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const lengthValue = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof lengthValue !== "number" ||
    !Number.isSafeInteger(lengthValue) ||
    lengthValue < 0
  ) {
    invalid(`${label} has an invalid length.`);
  }
  const length = lengthValue;
  if (length > maxLength) {
    invalid(`${label} must contain at most ${maxLength} entries.`);
  }

  const allowedKeys = new Set<PropertyKey>(["length"]);
  for (let index = 0; index < length; index++) {
    allowedKeys.add(String(index));
  }
  if (Reflect.ownKeys(value).some((key) => !allowedKeys.has(key))) {
    invalid(`${label} must not define custom properties.`);
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      invalid(`${label}[${index}] must be an enumerable data property.`);
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function normalizeCron(
  value: unknown,
  label: string,
  mode: ValidationMode,
): string {
  const original = requireString(value, label);
  if (original.length > MAX_SCHEDULE_EXPRESSION_LENGTH) {
    invalid(`${label} must be at most ${MAX_SCHEDULE_EXPRESSION_LENGTH} characters.`);
  }
  if (original.trim().length === 0) invalid(`${label} is required.`);
  assertNoControlCharacters(original, label);

  const normalized = normalizeCronExpression(original);
  if (normalized === null) {
    invalid("Schedule schedule must be a five-field POSIX cron expression.");
  }
  if (mode === "definition" && normalized !== original) {
    invalid("Schedule schedule must use canonical five-field POSIX cron syntax.");
  }
  return normalized;
}

function normalizeTimezone(
  value: unknown,
  mode: ValidationMode,
): string | undefined {
  if (value === undefined) return undefined;
  const timezone = requireContractString(
    value,
    "Schedule timezone",
    MAX_TIMEZONE_LENGTH,
    mode,
  );
  if (!isSupportedIanaTimezone(timezone)) {
    invalid("Schedule timezone must be a supported IANA timezone name.");
  }
  return timezone;
}

function normalizeTarget(value: unknown): TriggerTargetConfig {
  const target = snapshotDataRecord(
    value,
    "Schedule target",
    triggerTargetKeys(value),
  );
  const conversationDetail = agentConversationDiagnostic(
    "Schedule target",
    target.conversationMode,
    target.conversationId,
  );
  if (conversationDetail !== null) invalid(conversationDetail);

  const resolution = resolveTriggerTarget("Schedule target", target);
  if (resolution.target === undefined) {
    invalid("Schedule target must specify a valid task, workflow, or agent id.");
  }
  return resolution.target;
}

function normalizeAgentMessage(
  value: unknown,
  target: TriggerTarget,
): ScheduleAgentMessage | undefined {
  if (value === undefined) return undefined;
  if (target.kind !== "agent") {
    invalid("Schedule agentMessage is supported only for agent targets.");
  }

  const message = snapshotDataRecord(value, "Schedule agentMessage", ["prompt"]);
  // An agentMessage carrying no prompt says nothing. Emitting `{}` into the
  // shipped definition would ship that nothing as a field.
  if (message.prompt === undefined) return undefined;

  const prompt = message.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    invalid("Schedule agentMessage.prompt must be a non-empty string.");
  }
  if (prompt.length > MAX_AGENT_PROMPT_LENGTH) {
    invalid(`Schedule agentMessage.prompt must be at most ${MAX_AGENT_PROMPT_LENGTH} characters.`);
  }
  return { prompt };
}

/**
 * Read the conversation pair from the legacy `input._schedule_target` channel.
 *
 * Older SDKs addressed a scheduled agent conversation through run input. The
 * value is already a serializable snapshot, so plain property reads are safe.
 */
function legacyScheduleConversation(
  input: Record<string, unknown> | undefined,
): { conversationMode: unknown; conversationId: unknown } {
  const legacyTarget = input?._schedule_target;
  if (
    !legacyTarget || typeof legacyTarget !== "object" || Array.isArray(legacyTarget)
  ) {
    return { conversationMode: undefined, conversationId: undefined };
  }
  const record = legacyTarget as Record<string, unknown>;
  return {
    conversationMode: record.conversationMode,
    conversationId: record.conversationId,
  };
}

/**
 * Describe why the legacy `input._schedule_target` channel is invalid, or
 * return `null`.
 *
 * The legacy channel addresses the same hosted conversation as the canonical
 * target, so it earns the same guarantees. Validating only the canonical copy
 * would leave an author who addresses a conversation through the legacy
 * channel alone with none of them: a misspelled key would disappear and the
 * schedule would ship addressing nothing.
 *
 * The value is already a serializable snapshot, so plain key enumeration and
 * property reads are safe.
 */
export function legacyScheduleTargetDiagnostic(
  input: Record<string, unknown> | undefined,
  conversation: { conversationMode: unknown; conversationId: unknown },
): string | null {
  const legacyTarget = input?._schedule_target;
  const label = "Schedule input._schedule_target";
  if (legacyTarget === undefined) return null;
  if (
    legacyTarget === null || typeof legacyTarget !== "object" ||
    Array.isArray(legacyTarget)
  ) {
    return `${label} must be an object.`;
  }
  for (const key of Object.keys(legacyTarget)) {
    if (!LEGACY_TARGET_KEYS.has(key)) {
      return `${formatDiagnosticProperty(label, key)} is not supported.`;
    }
  }
  return agentConversationDiagnostic(
    label,
    conversation.conversationMode,
    conversation.conversationId,
  );
}

function normalizeInput(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Schedule input must be an object.");
  }
  try {
    return snapshotSerializable(value, "Schedule input") as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof VeryfrontError && error.detail
      ? error.detail
      : "Schedule input must be JSON-serializable.";
    invalid(detail, error);
  }
}

function normalizeScheduleHealth(
  value: unknown,
): ScheduleHealth | undefined {
  if (value === undefined) return undefined;
  const health = snapshotDataRecord(value, "Schedule health", ["maxStalenessSeconds"]);
  return {
    maxStalenessSeconds: requirePositiveInteger(
      health.maxStalenessSeconds,
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
  const parent = snapshotDataRecord(value, label, ["kind", "id"]);
  return {
    kind: requireRequirementKind(parent.kind, `${label}.kind`, mode),
    id: requireContractString(
      parent.id,
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
  const resource = snapshotDataRecord(value, label, ["kind", "id", "parent"]);

  const parent = normalizeIntegrationResourceParent(
    resource.parent,
    requirementIndex,
    resourceIndex,
    mode,
  );
  return {
    kind: requireRequirementKind(resource.kind, `${label}.kind`, mode),
    id: requireContractString(
      resource.id,
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
  const requirements = snapshotDataArray(
    value,
    "Schedule integrationRequirements",
    MAX_INTEGRATION_REQUIREMENTS,
  );

  const integrations = new Set<string>();
  return requirements.map((value, index) => {
    const label = `Schedule integrationRequirements[${index}]`;
    const requirement = snapshotDataRecord(value, label, [
      "integration",
      "requiredScopes",
      "resources",
    ]);

    const integration = requireIntegrationName(
      requirement.integration,
      `${label}.integration`,
      mode,
    );
    if (integrations.has(integration)) {
      invalid(`Schedule integrationRequirements contains duplicate integration ${integration}.`);
    }
    integrations.add(integration);

    const requiredScopesValue = requirement.requiredScopes;
    if (mode === "definition" && requiredScopesValue === undefined) {
      invalid(`${label}.requiredScopes must be an array.`);
    }
    const requiredScopes = snapshotDataArray(
      requiredScopesValue === undefined ? [] : requiredScopesValue,
      `${label}.requiredScopes`,
      MAX_SCOPES_PER_REQUIREMENT,
    );

    const resourcesValue = requirement.resources;
    if (mode === "definition" && resourcesValue === undefined) {
      invalid(`${label}.resources must be an array.`);
    }
    const resources = snapshotDataArray(
      resourcesValue === undefined ? [] : resourcesValue,
      `${label}.resources`,
      MAX_RESOURCES_PER_REQUIREMENT,
    );

    const normalizedScopes = requiredScopes.map((scope, scopeIndex) =>
      requireContractString(
        scope,
        `${label}.requiredScopes[${scopeIndex}]`,
        MAX_SCOPE_LENGTH,
        mode,
      )
    );
    const scopes = new Set<string>();
    for (const scope of normalizedScopes) {
      if (scopes.has(scope)) {
        invalid(`${label}.requiredScopes contains duplicate scope ${scope}.`);
      }
      scopes.add(scope);
    }

    const normalizedResources = resources.map((resource, resourceIndex) =>
      normalizeIntegrationResource(resource, index, resourceIndex, mode)
    );
    const resourceIdentities = new Set<string>();
    for (const resource of normalizedResources) {
      const identity = JSON.stringify([
        resource.kind,
        resource.id,
        resource.parent?.kind ?? null,
        resource.parent?.id ?? null,
      ]);
      if (resourceIdentities.has(identity)) {
        invalid(`${label}.resources contains a duplicate resource identity.`);
      }
      resourceIdentities.add(identity);
    }

    return {
      integration,
      requiredScopes: normalizedScopes,
      resources: normalizedResources,
    };
  });
}

function normalizeScheduleUnsafe(value: unknown, mode: ValidationMode): ScheduleDefinition {
  const config = snapshotDataRecord(
    value,
    "Schedule configuration",
    mode === "config" ? CONFIG_KEYS : DEFINITION_KEYS,
  );

  const id = requireString(config.id, "Schedule id");
  try {
    validateTriggerId(id, "Schedule");
  } catch (error) {
    const detail = error instanceof VeryfrontError && error.detail
      ? error.detail
      : "Schedule id must be a canonical slash-separated lowercase identifier.";
    invalid(detail, error);
  }

  const scheduleValue = config.schedule;
  const cronValue = config.cron;
  if (scheduleValue === undefined && cronValue === undefined) {
    invalid(
      mode === "definition"
        ? "Schedule schedule is required."
        : "Schedule schedule or cron is required.",
    );
  }
  const normalizedSchedule = scheduleValue === undefined
    ? undefined
    : normalizeCron(scheduleValue, "Schedule schedule", mode);
  const normalizedCron = cronValue === undefined
    ? undefined
    : normalizeCron(cronValue, "Schedule cron", mode);
  if (
    normalizedSchedule !== undefined &&
    normalizedCron !== undefined &&
    normalizedSchedule !== normalizedCron
  ) {
    invalid("Schedule schedule and cron must match when both are provided.");
  }
  const schedule = normalizedSchedule ?? normalizedCron;
  if (schedule === undefined) {
    invalid("Schedule schedule or cron is required.");
  }

  const name = optionalContractString(
    config.name,
    "Schedule name",
    MAX_NAME_LENGTH,
    mode,
  );
  const description = optionalContractString(
    config.description,
    "Schedule description",
    MAX_DESCRIPTION_LENGTH,
    mode,
  );
  const timezone = normalizeTimezone(config.timezone, mode);
  const target = normalizeTarget(config.target);
  const agentMessage = normalizeAgentMessage(config.agentMessage, target);
  const input = normalizeInput(config.input);

  // Declaring the same value in both places is how one definition stays
  // correct across a platform upgrade, so only a disagreement is rejected:
  // silently preferring one copy would detach the deployed schedule from what
  // the other copy names. Prompt content follows the identical rule.
  const legacyConversation = legacyScheduleConversation(input);
  const conflictDetail = conversationConflictDiagnostic(
    "Schedule",
    "input._schedule_target",
    target,
    legacyConversation.conversationMode,
    legacyConversation.conversationId,
  ) ??
    declarationConflictDiagnostic(
      "Schedule",
      "agentMessage.prompt",
      "input.prompt",
      agentMessage?.prompt,
      input?.prompt,
    );
  if (conflictDetail !== null) invalid(conflictDetail);

  const legacyTargetDetail = target.kind === "agent"
    ? legacyScheduleTargetDiagnostic(input, legacyConversation)
    : null;
  if (legacyTargetDetail !== null) invalid(legacyTargetDetail);

  const timeoutSeconds = optionalPositiveInteger(
    config.timeoutSeconds,
    "Schedule timeoutSeconds",
  );
  const backoffLimit = optionalNonNegativeInteger(
    config.backoffLimit,
    "Schedule backoffLimit",
  );
  const maxRuns = optionalPositiveInteger(
    config.maxRuns,
    "Schedule maxRuns",
  );

  const concurrencyPolicy = config.concurrencyPolicy;
  if (
    concurrencyPolicy !== undefined &&
    !CONCURRENCY_POLICIES.has(concurrencyPolicy as ScheduleConcurrencyPolicy)
  ) {
    invalid("Schedule concurrencyPolicy must be Allow, Forbid, or Replace.");
  }

  const health = normalizeScheduleHealth(config.health);
  const integrationRequirements = normalizeIntegrationRequirements(
    config.integrationRequirements,
    mode,
  );

  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    schedule,
    ...(timezone === undefined ? {} : { timezone }),
    target,
    ...(agentMessage === undefined ? {} : { agentMessage }),
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

/** Validate and copy an already-canonical source schedule definition. */
export function normalizeScheduleDefinition(value: unknown): ScheduleDefinition {
  return normalizeSchedule(value, "definition");
}

export function isValidScheduleDefinition(value: unknown): value is ScheduleDefinition {
  try {
    normalizeScheduleDefinition(value);
    return true;
  } catch {
    return false;
  }
}
