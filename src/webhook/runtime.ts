import { TRIGGER_CONFIG_INVALID, WEBHOOK_CONFIG_INVALID } from "#veryfront/errors";
import type { BoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { snapshotSerializable } from "#veryfront/trigger/validation.ts";
import type {
  WebhookDefinition,
  WebhookEventFilter,
  WebhookEventFilterCondition,
} from "./types.ts";
import { normalizeWebhookDefinition } from "./validation.ts";

const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1_024;
const PROMPT_PLACEHOLDER_PATTERN = /\{\{\s*payload(?:\.([a-zA-Z0-9_.-]+))?\s*\}\}/g;
const UTF8_ENCODER = new TextEncoder();

/** Owned, cloud-compatible inputs for one local webhook target run. */
export interface PreparedWebhookInvocation {
  /** Revalidated definition copied away from caller-owned state. */
  definition: WebhookDefinition;
  /** Bounded payload snapshot; nullish input is normalized to an empty object. */
  payload: BoundedJsonValue;
  /** Target input shaped consistently with hosted task and workflow runs. */
  targetInput: BoundedJsonValue;
  /** Whether the optional event filter accepted the payload. */
  matched: boolean;
  /** Rendered agent prompt when a matching definition targets an agent. */
  agentInput?: string;
}

function invalidPayload(detail: string): never {
  throw TRIGGER_CONFIG_INVALID.create({ detail });
}

function snapshotWebhookPayload(value: unknown): BoundedJsonValue {
  const snapshot = snapshotSerializable(value ?? {}, "Webhook payload");

  const serialized = JSON.stringify(snapshot);
  if (UTF8_ENCODER.encode(serialized).byteLength > MAX_WEBHOOK_PAYLOAD_BYTES) {
    invalidPayload("Webhook payload must be 64 KiB or smaller.");
  }
  return snapshot;
}

function readPath(payload: BoundedJsonValue, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split(".")) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(current, segment);
    if (!descriptor || !("value" in descriptor)) return undefined;
    current = descriptor.value;
  }
  return current;
}

function stableEquals(left: unknown, right: unknown): boolean {
  const pending: Array<readonly [unknown, unknown]> = [[left, right]];
  while (pending.length > 0) {
    const pair = pending.pop();
    if (!pair) break;
    const [currentLeft, currentRight] = pair;
    if (currentLeft === currentRight) continue;
    if (
      currentLeft === null ||
      currentRight === null ||
      typeof currentLeft !== "object" ||
      typeof currentRight !== "object"
    ) {
      return false;
    }

    const leftIsArray = Array.isArray(currentLeft);
    if (leftIsArray !== Array.isArray(currentRight)) return false;
    if (leftIsArray) {
      const leftArray = currentLeft as unknown[];
      const rightArray = currentRight as unknown[];
      if (leftArray.length !== rightArray.length) return false;
      for (let index = 0; index < leftArray.length; index++) {
        pending.push([leftArray[index], rightArray[index]]);
      }
      continue;
    }

    const leftRecord = currentLeft as Record<string, unknown>;
    const rightRecord = currentRight as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.hasOwn(rightRecord, key)) return false;
      pending.push([leftRecord[key], rightRecord[key]]);
    }
  }
  return true;
}

function matchesCondition(
  condition: WebhookEventFilterCondition,
  payload: BoundedJsonValue,
): boolean {
  const actual = readPath(payload, condition.path);
  switch (condition.operator) {
    case "equals":
      return stableEquals(actual, condition.value);
    case "not_equals":
      return !stableEquals(actual, condition.value);
    case "in":
      return Array.isArray(condition.value) &&
        condition.value.some((value) => stableEquals(actual, value));
    case "exists":
      return actual !== undefined;
    case "contains":
      if (
        typeof actual === "string" &&
        typeof condition.value === "string"
      ) {
        return actual.includes(condition.value);
      }
      return Array.isArray(actual) &&
        actual.some((value) => stableEquals(value, condition.value));
  }
}

/** Evaluate a normalized event filter with hosted webhook semantics. */
export function matchesWebhookEventFilter(
  filter: WebhookEventFilter | undefined,
  payload: BoundedJsonValue,
): boolean {
  if (!filter || filter.conditions.length === 0) return true;
  return filter.mode === "any"
    ? filter.conditions.some((condition) => matchesCondition(condition, payload))
    : filter.conditions.every((condition) => matchesCondition(condition, payload));
}

function toPromptValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

/** Render an agent webhook prompt exactly as the hosted runtime does. */
export function renderWebhookPromptTemplate(
  template: string,
  payload: BoundedJsonValue,
): string {
  let replacedPlaceholder = false;
  const rendered = template.replace(
    PROMPT_PLACEHOLDER_PATTERN,
    (_match, path: string | undefined) => {
      replacedPlaceholder = true;
      if (!path) return JSON.stringify(payload, null, 2);
      return toPromptValue(readPath(payload, path));
    },
  );
  if (replacedPlaceholder) return rendered;
  return `${template.trim()}\n\nWebhook payload:\n\`\`\`json\n${
    JSON.stringify(payload, null, 2)
  }\n\`\`\``;
}

/**
 * Revalidate and own a definition and payload before local webhook execution.
 */
export function prepareWebhookInvocation(
  definition: WebhookDefinition,
  payload: unknown,
): PreparedWebhookInvocation {
  const normalizedDefinition = normalizeWebhookDefinition(definition);
  const normalizedPayload = snapshotWebhookPayload(payload);
  const matched = matchesWebhookEventFilter(
    normalizedDefinition.eventFilter,
    normalizedPayload,
  );
  const agentInput = matched && normalizedDefinition.target.kind === "agent"
    ? renderAgentPrompt(normalizedDefinition, normalizedPayload)
    : undefined;

  return {
    definition: normalizedDefinition,
    payload: normalizedPayload,
    targetInput: normalizedDefinition.target.kind === "workflow"
      ? { payload: normalizedPayload }
      : normalizedPayload,
    matched,
    ...(agentInput === undefined ? {} : { agentInput }),
  };
}

function renderAgentPrompt(
  definition: WebhookDefinition,
  payload: BoundedJsonValue,
): string {
  const mapping = definition.agentMessage;
  if (definition.target.kind !== "agent" || mapping === undefined) {
    throw WEBHOOK_CONFIG_INVALID.create({
      detail: "Agent webhooks must define agentMessage.promptTemplate.",
    });
  }
  return renderWebhookPromptTemplate(mapping.promptTemplate, payload);
}
