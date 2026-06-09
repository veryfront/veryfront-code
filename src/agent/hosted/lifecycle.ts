import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("hosted-lifecycle");

/** State for hosted lifecycle terminal. */
export interface HostedLifecycleTerminalState {
  status: "completed" | "failed" | "cancelled";
  metadata?: {
    modelId?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
    };
  };
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

/** Public API contract for hosted lifecycle execution. */
export interface HostedLifecycleExecution<TChunk> {
  stream: AsyncIterable<TChunk>;
  waitForFinish: () => Promise<void>;
}

/** Public API contract for hosted lifecycle adapter. */
export interface HostedLifecycleAdapter<TRun, TChunk> {
  startRun: (input: { abortSignal: AbortSignal }) => Promise<TRun> | TRun;
  appendEvents?: (run: TRun, chunk: TChunk) => Promise<void> | void;
  persistTranscriptChunk?: (run: TRun, chunk: TChunk) => Promise<void> | void;
  persistTranscriptTerminalState?: (
    run: TRun,
    terminalState: HostedLifecycleTerminalState,
  ) => Promise<void> | void;
  onTerminalState?: (
    run: TRun,
    terminalState: HostedLifecycleTerminalState,
  ) => Promise<void> | void;
  finalizeRun?: (run: TRun, terminalState: HostedLifecycleTerminalState) => Promise<void> | void;
  cancelRun?: (run: TRun, terminalState: HostedLifecycleTerminalState) => Promise<void> | void;
}

/** Options accepted by hosted lifecycle runner. */
export interface HostedLifecycleRunnerOptions<TRun, TChunk> {
  abortSignal: AbortSignal;
  execution: HostedLifecycleExecution<TChunk>;
  adapter: HostedLifecycleAdapter<TRun, TChunk>;
  resolveTerminalState: () => Promise<HostedLifecycleTerminalState> | HostedLifecycleTerminalState;
  resolveErrorTerminalState?: (
    error: unknown,
  ) => Promise<HostedLifecycleTerminalState> | HostedLifecycleTerminalState;
}

/** Result returned from hosted lifecycle run. */
export interface HostedLifecycleRunResult<TRun> {
  run: TRun;
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
