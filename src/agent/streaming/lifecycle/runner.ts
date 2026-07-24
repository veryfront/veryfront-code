import {
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
} from "#veryfront/agent/streaming/stream-outcome.ts";
import { createCancellationCoordinator } from "./cancellation.ts";
import {
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
  StreamCommittedToolCall,
  StreamLifecycleError,
  StreamLifecycleFrame,
  StreamLifecycleInput,
  StreamLifecycleRun,
  StreamOutcome,
  StreamProviderError,
  StreamSnapshot,
  StreamTelemetryEvent,
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
    const disposeController = new AbortController();
    const attemptDeadlineMs = policy.clock.nowMs() + policy.attemptTimeoutMs;
    const deadlines = createStreamDeadlineController({
      clock: policy.clock,
      policy,
      attemptDeadlineMs,
      disposeSignal: disposeController.signal,
    });
    const settleAttemptTimeout = () => {
      if (outcome.settled) return;
      const failed = createFailedOutcome(reducer.snapshot, policy.clock.nowMs(), {
        code: "STREAM_ATTEMPT_TIMEOUT",
        source: "runtime",
        retryable: true,
        publicMessage: "Stream attempt exceeded its time limit",
      });
      reducer = { ...reducer, terminal: true, snapshot: failed.snapshot };
      outcome.settle(failed);
      activeCancellation.abortProvider(
        new DOMException("Stream attempt timed out", "AbortError"),
      );
      cleanup();
    };
    void policy.clock.waitUntil(attemptDeadlineMs, disposeController.signal)
      .then((result) => {
        if (result === "deadline") settleAttemptTimeout();
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
            yield frame;
            if (outcome.settled) return;
          }
          continue;
        }
        if (raced.kind === "provider_deadline") {
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
              settleReducerTerminal(outcome, reducer, policy.clock.nowMs());
            } else {
              const failed = createFailedOutcome(
                reducer.snapshot,
                policy.clock.nowMs(),
                {
                  code: resolved.code,
                  source: "tool",
                  retryable: false,
                  publicMessage: resolved.code === "TOOL_INPUT_TIMEOUT"
                    ? "Tool input did not arrive before the deadline"
                    : "Tool input ended before a valid object was complete",
                },
              );
              reducer = { ...reducer, terminal: true, snapshot: failed.snapshot };
              outcome.settle(failed);
            }
            for (const frame of resolved.reduction.frames) yield frame;
          } else {
            const code = raced.deadline === "first_progress"
              ? "FIRST_PROGRESS_TIMEOUT" as const
              : "SEMANTIC_IDLE_TIMEOUT" as const;
            const failed = createFailedOutcome(
              reducer.snapshot,
              policy.clock.nowMs(),
              {
                code,
                source: "provider",
                retryable: true,
                publicMessage: code === "FIRST_PROGRESS_TIMEOUT"
                  ? "Provider did not produce semantic progress"
                  : "Provider stopped producing semantic progress",
              },
            );
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
            policy.clock.nowMs(),
          );
          return;
        }

        pendingRead = null;
        const next = raced.result;
        if (next.done) {
          settleProviderEnd(outcome, reducer, policy.clock.nowMs());
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
          if (reduced.semanticProgress) {
            deadlines.noteSemanticProgress(reducer.snapshot);
          }
          const terminalCommitted = reducer.terminal;
          if (terminalCommitted) {
            settleReducerTerminal(outcome, reducer, policy.clock.nowMs());
          }
          for (const frame of reduced.frames) {
            if (!terminalCommitted && outcome.settled) return;
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
