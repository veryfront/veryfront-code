import { MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH } from "./runtime-stream-part.ts";
import { runtimeToolInputByteLength } from "./runtime-tool-input-budget.ts";

/**
 * Maximum provider-controlled parts accepted from one direct generation.
 *
 * This remains well above the separate 128 tool-call limit while bounding
 * descriptor traversal for sparse or adversarial content arrays.
 */
export const MAX_RUNTIME_DIRECT_CONTENT_PARTS = 65_536;

/** Maximum UTF-8 text retained from one direct provider generation. */
export const MAX_RUNTIME_DIRECT_TEXT_BYTES = 8 * 1_048_576;

type DirectToolMetadata = {
  providerExecuted?: true;
  dynamic?: true;
  supportsDeferredResults?: true;
};

export type RuntimeDirectContentPart =
  | { type: "text"; text: string }
  | ({
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: unknown;
  } & DirectToolMetadata)
  | ({
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError?: true;
  } & DirectToolMetadata);

export interface RuntimeDirectGenerateResult {
  content: RuntimeDirectContentPart[];
  finishReason: unknown;
  usage: unknown;
  providerMetadata?: Record<string, unknown>;
}

class DirectContentTypeError extends TypeError {
  constructor(reason: string) {
    super(`Invalid runtime generate content: ${reason}`);
    this.name = "TypeError";
  }
}

function invalid(reason: string): never {
  throw new DirectContentTypeError(reason);
}

const MISSING_OWN_PROPERTY = Symbol("missing own property");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwnDataProperty(
  record: Record<string, unknown> | unknown[],
  key: string,
): unknown | typeof MISSING_OWN_PROPERTY {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return MISSING_OWN_PROPERTY;
  if (!Object.hasOwn(descriptor, "value")) {
    return invalid(`${key} must be a data property`);
  }
  return descriptor.value;
}

function readIdentifier(
  part: Record<string, unknown>,
  key: "toolCallId" | "toolName",
  bounded = true,
): string {
  const value = readOwnDataProperty(part, key);
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    bounded && value.length > MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH
  ) {
    return invalid(
      bounded
        ? `${key} length must be between 1 and ${MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH}`
        : `${key} must be a non-empty string`,
    );
  }
  return value;
}

function readTrueFlag(
  part: Record<string, unknown>,
  key: "providerExecuted" | "dynamic" | "supportsDeferredResults" | "isError",
): true | undefined {
  const value = readOwnDataProperty(part, key);
  if (
    value === MISSING_OWN_PROPERTY ||
    value === undefined ||
    value === false
  ) {
    return undefined;
  }
  if (value !== true) {
    return invalid(`${key} must be a boolean when provided`);
  }
  return true;
}

function parseKnownPart(
  part: Record<string, unknown>,
): RuntimeDirectContentPart | undefined {
  const type = readOwnDataProperty(part, "type");
  if (typeof type !== "string") {
    return invalid("each part must contain a string type");
  }

  switch (type) {
    case "text": {
      const text = readOwnDataProperty(part, "text");
      if (typeof text !== "string") {
        return invalid("text parts require string text");
      }
      return { type: "text", text };
    }

    case "tool-call": {
      const input = readOwnDataProperty(part, "input");
      if (input === MISSING_OWN_PROPERTY) {
        return invalid("tool-call parts require input");
      }
      const providerExecuted = readTrueFlag(part, "providerExecuted");
      const dynamic = readTrueFlag(part, "dynamic");
      const supportsDeferredResults = readTrueFlag(
        part,
        "supportsDeferredResults",
      );
      return {
        type: "tool-call",
        toolCallId: readIdentifier(part, "toolCallId"),
        toolName: readIdentifier(part, "toolName"),
        input,
        ...(providerExecuted ? { providerExecuted } : {}),
        ...(dynamic ? { dynamic } : {}),
        ...(supportsDeferredResults ? { supportsDeferredResults } : {}),
      };
    }

    case "tool-result": {
      const result = readOwnDataProperty(part, "result");
      if (result === MISSING_OWN_PROPERTY) {
        return invalid("tool-result parts require result");
      }
      const providerExecuted = readTrueFlag(part, "providerExecuted");
      const dynamic = readTrueFlag(part, "dynamic");
      const supportsDeferredResults = readTrueFlag(
        part,
        "supportsDeferredResults",
      );
      const isError = readTrueFlag(part, "isError");
      return {
        type: "tool-result",
        // The bridge intentionally accepts overlong unpaired result metadata
        // long enough to quarantine a bounded prefix without exposing payloads.
        toolCallId: readIdentifier(part, "toolCallId", false),
        toolName: readIdentifier(part, "toolName", false),
        result,
        ...(isError ? { isError } : {}),
        ...(providerExecuted ? { providerExecuted } : {}),
        ...(dynamic ? { dynamic } : {}),
        ...(supportsDeferredResults ? { supportsDeferredResults } : {}),
      };
    }

    default:
      // Provider-specific direct-result parts remain opaque to the framework.
      return undefined;
  }
}

