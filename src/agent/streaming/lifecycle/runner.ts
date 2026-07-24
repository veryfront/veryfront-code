import { resolveStreamOutcome } from "#veryfront/agent/streaming/stream-outcome.ts";
import { createCancellationCoordinator } from "./cancellation.ts";
import {
  createAbsoluteDeadline,
  createClockDeadlineTimer,
  createStreamDeadlineController,
  type TrackedProviderRead,
  trackProviderRead,
} from "./deadlines.ts";
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
  resolveLocalToolDeadline,
  type StreamReducerState,
} from "./reducer.ts";
import type {
  StreamCancellationSource,
  StreamLifecycleFrame,
  StreamLifecycleInput,
  StreamLifecycleRun,
  StreamOutcome,
  StreamProviderError,
  StreamTelemetryEvent,
} from "./types.ts";

export function runStreamLifecycle<TProviderPart>(
  input: StreamLifecycleInput<TProviderPart>,
): StreamLifecycleRun {
  const policy = resolveStreamLifecyclePolicy(input.policy);
  const diagnostics = input.diagnostics ?? createDefaultDiagnosticPolicy();
  const diagnosticSink = input.diagnosticSink ?? createDefaultDiagnosticSink();
  const observer = input.observer ?? null;
  const notifyObserver = (notify: () => void): void => {
    if (!observer) return;
    try {
      notify();
    } catch {
      // Observability is fail-open and cannot alter lifecycle behavior.
    }
  };
  const outcome = createOutcomeDeferred((settledOutcome) =>
    notifyObserver(() => observer?.onOutcome(settledOutcome))
  );
  let consumed = false;
  let providerIterator: AsyncIterator<TProviderPart> | null = null;
  let cancellation:
    | ReturnType<typeof createCancellationCoordinator>
    | null = null;
  let reducer = createInitialReducerState();
  let cleanupRequested = false;
  let attemptStartMs: number | null = null;
  const elapsedMs = (): number => {
    if (attemptStartMs === null) return 0;
    return Math.max(0, policy.clock.nowMs() - attemptStartMs);
  };

  const settleCancelled = (source: StreamCancellationSource) => {
    if (outcome.settled) return;
    const snapshot = reducer.snapshot;
    reducer = terminateReducer(reducer, "cancelled");
    outcome.settle(resolveStreamOutcome({
      snapshot,
      elapsedMs: elapsedMs(),
      cancellation: source,
    }));
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
    attemptStartMs = policy.clock.nowMs();
    const activeCancellation = createCancellationCoordinator(
      input.cancellations ?? [],
      settleCancelled,
    );
    cancellation = activeCancellation;
    const disposeController = new AbortController();
    const attemptDeadlineMs = attemptStartMs + policy.attemptTimeoutMs;
    let lastProgressMs: number | null = null;
    const deadlines = createStreamDeadlineController({
      clock: policy.clock,
      policy,
      attemptDeadlineMs,
      disposeSignal: disposeController.signal,
    });
    const settleAttemptTimeout = () => {
      if (outcome.settled) return;
      notifyObserver(() => observer?.onDeadline("attempt"));
      const failed = resolveStreamOutcome({
        snapshot: reducer.snapshot,
        elapsedMs: elapsedMs(),
        lifecycleError: {
          code: "STREAM_ATTEMPT_TIMEOUT",
          phase: reducer.snapshot.phase,
          source: "runtime",
          retryable: true,
          publicMessage: "Stream attempt exceeded its time limit",
        },
      });
      reducer = { ...reducer, terminal: true, snapshot: failed.snapshot };
      outcome.settle(failed);
      activeCancellation.abortProvider(
        new DOMException("Stream attempt timed out", "AbortError"),
      );
      cleanup();
    };
    const attemptDeadline = createAbsoluteDeadline({
      timer: createClockDeadlineTimer(policy.clock),
      delayMs: policy.attemptTimeoutMs,
      onDeadline: settleAttemptTimeout,
    });
    try {
      if (activeCancellation.source) return;
      providerIterator = input.provider.open(activeCancellation.signal)
        [Symbol.asyncIterator]();
      let pendingRead: TrackedProviderRead<TProviderPart> | null = null;
      while (!outcome.settled) {
        pendingRead ??= trackProviderRead(
          providerIterator.next(),
          policy.clock,
        );
        deadlines.resumeProviderWait(reducer.snapshot);
        const raced = await deadlines.raceProviderRead(
          pendingRead,
          activeCancellation.signal,
        );
        deadlines.pauseProviderWait();

        if (raced.kind === "status") {
          for (const toolCallId of raced.toolCallIds) {
            if (outcome.settled) return;
            const tool = reducer.snapshot.tools.find((entry) => entry.id === toolCallId);
            if (
              !tool ||
              (tool.phase !== "input_open" && tool.phase !== "input_streaming")
            ) {
              continue;
            }
            const frame = sequenceTelemetry(reducer, {
              type: "tool_input_status",
              toolCallId,
              status: tool.phase === "input_streaming" ? "streaming_input" : "pending_input",
            }, policy.clock.nowMs());
            notifyObserver(() => observer?.onFrame(frame));
            yield frame;
            if (outcome.settled) return;
          }
          continue;
        }
        if (raced.kind === "provider_deadline") {
          notifyObserver(() => observer?.onDeadline(raced.deadline));
          if (
            raced.deadline === "tool_input_idle" ||
            raced.deadline === "tool_commit_grace"
          ) {
            const resolved = resolveLocalToolDeadline(
              reducer,
              raced.deadline,
              policy.clock.nowMs(),
            );
            reducer = resolved.reduction.state;
            if (resolved.kind === "handoff") {
              settleReducerTerminal(outcome, reducer, elapsedMs());
            } else {
              const failed = resolveStreamOutcome({
                snapshot: reducer.snapshot,
                elapsedMs: elapsedMs(),
                lifecycleError: {
                  code: resolved.code,
                  phase: reducer.snapshot.phase,
                  source: "tool",
                  retryable: false,
                  publicMessage: resolved.code === "TOOL_INPUT_TIMEOUT"
                    ? "Tool input did not arrive before the deadline"
                    : "Tool input ended before a valid object was complete",
                },
              });
              reducer = { ...reducer, terminal: true, snapshot: failed.snapshot };
              outcome.settle(failed);
            }
            for (const frame of resolved.reduction.frames) {
              notifyObserver(() => observer?.onFrame(frame));
              yield frame;
            }
          } else {
            const code = raced.deadline === "first_progress"
              ? "FIRST_PROGRESS_TIMEOUT" as const
              : "SEMANTIC_IDLE_TIMEOUT" as const;
            const failed = resolveStreamOutcome({
              snapshot: reducer.snapshot,
              elapsedMs: elapsedMs(),
              lifecycleError: {
                code,
                phase: reducer.snapshot.phase,
                source: "provider",
                retryable: true,
                publicMessage: code === "FIRST_PROGRESS_TIMEOUT"
                  ? "Provider did not produce semantic progress"
                  : "Provider stopped producing semantic progress",
              },
            });
            reducer = { ...reducer, terminal: true, snapshot: failed.snapshot };
            outcome.settle(failed);
          }
          activeCancellation.abortProvider(
            new DOMException("Stream provider deadline reached", "AbortError"),
          );
          cleanup();
          return;
        }
        if (raced.kind === "attempt_timeout") {
          settleAttemptTimeout();
          return;
        }
        if (raced.kind === "cancelled") return;
        if (raced.kind === "read_error") {
          settleProviderFailure(
            outcome,
            reducer,
            raced.error,
            input.provider.classifyError(raced.error, reducer.snapshot),
            elapsedMs(),
          );
          return;
        }

        pendingRead = null;
        const next = raced.result;
        if (next.done) {
          if (reducer.terminal) {
            settleReducerTerminal(outcome, reducer, elapsedMs());
          } else {
            outcome.settle(resolveStreamOutcome({
              snapshot: reducer.snapshot,
              elapsedMs: elapsedMs(),
            }));
          }
          return;
        }
        for (const signal of input.provider.decode(next.value, reducer.snapshot)) {
          if (signal.kind === "diagnostic_candidate") {
            const safe = acceptDiagnosticCandidate(diagnostics, signal.candidate);
            if (safe) {
              if (outcome.settled) return;
              const frame = sequenceDiagnostic(
                reducer,
                { type: "provider_diagnostic", event: safe },
                policy.clock.nowMs(),
              );
              if (outcome.settled) return;
              notifyObserver(() => observer?.onFrame(frame));
              yield frame;
              if (outcome.settled) return;
            }
            continue;
          }
          if (signal.kind === "provider_error") {
            settleProviderFailure(
              outcome,
              reducer,
              undefined,
              signal.error,
              elapsedMs(),
            );
            return;
          }
          const reduced = reduceStreamSignal(
            reducer,
            signal,
            policy.clock.nowMs(),
          );
          reducer = reduced.state;
          if (reduced.semanticProgress) {
            deadlines.noteSemanticProgress(reducer.snapshot);
            const progressAtMs = policy.clock.nowMs();
            const sincePreviousProgressMs = lastProgressMs === null
              ? null
              : progressAtMs - lastProgressMs;
            lastProgressMs = progressAtMs;
            const progressPhase = reducer.snapshot.phase;
            notifyObserver(() =>
              observer?.onSemanticProgress({
                elapsedMs: progressAtMs - (attemptStartMs ?? progressAtMs),
                sincePreviousProgressMs,
                phase: progressPhase,
              })
            );
          }
          const terminalCommitted = reducer.terminal;
          if (terminalCommitted) {
            settleReducerTerminal(outcome, reducer, elapsedMs());
          }
          for (const frame of reduced.frames) {
            if (!terminalCommitted && outcome.settled) return;
            notifyObserver(() => observer?.onFrame(frame));
            yield frame;
            if (!terminalCommitted && outcome.settled) return;
          }
          if (reducer.terminal) return;
        }
      }
    } finally {
      if (!outcome.settled) settleCancelled("consumer_stopped");
      cleanup();
      deadlines.dispose();
      attemptDeadline.dispose();
      disposeController.abort();
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

function createOutcomeDeferred(
  onSettle?: (outcome: StreamOutcome) => void,
): OutcomeDeferred {
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
      onSettle?.(outcome);
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

function settleProviderFailure(
  outcome: OutcomeDeferred,
  reducer: StreamReducerState,
  thrownError: unknown,
  providerError: StreamProviderError,
  elapsedMs: number,
): void {
  outcome.settle(resolveStreamOutcome({
    snapshot: reducer.snapshot,
    elapsedMs,
    ...(thrownError !== undefined ? { thrownError } : {}),
    providerError,
  }));
}

function settleReducerTerminal(
  outcome: OutcomeDeferred,
  reducer: StreamReducerState,
  elapsedMs: number,
): void {
  outcome.settle(resolveStreamOutcome({
    snapshot: reducer.snapshot,
    elapsedMs,
    ...(reducer.terminalError ? { lifecycleError: reducer.terminalError } : {}),
  }));
}

function sequenceTelemetry(
  reducer: StreamReducerState,
  event: StreamTelemetryEvent,
  elapsedMs: number,
): StreamLifecycleFrame {
  return {
    class: "telemetry",
    event,
    sequence: ++reducer.sequence,
    elapsedMs,
  };
}

function sequenceDiagnostic(
  reducer: StreamReducerState,
  event: Extract<StreamLifecycleFrame, { class: "diagnostic" }>["event"],
  elapsedMs: number,
): StreamLifecycleFrame {
  return { class: "diagnostic", event, sequence: ++reducer.sequence, elapsedMs };
}
