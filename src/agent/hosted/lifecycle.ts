import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("hosted-lifecycle");

/** State for hosted lifecycle terminal. */
export interface HostedLifecycleTerminalState {
  /** Status. */
  status: "completed" | "failed" | "cancelled";
  /** Additional structured metadata. */
  metadata?: {
    modelId?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
      reasoningTokens?: number;
    };
  };
  /** Terminal error code value. */
  terminalErrorCode?: string | null;
  /** Terminal error message value. */
  terminalErrorMessage?: string | null;
}

/** Public API contract for hosted lifecycle execution. */
export interface HostedLifecycleExecution<TChunk> {
  /** Stream value. */
  stream: AsyncIterable<TChunk>;
  /** Resolves after execution finishes. */
  waitForFinish: () => Promise<void>;
}

/** Public API contract for hosted lifecycle adapter. */
export interface HostedLifecycleAdapter<TRun, TChunk> {
  /** Callback that handles start run. */
  startRun: (input: { abortSignal: AbortSignal }) => Promise<TRun> | TRun;
  /** Callback that handles append events. */
  appendEvents?: (run: TRun, chunk: TChunk) => Promise<void> | void;
  /** Callback that handles persist transcript chunk. */
  persistTranscriptChunk?: (run: TRun, chunk: TChunk) => Promise<void> | void;
  /** Persist transcript terminal state value. */
  persistTranscriptTerminalState?: (
    run: TRun,
    terminalState: HostedLifecycleTerminalState,
  ) => Promise<void> | void;
  /** On terminal state value. */
  onTerminalState?: (
    run: TRun,
    terminalState: HostedLifecycleTerminalState,
  ) => Promise<void> | void;
  /** Callback that handles finalize run. */
  finalizeRun?: (run: TRun, terminalState: HostedLifecycleTerminalState) => Promise<void> | void;
  /** Callback that handles cancel run. */
  cancelRun?: (run: TRun, terminalState: HostedLifecycleTerminalState) => Promise<void> | void;
}

/** Options accepted by hosted lifecycle runner. */
export interface HostedLifecycleRunnerOptions<TRun, TChunk> {
  /** Abort signal value. */
  abortSignal: AbortSignal;
  /** Execution value. */
  execution: HostedLifecycleExecution<TChunk>;
  /** Adapter value. */
  adapter: HostedLifecycleAdapter<TRun, TChunk>;
  /** Callback that handles resolve terminal state. */
  resolveTerminalState: () => Promise<HostedLifecycleTerminalState> | HostedLifecycleTerminalState;
  /** Resolve error terminal state value. */
  resolveErrorTerminalState?: (
    error: unknown,
  ) => Promise<HostedLifecycleTerminalState> | HostedLifecycleTerminalState;
}

/** Result returned from hosted lifecycle run. */
export interface HostedLifecycleRunResult<TRun> {
  /** Run value. */
  run: TRun;
  /** Terminal state value. */
  terminalState: HostedLifecycleTerminalState;
}

function getTerminalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultErrorTerminalState(
  abortSignal: AbortSignal,
  error: unknown,
): HostedLifecycleTerminalState {
  if (abortSignal.aborted) {
    return {
      status: "cancelled",
      terminalErrorCode: "ABORTED",
      terminalErrorMessage: getTerminalErrorMessage(error),
    };
  }

  return {
    status: "failed",
    terminalErrorCode: "STREAM_ERROR",
    terminalErrorMessage: getTerminalErrorMessage(error),
  };
}

async function captureHookError(
  callback: (() => Promise<void> | void) | undefined,
): Promise<unknown | null> {
  if (!callback) {
    return null;
  }

  try {
    await callback();
    return null;
  } catch (error) {
    return error;
  }
}

async function runTerminalHooks<TRun, TChunk>(input: {
  run: TRun;
  terminalState: HostedLifecycleTerminalState;
  adapter: HostedLifecycleAdapter<TRun, TChunk>;
}): Promise<void> {
  let firstHookError: unknown | null = null;

  const persistError = await captureHookError(() =>
    input.adapter.persistTranscriptTerminalState?.(input.run, input.terminalState)
  );
  if (persistError) {
    firstHookError = persistError;
  }

  const terminalObserverError = await captureHookError(() =>
    input.adapter.onTerminalState?.(input.run, input.terminalState)
  );
  if (!firstHookError && terminalObserverError) {
    firstHookError = terminalObserverError;
  }

  const terminalControlError = await captureHookError(() =>
    input.terminalState.status === "cancelled"
      ? input.adapter.cancelRun?.(input.run, input.terminalState)
      : input.adapter.finalizeRun?.(input.run, input.terminalState)
  );

  if (firstHookError) {
    throw firstHookError;
  }

  if (terminalControlError) {
    throw terminalControlError;
  }
}

/** Run hosted lifecycle. */
export async function runHostedLifecycle<TRun, TChunk>(
  options: HostedLifecycleRunnerOptions<TRun, TChunk>,
): Promise<HostedLifecycleRunResult<TRun>> {
  const run = await options.adapter.startRun({ abortSignal: options.abortSignal });

  try {
    for await (const chunk of options.execution.stream) {
      await options.adapter.appendEvents?.(run, chunk);
      await options.adapter.persistTranscriptChunk?.(run, chunk);
    }

    await options.execution.waitForFinish();
  } catch (error) {
    const terminalState = options.resolveErrorTerminalState
      ? await options.resolveErrorTerminalState(error)
      : defaultErrorTerminalState(options.abortSignal, error);

    await runTerminalHooks({
      run,
      terminalState,
      adapter: options.adapter,
    }).catch((terminalHookError) => {
      logger.debug("Hosted lifecycle terminal hooks failed while preserving execution error", {
        terminalStatus: terminalState.status,
        terminalErrorCode: terminalState.terminalErrorCode ?? null,
        terminalHookError,
      });
    });

    throw error;
  }

  const terminalState = await options.resolveTerminalState();
  await runTerminalHooks({
    run,
    terminalState,
    adapter: options.adapter,
  });

  return { run, terminalState };
}
