/** Input payload for child run execution buffer cleanup. */
export interface ChildRunExecutionBufferCleanupInput {
  closeReasoningBuffer: () => Promise<void>;
  closeTextBuffer: () => Promise<void>;
}

/** Input payload for child run execution resource finalize. */
export interface ChildRunExecutionResourceFinalizeInput
  extends ChildRunExecutionBufferCleanupInput {
  durableStepStarted: boolean;
  appendFinishStepChunk: () => Promise<void>;
  flushMirror?: () => Promise<void>;
  closeTooling?: () => Promise<void>;
  closeRuntime?: () => Promise<void>;
}

/** Close child run execution buffers helper. */
export async function closeChildRunExecutionBuffers(
  input: ChildRunExecutionBufferCleanupInput,
): Promise<void> {
  await input.closeReasoningBuffer();
  await input.closeTextBuffer();
}

/** Finalize child run execution resources helper. */
export async function finalizeChildRunExecutionResources(
  input: ChildRunExecutionResourceFinalizeInput,
): Promise<void> {
  await closeChildRunExecutionBuffers(input);

  if (input.durableStepStarted) {
    await input.appendFinishStepChunk();
  }

  await input.flushMirror?.();
  await Promise.allSettled([input.closeTooling?.(), input.closeRuntime?.()]);
}
