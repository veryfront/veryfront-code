import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import { hasCompletedStepSignal, resolveStreamOutcome } from "../streaming/stream-outcome.ts";
import type { StreamSnapshot } from "../streaming/lifecycle/types.ts";

/** Error shape for hosted terminal. */
export interface HostedTerminalError {
  code: string;
  message: string;
}

/** State for hosted response finalization. */
export interface HostedResponseFinalizationState<TMessage, TChunk> {
  persistedMessage: TMessage;
  finalizedMessage: TMessage;
  fallbackChunks: readonly TChunk[];
  hasIncompleteToolParts: boolean;
  metadata?: HostedLifecycleTerminalState["metadata"];
}

/** State for hosted detached finalization. */
export interface HostedDetachedFinalizationState<TChunk> {
  hasContent: boolean;
  fallbackChunks: readonly TChunk[];
  hasIncompleteToolParts: boolean;
}

/** Options accepted by finalize hosted response. */
export interface FinalizeHostedResponseOptions<TMessage, TChunk> {
  isAborted: boolean;
  getFinalStep: () => Promise<unknown>;
  buildState: (finalStep: unknown) =>
    | Promise<HostedResponseFinalizationState<TMessage, TChunk>>
    | HostedResponseFinalizationState<TMessage, TChunk>;
  shouldFailEmptyMessage: (input: { isAborted: boolean; message: TMessage }) => boolean;
  resolveEmptyTerminalError: (input: {
    finalStep: unknown;
    streamError?: unknown | null;
  }) => HostedTerminalError | Promise<HostedTerminalError>;
  appendFallbackChunk: (chunk: TChunk) => Promise<void> | void;
  flushMirror: () => Promise<void> | void;
  dispatchTerminalState: (state: HostedLifecycleTerminalState) => Promise<void> | void;
  resolveTerminalState: (input: {
    isAborted: boolean;
    hasIncompleteToolParts: boolean;
  }) => HostedLifecycleTerminalState;
  cleanup: () => Promise<void> | void;
  streamError?: unknown | null;
}

/** Options accepted by finalize hosted detached. */
export interface FinalizeHostedDetachedOptions<TChunk> {
  isAborted: boolean;
  mirroredDurableOutput: boolean;
  getFinalStep: () => Promise<unknown>;
  buildState: (finalStep: unknown) =>
    | Promise<HostedDetachedFinalizationState<TChunk>>
    | HostedDetachedFinalizationState<TChunk>;
  resolveEmptyTerminalError: (input: {
    finalStep: unknown;
    streamError?: unknown | null;
  }) => HostedTerminalError | Promise<HostedTerminalError>;
  appendFallbackChunk: (chunk: TChunk) => Promise<void> | void;
  flushMirror: () => Promise<void> | void;
  dispatchTerminalState: (state: HostedLifecycleTerminalState) => Promise<void> | void;
  resolveTerminalState: (input: {
    isAborted: boolean;
    hasIncompleteToolParts: boolean;
  }) => HostedLifecycleTerminalState;
  cleanup: () => Promise<void> | void;
  streamError?: unknown | null;
}

async function appendFallbackChunks<TChunk>(
  chunks: readonly TChunk[],
  appendFallbackChunk: (chunk: TChunk) => Promise<void> | void,
): Promise<void> {
  for (const chunk of chunks) {
    await appendFallbackChunk(chunk);
  }
}

async function cleanupAfterFinalization(cleanup: () => Promise<void> | void): Promise<void> {
  await cleanup();
}

/**
 * Read a known step finish reason from a hosted final step, or null.
 *
 * Returns every finish reason that marks a completed provider step,
 * including "tool-calls", which signals a tool handoff rather than run
 * completion. Unknown reasons and malformed steps read as null.
 */
export function readHostedFinishReason(
  finalStep: unknown,
): StreamSnapshot["finishReason"] {
  if (
    typeof finalStep !== "object" || finalStep === null ||
    !("finishReason" in finalStep) || typeof finalStep.finishReason !== "string"
  ) {
    return null;
  }
  return hasCompletedStepSignal(finalStep.finishReason)
    ? finalStep.finishReason as StreamSnapshot["finishReason"]
    : null;
}

