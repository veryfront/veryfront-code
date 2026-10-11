import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED, VeryfrontError } from "../../errors/index.ts";
import { everyPrivateArray, somePrivateArray } from "#veryfront/security/private-array.ts";
import { testPrivateRegExp } from "#veryfront/security/private-regexp.ts";
import {
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE,
  isProviderReplayCheckpointEventType,
  parseProviderReplayCheckpointEvent,
} from "#veryfront/agent/runtime/provider-replay.ts";

const ArrayIsArray = Array.isArray;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectKeys = Object.keys;
const ReflectApply = Reflect.apply;
const NumberIsFinite = Number.isFinite;
const NumberIsInteger = Number.isInteger;
const ModelCallIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ProviderToolIdPattern = /\./;
const UserMediaMessagePartTypes = ["image", "file"] as const;
const ReasoningEfforts = ["low", "medium", "high", "max"] as const;

function objectKeys(value: Record<string, unknown>): string[] {
  return ReflectApply(ObjectKeys, Object, [value]) as string[];
}

function ownPropertyDescriptor(
  record: Record<string, unknown>,
  key: string,
): PropertyDescriptor | undefined {
  return ReflectApply(ObjectGetOwnPropertyDescriptor, Object, [record, key]) as
    | PropertyDescriptor
    | undefined;
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = ownPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !ArrayIsArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return everyPrivateArray(
    objectKeys(value),
    (key) => somePrivateArray(keys, (allowed) => allowed === key),
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && ReflectApply(NumberIsFinite, Number, [value]) as boolean;
}

function isModel(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["id", "modelProvider"]) &&
    typeof ownDataValue(value, "id") === "string" && ownDataValue(value, "id") !== "" &&
    (ownDataValue(value, "modelProvider") === undefined ||
      (typeof ownDataValue(value, "modelProvider") === "string" &&
        ownDataValue(value, "modelProvider") !== ""));
}

function isRequest(value: unknown): boolean {
  if (
    !isRecord(value) || !hasOnlyKeys(value, [
      "maxOutputTokens",
      "temperature",
      "topP",
      "topK",
      "stopSequences",
      "seed",
      "presencePenalty",
      "frequencyPenalty",
      "reasoning",
      "responseFormat",
    ])
  ) return false;
  for (
    const key of [
      "maxOutputTokens",
      "temperature",
      "topP",
      "topK",
      "seed",
      "presencePenalty",
      "frequencyPenalty",
    ]
  ) {
    const field = ownDataValue(value, key);
    if (field !== undefined && !isFiniteNumber(field)) return false;
  }
  const maxOutputTokens = ownDataValue(value, "maxOutputTokens");
  if (typeof maxOutputTokens === "number" && maxOutputTokens < 0) return false;
  const stops = ownDataValue(value, "stopSequences");
  if (
    stops !== undefined &&
    (!ArrayIsArray(stops) || !everyPrivateArray(stops, (item) => typeof item === "string"))
  ) {
    return false;
  }
  const reasoning = ownDataValue(value, "reasoning");
  if (reasoning !== undefined) {
    if (!isRecord(reasoning) || !hasOnlyKeys(reasoning, ["enabled", "effort", "budgetTokens"])) {
      return false;
    }
    const enabled = ownDataValue(reasoning, "enabled");
    const effort = ownDataValue(reasoning, "effort");
    const budget = ownDataValue(reasoning, "budgetTokens");
    if (
      (enabled !== undefined && typeof enabled !== "boolean") ||
      (effort !== undefined &&
        (typeof effort !== "string" ||
          !somePrivateArray(ReasoningEfforts, (allowed) => allowed === effort))) ||
      (budget !== undefined &&
        (!(ReflectApply(NumberIsInteger, Number, [budget]) as boolean) || (budget as number) < 0))
    ) {
      return false;
    }
  }
  const responseFormat = ownDataValue(value, "responseFormat");
  if (responseFormat === undefined) return true;
  if (!isRecord(responseFormat)) return false;
  const responseType = ownDataValue(responseFormat, "type");
  if (responseType === "text" || responseType === "json") {
    return hasOnlyKeys(responseFormat, ["type"]);
  }
  return responseType === "json_schema" &&
    hasOnlyKeys(responseFormat, ["type", "name", "schema", "description", "strict"]) &&
    typeof ownDataValue(responseFormat, "name") === "string" &&
    ownDataValue(responseFormat, "schema") !== undefined &&
    (ownDataValue(responseFormat, "description") === undefined ||
      typeof ownDataValue(responseFormat, "description") === "string") &&
    (ownDataValue(responseFormat, "strict") === undefined ||
      typeof ownDataValue(responseFormat, "strict") === "boolean");
}

