import type {
  RuntimeGenerateUsage,
  RuntimeStreamPart,
} from "#veryfront/agent/runtime/runtime-tool-types.ts";
import { snapshotJsonValue } from "#veryfront/provider/runtime-loader/json-snapshot.ts";

/** Maximum UTF-16 length accepted for provider-controlled stream identifiers. */
export const MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH = 1_024;
/** Maximum canonical JSON size accepted for one provider raw stream chunk. */
export const MAX_RUNTIME_RAW_CHUNK_BYTES = 8 * 1024 * 1024;
/** Maximum nesting depth accepted for one provider raw stream chunk. */
export const MAX_RUNTIME_RAW_CHUNK_DEPTH = 64;
/** Maximum JSON value count accepted for one provider raw stream chunk. */
export const MAX_RUNTIME_RAW_CHUNK_NODES = 65_536;

const TOOL_FLAGS = [
  "providerExecuted",
  "dynamic",
  "supportsDeferredResults",
] as const;
const TOOL_RESULT_FLAGS = [
  ...TOOL_FLAGS,
  "preliminary",
  "isError",
] as const;

type FixedRuntimeStreamPartType = Exclude<
  RuntimeStreamPart["type"],
  `data-${string}`
>;

const FIXED_RUNTIME_STREAM_PART_TYPES = {
  "stream-start": true,
  "response-metadata": true,
  "text-start": true,
  "text-delta": true,
  "text-end": true,
  "reasoning-start": true,
  "reasoning-delta": true,
  "reasoning-end": true,
  "raw": true,
  "tool-input-start": true,
  "tool-input-delta": true,
  "tool-input-end": true,
  "tool-input-available": true,
  "tool-call": true,
  "tool-result": true,
  "tool-error": true,
  "finish": true,
  "error": true,
} as const satisfies Record<FixedRuntimeStreamPartType, true>;

type RuntimeUsageNormalizer = (
  usage: unknown,
) => RuntimeGenerateUsage | null | undefined;

export interface RuntimeStreamPartParserOptions {
  /**
   * Required when a finish event contains provider usage. Keeping usage
   * normalization injectable prevents this structural parser from duplicating
   * the bridge's numeric and billing invariants.
   */
  normalizeUsage?: RuntimeUsageNormalizer;
}

class StreamPartTypeError extends TypeError {
  constructor(reason: string) {
    super(`Invalid runtime stream part: ${reason}`);
    this.name = "TypeError";
  }
}

function invalid(reason: string): never {
  throw new StreamPartTypeError(reason);
}

const MISSING_OWN_PROPERTY = Symbol("missing own property");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwnDataProperty(
  record: Record<string, unknown>,
  key: string,
): unknown | typeof MISSING_OWN_PROPERTY {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return MISSING_OWN_PROPERTY;
  if (!Object.hasOwn(descriptor, "value")) {
    return invalid(`${key} must be a data property`);
  }
  return descriptor.value;
}

function isFixedRuntimeStreamPartType(
  value: string,
): value is FixedRuntimeStreamPartType {
  return Object.hasOwn(FIXED_RUNTIME_STREAM_PART_TYPES, value);
}

function assertNeverRuntimeStreamPartType(value: never): never {
  void value;
  return invalid("unsupported type");
}

function requireIdentifierValue(value: unknown, key: string): string {
  if (typeof value !== "string") {
    return invalid(`${key} must be a string`);
  }
  if (
    value.length === 0 ||
    value.length > MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH
  ) {
    return invalid(
      `${key} length must be between 1 and ${MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH}`,
    );
  }
  return value;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = readOwnDataProperty(record, key);
  if (value === MISSING_OWN_PROPERTY || typeof value !== "string") {
    return invalid(`${key} must be a string`);
  }
  return value;
}

function readIdentifier(
  record: Record<string, unknown>,
  key: string,
): string {
  return requireIdentifierValue(readOwnDataProperty(record, key), key);
}