function createHostedCompatibilitySnapshot(input: {
  hasOutput: boolean;
  finishReason: StreamSnapshot["finishReason"];
}): StreamSnapshot {
  const phase = input.finishReason === "tool-calls"
    ? "tool_handoff" as const
    : input.finishReason === null
    ? "streaming" as const
    : "completed" as const;
  return {
    phase,
    accumulatedText: input.hasOutput ? "<COMPATIBILITY_OUTPUT>" : "",
    reasoning: [],
    tools: [],
    finishReason: input.finishReason,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    hasStreamOutput: input.hasOutput,
    hasSemanticProgress: input.hasOutput || input.finishReason !== null,
  };
}

function shouldFailStreamError(input: {
  isAborted: boolean;
  hasOutput: boolean;
  finalStep: unknown;
  streamError?: unknown | null;
}): boolean {
  if (input.isAborted || input.streamError == null) {
    return false;
  }

  const streamOutcome = resolveStreamOutcome({
    snapshot: createHostedCompatibilitySnapshot({
      hasOutput: input.hasOutput,
      finishReason: readHostedFinishReason(input.finalStep),
    }),
    elapsedMs: 0,
    thrownError: input.streamError,
  });
  return streamOutcome.status === "failed";
}

/** Response payload for finalize hosted. */
export async function finalizeHostedResponse<TMessage, TChunk>(
  options: FinalizeHostedResponseOptions<TMessage, TChunk>,
): Promise<void> {
  const finalStep = await options.getFinalStep();
  const state = await options.buildState(finalStep);

  if (
    options.shouldFailEmptyMessage({
      isAborted: options.isAborted,
      message: state.finalizedMessage,
    })
  ) {
    const terminalError = await options.resolveEmptyTerminalError({
      finalStep,
      streamError: options.streamError,
    });

    await options.flushMirror();
    await options.dispatchTerminalState({
      status: "failed",
      metadata: state.metadata,
      terminalErrorCode: terminalError.code,
      terminalErrorMessage: terminalError.message,
    });
    await cleanupAfterFinalization(options.cleanup);
    return;
  }

  await appendFallbackChunks(state.fallbackChunks, options.appendFallbackChunk);
  await options.flushMirror();
  if (
    shouldFailStreamError({
      isAborted: options.isAborted,
      hasOutput: true,
      finalStep,
      streamError: options.streamError,
    })
  ) {
    const terminalError = await options.resolveEmptyTerminalError({
      finalStep,
      streamError: options.streamError,
    });

    await options.dispatchTerminalState({
      status: "failed",
      metadata: state.metadata,
      terminalErrorCode: terminalError.code,
      terminalErrorMessage: terminalError.message,
    });
    await cleanupAfterFinalization(options.cleanup);
    return;
  }

  const terminalState = options.resolveTerminalState({
    isAborted: options.isAborted,
    hasIncompleteToolParts: state.hasIncompleteToolParts,
  });
  await options.dispatchTerminalState({
    ...terminalState,
    ...(state.metadata !== undefined ? { metadata: state.metadata } : {}),
  });
  await cleanupAfterFinalization(options.cleanup);
}

/** Finalize hosted detached helper. */
export async function finalizeHostedDetached<TChunk>(
  options: FinalizeHostedDetachedOptions<TChunk>,
): Promise<void> {
  const finalStep = await options.getFinalStep();
  const state = await options.buildState(finalStep);

  if (!options.isAborted && !options.mirroredDurableOutput && !state.hasContent) {
    const terminalError = await options.resolveEmptyTerminalError({
      finalStep,
      streamError: options.streamError,
    });

    await options.flushMirror();
    await options.dispatchTerminalState({
      status: "failed",
      terminalErrorCode: terminalError.code,
      terminalErrorMessage: terminalError.message,
    });
    await cleanupAfterFinalization(options.cleanup);
    return;
  }

  await appendFallbackChunks(state.fallbackChunks, options.appendFallbackChunk);
  await options.flushMirror();
  if (
    shouldFailStreamError({
      isAborted: options.isAborted,
      hasOutput: options.mirroredDurableOutput || state.hasContent,
      finalStep,
      streamError: options.streamError,
    })
  ) {
    const terminalError = await options.resolveEmptyTerminalError({
      finalStep,
      streamError: options.streamError,
    });

    await options.dispatchTerminalState({
      status: "failed",
      terminalErrorCode: terminalError.code,
      terminalErrorMessage: terminalError.message,
    });
    await cleanupAfterFinalization(options.cleanup);
    return;
  }

  await options.dispatchTerminalState(
    options.resolveTerminalState({
      isAborted: options.isAborted,
      hasIncompleteToolParts: state.hasIncompleteToolParts,
    }),
  );
  await cleanupAfterFinalization(options.cleanup);
}
