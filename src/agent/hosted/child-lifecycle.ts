import {
  buildChildRunExecutionSnapshot,
  type ChildRunExecutionResult,
  type ChildRunExecutionSnapshot,
  getChildRunSnapshotUsage,
} from "../child-run/execution-snapshot.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils";
import { resolveKnownProviderTerminalError } from "../streaming/stream-outcome.ts";
import { isChildRunAbortError } from "../child-run/execution-support.ts";
import {
  HostedChildTerminalStateError,
  isHostedChildTerminalErrorCode,
  resolveHostedChildTerminalErrorCode,
} from "./child-status.ts";

/** State for hosted child lifecycle terminal. */
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

/** Public API contract for hosted child lifecycle adapter. */
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

/** Options accepted by hosted child lifecycle runner. */
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
    readonly terminalErrorCode?: string,
  ) {
    super(message);
    this.name = "HostedChildExecutionFailure";
  }
}

/**
 * Terminal error code for a child whose work finished but whose terminal state
 * could not be persisted. Distinct from an execution failure code on purpose:
 * the child produced its result, the run record did not survive it.
 */
export const HOSTED_CHILD_FINALIZATION_FAILED_CODE = "CHILD_FINALIZATION_FAILED";

function buildFinalizationFailureState(
  completedState: HostedChildLifecycleTerminalState,
  error: unknown,
): HostedChildLifecycleTerminalState {
  return {
    status: "failed",
    usage: completedState.usage,
    terminalErrorCode: HOSTED_CHILD_FINALIZATION_FAILED_CODE,
    terminalErrorMessage: error instanceof Error ? error.message : String(error),
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

  try {
    await dispatchTerminalState(options.adapter, terminalState);
  } catch (lifecycleError) {
    // Same guard the failure path above uses. Without a handler the error still
    // propagates, which is the long-standing contract for this function.
    if (!options.onLifecycleError) {
      throw lifecycleError;
    }

    try {
      await options.onLifecycleError(lifecycleError);
    } catch {
      // An observability callback must not change the outcome. Letting it throw
      // here would reach the outer catch, which relabels with executionFailedCode
      // and dispatches `failed` — the double dispatch this guard exists to stop.
      // Same reasoning as durable-child-fork-execution.ts:884-888.
    }

    // Deliberately not re-dispatched: the adapter has already rejected this
    // run's terminal state, so dispatching `failed` on top would write a second
    // terminal state. Reporting through the return value keeps a persistence
    // failure distinguishable from an execution failure, which the caller's
    // `executionFailedCode` would not.
    return {
      status: "failed",
      error: lifecycleError,
      terminalState: buildFinalizationFailureState(terminalState, lifecycleError),
    };
  }

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

const CANCELLED_TERMINAL_MESSAGE = "Child run cancelled";
/** An incidental cause on a cancelled run: enough to identify it, not the whole story. */
const MAX_CANCELLED_CAUSE_LENGTH = 200;
/**
 * A failed run's message is the primary explanation a user reads to find out why
 * their agent failed, so it keeps far more room than an incidental cause. Real
 * provider validation errors survive intact; only bulk payloads are cut.
 */
const MAX_FAILURE_MESSAGE_LENGTH = 4_000;

/**
 * Bound and sanitize error text on its way to a durable run record.
 *
 * `terminalErrorMessage` is persisted by `finalizeConversationAgentRun`, and
 * AGENTS.md:96-101 bars sensitive values in error messages — naming provider
 * response bodies and raw prompts explicitly. Credential-bearing URLs are
 * stripped and the text is cut to an excerpt, the same treatment
 * `sanitizeDiscoveryErrorMessage` applies to surfaced error text.
 *
 * Applied to every branch rather than only the ones known to carry external
 * text, so "everything written to terminalErrorMessage is sanitized and bounded"
 * holds as an invariant instead of a case-by-case argument.
 */
function boundTerminalErrorText(value: string, maxLength: number): string {
  const sanitized = sanitizeUrlCredentials(value);
  return sanitized.length <= maxLength ? sanitized : `${sanitized.slice(0, maxLength - 3)}...`;
}

/**
 * A run torn down mid-flight reports `cancelled`, but the error that surfaced is
 * not always the abort itself — an aborted signal makes any error in flight look
 * like a cancellation. Keep the cancelled status and append the real cause, so a
 * failure that merely coincided with teardown is still diagnosable.
 *
 * The cause reaches a durable run record, so it is sanitized and bounded before
 * it is carried: credential-bearing URLs are stripped, and a bulk payload such as
 * a provider response body is cut to an excerpt rather than persisted whole. Same
 * treatment `sanitizeDiscoveryErrorMessage` applies to surfaced error text.
 *
 * Only the code is contractual here; `shouldBlockHostedChildSameTurnRetry`
 * matches on `terminalErrorCode` precisely because the message is not.
 */
function resolveCancelledTerminalMessage(error: unknown): string {
  if (isChildRunAbortError(error)) {
    return CANCELLED_TERMINAL_MESSAGE;
  }

  const cause = boundTerminalErrorText(
    error instanceof Error ? error.message : String(error),
    MAX_CANCELLED_CAUSE_LENGTH,
  );
  return cause.length === 0
    ? CANCELLED_TERMINAL_MESSAGE
    : `${CANCELLED_TERMINAL_MESSAGE}: ${cause}`;
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
      terminalErrorMessage: boundTerminalErrorText(error.message, MAX_FAILURE_MESSAGE_LENGTH),
    };
  }

  if (error instanceof HostedChildExecutionFailure) {
    const providerError = error.terminalErrorCode === undefined
      ? resolveKnownProviderTerminalError(error)
      : null;
    return {
      status: "failed",
      terminalErrorCode: error.terminalErrorCode ?? providerError?.code ??
        input.executionFailedCode,
      terminalErrorMessage: boundTerminalErrorText(
        providerError?.message ?? error.message,
        MAX_FAILURE_MESSAGE_LENGTH,
      ),
      usage: toHostedChildLifecycleUsage(error.usage),
    };
  }

  if (isChildRunAbortError(error) || input.abortSignal?.aborted) {
    return {
      status: "cancelled",
      terminalErrorCode: "CANCELLED",
      terminalErrorMessage: resolveCancelledTerminalMessage(error),
      usage: toHostedChildLifecycleUsage(getChildRunSnapshotUsage(input.getExecutionSnapshot())),
    };
  }

  return {
    status: "failed",
    terminalErrorCode: input.executionFailedCode,
    terminalErrorMessage: boundTerminalErrorText(
      error instanceof Error ? error.message : String(error),
      MAX_FAILURE_MESSAGE_LENGTH,
    ),
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
          throw new HostedChildExecutionFailure(
            snapshot.error ?? "Unknown error",
            snapshot.usage,
            snapshot.terminalErrorCode,
          );
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