function readOptionalIdentifier(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = readOwnDataProperty(record, key);
  if (value === MISSING_OWN_PROPERTY || value === undefined) return undefined;
  return requireIdentifierValue(value, key);
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = readOwnDataProperty(record, key);
  if (value === MISSING_OWN_PROPERTY || value === undefined) return undefined;
  if (typeof value !== "string") {
    return invalid(`${key} must be a string when provided`);
  }
  return value;
}

function readOptionalArray(
  record: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const value = readOwnDataProperty(record, key);
  if (value === MISSING_OWN_PROPERTY || value === undefined) return undefined;
  if (!Array.isArray(value)) {
    return invalid(`${key} must be an array when provided`);
  }
  return value;
}

function readOptionalDate(
  record: Record<string, unknown>,
  key: string,
): Date | undefined {
  const value = readOwnDataProperty(record, key);
  if (value === MISSING_OWN_PROPERTY || value === undefined) return undefined;
  if (!(value instanceof Date)) {
    return invalid(`${key} must be a Date when provided`);
  }

  let timestamp: number;
  try {
    timestamp = Date.prototype.getTime.call(value);
  } catch {
    return invalid(`${key} must be a valid Date`);
  }
  if (!Number.isFinite(timestamp)) {
    return invalid(`${key} must be a valid Date`);
  }
  return new Date(timestamp);
}

function readTrueFlags<const Keys extends readonly string[]>(
  record: Record<string, unknown>,
  keys: Keys,
): Partial<Record<Keys[number], true>> {
  const result: Record<string, true> = {};
  for (const key of keys) {
    const value = readOwnDataProperty(record, key);
    if (
      value === MISSING_OWN_PROPERTY ||
      value === undefined ||
      value === false
    ) continue;
    if (value !== true) {
      return invalid(`${key} must be a boolean when provided`);
    }
    result[key] = true;
  }
  return result as Partial<Record<Keys[number], true>>;
}

function requireBoundedFinishReason(value: string): string {
  if (value.length > MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH) {
    return invalid(
      `finishReason length must not exceed ${MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH}`,
    );
  }
  return value;
}

/** Normalize provider finish-reason variants into the canonical bridge shape. */
export function normalizeRuntimeFinishReason(value: unknown): string | null {
  try {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return requireBoundedFinishReason(value);
    if (!isRecord(value)) {
      return invalid("finishReason must be a string, null, or unified reason");
    }

    const unified = readOwnDataProperty(value, "unified");
    if (unified === null) return null;
    if (typeof unified === "string") return requireBoundedFinishReason(unified);
    return invalid("finishReason.unified must be a string or null");
  } catch (error) {
    if (error instanceof StreamPartTypeError) throw error;
    return invalid("finishReason could not be safely inspected");
  }
}

function normalizeFinishUsage(
  part: Record<string, unknown>,
  normalizeUsage: RuntimeUsageNormalizer | undefined,
): RuntimeGenerateUsage | null | undefined {
  let sawNull = false;

  // Cumulative usage is authoritative. Inspect the incremental fallback only
  // when cumulative usage is absent or cannot be normalized.
  for (const key of ["totalUsage", "usage"] as const) {
    const candidate = readOwnDataProperty(part, key);
    if (candidate === MISSING_OWN_PROPERTY || candidate === undefined) continue;
    if (candidate === null) {
      sawNull = true;
      continue;
    }
    if (!normalizeUsage) {
      return invalid("finish usage requires a usage normalizer");
    }

    let normalized: RuntimeGenerateUsage | null | undefined;
    try {
      normalized = normalizeUsage(candidate);
    } catch {
      return invalid("finish usage normalization failed");
    }
    if (normalized === undefined) continue;
    if (normalized === null) {
      sawNull = true;
      continue;
    }
    if (!isRecord(normalized)) {
      return invalid("usage normalizer returned an invalid value");
    }
    return normalized;
  }

  return sawNull ? null : undefined;
}

