import {
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
} from "#veryfront/agent/streaming/stream-outcome.ts";
import { createCancellationCoordinator } from "./cancellation.ts";
import {
  acceptDiagnosticCandidate,
  createDefaultDiagnosticPolicy,
  createDefaultDiagnosticSink,
  reportLifecycleDiagnostic,
} from "./diagnostics.ts";
import { StreamAlreadyConsumedError } from "./errors.ts";
import { resolveStreamLifecyclePolicy } from "./policy.ts";
import {
  createInitialReducerState,
  reduceStreamSignal,
  type StreamReducerState,
} from "./reducer.ts";
import type {
  StreamCancellationSource,
  StreamCommittedToolCall,
  StreamLifecycleError,
  StreamLifecycleFrame,
  StreamLifecycleInput,
  StreamLifecycleRun,
  StreamOutcome,
  StreamProviderError,
  StreamSnapshot,
} from "./types.ts";

export function runStreamLifecycle<TProviderPart>(
  input: StreamLifecycleInput<TProviderPart>,
): StreamLifecycleRun {
  const policy = resolveStreamLifecyclePolicy(input.policy);
  const diagnostics = input.diagnostics ?? createDefaultDiagnosticPolicy();
  const diagnosticSink = input.diagnosticSink ?? createDefaultDiagnosticSink();
  const outcome = createOutcomeDeferred();
  let consumed = false;
  let providerIterator: AsyncIterator<TProviderPart> | null = null;
  let cancellation:
    | ReturnType<typeof createCancellationCoordinator>
    | null = null;
  let reducer = createInitialReducerState();
  let cleanupRequested = false;

  const settleCancelled = (source: StreamCancellationSource) => {
    if (outcome.settled) return;
    reducer = terminateReducer(reducer, "cancelled");
    outcome.settle(
      createCancelledOutcome(reducer.snapshot, source, policy.clock.nowMs()),
    );
  };
  const cleanup = () => {
    if (cleanupRequested) return;
    cleanupRequested = true;
    const result = providerIterator?.return?.();
    void Promise.resolve(result).catch(() => {
      reportLifecycleDiagnostic(diagnosticSink, {
        type: "provider_cleanup_failed",
      });
    });
  };

  const consume = async function* (): AsyncGenerator<StreamLifecycleFrame> {
    const activeCancellation = createCancellationCoordinator(
      input.cancellations ?? [],
      settleCancelled,
    );
    cancellation = activeCancellation;
    try {
      if (activeCancellation.source) return;
      providerIterator = input.provider.open(activeCancellation.signal)
        [Symbol.asyncIterator]();
      while (!outcome.settled) {
        let next: IteratorResult<TProviderPart>;
        try {
          next = await providerIterator.next();
        } catch (error) {
          settleProviderFailure(
            outcome,
            reducer,
            error,
            input.provider.classifyError(error, reducer.snapshot),
            policy.clock.nowMs(),
          );
          return;
        }
        if (next.done) {
          settleProviderEnd(outcome, reducer, policy.clock.nowMs());
          return;
        }
        for (const signal of input.provider.decode(next.value, reducer.snapshot)) {
          if (signal.kind === "diagnostic_candidate") {
            const safe = acceptDiagnosticCandidate(diagnostics, signal.candidate);
            if (safe) {
              yield sequenceDiagnostic(
                reducer,
                { type: "provider_diagnostic", event: safe },
                policy.clock.nowMs(),
              );
            }
            continue;
          }
          if (signal.kind === "provider_error") {
            settleProviderFailure(
              outcome,
              reducer,
              undefined,
              signal.error,
              policy.clock.nowMs(),
            );
            return;
          }
          const reduced = reduceStreamSignal(
            reducer,
            signal,
            policy.clock.nowMs(),
          );
          reducer = reduced.state;
          if (reducer.terminal) {
            settleReducerTerminal(outcome, reducer, policy.clock.nowMs());
          }
          for (const frame of reduced.frames) yield frame;
          if (reducer.terminal) return;
        }
      }
    } finally {
      if (!outcome.settled) settleCancelled("consumer_stopped");
      cleanup();
      activeCancellation.dispose();
    }
  };

  let iterator: AsyncGenerator<StreamLifecycleFrame> | null = null;
  const frames: AsyncIterable<StreamLifecycleFrame> = {
    [Symbol.asyncIterator]() {
      if (consumed) throw new StreamAlreadyConsumedError();
      consumed = true;
      iterator = consume();
      return {
        next: (value?: unknown) => iterator!.next(value),
        return: async () => {
          if (!outcome.settled) settleCancelled("consumer_stopped");
          cancellation?.stopConsumer();
          return await iterator!.return(undefined);
        },
        throw: async (error?: unknown) => {
          if (!outcome.settled) settleCancelled("consumer_stopped");
          cancellation?.stopConsumer();
          return await iterator!.throw(error);
        },
      };
    },
  };

  return { frames, outcome: outcome.promise };
}

interface OutcomeDeferred {
  readonly promise: Promise<StreamOutcome>;
  readonly settled: boolean;
  settle(outcome: StreamOutcome): void;
}

