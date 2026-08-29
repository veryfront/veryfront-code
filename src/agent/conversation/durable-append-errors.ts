import { getConversationRunErrorSchema } from "./durable-contracts.ts";

/** Error shape for append conversation run events. */
export class AppendConversationRunEventsError extends Error {
  readonly status: number;
  readonly detail: string | null;
  readonly slug: string | null;

  constructor(input: {
    status: number;
    detail?: string | null;
    slug?: string | null;
    statusText?: string;
  }) {
    const detail = input.detail?.trim() || input.statusText || `HTTP ${input.status}`;
    super(`Append conversation run events failed (${input.status}): ${detail}`);
    this.name = "AppendConversationRunEventsError";
    this.status = input.status;
    this.detail = input.detail?.trim() || null;
    this.slug = input.slug?.trim() || null;
  }
}

/** Parsed append conversation run events problem details. */
export interface ParsedAppendConversationRunEventsErrorBody {
  detail: string | null;
  slug: string | null;
}

/** Parses append conversation run events problem details without losing machine identity. */
export function parseAppendConversationRunEventsError(
  bodyText: string,
): ParsedAppendConversationRunEventsErrorBody {
  if (!bodyText) {
    return { detail: null, slug: null };
  }

  try {
    const parsed = getConversationRunErrorSchema().safeParse(JSON.parse(bodyText));
    if (parsed.success) {
      return {
        detail: parsed.data.detail ?? parsed.data.error ?? parsed.data.slug ?? null,
        slug: parsed.data.slug ?? parsed.data.error ?? null,
      };
    }
  } catch {
    return { detail: bodyText, slug: null };
  }

  return { detail: bodyText, slug: null };
}

/** Parses append conversation run events error body. */
export function parseAppendConversationRunEventsErrorBody(bodyText: string): string | null {
  return parseAppendConversationRunEventsError(bodyText).detail;
}

const TERMINAL_RUN_APPEND_REJECTION_DETAIL = "Cannot append external events to a terminal run";
// The api's registered slug for this rejection (veryfront-issue-inbox#757);
// preferred over the English detail, which stays as a fallback for api
// versions that still emit only `validation-failed`.
const TERMINAL_RUN_APPEND_REJECTION_SLUG = "terminal-run-append-rejected";
const DELETED_RUN_APPEND_REJECTION_DETAIL = "resource-not-found";

function isTerminalRunAppendRejection(error: AppendConversationRunEventsError): boolean {
  return error.status === 400 &&
    (error.slug === TERMINAL_RUN_APPEND_REJECTION_SLUG ||
      error.detail === TERMINAL_RUN_APPEND_REJECTION_DETAIL);
}

/**
 * The run already reached a terminal status server-side, so it will never accept
 * another event -- nor a terminal transition. Cancelling a project's in-flight runs
 * before deleting it is the common source. An exact `resource-not-found` slug
 * for the captured conversation/run pair also means that pair can no longer accept
 * a terminal transition. This is deliberately narrower than
 * {@link isIgnorableConversationRunAppendError}: other missing resources and a run
 * waiting for a tool result are ignorable for appends but say nothing about
 * finalization, and every other rejection must keep surfacing as an error.
 */
export function isTerminalRunConversationRunAppendError(
  error: unknown,
): error is AppendConversationRunEventsError {
  return (
    error instanceof AppendConversationRunEventsError &&
    (isTerminalRunAppendRejection(error) ||
      (error.status === 404 && error.slug === DELETED_RUN_APPEND_REJECTION_DETAIL))
  );
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
    isTerminalRunAppendRejection(error) ||
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
