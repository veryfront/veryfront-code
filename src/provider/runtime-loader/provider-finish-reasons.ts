export type NormalizedFinishReason = string | { unified: string; raw: string } | null;

export function normalizeAnthropicFinishReason(raw: unknown): NormalizedFinishReason {
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "tool_use":
      return { unified: "tool-calls", raw };
    case "end_turn":
    case "stop_sequence":
      return { unified: "stop", raw };
    case "max_tokens":
      return { unified: "length", raw };
    default:
      return raw;
  }
}

export function normalizeGoogleFinishReason(raw: unknown): NormalizedFinishReason {
  if (typeof raw !== "string") {
    return null;
  }

  switch (raw) {
    case "STOP":
      return { unified: "stop", raw };
    case "MAX_TOKENS":
      return { unified: "length", raw };
    case "SAFETY":
    case "RECITATION":
      return { unified: "content-filter", raw };
    default:
      return raw.toLowerCase();
  }
}

export function normalizeOpenAIFinishReason(raw: unknown): NormalizedFinishReason {
  if (typeof raw !== "string") {
    return null;
  }

  if (raw === "tool_calls") {
    return { unified: "tool-calls", raw };
  }

  if (raw === "content_filter") {
    return { unified: "content-filter", raw };
  }

  return raw;
}

export function normalizeOpenAIResponsesFinishReason(raw: unknown): NormalizedFinishReason {
  if (typeof raw !== "string") return null;
  switch (raw) {
    case "completed":
      return { unified: "stop", raw };
    case "incomplete":
      return { unified: "length", raw };
    case "failed":
      return { unified: "error", raw };
    case "in_progress":
      return null;
    default:
      return raw;
  }
}
