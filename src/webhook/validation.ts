import { VeryfrontError, WEBHOOK_CONFIG_INVALID } from "#veryfront/errors";
import { isTriggerTarget, type TriggerTarget } from "#veryfront/trigger/target.ts";
import { assertSerializable, isTriggerId } from "#veryfront/trigger/validation.ts";
import type {
  WebhookAgentMessageMapping,
  WebhookDefinition,
  WebhookEventFilter,
  WebhookEventFilterCondition,
  WebhookEventFilterOperator,
} from "./types.ts";

const OPERATORS = new Set<WebhookEventFilterOperator>([
  "equals",
  "not_equals",
  "contains",
  "exists",
]);

function invalid(detail: string, cause?: unknown): never {
  throw WEBHOOK_CONFIG_INVALID.create({ detail, ...(cause === undefined ? {} : { cause }) });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function getOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${label} is required.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireString(value, label);
}

function normalizeTarget(value: unknown): TriggerTarget {
  const target = requireRecord(value, "Webhook target");
  const candidate = {
    kind: getOwn(target, "kind"),
    id: getOwn(target, "id"),
  };
  if (!isTriggerTarget(candidate)) {
    invalid("Webhook target must specify a valid task, workflow, or agent id.");
  }
  return candidate;
}

function normalizeFilterCondition(
  value: unknown,
  index: number,
): WebhookEventFilterCondition {
  const label = `Webhook eventFilter condition ${index}`;
  const condition = requireRecord(value, label);
  const path = requireString(getOwn(condition, "path"), `${label} path`);
  const operator = getOwn(condition, "operator");
  if (!OPERATORS.has(operator as WebhookEventFilterOperator)) {
    invalid(`${label} operator is not supported.`);
  }
  const conditionValue = getOwn(condition, "value");

  try {
    assertSerializable(conditionValue, `${label} value`);
  } catch (error) {
    const detail = error instanceof VeryfrontError && error.detail
      ? error.detail
      : `${label} value must be JSON-serializable.`;
    invalid(detail, error);
  }

  return {
    path,
    operator: operator as WebhookEventFilterOperator,
    ...(conditionValue === undefined ? {} : { value: conditionValue }),
  };
}

function normalizeFilter(value: unknown): WebhookEventFilter | undefined {
  if (value === undefined) return undefined;
  const filter = requireRecord(value, "Webhook eventFilter");
  const mode = getOwn(filter, "mode");
  if (mode !== "all" && mode !== "any") {
    invalid("Webhook eventFilter mode must be all or any.");
  }
  const conditions = getOwn(filter, "conditions");
  if (!Array.isArray(conditions)) {
    invalid("Webhook eventFilter conditions must be an array.");
  }

  return {
    mode,
    conditions: conditions.map(normalizeFilterCondition),
  };
}

function normalizeAgentMessage(
  value: unknown,
  required: boolean,
): WebhookAgentMessageMapping | undefined {
  if (value === undefined) {
    if (required) invalid("Agent webhooks must define agentMessage.promptTemplate.");
    return undefined;
  }

  const mapping = requireRecord(value, "Webhook agentMessage");
  return {
    promptTemplate: requireString(
      getOwn(mapping, "promptTemplate"),
      "Webhook agentMessage.promptTemplate",
    ),
  };
}

function normalizeWebhookDefinitionUnsafe(value: unknown): WebhookDefinition {
  const config = requireRecord(value, "Webhook configuration");

  const id = requireString(getOwn(config, "id"), "Webhook id");
  if (!isTriggerId(id)) {
    invalid(
      "Webhook id must start with a lowercase letter or number and use lowercase letters, numbers, dots, underscores, slashes, or hyphens.",
    );
  }

  const name = optionalString(getOwn(config, "name"), "Webhook name");
  const description = optionalString(
    getOwn(config, "description"),
    "Webhook description",
  );
  const target = normalizeTarget(getOwn(config, "target"));
  const eventFilter = normalizeFilter(getOwn(config, "eventFilter"));
  const agentMessage = normalizeAgentMessage(
    getOwn(config, "agentMessage"),
    target.kind === "agent",
  );

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
    if (error instanceof VeryfrontError && error.slug === WEBHOOK_CONFIG_INVALID.slug) {
      throw error;
    }
    invalid("Webhook configuration is invalid.", error);
  }
}

export function isValidWebhookDefinition(value: unknown): value is WebhookDefinition {
  try {
    normalizeWebhookDefinition(value);
    return true;
  } catch {
    return false;
  }
}
