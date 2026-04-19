import type { ChatFinishReason, ChatStreamEvent } from "./protocol.ts";

type ParsedRenderableCustomChunk = Extract<
  ChatStreamEvent,
  { type: "source-url" | "source-document" | "file" }
>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function toRenderableCustomChunk(value: unknown): ParsedRenderableCustomChunk | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "source-url" && typeof value.url === "string") {
    return {
      type: "source-url",
      sourceId: typeof value.sourceId === "string" && value.sourceId.length > 0
        ? value.sourceId
        : value.url,
      url: value.url,
      ...(typeof value.title === "string" ? { title: value.title } : {}),
    };
  }

  if (
    value.type === "source-document" &&
    typeof value.sourceId === "string" &&
    typeof value.mediaType === "string" &&
    typeof value.title === "string"
  ) {
    return {
      type: "source-document",
      sourceId: value.sourceId,
      mediaType: value.mediaType,
      title: value.title,
      ...(typeof value.filename === "string" ? { filename: value.filename } : {}),
    };
  }

  if (
    value.type === "file" && typeof value.url === "string" && typeof value.mediaType === "string"
  ) {
    return {
      type: "file",
      url: value.url,
      mediaType: value.mediaType,
      ...(typeof value.filename === "string" ? { filename: value.filename } : {}),
    };
  }

  return null;
}

export function parseSerializedToolResult(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (
    !trimmed.startsWith("{") &&
    !trimmed.startsWith("[") &&
    trimmed !== "null" &&
    trimmed !== "true" &&
    trimmed !== "false" &&
    !/^[-]?\d+(\.\d+)?$/.test(trimmed)
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
    return result;
  }

  if (isRecord(result)) {
    if (typeof result.error === "string" && result.error.length > 0) {
      return result.error;
    }

    if (typeof result.message === "string" && result.message.length > 0) {
      return result.message;
    }
  }

  return JSON.stringify(result ?? { error: "Tool execution failed" });
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
