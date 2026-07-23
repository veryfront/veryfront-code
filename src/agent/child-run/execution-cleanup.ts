import { agentLogger } from "#veryfront/utils";

/** Input payload for child run execution buffer cleanup. */
export interface ChildRunExecutionBufferCleanupInput {
  /** Callback that handles close reasoning buffer. */
  closeReasoningBuffer: () => Promise<void>;
  /** Callback that handles close text buffer. */
  closeTextBuffer: () => Promise<void>;
}

/** Input payload for child run execution resource finalize. */
export interface ChildRunExecutionResourceFinalizeInput
  extends ChildRunExecutionBufferCleanupInput {
  /** Whether durable step started. */
  durableStepStarted: boolean;
  /** Callback that handles append finish step chunk. */
  appendFinishStepChunk: () => Promise<void>;
  /** Callback that handles flush mirror. */
  flushMirror?: () => Promise<void>;
  /** Callback that handles close tooling. */
  closeTooling?: () => Promise<void>;
  /** Callback that handles close runtime. */
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
  const [toolingResult, runtimeResult] = await Promise.allSettled([
    input.closeTooling?.(),
    input.closeRuntime?.(),
  ]);
  if (toolingResult.status === "rejected") {
    agentLogger.warn("Child run teardown: closeTooling failed", {
      errorName: toolingResult.reason instanceof Error
        ? toolingResult.reason.name
        : typeof toolingResult.reason,
    });
  }
  if (runtimeResult.status === "rejected") {
    agentLogger.warn("Child run teardown: closeRuntime failed", {
      errorName: runtimeResult.reason instanceof Error
        ? runtimeResult.reason.name
        : typeof runtimeResult.reason,
    });
  }
}
