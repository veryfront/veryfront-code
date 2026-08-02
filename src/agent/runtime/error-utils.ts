import { snapshotJsonValue } from "#veryfront/provider/runtime-loader/json-snapshot.ts";

export { createAbortError, throwIfAborted } from "#veryfront/utils/abort.ts";

/** Maximum UTF-8 size of tool failure text forwarded to logs, clients, or models. */
export const MAX_TOOL_ERROR_TEXT_BYTES = 4_096;

const TOOL_ERROR_TEXT_TRUNCATION_SUFFIX = "…";
const TOOL_ERROR_TEXT_TRUNCATION_SUFFIX_BYTES = 3;
const UNKNOWN_TOOL_ERROR_TEXT = "Unknown error";
const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const DOM_EXCEPTION_MESSAGE_GETTER = typeof DOMException === "function"
  ? getOwnPropertyDescriptor(DOMException.prototype, "message")?.get
  : undefined;

function codePointUtf8Width(value: string, index: number): { bytes: number; codeUnits: number } {
  const codeUnit = value.charCodeAt(index);
  if (codeUnit <= 0x7f) return { bytes: 1, codeUnits: 1 };
  if (codeUnit <= 0x7ff) return { bytes: 2, codeUnits: 1 };
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { bytes: 4, codeUnits: 2 };
    }
  }
  // TextEncoder replaces lone surrogates with the three-byte U+FFFD sequence.
  return { bytes: 3, codeUnits: 1 };
}

function boundToolErrorText(value: string): string {
  let bytes = 0;
  let index = 0;
  let suffixSafeIndex = 0;

  while (index < value.length) {
    const width = codePointUtf8Width(value, index);
    if (width.bytes > MAX_TOOL_ERROR_TEXT_BYTES - bytes) {
      return value.slice(0, suffixSafeIndex) + TOOL_ERROR_TEXT_TRUNCATION_SUFFIX;
    }
    bytes += width.bytes;
    index += width.codeUnits;
    if (bytes <= MAX_TOOL_ERROR_TEXT_BYTES - TOOL_ERROR_TEXT_TRUNCATION_SUFFIX_BYTES) {
      suffixSafeIndex = index;
    }
  }

  return value;
}

function readOwnMessage(error: unknown): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    const descriptor = getOwnPropertyDescriptor(error, "message");
    return descriptor && Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function readNativeDomExceptionMessage(error: unknown): string | undefined {
  if (
    !DOM_EXCEPTION_MESSAGE_GETTER ||
    ((typeof error !== "object" || error === null) && typeof error !== "function")
  ) {
    return undefined;
  }

  try {
    const message = apply(DOM_EXCEPTION_MESSAGE_GETTER, error, []);
    return typeof message === "string" ? message : undefined;
  } catch {
    return undefined;
  }
}

export function stringifyToolError(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return boundToolErrorText(error);
  }

  const ownMessage = readOwnMessage(error);
  if (ownMessage !== undefined && ownMessage.length > 0) {
    return boundToolErrorText(ownMessage);
  }

  const domExceptionMessage = readNativeDomExceptionMessage(error);
  if (domExceptionMessage !== undefined && domExceptionMessage.length > 0) {
    return boundToolErrorText(domExceptionMessage);
  }

  try {
    const snapshot = snapshotJsonValue(error, {
      maxBytes: MAX_TOOL_ERROR_TEXT_BYTES,
      maxDepth: 16,
      maxNodes: 1_024,
    });
    const serialized = JSON.stringify(snapshot);
    return typeof serialized === "string" && serialized.length > 0
      ? serialized
      : UNKNOWN_TOOL_ERROR_TEXT;
  } catch {
    if (error === undefined) return "undefined";
    if (typeof error === "bigint") return "bigint";
    if (typeof error === "symbol") return "symbol";
    return UNKNOWN_TOOL_ERROR_TEXT;
  }
}