function isMessage(value: unknown): boolean {
  if (!isRecord(value) || typeof ownDataValue(value, "role") !== "string") return false;
  const role = ownDataValue(value, "role");
  const content = ownDataValue(value, "content");
  if (role === "system") {
    return typeof content === "string" &&
      hasOnlyKeys(value, ["role", "content", "providerOptions"]) &&
      isPersistedProviderOptions(ownDataValue(value, "providerOptions"));
  }
  if (!ArrayIsArray(content) || !hasOnlyKeys(value, ["role", "content"])) return false;
  return everyPrivateArray(content, (part) => {
    if (!isRecord(part)) return false;
    if (role === "user") {
      return ownDataValue(part, "type") === "text"
        ? hasOnlyKeys(part, ["type", "text"]) && typeof ownDataValue(part, "text") === "string"
        : somePrivateArray(
          UserMediaMessagePartTypes,
          (type) => type === ownDataValue(part, "type"),
        ) &&
          hasOnlyKeys(part, ["type", "mediaType", "url", "filename"]) &&
          typeof ownDataValue(part, "mediaType") === "string" &&
          typeof ownDataValue(part, "url") === "string" &&
          (ownDataValue(part, "filename") === undefined ||
            typeof ownDataValue(part, "filename") === "string");
    }
    if (role === "assistant") {
      if (ownDataValue(part, "type") === "text") {
        return hasOnlyKeys(part, ["type", "text"]) &&
          typeof ownDataValue(part, "text") === "string";
      }
      return ownDataValue(part, "type") === "tool-call" &&
        hasOnlyKeys(part, ["type", "toolCallId", "toolName", "input", "providerExecuted"]) &&
        typeof ownDataValue(part, "toolCallId") === "string" &&
        typeof ownDataValue(part, "toolName") === "string" &&
        ownDataValue(part, "input") !== undefined &&
        (ownDataValue(part, "providerExecuted") === undefined ||
          typeof ownDataValue(part, "providerExecuted") === "boolean");
    }
    if (role === "tool") {
      const output = ownDataValue(part, "output");
      return ownDataValue(part, "type") === "tool-result" &&
        hasOnlyKeys(part, ["type", "toolCallId", "toolName", "output"]) &&
        typeof ownDataValue(part, "toolCallId") === "string" &&
        typeof ownDataValue(part, "toolName") === "string" && isRecord(output) &&
        hasOnlyKeys(output, ["type", "value"]) && ownDataValue(output, "type") === "json" &&
        ownDataValue(output, "value") !== undefined;
    }
    return false;
  });
}

function isPersistedProviderOptions(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return everyPrivateArray(objectKeys(value), (key) => {
    if (key === "") return false;
    const bucket = ownDataValue(value, key);
    if (!isRecord(bucket) || !hasOnlyKeys(bucket, ["cacheControl"])) return false;
    const cacheControl = ownDataValue(bucket, "cacheControl");
    return isRecord(cacheControl) && hasOnlyKeys(cacheControl, ["type", "ttl"]) &&
      ownDataValue(cacheControl, "type") === "ephemeral" &&
      (ownDataValue(cacheControl, "ttl") === undefined ||
        ownDataValue(cacheControl, "ttl") === "5m" || ownDataValue(cacheControl, "ttl") === "1h");
  });
}

