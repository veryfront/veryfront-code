import type { HostedLifecycleTerminalState } from "./hosted-lifecycle.ts";

export interface HostedTerminalError {
  code: string;
  message: string;
}

export interface HostedResponseFinalizationState<TMessage, TChunk> {
  persistedMessage: TMessage;
  finalizedMessage: TMessage;
  fallbackChunks: readonly TChunk[];
  hasIncompleteToolParts: boolean;
  metadata?: HostedLifecycleTerminalState["metadata"];
}

export interface HostedDetachedFinalizationState<TChunk> {
  hasContent: boolean;
  fallbackChunks: readonly TChunk[];
  hasIncompleteToolParts: boolean;
}

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
  await options.dispatchTerminalState(
    options.resolveTerminalState({
      isAborted: options.isAborted,
      hasIncompleteToolParts: state.hasIncompleteToolParts,
    }),
  );
  await cleanupAfterFinalization(options.cleanup);
}
