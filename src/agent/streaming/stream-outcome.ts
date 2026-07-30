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

import type {
  StreamCancellationSource,
  StreamCommittedToolCall,
  StreamLifecycleError,
  StreamOutcome,
  StreamProviderError,
  StreamSnapshot,
} from "./lifecycle/types.ts";

/** Input accepted by the shared terminal classifier. */
export interface ResolveStreamOutcomeInput {
  snapshot: StreamSnapshot;
  elapsedMs: number;
  cancellation?: StreamCancellationSource;
  lifecycleError?: StreamLifecycleError;
  thrownError?: unknown;
  providerError?: StreamProviderError;
}

/**
 * The sole terminal classifier for provider stream attempts. The lifecycle
 * runner and hosted compatibility finalization both resolve their Stream
 * Outcome here so terminal meaning cannot drift between layers.
 */
export function resolveStreamOutcome(
  input: ResolveStreamOutcomeInput,
): StreamOutcome {
  if (input.cancellation) {
    const snapshot = { ...input.snapshot, phase: "cancelled" as const };
    return {
      status: "cancelled",
      source: input.cancellation,
      publicMessage: "Stream was cancelled",
      snapshot,
      usage: snapshot.usage,
      elapsedMs: input.elapsedMs,
      phase: snapshot.phase,
    };
  }
  if (input.lifecycleError) {
    const snapshot = { ...input.snapshot, phase: "failed" as const };
    return {
      status: "failed",
      error: input.lifecycleError,
      snapshot,
      usage: snapshot.usage,
      elapsedMs: input.elapsedMs,
      phase: snapshot.phase,
    };
  }
  if (
    input.thrownError !== undefined &&
    !(
      input.snapshot.hasStreamOutput &&
      hasCompletedStepSignal(input.snapshot.finishReason) &&
      isLateProviderBodyReadError(input.thrownError)
    )
  ) {
    return failedClassifiedProviderOutcome(
      input,
      input.providerError ?? classifyThrownProviderError(input.thrownError),
    );
  }
  if (input.thrownError === undefined && input.providerError) {
    return failedClassifiedProviderOutcome(input, input.providerError);
  }
  if (input.snapshot.phase === "tool_handoff") return toolHandoffOutcome(input);
  if (
    input.snapshot.phase === "completed" &&
    input.snapshot.finishReason !== null &&
    input.snapshot.finishReason !== "tool-calls"
  ) {
    return completedOutcome(input);
  }
  return failedRuntimeOutcome(
    input,
    "PROVIDER_STREAM_ERROR",
    "Provider stream ended before completion",
  );
}

/** Committed local tool calls projected from a terminal snapshot. */
export function collectCommittedLocalToolCalls(
  snapshot: Readonly<StreamSnapshot>,
): StreamCommittedToolCall[] {
  return snapshot.tools
    .filter((tool) => tool.phase === "input_ready" && tool.providerExecuted !== true)
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      arguments: tool.inputText,
      inputDeltas: [...tool.inputDeltas],
      inputAnnounced: true,
      inputAvailable: true,
      providerExecuted: false,
      ...(tool.dynamic ? { dynamic: true } : {}),
    }));
}

function classifyThrownProviderError(error: unknown): StreamProviderError {
  const known = resolveKnownProviderTerminalError(error);
  if (known) {
    return {
      code: known.code,
      publicMessage: known.message,
      retryable: false,
      terminal: true,
    };
  }
  return {
    code: "PROVIDER_STREAM_ERROR",
    publicMessage: "Provider stream failed",
    retryable: true,
    terminal: false,
  };
}

function createFailedResolverOutcome(
  input: ResolveStreamOutcomeInput,
  error: Omit<StreamLifecycleError, "phase">,
): StreamOutcome {
  const failedFrom = input.snapshot.phase;
  const snapshot = { ...input.snapshot, phase: "failed" as const };
  return {
    status: "failed",
    error: { ...error, phase: failedFrom },
    snapshot,
    usage: snapshot.usage,
    elapsedMs: input.elapsedMs,
    phase: snapshot.phase,
  };
}

function failedClassifiedProviderOutcome(
  input: ResolveStreamOutcomeInput,
  providerError: StreamProviderError,
): StreamOutcome {
  return createFailedResolverOutcome(input, {
    code: providerError.terminal ? "PROVIDER_TERMINAL_ERROR" : "PROVIDER_STREAM_ERROR",
    providerCode: providerError.code,
    source: "provider",
    retryable: providerError.retryable,
    publicMessage: providerError.publicMessage,
    ...(providerError.diagnosticId ? { diagnosticId: providerError.diagnosticId } : {}),
  });
}

function failedRuntimeOutcome(
  input: ResolveStreamOutcomeInput,
  code: "PROVIDER_STREAM_ERROR" | "PROTOCOL_VIOLATION",
  publicMessage: string,
): StreamOutcome {
  return createFailedResolverOutcome(input, {
    code,
    source: "runtime",
    retryable: code === "PROVIDER_STREAM_ERROR",
    publicMessage,
  });
}

function toolHandoffOutcome(input: ResolveStreamOutcomeInput): StreamOutcome {
  const snapshot = { ...input.snapshot, phase: "tool_handoff" as const };
  return {
    status: "tool_handoff",
    finishReason: "tool-calls",
    toolCalls: collectCommittedLocalToolCalls(snapshot),
    snapshot,
    usage: snapshot.usage,
    elapsedMs: input.elapsedMs,
    phase: snapshot.phase,
  };
}

function completedOutcome(input: ResolveStreamOutcomeInput): StreamOutcome {
  const finishReason = input.snapshot.finishReason;
  if (finishReason === null || finishReason === "tool-calls") {
    return failedRuntimeOutcome(
      input,
      "PROTOCOL_VIOLATION",
      "Provider stream ended in an invalid lifecycle state",
    );
  }
  const snapshot = { ...input.snapshot, phase: "completed" as const };
  return {
    status: "completed",
    finishReason,
    snapshot,
    usage: snapshot.usage,
    elapsedMs: input.elapsedMs,
    phase: snapshot.phase,
  };
}