function isTool(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (ownDataValue(value, "type") === "function") {
    return hasOnlyKeys(value, ["type", "name", "description", "inputSchema"]) &&
      typeof ownDataValue(value, "name") === "string" &&
      ownDataValue(value, "inputSchema") !== undefined &&
      (ownDataValue(value, "description") === undefined ||
        typeof ownDataValue(value, "description") === "string");
  }
  const id = ownDataValue(value, "id");
  return ownDataValue(value, "type") === "provider" &&
    hasOnlyKeys(value, ["type", "name", "id", "args"]) &&
    typeof ownDataValue(value, "name") === "string" &&
    typeof id === "string" &&
    testPrivateRegExp(ProviderToolIdPattern, id) &&
    isRecord(ownDataValue(value, "args"));
}

const AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE = "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
/** Pre-rename spelling, accepted on read so an older producer's event stays private. */
const LEGACY_AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE = "AGENT_RUN_MODEL_CALL_CONTEXT";

/**
 * The canonical private type an event declares, or `undefined` for a public
 * event. Either spelling of a renamed private type maps to its past-tense name.
 */
export function getCanonicalPrivateConversationRunEventType(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const type = ownDataValue(value, "type");
  if (
    type === AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE ||
    type === LEGACY_AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE
  ) {
    return AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE;
  }
  return isProviderReplayCheckpointEventType(type)
    ? AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE
    : undefined;
}

/** Return whether an event declares the private durable run-event discriminator. */
export function hasPrivateConversationRunEventType(
  value: unknown,
): value is Record<string, unknown> {
  return getCanonicalPrivateConversationRunEventType(value) !== undefined;
}

/** Return whether an event belongs to the private durable run-event sequence. */
export function isPrivateConversationRunEvent(value: unknown): boolean {
  if (!hasPrivateConversationRunEventType(value)) return false;
  if (
    getCanonicalPrivateConversationRunEventType(value) ===
      AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE
  ) {
    try {
      parseProviderReplayCheckpointEvent(value);
      return true;
    } catch {
      return false;
    }
  }
  const messages = ownDataValue(value, "messages");
  if (!ArrayIsArray(messages) || !everyPrivateArray(messages, isMessage)) return false;
  const modelCallIdDescriptor = ownPropertyDescriptor(value, "modelCallId");
  if (
    modelCallIdDescriptor !== undefined &&
    (!("value" in modelCallIdDescriptor) || typeof modelCallIdDescriptor.value !== "string" ||
      !testPrivateRegExp(ModelCallIdPattern, modelCallIdDescriptor.value))
  ) return false;
  const toolsDescriptor = ownPropertyDescriptor(value, "tools");
  if (
    toolsDescriptor !== undefined &&
    (!("value" in toolsDescriptor) || !ArrayIsArray(toolsDescriptor.value) ||
      !everyPrivateArray(toolsDescriptor.value, isTool))
  ) return false;
  const model = ownDataValue(value, "model");
  if (model !== undefined && !isModel(model)) return false;
  const request = ownDataValue(value, "request");
  if (request !== undefined && !isRequest(request)) return false;
  const elapsedMs = ownDataValue(value, "elapsedMs");
  if (elapsedMs !== undefined && (!isFiniteNumber(elapsedMs) || elapsedMs < 0)) return false;
  const emittedAt = ownDataValue(value, "emittedAt");
  if (
    emittedAt !== undefined &&
    (!(ReflectApply(NumberIsInteger, Number, [emittedAt]) as boolean) || (emittedAt as number) < 0)
  ) {
    return false;
  }
  return hasOnlyKeys(value as Record<string, unknown>, [
    "type",
    "modelCallId",
    "model",
    "request",
    "messages",
    "tools",
    "elapsedMs",
    "emittedAt",
  ]);
}

/** Failure to persist a required run event before its associated operation. */
export class DurableRunEventPersistenceError extends VeryfrontError {
  override name = "DurableRunEventPersistenceError";

  constructor(detail: string, options: { cause?: unknown } = {}) {
    super(detail, {
      slug: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.slug,
      category: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.category,
      status: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.status,
      title: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.title,
      suggestion: DURABLE_RUN_EVENT_PERSISTENCE_FAILED.suggestion,
      detail,
      cause: options.cause,
    });
    this.name = "DurableRunEventPersistenceError";
  }
}