function parseToolInputAvailable(
  part: Record<string, unknown>,
): Extract<RuntimeStreamPart, { type: "tool-input-available" }> {
  const toolCallId = readOptionalIdentifier(part, "toolCallId");
  const id = readOptionalIdentifier(part, "id");
  if (toolCallId === undefined && id === undefined) {
    return invalid("tool-input-available requires toolCallId or id");
  }
  const input = readOwnDataProperty(part, "input");
  if (input === MISSING_OWN_PROPERTY) {
    return invalid("tool-input-available requires input");
  }

  return {
    type: "tool-input-available",
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(id === undefined ? {} : { id }),
    toolName: readIdentifier(part, "toolName"),
    input,
    ...readTrueFlags(part, TOOL_FLAGS),
  };
}

function parseToolResult(
  part: Record<string, unknown>,
): Extract<RuntimeStreamPart, { type: "tool-result" }> {
  const result: Extract<RuntimeStreamPart, { type: "tool-result" }> = {
    type: "tool-result",
    toolCallId: readIdentifier(part, "toolCallId"),
    toolName: readIdentifier(part, "toolName"),
    ...readTrueFlags(part, TOOL_RESULT_FLAGS),
  };
  const output = readOwnDataProperty(part, "output");
  const providerResult = readOwnDataProperty(part, "result");
  const error = readOwnDataProperty(part, "error");
  const input = readOwnDataProperty(part, "input");
  if (output !== MISSING_OWN_PROPERTY) result.output = output;
  if (providerResult !== MISSING_OWN_PROPERTY) result.result = providerResult;
  if (error !== MISSING_OWN_PROPERTY) result.error = error;
  if (input !== MISSING_OWN_PROPERTY) result.input = input;
  return result;
}

function parseToolError(
  part: Record<string, unknown>,
): Extract<RuntimeStreamPart, { type: "tool-error" }> {
  const result: Extract<RuntimeStreamPart, { type: "tool-error" }> = {
    type: "tool-error",
    toolCallId: readIdentifier(part, "toolCallId"),
    toolName: readIdentifier(part, "toolName"),
    ...readTrueFlags(part, TOOL_RESULT_FLAGS),
  };
  const error = readOwnDataProperty(part, "error");
  const input = readOwnDataProperty(part, "input");
  if (error !== MISSING_OWN_PROPERTY) result.error = error;
  if (input !== MISSING_OWN_PROPERTY) result.input = input;
  return result;
}

