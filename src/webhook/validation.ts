import { VeryfrontError, WEBHOOK_CONFIG_INVALID } from "#veryfront/errors";
import {
  agentConversationDiagnostic,
  conversationConflictDiagnostic,
  type ResolvedTriggerTarget,
  resolveTriggerTarget,
  triggerTargetKeys,
} from "#veryfront/trigger/target.ts";
import { snapshotSerializable, validateTriggerId } from "#veryfront/trigger/validation.ts";
import type {
  WebhookAgentConversationMode,
  WebhookAgentMessageMapping,
  WebhookDefinition,
  WebhookEventFilter,
  WebhookEventFilterCondition,
  WebhookEventFilterOperator,
} from "./types.ts";

const EVENT_FILTER_OPERATORS = new Set<WebhookEventFilterOperator>([
  "equals",
  "not_equals",
  "in",
  "exists",
  "contains",
]);
const WEBHOOK_KEYS = [
  "id",
  "name",
  "description",
  "target",
  "eventFilter",
  "agentMessage",
] as const;
const EVENT_FILTER_KEYS = ["mode", "conditions"] as const;
const EVENT_FILTER_CONDITION_KEYS = ["path", "operator", "value"] as const;
const AGENT_MESSAGE_KEYS = [
  "promptTemplate",
  "conversationMode",
  "conversationId",
] as const;
const MAX_WEBHOOK_ID_LENGTH = 128;
const MAX_TARGET_ID_LENGTH = 255;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_EVENT_FILTER_CONDITIONS = 50;
const MAX_EVENT_FILTER_PATH_LENGTH = 255;
const MAX_PROMPT_TEMPLATE_LENGTH = 20_000;
const MAX_DIAGNOSTIC_KEY_LENGTH = 80;
const SIMPLE_DIAGNOSTIC_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

function invalid(detail: string, cause?: unknown): never {
  throw WEBHOOK_CONFIG_INVALID.create({
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

function assertNoControlCharacters(
  value: string,
  label: string,
  allowFormattingWhitespace = false,
): void {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    const allowedWhitespace = allowFormattingWhitespace &&
      (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d);
    if (
      !allowedWhitespace &&
      (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f))
    ) {
      invalid(`${label} must not contain control characters.`);
    }
  }
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
    if (listedKeys.has(key) !== (descriptor !== undefined)) {
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
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    invalid(`${label} has an invalid length.`);
  }
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

function requireCanonicalString(
  value: unknown,
  label: string,
  maxLength: number,
  allowFormattingWhitespace = false,
): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${label} is required.`);
  }
  if (value.length > maxLength) {
    invalid(`${label} must be at most ${maxLength} characters.`);
  }
  if (value.trim().length === 0) invalid(`${label} is required.`);
  if (value.trim() !== value) {
    invalid(`${label} must not include leading or trailing whitespace.`);
  }
  assertNoControlCharacters(value, label, allowFormattingWhitespace);
  return value;
}

function optionalCanonicalString(
  value: unknown,
  label: string,
  maxLength: number,
  allowFormattingWhitespace = false,
): string | undefined {
  return value === undefined ? undefined : requireCanonicalString(
    value,
    label,
    maxLength,
    allowFormattingWhitespace,
  );
}

function requireEventFilterPath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${label} is required.`);
  }
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("$.") ? trimmed.slice(2) : trimmed;
  if (normalized.length === 0) invalid(`${label} is required.`);
  if (normalized.length > MAX_EVENT_FILTER_PATH_LENGTH) {
    invalid(`${label} must be at most ${MAX_EVENT_FILTER_PATH_LENGTH} characters.`);
  }
  assertNoControlCharacters(normalized, label);
  return normalized;
}

function requirePromptTemplate(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid("Webhook agentMessage.promptTemplate is required.");
  }
  if (value.length > MAX_PROMPT_TEMPLATE_LENGTH) {
    invalid(
      `Webhook agentMessage.promptTemplate must be at most ${MAX_PROMPT_TEMPLATE_LENGTH} characters.`,
    );
  }
  if (value.trim().length === 0) {
    invalid("Webhook agentMessage.promptTemplate is required.");
  }
  return value;
}

/** Return true for source webhook identifiers accepted by hosted reconciliation. */
export function isWebhookId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_WEBHOOK_ID_LENGTH) {
    return false;
  }
  try {
    validateTriggerId(value, "Webhook");
    return true;
  } catch {
    return false;
  }
}

function normalizeTarget(value: unknown): ResolvedTriggerTarget {
  const target = snapshotDataRecord(
    value,
    "Webhook target",
    triggerTargetKeys(value),
  );
  const conversationDetail = agentConversationDiagnostic(
    "Webhook target",
    target.conversationMode,
    target.conversationId,
  );
  if (conversationDetail !== null) invalid(conversationDetail);

  const resolution = resolveTriggerTarget("Webhook target", target);
  if (
    resolution.target === undefined ||
    resolution.target.id.length > MAX_TARGET_ID_LENGTH
  ) {
    invalid(
      `Webhook target must specify a task, workflow, or agent id of at most ${MAX_TARGET_ID_LENGTH} characters using the canonical trigger id format.`,
    );
  }
  return resolution.target;
}

function snapshotFilterValue(value: unknown, label: string): unknown {
  try {
    return snapshotSerializable(value, label);
  } catch (error) {
    const detail = error instanceof VeryfrontError && error.detail
      ? error.detail
      : `${label} must be JSON-serializable.`;
    invalid(detail, error);
  }
}

