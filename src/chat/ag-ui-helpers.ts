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
    const resolvedSourceId = typeof value.sourceId === "string" && value.sourceId.length > 0
      ? value.sourceId
      : value.url;
    // Only a genuinely absent title falls back to the resolved source id --
    // the same fallback, under the same condition, the AG-UI decoder's
    // native UrlCited case applies. This function decodes the reconstructed
    // CUSTOM twin a replayed native URL_CITED durable record produces too,
    // and that record never carries an empty title
    // (native-run-events.ts's omitInvalidOptionalStrings drops it, I1), so
    // it must render the same fallback the live frame does. A
    // present-but-wrong-typed title is still dropped rather than defaulted,
    // matching this function's own `typeof === "string"` guard on every
    // other optional field, and matching the native decoder's own
    // absent-vs-wrong-typed distinction so the two paths render the same
    // chat event for the same logical value.
    const resolvedTitle = value.title === undefined
      ? resolvedSourceId
      : typeof value.title === "string"
      ? value.title
      : undefined;
    return {
      type: "source-url",
      sourceId: resolvedSourceId,
      url: value.url,
      ...(resolvedTitle !== undefined ? { title: resolvedTitle } : {}),
    };
  }

  if (
    value.type === "source-document" &&
    typeof value.sourceId === "string" &&
    typeof value.mediaType === "string"
  ) {
    // ChatSourceDocumentUiPart.title is a required chat UI field, unlike
    // source-url's title or this event's own filename, so an absent title
    // falls back to the source id instead of making the whole citation
    // unrenderable -- see the source-url case above for why this must hold
    // for a replayed native DOCUMENT_CITED record too, not just a live one.
    return {
      type: "source-document",
      sourceId: value.sourceId,
      mediaType: value.mediaType,
      title: typeof value.title === "string" ? value.title : value.sourceId,
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
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(trimmed)
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
