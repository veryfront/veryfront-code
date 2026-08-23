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
const arrayIsArray = Array.isArray;
const arrayPop = Array.prototype.pop;
const arrayPush = Array.prototype.push;
const jsonStringify = JSON.stringify;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const reflectApply = Reflect.apply;
const reflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectGetPrototypeOf = Reflect.getPrototypeOf;
const regExpExec = RegExp.prototype.exec;
const stringIncludes = String.prototype.includes;
const stringRepeat = String.prototype.repeat;
const stringSlice = String.prototype.slice;
const stringSplit = String.prototype.split;
const stringTrim = String.prototype.trim;
const textEncoderEncode = TextEncoder.prototype.encode;
const typedArrayByteLengthGetter = reflectGetOwnPropertyDescriptor(
  reflectGetPrototypeOf(Uint8Array.prototype)!,
  "byteLength",
)!.get!;

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

  const serialized = stringifyWebhookJson(snapshot);
  const encoded = reflectApply(textEncoderEncode, UTF8_ENCODER, [serialized]) as Uint8Array;
  const byteLength = reflectApply(typedArrayByteLengthGetter, encoded, []) as number;
  if (byteLength > MAX_WEBHOOK_PAYLOAD_BYTES) {
    invalidPayload("Webhook payload must be 64 KiB or smaller.");
  }
  return snapshot;
}

function readPath(payload: BoundedJsonValue, path: string): unknown {
  let current: unknown = payload;
  const segments = reflectApply(stringSplit, path, ["."]) as string[];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (
      current === null ||
      typeof current !== "object" ||
      arrayIsArray(current)
    ) {
      return undefined;
    }
    const descriptor = reflectGetOwnPropertyDescriptor(current, segment);
    if (!descriptor || !("value" in descriptor)) return undefined;
    current = descriptor.value;
  }
  return current;
}

function stableEquals(left: unknown, right: unknown): boolean {
  const pending: Array<readonly [unknown, unknown]> = [[left, right]];
  while (pending.length > 0) {
    const pair = reflectApply(arrayPop, pending, []) as readonly [unknown, unknown] | undefined;
    if (!pair) break;
    const currentLeft = pair[0];
    const currentRight = pair[1];
    if (currentLeft === currentRight) continue;
    if (
      currentLeft === null ||
      currentRight === null ||
      typeof currentLeft !== "object" ||
      typeof currentRight !== "object"
    ) {
      return false;
    }

    const leftIsArray = arrayIsArray(currentLeft);
    if (leftIsArray !== arrayIsArray(currentRight)) return false;
    if (leftIsArray) {
      const leftArray = currentLeft as unknown[];
      const rightArray = currentRight as unknown[];
      if (leftArray.length !== rightArray.length) return false;
      for (let index = 0; index < leftArray.length; index++) {
        reflectApply(arrayPush, pending, [[leftArray[index], rightArray[index]]]);
      }
      continue;
    }

    const leftRecord = currentLeft as Record<string, unknown>;
    const rightRecord = currentRight as Record<string, unknown>;
    const leftKeys = objectKeys(leftRecord);
    const rightKeys = objectKeys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return false;
    for (let index = 0; index < leftKeys.length; index++) {
      const key = leftKeys[index]!;
      if (!objectHasOwn(rightRecord, key)) return false;
      reflectApply(arrayPush, pending, [[leftRecord[key], rightRecord[key]]]);
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
    case "in": {
      if (!arrayIsArray(condition.value)) return false;
      for (let index = 0; index < condition.value.length; index++) {
        if (stableEquals(actual, condition.value[index])) return true;
      }
      return false;
    }
    case "exists":
      return actual !== undefined;
    case "contains":
      if (
        typeof actual === "string" &&
        typeof condition.value === "string"
      ) {
        return reflectApply(stringIncludes, actual, [condition.value]) as boolean;
      }
      if (!arrayIsArray(actual)) return false;
      for (let index = 0; index < actual.length; index++) {
        if (stableEquals(actual[index], condition.value)) return true;
      }
      return false;
  }
}

/** Evaluate a normalized event filter with hosted webhook semantics. */
export function matchesWebhookEventFilter(
  filter: WebhookEventFilter | undefined,
  payload: BoundedJsonValue,
): boolean {
  if (!filter || filter.conditions.length === 0) return true;
  if (filter.mode === "any") {
    for (let index = 0; index < filter.conditions.length; index++) {
      if (matchesCondition(filter.conditions[index]!, payload)) return true;
    }
    return false;
  }
  for (let index = 0; index < filter.conditions.length; index++) {
    if (!matchesCondition(filter.conditions[index]!, payload)) return false;
  }
  return true;
}

function toPromptValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return stringifyWebhookJson(value as BoundedJsonValue, 2);
}