function normalizeFilterCondition(
  value: unknown,
  index: number,
): WebhookEventFilterCondition {
  const label = `Webhook eventFilter condition ${index}`;
  const condition = snapshotDataRecord(
    value,
    label,
    EVENT_FILTER_CONDITION_KEYS,
  );
  const path = requireEventFilterPath(condition.path, `${label} path`);
  const operator = condition.operator;
  if (!EVENT_FILTER_OPERATORS.has(operator as WebhookEventFilterOperator)) {
    invalid(`${label} operator is not supported.`);
  }

  const conditionValue = condition.value === undefined
    ? undefined
    : snapshotFilterValue(condition.value, `${label} value`);
  return {
    path,
    operator: operator as WebhookEventFilterOperator,
    ...(conditionValue === undefined ? {} : { value: conditionValue }),
  };
}

function normalizeFilter(value: unknown): WebhookEventFilter | undefined {
  if (value === undefined) return undefined;
  const filter = snapshotDataRecord(
    value,
    "Webhook eventFilter",
    EVENT_FILTER_KEYS,
  );
  const mode = filter.mode;
  if (mode !== "all" && mode !== "any") {
    invalid("Webhook eventFilter mode must be all or any.");
  }
  const conditions = snapshotDataArray(
    filter.conditions,
    "Webhook eventFilter conditions",
    MAX_EVENT_FILTER_CONDITIONS,
  ).map(normalizeFilterCondition);

  const normalized = { mode, conditions } satisfies WebhookEventFilter;
  return snapshotFilterValue(
    normalized,
    "Webhook eventFilter",
  ) as unknown as WebhookEventFilter;
}

function normalizeAgentMessage(
  value: unknown,
  target: ResolvedTriggerTarget,
): WebhookAgentMessageMapping | undefined {
  if (value === undefined) {
    if (target.kind === "agent") {
      invalid("Agent webhooks must define agentMessage.promptTemplate.");
    }
    return undefined;
  }
  if (target.kind !== "agent") {
    invalid("Webhook agentMessage is supported only for agent targets.");
  }

  const mapping = snapshotDataRecord(
    value,
    "Webhook agentMessage",
    AGENT_MESSAGE_KEYS,
  );
  const promptTemplate = requirePromptTemplate(mapping.promptTemplate);

  // Declaring the same value in both places is how one definition stays
  // correct across a platform upgrade, so only a disagreement is rejected:
  // honoring one copy and dropping the other would silently detach the
  // deployed webhook from the conversation the other copy names.
  const conflictDetail = conversationConflictDiagnostic(
    "Webhook",
    "agentMessage",
    target,
    mapping.conversationMode,
    mapping.conversationId,
  );
  if (conflictDetail !== null) invalid(conflictDetail);

  const conversationDetail = agentConversationDiagnostic(
    "Webhook agentMessage",
    mapping.conversationMode,
    mapping.conversationId,
  );
  if (conversationDetail !== null) invalid(conversationDetail);

  // The legacy agentMessage pair is preserved verbatim: a platform that
  // predates target-level addressing reads it, and it agrees with the target
  // whenever both are declared.
  return {
    promptTemplate,
    ...(mapping.conversationMode === undefined ? {} : {
      conversationMode: mapping.conversationMode as WebhookAgentConversationMode,
    }),
    ...(mapping.conversationId === undefined
      ? {}
      : { conversationId: mapping.conversationId as string | null }),
  };
}

function normalizeWebhookDefinitionUnsafe(value: unknown): WebhookDefinition {
  const config = snapshotDataRecord(
    value,
    "Webhook configuration",
    WEBHOOK_KEYS,
  );
  const id = requireCanonicalString(
    config.id,
    "Webhook id",
    MAX_WEBHOOK_ID_LENGTH,
  );
  if (!isWebhookId(id)) {
    invalid(
      `Webhook id must be at most ${MAX_WEBHOOK_ID_LENGTH} characters and contain slash-separated lowercase segments that start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.`,
    );
  }

  const name = optionalCanonicalString(
    config.name,
    "Webhook name",
    MAX_NAME_LENGTH,
  );
  const description = optionalCanonicalString(
    config.description,
    "Webhook description",
    MAX_DESCRIPTION_LENGTH,
    true,
  );
  const target = normalizeTarget(config.target);
  const eventFilter = normalizeFilter(config.eventFilter);
  const agentMessage = normalizeAgentMessage(config.agentMessage, target);

  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    target,
    ...(eventFilter === undefined ? {} : { eventFilter }),
    ...(agentMessage === undefined ? {} : { agentMessage }),
  };
}

export function normalizeWebhookDefinition(value: unknown): WebhookDefinition {
  try {
    return normalizeWebhookDefinitionUnsafe(value);
  } catch (error) {
    if (
      error instanceof VeryfrontError &&
      error.slug === WEBHOOK_CONFIG_INVALID.slug
    ) {
      throw error;
    }
    invalid("Webhook configuration is invalid.", error);
  }
}

export function normalizeWebhookConfig(value: unknown): WebhookDefinition {
  return normalizeWebhookDefinition(value);
}

export function isValidWebhookDefinition(
  value: unknown,
): value is WebhookDefinition {
  try {
    normalizeWebhookDefinition(value);
    return true;
  } catch {
    return false;
  }
}
