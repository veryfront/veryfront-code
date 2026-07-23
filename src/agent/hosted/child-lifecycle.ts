import {
  buildChildRunExecutionSnapshot,
  type ChildRunExecutionResult,
  type ChildRunExecutionSnapshot,
  getChildRunSnapshotUsage,
} from "../child-run/execution-snapshot.ts";
import { parseProviderError } from "../../chat/provider-errors.ts";
import { isChildRunAbortError } from "../child-run/execution-support.ts";
import {
  HostedChildTerminalStateError,
  isHostedChildTerminalErrorCode,
  resolveHostedChildTerminalErrorCode,
} from "./child-status.ts";

/** State for hosted child lifecycle terminal. */
export interface HostedChildLifecycleTerminalState {
  /** Status. */
  status: "completed" | "failed" | "cancelled";
  /** Usage value. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  /** Terminal error code value. */
  terminalErrorCode?: string | null;
  /** Terminal error message value. */
  terminalErrorMessage?: string | null;
}

/** Completed terminal state for hosted child execution. */
export interface HostedChildLifecycleCompletedState
  extends Omit<HostedChildLifecycleTerminalState, "status"> {
  /** Completed status discriminator. */
  status: "completed";
}

/** Public API contract for hosted child lifecycle adapter. */
export interface HostedChildLifecycleAdapter {
  /** Callback that handles pending. */
  pending?: () => Promise<void> | void;
  /** Callback that handles running. */
  running?: () => Promise<void> | void;
  /** Completed value. */
  completed?: (
    terminalState: HostedChildLifecycleTerminalState,
  ) => Promise<void> | void;
  /** Failed value. */
  failed?: (
    terminalState: HostedChildLifecycleTerminalState,
  ) => Promise<void> | void;
  /** Whether cancelled. */
  cancelled?: (
    terminalState: HostedChildLifecycleTerminalState,
  ) => Promise<void> | void;
}

/** Failed or cancelled terminal state for hosted child execution. */
export interface HostedChildLifecycleErrorState
  extends Omit<HostedChildLifecycleTerminalState, "status"> {
  /** Error status discriminator. */
  status: "failed" | "cancelled";
}

/** Options accepted by hosted child lifecycle runner. */
export interface HostedChildLifecycleRunnerOptions<TResult> {
  /** Adapter value. */
  adapter: HostedChildLifecycleAdapter;
  /** Callback that handles execute. */
  execute: () => Promise<TResult> | TResult;
  /** Resolve completed state value. */
  resolveCompletedState?: (
    result: TResult,
  ) =>
    | Promise<HostedChildLifecycleCompletedState>
    | HostedChildLifecycleCompletedState;
  /** Resolve error state value. */
  resolveErrorState: (
    error: unknown,
  ) =>
    | Promise<HostedChildLifecycleErrorState>
    | HostedChildLifecycleErrorState;
  /** Callback invoked when lifecycle error. */
  onLifecycleError?: (error: unknown) => Promise<void> | void;
}

/** Result returned from hosted child lifecycle run. */
export type HostedChildLifecycleRunResult<TResult> =
  | {
    status: "completed";
    result: TResult;
    terminalState: HostedChildLifecycleTerminalState;
  }
  | {
    status: "failed" | "cancelled";
    error: unknown;
    terminalState: HostedChildLifecycleTerminalState;
  };

/** Result returned from hosted child execution lifecycle. */
export type HostedChildExecutionLifecycleResult<
  TLocalResult extends ChildRunExecutionResult,
> =
  | {
    status: "completed";
    result: TLocalResult;
    snapshot: ChildRunExecutionSnapshot;
    terminalState: HostedChildLifecycleTerminalState;
  }
  | {
    status: "failed" | "cancelled";
    error: unknown;
    terminalState: HostedChildLifecycleTerminalState;
  };

