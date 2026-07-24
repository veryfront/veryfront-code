import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import {
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
} from "../streaming/stream-outcome.ts";

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

function hasFinalStepCompletionSignal(finalStep: unknown): boolean {
  if (
    typeof finalStep !== "object" || finalStep === null || !("finishReason" in finalStep) ||
    typeof finalStep.finishReason !== "string"
  ) {
    return false;
  }

  return hasCompletedStepSignal(finalStep.finishReason);
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

  if (
    input.hasOutput &&
    hasFinalStepCompletionSignal(input.finalStep) &&
    isLateProviderBodyReadError(input.streamError)
  ) {
    return false;
  }

  return true;
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
