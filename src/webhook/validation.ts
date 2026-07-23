import { VeryfrontError, WEBHOOK_CONFIG_INVALID } from "#veryfront/errors";
import { snapshotDenseArray, snapshotExactRecord } from "#veryfront/trigger/contract-snapshot.ts";
import { snapshotTriggerTarget } from "#veryfront/trigger/target.ts";
import { snapshotSerializable, validateTriggerId } from "#veryfront/trigger/validation.ts";
import type {
  WebhookAgentMessageMapping,
  WebhookDefinition,
  WebhookEventFilter,
  WebhookEventFilterCondition,
  WebhookEventFilterOperator,
} from "./types.ts";

const TOP_LEVEL_KEYS = [
  "id",
  "name",
  "description",
  "target",
  "eventFilter",
  "agentMessage",
] as const;
const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_PROMPT_TEMPLATE_LENGTH = 32_768;
const MAX_FILTER_PATH_LENGTH = 512;
const MAX_FILTER_CONDITIONS = 128;
const MAX_FILTER_VALUE_DEPTH = 16;
const MAX_FILTER_VALUE_NODES = 80;
const MAX_FILTER_VALUE_CODE_UNITS = 8_192;

function invalid(detail: string): never {
  throw WEBHOOK_CONFIG_INVALID.create({ detail });
}

function requireText(
  value: unknown,
  label: string,
  maxLength: number,
  options: { multiline?: boolean; preserveWhitespace?: boolean } = {},
): string {
  if (typeof value !== "string") invalid(`${label} is required.`);
  if (value.length > maxLength) invalid(`${label} must be at most ${maxLength} characters.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) invalid(`${label} is required.`);

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code === 127 ||
      (code <= 31 && (!options.multiline || (code !== 9 && code !== 10 && code !== 13)))
    ) {
      invalid(`${label} contains unsupported control characters.`);
    }
  }
  return options.preserveWhitespace ? value : trimmed;
}

function optionalText(
  value: unknown,
  label: string,
  maxLength: number,
  options?: { multiline?: boolean; preserveWhitespace?: boolean },
): string | undefined {
  return value === undefined ? undefined : requireText(value, label, maxLength, options);
}

function isFilterOperator(value: unknown): value is WebhookEventFilterOperator {
  return value === "equals" || value === "not_equals" || value === "contains" ||
    value === "exists";
}

function normalizeFilterValue(value: unknown, label: string): unknown {
  try {
    return snapshotSerializable(value, label, {
      maxDepth: MAX_FILTER_VALUE_DEPTH,
      maxNodes: MAX_FILTER_VALUE_NODES,
      maxCodeUnits: MAX_FILTER_VALUE_CODE_UNITS,
    });
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "trigger-config-invalid") {
      invalid(error.detail ?? `${label} must be JSON-serializable.`);
    }
    invalid(`${label} must be JSON-serializable.`);
  }
}

function normalizeEventFilter(value: unknown): WebhookEventFilter | undefined {
  if (value === undefined) return undefined;
  const filter = snapshotExactRecord(
    value,
    "Webhook eventFilter",
    ["mode", "conditions"],
    invalid,
  );
  if (filter.mode !== "all" && filter.mode !== "any") {
    invalid("Webhook eventFilter mode must be all or any.");
  }

  const rawConditions = snapshotDenseArray(
    filter.conditions,
    "Webhook eventFilter conditions",
    MAX_FILTER_CONDITIONS,
    invalid,
  );
  const conditions = rawConditions.map((value, index): WebhookEventFilterCondition => {
    const label = `Webhook eventFilter condition ${index}`;
    const condition = snapshotExactRecord(
      value,
      label,
      ["path", "operator", "value"],
      invalid,
    );
    const path = requireText(condition.path, `${label} path`, MAX_FILTER_PATH_LENGTH);
    if (!isFilterOperator(condition.operator)) {
      invalid(`${label} operator is not supported.`);
    }
    const normalizedValue = normalizeFilterValue(condition.value, `${label} value`);
    return {
      path,
      operator: condition.operator,
      ...(normalizedValue === undefined ? {} : { value: normalizedValue }),
    };
  });

  return { mode: filter.mode, conditions };
}

function normalizeAgentMessage(value: unknown): WebhookAgentMessageMapping | undefined {
  if (value === undefined) return undefined;
  const mapping = snapshotExactRecord(
    value,
    "Webhook agentMessage",
    ["promptTemplate"],
    invalid,
  );
  return {
    promptTemplate: requireText(
      mapping.promptTemplate,
      "Webhook agentMessage.promptTemplate",
      MAX_PROMPT_TEMPLATE_LENGTH,
      { multiline: true, preserveWhitespace: true },
    ),
  };
}

/** Validate and detach a source-defined webhook contract. */
export function normalizeWebhookConfig(value: unknown): WebhookDefinition {
  const config = snapshotExactRecord(value, "Webhook", TOP_LEVEL_KEYS, invalid);
  const id = requireText(config.id, "Webhook id", 255);
  try {
    validateTriggerId(id, "Webhook");
  } catch (error) {
    if (error instanceof VeryfrontError && error.slug === "trigger-config-invalid") {
      invalid(error.detail ?? "Webhook id is invalid.");
    }
    invalid("Webhook id is invalid.");
  }

  const target = snapshotTriggerTarget(config.target);
  if (!target) {
    invalid("Webhook target must specify a valid task, workflow, or agent id.");
  }

  const name = optionalText(config.name, "Webhook name", MAX_NAME_LENGTH);
  const description = optionalText(
    config.description,
    "Webhook description",
    MAX_DESCRIPTION_LENGTH,
    { multiline: true },
  );
  const eventFilter = normalizeEventFilter(config.eventFilter);
  const agentMessage = normalizeAgentMessage(config.agentMessage);
  if (target.kind === "agent" && !agentMessage) {
    invalid("Agent webhooks must define agentMessage.promptTemplate.");
  }

  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    target,
    ...(eventFilter === undefined ? {} : { eventFilter }),
    ...(agentMessage === undefined ? {} : { agentMessage }),
  };
}