/** Should skip hosted child terminal persistence helper. */
export function shouldSkipHostedChildTerminalPersistence(
  terminalState: Pick<HostedChildLifecycleTerminalState, "terminalErrorCode">,
): boolean {
  return isHostedChildTerminalErrorCode(terminalState.terminalErrorCode);
}

/** Options accepted by hosted child execution lifecycle. */
export interface HostedChildExecutionLifecycleOptions<
  TLocalResult extends ChildRunExecutionResult,
> {
  /** Adapter value. */
  adapter: HostedChildLifecycleAdapter;
  /** Execution failed code value. */
  executionFailedCode: string;
  /** Abort signal value. */
  abortSignal?: AbortSignal | undefined;
  /** Callback that handles execute. */
  execute: () => Promise<TLocalResult> | TLocalResult;
  /** Callback that handles get execution snapshot. */
  getExecutionSnapshot: () => ChildRunExecutionSnapshot | null;
  /** Callback invoked when lifecycle error. */
  onLifecycleError?: (error: unknown) => Promise<void> | void;
  /** Callback that handles skip terminal persistence. */
  skipTerminalPersistence?: (terminalState: HostedChildLifecycleTerminalState) => boolean;
}

class HostedChildExecutionFailure extends Error {
  constructor(
    message: string,
    readonly usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
  ) {
    super(message);
    this.name = "HostedChildExecutionFailure";
  }
}