function stringifyWebhookJson(
  value: BoundedJsonValue,
  spaces = 0,
  depth = 0,
): string {
  if (
    value === null || typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return jsonStringify(value);
  }

  const currentIndent = spaces > 0
    ? reflectApply(stringRepeat, " ", [depth * spaces]) as string
    : "";
  const childIndent = spaces > 0
    ? reflectApply(stringRepeat, " ", [(depth + 1) * spaces]) as string
    : "";
  const separator = spaces > 0 ? ",\n" : ",";
  const beforeValue = spaces > 0 ? " " : "";

  if (arrayIsArray(value)) {
    if (value.length === 0) return "[]";
    let serialized = spaces > 0 ? "[\n" : "[";
    for (let index = 0; index < value.length; index++) {
      if (index > 0) serialized += separator;
      const descriptor = reflectGetOwnPropertyDescriptor(value, `${index}`);
      serialized += childIndent + stringifyWebhookJson(
        descriptor!.value as BoundedJsonValue,
        spaces,
        depth + 1,
      );
    }
    return `${serialized}${spaces > 0 ? `\n${currentIndent}` : ""}]`;
  }

  const keys = objectKeys(value);
  if (keys.length === 0) return "{}";
  let serialized = spaces > 0 ? "{\n" : "{";
  for (let index = 0; index < keys.length; index++) {
    if (index > 0) serialized += separator;
    const key = keys[index]!;
    const descriptor = reflectGetOwnPropertyDescriptor(value, key);
    serialized += childIndent + jsonStringify(key) + `:${beforeValue}` +
      stringifyWebhookJson(
        descriptor!.value as BoundedJsonValue,
        spaces,
        depth + 1,
      );
  }
  return `${serialized}${spaces > 0 ? `\n${currentIndent}` : ""}}`;
}

/** Render an agent webhook prompt exactly as the hosted runtime does. */
export function renderWebhookPromptTemplate(
  template: string,
  payload: BoundedJsonValue,
): string {
  let rendered = "";
  let lastIndex = 0;
  let replacedPlaceholder = false;
  PROMPT_PLACEHOLDER_PATTERN.lastIndex = 0;
  for (
    let match = reflectApply(regExpExec, PROMPT_PLACEHOLDER_PATTERN, [template]) as
      | RegExpExecArray
      | null;
    match;
    match = reflectApply(regExpExec, PROMPT_PLACEHOLDER_PATTERN, [template]) as
      | RegExpExecArray
      | null
  ) {
    replacedPlaceholder = true;
    rendered += reflectApply(stringSlice, template, [lastIndex, match.index]) as string;
    const path = match[1];
    rendered += path ? toPromptValue(readPath(payload, path)) : stringifyWebhookJson(payload, 2);
    lastIndex = match.index + match[0].length;
  }
  if (replacedPlaceholder) {
    return rendered + (reflectApply(stringSlice, template, [lastIndex]) as string);
  }
  return `${reflectApply(stringTrim, template, [])}\n\nWebhook payload:\n\`\`\`json\n${
    stringifyWebhookJson(payload, 2)
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
