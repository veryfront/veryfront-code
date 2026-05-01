import {
  buildChildRunExecutionSnapshot,
  type ChildRunExecutionResult,
  type ChildRunExecutionSnapshot,
  getChildRunSnapshotUsage,
} from "./child-run-execution-snapshot.ts";
import { isChildRunAbortError } from "./child-run-execution-support.ts";
import {
  HostedChildTerminalStateError,
  resolveHostedChildTerminalErrorCode,
} from "./hosted-child-status.ts";

export interface HostedChildLifecycleTerminalState {
  status: "completed" | "failed" | "cancelled";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

export interface HostedChildLifecycleCompletedState
  extends Omit<HostedChildLifecycleTerminalState, "status"> {
  status: "completed";
}

export interface HostedChildLifecycleAdapter {
  pending?: () => Promise<void> | void;
  running?: () => Promise<void> | void;
  completed?: (
    terminalState: HostedChildLifecycleTerminalState,
  ) => Promise<void> | void;
  failed?: (
    terminalState: HostedChildLifecycleTerminalState,
  ) => Promise<void> | void;
  cancelled?: (
    terminalState: HostedChildLifecycleTerminalState,
  ) => Promise<void> | void;
}

export interface HostedChildLifecycleErrorState
  extends Omit<HostedChildLifecycleTerminalState, "status"> {
  status: "failed" | "cancelled";
}

export interface HostedChildLifecycleRunnerOptions<TResult> {
  adapter: HostedChildLifecycleAdapter;
  execute: () => Promise<TResult> | TResult;
  resolveCompletedState?: (
    result: TResult,
  ) =>
    | Promise<HostedChildLifecycleCompletedState>
    | HostedChildLifecycleCompletedState;
  resolveErrorState: (
    error: unknown,
  ) =>
    | Promise<HostedChildLifecycleErrorState>
    | HostedChildLifecycleErrorState;
  onLifecycleError?: (error: unknown) => Promise<void> | void;
}

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

export interface HostedChildExecutionLifecycleOptions<
  TLocalResult extends ChildRunExecutionResult,
> {
  adapter: HostedChildLifecycleAdapter;
  executionFailedCode: string;
  abortSignal?: AbortSignal | undefined;
  execute: () => Promise<TLocalResult> | TLocalResult;
  getExecutionSnapshot: () => ChildRunExecutionSnapshot | null;
  onLifecycleError?: (error: unknown) => Promise<void> | void;
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
    return {
      status: "failed",
      terminalErrorCode: input.executionFailedCode,
      terminalErrorMessage: error.message,
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
