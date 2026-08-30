import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED, VeryfrontError } from "../../errors/index.ts";
import {
  AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE,
  parseProviderReplayCheckpointEvent,
} from "#veryfront/agent/runtime/provider-replay.ts";

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
    stops !== undefined && (!Array.isArray(stops) || stops.some((item) => typeof item !== "string"))
  ) {
    return false;
  }
  const reasoning = ownDataValue(value, "reasoning");
  if (reasoning === undefined) return true;
  if (!isRecord(reasoning) || !hasOnlyKeys(reasoning, ["enabled", "effort", "budgetTokens"])) {
    return false;
  }
  const enabled = ownDataValue(reasoning, "enabled");
  const effort = ownDataValue(reasoning, "effort");
  const budget = ownDataValue(reasoning, "budgetTokens");
  return (enabled === undefined || typeof enabled === "boolean") &&
    (effort === undefined ||
      (typeof effort === "string" && ["low", "medium", "high", "max"].includes(effort))) &&
    (budget === undefined || (Number.isInteger(budget) && (budget as number) >= 0));
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
  if (!Array.isArray(content) || !hasOnlyKeys(value, ["role", "content"])) return false;
  return content.every((part) => {
    if (!isRecord(part)) return false;
    if (role === "user") {
      return ownDataValue(part, "type") === "text"
        ? hasOnlyKeys(part, ["type", "text"]) && typeof ownDataValue(part, "text") === "string"
        : ["image", "file"].includes(String(ownDataValue(part, "type"))) &&
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
  return Object.keys(value).every((key) => {
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
  return ownDataValue(value, "type") === "provider" &&
    hasOnlyKeys(value, ["type", "name", "id", "args"]) &&
    typeof ownDataValue(value, "name") === "string" &&
    typeof ownDataValue(value, "id") === "string" &&
    String(ownDataValue(value, "id")).includes(".") &&
    isRecord(ownDataValue(value, "args"));
}

/** Return whether an event declares the private durable run-event discriminator. */
export function hasPrivateConversationRunEventType(value: unknown): value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = ownDataValue(value, "type");
  return type === "AGENT_RUN_MODEL_CALL_CONTEXT" ||
    type === AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE;
}

/** Return whether an event belongs to the private durable run-event sequence. */
export function isPrivateConversationRunEvent(value: unknown): boolean {
  if (!hasPrivateConversationRunEventType(value)) return false;
  if (ownDataValue(value, "type") === AGENT_RUN_PROVIDER_REPLAY_CHECKPOINT_EVENT_TYPE) {
    try {
      parseProviderReplayCheckpointEvent(value);
      return true;
    } catch {
      return false;
    }
  }
  const messages = ownDataValue(value, "messages");
  if (!Array.isArray(messages) || !messages.every(isMessage)) return false;
  const toolsDescriptor = Object.getOwnPropertyDescriptor(value, "tools");
  if (
    toolsDescriptor !== undefined &&
    (!("value" in toolsDescriptor) || !Array.isArray(toolsDescriptor.value) ||
      !toolsDescriptor.value.every(isTool))
  ) return false;
  const model = ownDataValue(value, "model");
  if (model !== undefined && !isModel(model)) return false;
  const request = ownDataValue(value, "request");
  if (request !== undefined && !isRequest(request)) return false;
  const elapsedMs = ownDataValue(value, "elapsedMs");
  if (elapsedMs !== undefined && (!isFiniteNumber(elapsedMs) || elapsedMs < 0)) return false;
  const emittedAt = ownDataValue(value, "emittedAt");
  if (emittedAt !== undefined && (!Number.isInteger(emittedAt) || (emittedAt as number) < 0)) {
    return false;
  }
  return hasOnlyKeys(value as Record<string, unknown>, [
    "type",
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
