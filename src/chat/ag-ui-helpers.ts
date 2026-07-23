import type { ChatFinishReason, ChatStreamEvent } from "./protocol.ts";

type ParsedRenderableCustomChunk = Extract<
  ChatStreamEvent,
  { type: "source-url" | "source-document" | "file" }
>;

const MAX_TOOL_ERROR_TEXT_LENGTH = 4_096;
const MAX_TOOL_ERROR_VALUE_DEPTH = 32;
const MAX_TOOL_ERROR_VALUE_ENTRIES = 1_000;
const MAX_SERIALIZED_TOOL_RESULT_CHARS = 1_048_576;
const SAFE_DATA_FILE_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 &&
      url.password.length === 0;
  } catch {
    return false;
  }
}

export function isSafeRenderableFileUrl(value: string, mediaType: string): boolean {
  if (isSafeHttpUrl(value)) {
    return true;
  }

  const normalizedMediaType = mediaType.trim().toLowerCase().split(";", 1)[0];
  return SAFE_DATA_FILE_MEDIA_TYPES.has(normalizedMediaType ?? "") &&
    value.toLowerCase().startsWith(`data:${normalizedMediaType};base64,`);
}

function readOwnDataProperty(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function snapshotToolErrorValue(
  value: unknown,
  context: { active: WeakSet<object>; remainingEntries: number },
  depth: number,
): unknown {
  if (depth > MAX_TOOL_ERROR_VALUE_DEPTH) return "[MaxDepth]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateToolError(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return null;
  if (context.active.has(value)) return "[Circular]";

  context.active.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (
        let index = 0;
        index < value.length && context.remainingEntries > 0;
        index += 1
      ) {
        context.remainingEntries -= 1;
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        result.push(snapshotToolErrorValue(
          descriptor && "value" in descriptor ? descriptor.value : undefined,
          context,
          depth + 1,
        ));
      }
      return result;
    }

    const entries: Array<[string, unknown]> = [];
    for (const key of Object.keys(value)) {
      if (context.remainingEntries <= 0) break;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) continue;
      context.remainingEntries -= 1;
      entries.push([key, snapshotToolErrorValue(descriptor.value, context, depth + 1)]);
    }
    return Object.fromEntries(entries);
  } catch {
    return "[Unserializable]";
  } finally {
    context.active.delete(value);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(snapshotToolErrorValue(value, {
      active: new WeakSet<object>(),
      remainingEntries: MAX_TOOL_ERROR_VALUE_ENTRIES,
    }, 0)) ?? "Tool execution failed";
  } catch {
    return "Tool execution failed";
  }
}

function truncateToolError(value: string): string {
  return value.length <= MAX_TOOL_ERROR_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_TOOL_ERROR_TEXT_LENGTH - 1)}\u2026`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function toRenderableCustomChunk(value: unknown): ParsedRenderableCustomChunk | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = readOwnDataProperty(value, "type");
  const url = readOwnDataProperty(value, "url");
  const sourceId = readOwnDataProperty(value, "sourceId");
  const title = readOwnDataProperty(value, "title");
  const mediaType = readOwnDataProperty(value, "mediaType");
  const filename = readOwnDataProperty(value, "filename");

  if (
    type === "source-url" && typeof url === "string" &&
    isSafeHttpUrl(url)
  ) {
    return {
      type: "source-url",
      sourceId: typeof sourceId === "string" && sourceId.length > 0 ? sourceId : url,
      url,
      ...(typeof title === "string" ? { title } : {}),
    };
  }

  if (
    type === "source-document" &&
    typeof sourceId === "string" &&
    typeof mediaType === "string" &&
    typeof title === "string"
  ) {
    return {
      type: "source-document",
      sourceId,
      mediaType,
      title,
      ...(typeof filename === "string" ? { filename } : {}),
    };
  }

  if (
    type === "file" && typeof url === "string" && typeof mediaType === "string" &&
    isSafeRenderableFileUrl(url, mediaType)
  ) {
    return {
      type: "file",
      url,
      mediaType,
      ...(typeof filename === "string" ? { filename } : {}),
    };
  }

  return null;
}

export function parseSerializedToolResult(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  if (value.length > MAX_SERIALIZED_TOOL_RESULT_CHARS) {
    return value;
  }

  const trimmed = value.trim();
  if (
    !trimmed.startsWith("{") &&
    !trimmed.startsWith("[") &&
    trimmed !== "null" &&
    trimmed !== "true" &&
    trimmed !== "false" &&
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function formatToolErrorText(result: unknown): string {
  if (typeof result === "string" && result.length > 0) {
    return truncateToolError(result);
  }

  if (isRecord(result)) {
    const error = readOwnDataProperty(result, "error");
    if (typeof error === "string" && error.length > 0) {
      return truncateToolError(error);
    }

    const message = readOwnDataProperty(result, "message");
    if (typeof message === "string" && message.length > 0) {
      return truncateToolError(message);
    }
  }

  return truncateToolError(safeStringify(result ?? { error: "Tool execution failed" }));
}

export function mapFinishReason(reason: string | undefined): ChatFinishReason | undefined {
  if (!reason) return undefined;

  switch (reason.trim().toLowerCase()) {
    case "stop":
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "tool_use":
      return "tool-calls";
    case "content_filter":
    case "content-filter":
      return "content-filter";
    case "error":
      return "error";
    default:
      return "other";
  }
}

export function splitSseFrames(value: string): { frames: string[]; remainder: string } {
  const blocks = value.split("\n\n");
  return {
    frames: blocks.slice(0, -1),
    remainder: blocks.at(-1) ?? "",
  };
}

export function isCommentOnlySseFrame(raw: string): boolean {
  return raw
    .split("\n")
    .every((line) => line.trim().length === 0 || line.trimStart().startsWith(":"));
}