function resolveKnownProviderTerminalError(error: unknown): {
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

async function dispatchTerminalState(
  adapter: HostedChildLifecycleAdapter,
  terminalState: HostedChildLifecycleTerminalState,
): Promise<void> {
  if (terminalState.status === "cancelled") {
    await adapter.cancelled?.(terminalState);
    return;
  }

  if (terminalState.status === "failed") {
    await adapter.failed?.(terminalState);
    return;
  }

  await adapter.completed?.(terminalState);
}

/** Run hosted child lifecycle. */
export async function runHostedChildLifecycle<TResult>(
  options: HostedChildLifecycleRunnerOptions<TResult>,
): Promise<HostedChildLifecycleRunResult<TResult>> {
  await options.adapter.pending?.();
  await options.adapter.running?.();

  let result: TResult;
  try {
    result = await options.execute();
  } catch (error) {
    const terminalState = await options.resolveErrorState(error);

    try {
      await dispatchTerminalState(options.adapter, terminalState);
    } catch (lifecycleError) {
      if (options.onLifecycleError) {
        await options.onLifecycleError(lifecycleError);
      } else {
        throw lifecycleError;
      }
    }

    return {
      status: terminalState.status,
      error,
      terminalState,
    };
  }

  const terminalState = options.resolveCompletedState
    ? await options.resolveCompletedState(result)
    : { status: "completed" as const };

  await dispatchTerminalState(options.adapter, terminalState);

  return {
    status: "completed",
    result,
    terminalState,
  };
}

function toHostedChildLifecycleUsage(
  usage: ChildRunExecutionSnapshot["usage"] | undefined,
): HostedChildLifecycleTerminalState["usage"] {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function wrapSkippableTerminalPersistence(
  adapter: HostedChildLifecycleAdapter,
  skipTerminalPersistence: HostedChildExecutionLifecycleOptions<
    ChildRunExecutionResult
  >["skipTerminalPersistence"],
): HostedChildLifecycleAdapter {
  if (!skipTerminalPersistence) {
    return adapter;
  }

  return {
    ...adapter,
    failed: async (terminalState) => {
      if (skipTerminalPersistence(terminalState)) {
        return;
      }

      await adapter.failed?.(terminalState);
    },
    cancelled: async (terminalState) => {
      if (skipTerminalPersistence(terminalState)) {
        return;
      }

      await adapter.cancelled?.(terminalState);
    },
  };
}

function resolveHostedChildExecutionErrorState(
  error: unknown,
  input: {
    executionFailedCode: string;
    abortSignal?: AbortSignal | undefined;
    getExecutionSnapshot: () => ChildRunExecutionSnapshot | null;
  },
): HostedChildLifecycleErrorState {
  if (error instanceof HostedChildTerminalStateError) {
    if (error.status === "completed") {
      throw error;
    }

    return {
      status: error.status,
      terminalErrorCode: resolveHostedChildTerminalErrorCode(error.status),
      terminalErrorMessage: error.message,
    };
  }

  if (error instanceof HostedChildExecutionFailure) {
    const providerError = resolveKnownProviderTerminalError(error);
    return {
      status: "failed",
      terminalErrorCode: providerError?.code ?? input.executionFailedCode,
      terminalErrorMessage: providerError?.message ?? error.message,
      usage: toHostedChildLifecycleUsage(error.usage),
    };
  }

  if (isChildRunAbortError(error) || input.abortSignal?.aborted) {
    return {
      status: "cancelled",
      terminalErrorCode: "CANCELLED",
      terminalErrorMessage: "Child run cancelled",
      usage: toHostedChildLifecycleUsage(getChildRunSnapshotUsage(input.getExecutionSnapshot())),
    };
  }

  return {
    status: "failed",
    terminalErrorCode: input.executionFailedCode,
    terminalErrorMessage: error instanceof Error ? error.message : String(error),
    usage: toHostedChildLifecycleUsage(getChildRunSnapshotUsage(input.getExecutionSnapshot())),
  };
}

/** Run hosted child execution lifecycle. */
export async function runHostedChildExecutionLifecycle<
  TLocalResult extends ChildRunExecutionResult,
>(
  options: HostedChildExecutionLifecycleOptions<TLocalResult>,
): Promise<HostedChildExecutionLifecycleResult<TLocalResult>> {
  const adapter = wrapSkippableTerminalPersistence(
    options.adapter,
    options.skipTerminalPersistence,
  );

  try {
    const lifecycleResult = await runHostedChildLifecycle({
      adapter,
      execute: async () => {
        const result = await options.execute();
        const snapshot = options.getExecutionSnapshot() ?? buildChildRunExecutionSnapshot(result);

        if (!snapshot.success) {
          throw new HostedChildExecutionFailure(snapshot.error ?? "Unknown error", snapshot.usage);
        }

        return {
          result,
          snapshot,
        };
      },
      resolveCompletedState: ({ snapshot }) => ({
        status: "completed",
        usage: toHostedChildLifecycleUsage(snapshot.usage),
      }),
      resolveErrorState: (error) =>
        resolveHostedChildExecutionErrorState(error, {
          executionFailedCode: options.executionFailedCode,
          abortSignal: options.abortSignal,
          getExecutionSnapshot: options.getExecutionSnapshot,
        }),
      onLifecycleError: options.onLifecycleError,
    });

    if (lifecycleResult.status !== "completed") {
      return lifecycleResult;
    }

    return {
      status: "completed",
      result: lifecycleResult.result.result,
      snapshot: lifecycleResult.result.snapshot,
      terminalState: lifecycleResult.terminalState,
    };
  } catch (error) {
    if (error instanceof HostedChildTerminalStateError) {
      return {
        status: error.status === "cancelled" ? "cancelled" : "failed",
        error,
        terminalState: {
          status: error.status,
          terminalErrorCode: resolveHostedChildTerminalErrorCode(error.status),
          terminalErrorMessage: error.message,
        },
      };
    }

    const terminalState = resolveHostedChildExecutionErrorState(error, {
      executionFailedCode: options.executionFailedCode,
      abortSignal: options.abortSignal,
      getExecutionSnapshot: options.getExecutionSnapshot,
    });

    try {
      await dispatchTerminalState(adapter, terminalState);
    } catch (lifecycleError) {
      await options.onLifecycleError?.(lifecycleError);
    }

    return {
      status: terminalState.status,
      error,
      terminalState,
    };
  }
}