/**
 * Parse the provider-controlled content array returned by `doGenerate`.
 *
 * Known parts are copied into a canonical shape. Unknown provider-specific
 * records are ignored, while malformed containers and malformed known parts
 * fail closed instead of becoming a false successful empty generation.
 */
export function parseRuntimeDirectContent(
  content: unknown,
): RuntimeDirectContentPart[] {
  try {
    if (content === undefined) return [];
    if (!Array.isArray(content)) {
      return invalid("content must be an array when provided");
    }
    const parsed: RuntimeDirectContentPart[] = [];
    let textBytes = 0;
    const length = readOwnDataProperty(content, "length");
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_RUNTIME_DIRECT_CONTENT_PARTS
    ) {
      return invalid(
        `content array length must be between 0 and ${MAX_RUNTIME_DIRECT_CONTENT_PARTS}`,
      );
    }
    for (let index = 0; index < length; index++) {
      const part = readOwnDataProperty(content, String(index));
      if (!isRecord(part)) {
        return invalid("each part must be an object");
      }
      const known = parseKnownPart(part);
      if (!known) continue;
      if (known.type === "text") {
        const remainingTextBytes = MAX_RUNTIME_DIRECT_TEXT_BYTES - textBytes;
        const measured = runtimeToolInputByteLength(
          known.text,
          remainingTextBytes,
        );
        if (measured > remainingTextBytes) {
          return invalid(
            `text content must not exceed ${MAX_RUNTIME_DIRECT_TEXT_BYTES} UTF-8 bytes`,
          );
        }
        textBytes += measured;
      }
      parsed.push(known);
    }
    return parsed;
  } catch (error) {
    if (error instanceof DirectContentTypeError) throw error;
    return invalid("content could not be safely inspected");
  }
}

/**
 * Snapshot the known fields of one untrusted `doGenerate` result without
 * invoking provider-controlled accessors.
 */
export function parseRuntimeDirectGenerateResult(
  value: unknown,
): RuntimeDirectGenerateResult {
  try {
    if (!isRecord(value)) {
      return invalid("doGenerate result must be an object");
    }
    const rawContent = readOwnDataProperty(value, "content");
    const rawFinishReason = readOwnDataProperty(value, "finishReason");
    const rawUsage = readOwnDataProperty(value, "usage");
    const rawProviderMetadata = readOwnDataProperty(value, "providerMetadata");
    const providerMetadata = rawProviderMetadata === MISSING_OWN_PROPERTY ||
        rawProviderMetadata === undefined
      ? undefined
      : rawProviderMetadata;

    if (providerMetadata !== undefined && !isRecord(providerMetadata)) {
      return invalid("providerMetadata must be an object when provided");
    }

    return {
      content: parseRuntimeDirectContent(
        rawContent === MISSING_OWN_PROPERTY ? undefined : rawContent,
      ),
      finishReason: rawFinishReason === MISSING_OWN_PROPERTY ? undefined : rawFinishReason,
      usage: rawUsage === MISSING_OWN_PROPERTY ? undefined : rawUsage,
      ...(providerMetadata === undefined ? {} : { providerMetadata }),
    };
  } catch (error) {
    if (error instanceof DirectContentTypeError) throw error;
    return invalid("doGenerate result could not be safely inspected");
  }
}
