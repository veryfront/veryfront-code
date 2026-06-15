import { getConversationRunErrorSchema } from "./durable-contracts.ts";

/** Error shape for append conversation run events. */
export class AppendConversationRunEventsError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(input: {
    status: number;
    detail?: string | null;
    statusText?: string;
  }) {
    const detail = input.detail?.trim() || input.statusText || `HTTP ${input.status}`;
    super(`Append conversation run events failed (${input.status}): ${detail}`);
    this.name = "AppendConversationRunEventsError";
    this.status = input.status;
    this.detail = input.detail?.trim() || null;
  }
}

/** Parses append conversation run events error body. */
export function parseAppendConversationRunEventsErrorBody(bodyText: string): string | null {
  if (!bodyText) {
    return null;
  }

  try {
    const parsed = getConversationRunErrorSchema().safeParse(JSON.parse(bodyText));
    if (parsed.success) {
      return parsed.data.detail ?? parsed.data.error ?? null;
    }
  } catch {
    return bodyText;
  }

  return bodyText;
}

/** Error shape for is ignorable conversation run append. */
export function isIgnorableConversationRunAppendError(
  error: unknown,
): error is AppendConversationRunEventsError {
  if (!(error instanceof AppendConversationRunEventsError)) {
    return false;
  }

  if (error.status === 404) {
    return true;
  }

  if (error.status !== 400) {
    return false;
  }

  return (
    error.detail === "Cannot append external events to a terminal run" ||
    error.detail === "Cannot append external events while the run is waiting for a tool result"
  );
}

/** Error shape for is cursor mismatch conversation run append. */
export function isCursorMismatchConversationRunAppendError(
  error: unknown,
): error is AppendConversationRunEventsError {
  return (
    error instanceof AppendConversationRunEventsError &&
    error.status === 400 &&
    error.detail === "External run event cursor mismatch"
  );
}
