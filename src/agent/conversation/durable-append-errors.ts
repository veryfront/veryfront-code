import { getConversationRunErrorSchema } from "./durable-contracts.ts";

/** Error shape for append conversation run events. */
export class AppendConversationRunEventsError extends Error {
  /** Status. */
  readonly status: number;
  /** Detail value. */
  readonly detail: string | null;

  /** Creates an instance with the supplied dependencies. */
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

/**
 * A payload-too-large rejection is permanent: the same bytes will be rejected on
 * every retry, so the mirror must stop rather than retry-storm the API. The runtime
 * normalizes events under the limit before appending, so reaching this is a bug —
 * classify it distinctly so it can be surfaced loudly instead of silently ignored.
 */
export function isPayloadTooLargeConversationRunAppendError(
  error: unknown,
): error is AppendConversationRunEventsError {
  return (
    error instanceof AppendConversationRunEventsError &&
    error.status === 400 &&
    typeof error.detail === "string" &&
    error.detail.includes("payload must be less than")
  );
}

/** Error shape for permanent auth rejection while appending run events. */
export function isPermanentAuthConversationRunAppendError(
  error: unknown,
): error is AppendConversationRunEventsError {
  return (
    error instanceof AppendConversationRunEventsError &&
    (error.status === 401 || error.status === 403)
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
