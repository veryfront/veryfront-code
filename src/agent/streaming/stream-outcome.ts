/**
 * Stream Outcome: the single place that interprets how a provider stream ended.
 *
 * Both the runtime layer (which starts streams) and the hosted layer (which
 * finishes them) need to answer the same questions: what error message does a
 * thrown value carry, was it the late body-read failure, did the final step
 * complete, and does the error map to a known terminal provider error. Before
 * this module those answers were byte-identical private copies on both sides
 * of the runtime/hosted boundary with nothing keeping them in sync.
 */

import { parseProviderError } from "#veryfront/chat/provider-errors.ts";

/** Extract a human-readable message from any value a provider stream can throw. */
export function getStreamErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" && error !== null && "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

/**
 * True for the "error reading a body from connection" failure some providers
 * raise after all output has already streamed. Treated as a completed stream
 * when output and a completion signal are present.
 */
export function isLateProviderBodyReadError(error: unknown): boolean {
  return /error reading a body from connection/i.test(getStreamErrorMessage(error));
}

/** True when the provider finish reason marks a completed step. */
export function hasCompletedStepSignal(finishReason: string | null): boolean {
  switch (finishReason) {
    case "stop":
    case "length":
    case "tool-calls":
    case "content-filter":
    case "other":
      return true;
    default:
      return false;
  }
}

/**
 * Map a thrown provider error to a terminal `{code, message}` pair, or null
 * for the generic "LLM provider service error" (which callers treat as
 * unknown/retryable rather than terminal).
 */
export function resolveKnownProviderTerminalError(error: unknown): {
  code: string;
  message: string;
} | null {
  const parsedError = parseProviderError(error);
  if (
    parsedError.code === "EXTERNAL_SERVICE_ERROR" &&
    parsedError.message === "LLM provider service error"
  ) {
    return null;
  }

  return {
    code: parsedError.code,
    message: parsedError.message,
  };
}
