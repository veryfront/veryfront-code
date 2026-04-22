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