function parseKnownPart(
  value: unknown,
  options: RuntimeStreamPartParserOptions,
): RuntimeStreamPart {
  if (!isRecord(value)) {
    return invalid("expected an object with a string type");
  }
  const type = readRequiredString(value, "type");

  if (type.startsWith("data-")) {
    if (type.length > MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH) {
      return invalid(
        `data event type length must not exceed ${MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH}`,
      );
    }
    const data = readOwnDataProperty(value, "data");
    if (data === MISSING_OWN_PROPERTY) {
      return invalid("data event requires data");
    }
    return {
      type: type as `data-${string}`,
      data,
    };
  }

  if (!isFixedRuntimeStreamPartType(type)) {
    return invalid("unsupported type");
  }

  switch (type) {
    case "stream-start": {
      const warnings = readOptionalArray(value, "warnings");
      return {
        type: "stream-start",
        ...(warnings === undefined ? {} : { warnings }),
      };
    }

    case "response-metadata": {
      const id = readOptionalIdentifier(value, "id");
      const timestamp = readOptionalDate(value, "timestamp");
      const modelId = readOptionalIdentifier(value, "modelId");
      return {
        type: "response-metadata",
        ...(id === undefined ? {} : { id }),
        ...(timestamp === undefined ? {} : { timestamp }),
        ...(modelId === undefined ? {} : { modelId }),
      };
    }

    case "text-start":
      return {
        type: "text-start",
        id: readIdentifier(value, "id"),
      };

    case "text-delta": {
      const delta = readOwnDataProperty(value, "delta");
      const text = typeof delta === "string" ? delta : readOwnDataProperty(value, "text");
      if (typeof text !== "string") {
        return invalid("text-delta requires text or delta");
      }
      return { type: "text-delta", text };
    }

    case "text-end":
      return {
        type: "text-end",
        id: readIdentifier(value, "id"),
      };

    case "reasoning-start":
      return {
        type: "reasoning-start",
        id: readIdentifier(value, "id"),
      };

    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: readIdentifier(value, "id"),
        delta: readRequiredString(value, "delta"),
      };

    case "reasoning-end": {
      const signature = readOptionalString(value, "signature");
      const redactedData = readOptionalString(value, "redactedData");
      return {
        type: "reasoning-end",
        id: readIdentifier(value, "id"),
        ...(signature === undefined ? {} : { signature }),
        ...(redactedData === undefined ? {} : { redactedData }),
      };
    }

    case "raw": {
      const rawValue = readOwnDataProperty(value, "rawValue");
      if (rawValue === MISSING_OWN_PROPERTY) {
        return invalid("raw event requires rawValue");
      }
      try {
        return {
          type: "raw",
          rawValue: snapshotJsonValue(rawValue, {
            maxBytes: MAX_RUNTIME_RAW_CHUNK_BYTES,
            maxDepth: MAX_RUNTIME_RAW_CHUNK_DEPTH,
            maxNodes: MAX_RUNTIME_RAW_CHUNK_NODES,
          }),
        };
      } catch {
        return invalid("rawValue must be bounded JSON data");
      }
    }

    case "tool-input-start":
      return {
        type: "tool-input-start",
        id: readIdentifier(value, "id"),
        toolName: readIdentifier(value, "toolName"),
        ...readTrueFlags(value, TOOL_FLAGS),
      };

    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        id: readIdentifier(value, "id"),
        delta: readRequiredString(value, "delta"),
      };

    case "tool-input-end":
      return {
        type: "tool-input-end",
        id: readIdentifier(value, "id"),
      };

    case "tool-input-available":
      return parseToolInputAvailable(value);

    case "tool-call": {
      const input = readOwnDataProperty(value, "input");
      if (input === MISSING_OWN_PROPERTY) {
        return invalid("tool-call requires input");
      }
      return {
        type: "tool-call",
        toolCallId: readIdentifier(value, "toolCallId"),
        toolName: readIdentifier(value, "toolName"),
        input,
        ...readTrueFlags(value, TOOL_FLAGS),
      };
    }

    case "tool-result":
      return parseToolResult(value);

    case "tool-error":
      return parseToolError(value);

    case "finish": {
      const totalUsage = normalizeFinishUsage(value, options.normalizeUsage);
      const rawProviderMetadata = readOwnDataProperty(value, "providerMetadata");
      const providerMetadata = rawProviderMetadata === MISSING_OWN_PROPERTY ||
          rawProviderMetadata === undefined
        ? undefined
        : rawProviderMetadata;
      if (providerMetadata !== undefined && !isRecord(providerMetadata)) {
        return invalid("providerMetadata must be an object when provided");
      }
      const rawFinishReason = readOwnDataProperty(value, "finishReason");
      return {
        type: "finish",
        finishReason: normalizeRuntimeFinishReason(
          rawFinishReason === MISSING_OWN_PROPERTY ? undefined : rawFinishReason,
        ),
        ...(providerMetadata === undefined ? {} : { providerMetadata }),
        ...(totalUsage === undefined ? {} : { totalUsage }),
      };
    }

    case "error": {
      const error = readOwnDataProperty(value, "error");
      if (error === MISSING_OWN_PROPERTY) {
        return invalid("error event requires error");
      }
      return { type: "error", error };
    }

    default:
      return assertNeverRuntimeStreamPartType(type);
  }
}

/**
 * Parse one untrusted provider stream event into the canonical runtime shape.
 *
 * The parser is intentionally shallow for opaque payloads (`data`, tool
 * input/output, provider metadata, and errors), but it never forwards unknown
 * top-level fields. Raw chunks are the exception: they are copied into
 * bounded, deeply owned JSON snapshots before crossing the runtime boundary.
 */
export function parseRuntimeStreamPart(
  value: unknown,
  options: RuntimeStreamPartParserOptions = {},
): RuntimeStreamPart {
  try {
    return parseKnownPart(value, options);
  } catch (error) {
    if (error instanceof StreamPartTypeError) throw error;
    return invalid("could not be safely inspected");
  }
}