function createOutcomeDeferred(): OutcomeDeferred {
  let settled = false;
  let resolvePromise!: (outcome: StreamOutcome) => void;
  const promise = new Promise<StreamOutcome>((resolve) => resolvePromise = resolve);
  return {
    promise,
    get settled() {
      return settled;
    },
    settle(outcome) {
      if (settled) return;
      settled = true;
      resolvePromise(outcome);
    },
  };
}

function terminateReducer(
  reducer: StreamReducerState,
  phase: "failed" | "cancelled",
): StreamReducerState {
  return {
    ...reducer,
    terminal: true,
    snapshot: { ...reducer.snapshot, phase },
  };
}

function createCancelledOutcome(
  snapshot: StreamSnapshot,
  source: StreamCancellationSource,
  elapsedMs: number,
): StreamOutcome {
  const terminal = { ...snapshot, phase: "cancelled" as const };
  return {
    status: "cancelled",
    source,
    publicMessage: "Stream was cancelled",
    snapshot: terminal,
    usage: terminal.usage,
    elapsedMs,
    phase: terminal.phase,
  };
}

function createFailedOutcome(
  snapshot: StreamSnapshot,
  elapsedMs: number,
  error: Omit<StreamLifecycleError, "phase">,
): StreamOutcome {
  const failedFrom = snapshot.phase;
  const terminal = { ...snapshot, phase: "failed" as const };
  return {
    status: "failed",
    snapshot: terminal,
    usage: terminal.usage,
    elapsedMs,
    phase: terminal.phase,
    error: { ...error, phase: failedFrom },
  };
}

function settleProviderEnd(
  outcome: OutcomeDeferred,
  reducer: StreamReducerState,
  elapsedMs: number,
): void {
  if (reducer.terminal) {
    settleReducerTerminal(outcome, reducer, elapsedMs);
    return;
  }
  outcome.settle(createFailedOutcome(reducer.snapshot, elapsedMs, {
    code: "PROVIDER_STREAM_ERROR",
    source: "provider",
    retryable: true,
    publicMessage: "Provider stream ended before completion",
  }));
}

function settleProviderFailure(
  outcome: OutcomeDeferred,
  reducer: StreamReducerState,
  thrownError: unknown,
  providerError: StreamProviderError,
  elapsedMs: number,
): void {
  if (
    thrownError !== undefined &&
    reducer.snapshot.hasStreamOutput &&
    hasCompletedStepSignal(reducer.snapshot.finishReason) &&
    isLateProviderBodyReadError(thrownError)
  ) {
    settleReducerTerminal(outcome, reducer, elapsedMs);
    return;
  }
  outcome.settle(createFailedOutcome(reducer.snapshot, elapsedMs, {
    code: providerError.terminal ? "PROVIDER_TERMINAL_ERROR" : "PROVIDER_STREAM_ERROR",
    source: "provider",
    retryable: providerError.retryable,
    publicMessage: providerError.publicMessage,
    ...(providerError.code ? { providerCode: providerError.code } : {}),
    ...(providerError.diagnosticId ? { diagnosticId: providerError.diagnosticId } : {}),
  }));
}

function collectCommittedLocalToolCalls(
  snapshot: Readonly<StreamSnapshot>,
): StreamCommittedToolCall[] {
  return snapshot.tools
    .filter((tool) => tool.phase === "input_ready" && tool.providerExecuted !== true)
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      arguments: tool.inputText,
      inputDeltas: [...tool.inputDeltas],
      inputAnnounced: true,
      inputAvailable: true,
      providerExecuted: false,
      ...(tool.dynamic ? { dynamic: true } : {}),
    }));
}

function settleReducerTerminal(
  outcome: OutcomeDeferred,
  reducer: StreamReducerState,
  elapsedMs: number,
): void {
  const snapshot = reducer.snapshot;
  if (snapshot.phase === "failed" && reducer.terminalError) {
    outcome.settle({
      status: "failed",
      error: reducer.terminalError,
      snapshot,
      usage: snapshot.usage,
      elapsedMs,
      phase: snapshot.phase,
    });
    return;
  }
  if (snapshot.phase === "tool_handoff") {
    outcome.settle({
      status: "tool_handoff",
      finishReason: "tool-calls",
      toolCalls: collectCommittedLocalToolCalls(snapshot),
      snapshot,
      usage: snapshot.usage,
      elapsedMs,
      phase: snapshot.phase,
    });
    return;
  }
  if (
    snapshot.phase === "completed" &&
    snapshot.finishReason !== null &&
    snapshot.finishReason !== "tool-calls"
  ) {
    outcome.settle({
      status: "completed",
      finishReason: snapshot.finishReason,
      snapshot,
      usage: snapshot.usage,
      elapsedMs,
      phase: snapshot.phase,
    });
    return;
  }
  outcome.settle(createFailedOutcome(snapshot, elapsedMs, {
    code: "PROTOCOL_VIOLATION",
    source: "runtime",
    retryable: false,
    publicMessage: "Provider stream ended in an invalid lifecycle state",
  }));
}

function sequenceDiagnostic(
  reducer: StreamReducerState,
  event: Extract<StreamLifecycleFrame, { class: "diagnostic" }>["event"],
  elapsedMs: number,
): StreamLifecycleFrame {
  return { class: "diagnostic", event, sequence: ++reducer.sequence, elapsedMs };
}
