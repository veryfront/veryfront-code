# Enterprise Stream Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented provider-stream interpretation with one tested Stream Lifecycle module while preserving current public SSE, AG-UI, conversation-run, provider-loader, and watchdog interfaces.

**Architecture:** Add an internal deep module under `src/agent/streaming/lifecycle/`. It decodes the existing `RuntimeStreamPart` boundary into provider-neutral signals, reduces them into validated semantic, telemetry, and diagnostic frames, owns monotonic deadlines and one typed Stream Outcome, and feeds existing output formats through compatibility Adapters. Roll out through four separately mergeable gates: shadow comparison, runtime ownership, deadline consolidation, then versioned projection contracts. Production version 2 delivery remains off until the separate agent-loop Stream Delivery design is implemented end to end.

**Tech Stack:** Deno, TypeScript, async iterators, `AbortController`, existing Veryfront test helpers, and OpenTelemetry interfaces already in the repository.

## Global Constraints

- Add no dependency.
- Keep `processStream()`, `createChatStreamWatchdog()`, `withToolInputStatusTransitions()`, `ConversationRunEventEncoder`, and the AG-UI browser encoder exported throughout migration.
- Preserve current public SSE, AG-UI, and conversation-run event shapes unless a golden fixture explicitly approves a difference.
- Use the existing `RuntimeStreamPart` boundary for the first Provider Adapter. Raw OpenAI, Anthropic, and Google transport adapters are not part of this plan.
- Keep one provider read in flight. Shadow mode must never call `iterator.next()` or issue another provider request.
- Use one injected monotonic clock. Default budgets are 60,000 ms to first semantic progress, 15,000 ms semantic idle, 15,000 ms local tool-input idle, 250 ms local commit grace, 5,000 ms status cadence, and 300,000 ms absolute attempt time.
- Provider-wait budgets accrue only while awaiting a provider read. They pause while reducing a part or while the consumer holds any yielded frame. The absolute attempt budget and external cancellation never pause.
- The absolute attempt deadline wins ties and discards every provider part that has resolved but has not been reduced.
- Lifecycle status cadence comes from the lifecycle phase scheduler. The Live Adapter must not own a second status timer.
- A delivery failure remains the primary run-finalization error. A resulting `consumer_stopped` outcome is secondary cleanup evidence.
- Raw diagnostics are disabled by default. Redaction must run before any raw candidate becomes a diagnostic frame.
- Metrics and traces may label only bounded categories. Never label prompts, tool arguments, provider payloads, run IDs, conversation IDs, or tool call IDs.
- Use `describe()` and `it()` from `#veryfront/testing/bdd.ts` and assertions from `#veryfront/testing/assert.ts`.
- Keep internal imports on `#veryfront/*` or relative paths inside the same module. Do not add a package export for the lifecycle module during these phases.
- Do not begin a later gate until every command in the current gate passes and every shadow divergence has a named classification.
- A lifecycle run covers one provider attempt. Local tool execution, finalization fallback, and external child progress are separate agent-loop event sources.
- The `RuntimeStreamPart` boundary emits exactly one `finish` per provider attempt, so the reducer treats the first `step_finish` as terminal. `message_start` and `step_start` remain accepted for forward compatibility, and multi-step provider attempts are out of scope until a Provider Adapter emits intermediate step boundaries. This is a deliberate narrowing of the design's step vocabulary for version 1.
- Gate 4 adds version 2 projection capability and fixtures but does not enable production version 2 writes. The current hosted contract exposes UI chunks, not lifecycle frames, and cannot perform a correct cutover by changing `processStream()` alone.
- Phase 5 source-tagged agent-loop delivery, backend idempotency, persistent outbox, resumable cursor, cross-process recovery, retention enforcement, compaction, and storage measurement require a separate approved design and plan.

## File Structure

Create the lifecycle core:

- `src/agent/streaming/lifecycle/types.ts`: canonical signal, frame, snapshot, outcome, Provider Adapter, cancellation, and diagnostic contracts.
- `src/agent/streaming/lifecycle/policy.ts`: default policy and policy resolution.
- `src/agent/streaming/lifecycle/errors.ts`: lifecycle-specific programmer errors.
- `src/agent/streaming/lifecycle/clock.ts`: production monotonic clock.
- `src/agent/streaming/lifecycle/reducer.ts`: pure lifecycle validation, repair, progress classification, and snapshot updates.
- `src/agent/streaming/lifecycle/tool-input.ts`: strict local tool-input parsing that distinguishes malformed input from a valid empty object.
- `src/agent/streaming/lifecycle/deadlines.ts`: provider-wait accounting, phase wake-ups, status cadence, and absolute attempt deadline.
- `src/agent/streaming/lifecycle/runner.ts`: lazy single-consumer provider iteration, cancellation, cleanup, frame sequencing, and exactly-once outcome settlement.
- `src/agent/streaming/lifecycle/cancellation.ts`: source-tagged cancellation coordinator.
- `src/agent/streaming/lifecycle/diagnostics.ts`: diagnostic policy gating and fail-open sink.
- `src/agent/streaming/lifecycle/watchdog-compat-adapter.ts`: compatibility chunk-to-lifecycle-activity mapping for the exported watchdog (Gate 3).
- `src/agent/streaming/lifecycle/runtime-provider-adapter.ts`: `RuntimeStreamPart` normalization only.
- `src/agent/streaming/lifecycle/live-adapter.ts`: canonical frame to existing `ChatStreamEvent` mapping.
- `src/agent/streaming/lifecycle/testing.ts`: manual monotonic clock and scripted Provider Adapter for tests only.
- `src/agent/streaming/lifecycle/index.ts`: internal exports used by runtime and projection Adapters.

Create rollout support:

- `src/agent/runtime/stream-lifecycle-shadow.ts`: already-read-part shadow tap and bounded divergence report.
- `src/agent/runtime/stream-lifecycle-mode.ts`: host-level `legacy | shadow | active` rollout resolution.
- `src/agent/conversation/lifecycle-run-event-adapter.ts`: validated lifecycle frames to existing durable event names.
- `src/agent/conversation/legacy-run-read-adapter.ts`: read-only repair path for unversioned historical conversation-run event sequences.
- `src/agent/ag-ui/lifecycle-browser-adapter.ts`: validated lifecycle frames to AG-UI browser events.
- `src/agent/conversation/fixtures/legacy-content-after-end.json`: immutable malformed legacy sequence for repair tests.
- `src/agent/streaming/lifecycle/observability.ts`: bounded lifecycle metrics and active-span attributes.
- `src/observability/instruments/stream-lifecycle-instruments.ts`: internal OpenTelemetry counters and histograms.

Modify existing owners only at their migration gate:

- `src/agent/runtime/chat-stream-handler.ts`
- `src/agent/runtime/chat-stream-handler.test.ts`
- `src/agent/runtime/index.ts`
- `src/agent/runtime/runtime-tool-types.ts`
- `src/chat/protocol.ts`
- `src/provider/runtime-loader/tool-input-status.ts`
- `src/provider/runtime-loader.test.ts`
- `extensions/ext-llm-openai/src/openai-provider.ts`
- `extensions/ext-llm-anthropic/src/anthropic-provider.ts`
- `extensions/ext-llm-google/src/google-provider.ts`
- `src/chat/stream-watchdog.ts`
- `src/chat/stream-watchdog.test.ts`
- `src/agent/streaming/stream-outcome.ts`
- `src/agent/hosted/stream-finalization.ts`
- `src/agent/hosted/stream-finalization.test.ts`
- `src/agent/hosted/chat-execution-runtime.ts`
- `src/agent/hosted/chat-execution-runtime.test.ts`
- `src/agent/conversation/run-event-preparation.ts`
- `src/agent/conversation/run-event-preparation.test.ts`
- `src/agent/conversation/durable-contracts.ts`
- `src/observability/metrics/types.ts`
- `src/observability/instruments/instruments-factory.ts`
- `src/observability/metrics/manager.ts`
- `src/observability/metrics/recorder.ts`
- `src/observability/metrics/index.ts`
- `docs/architecture/05-agent-runtime.md`
- `docs/architecture/27-agent-message-stream-dataflow.md`
- `docs/internal/stream-lifecycle-rollout.md`
- `CONTEXT.md`

---

## Gate 1: Interface and shadow reducer

### Task 1: Freeze the lifecycle contract and policy

**Files:**

- Create: `src/agent/streaming/lifecycle/types.ts`
- Create: `src/agent/streaming/lifecycle/policy.ts`
- Create: `src/agent/streaming/lifecycle/errors.ts`
- Create: `src/agent/streaming/lifecycle/clock.ts`
- Create: `src/agent/streaming/lifecycle/types.test.ts`
- Create: `src/agent/streaming/lifecycle/index.ts`

**Interfaces:**

- Consumes: no new code; preserve helpers in `src/agent/streaming/stream-outcome.ts`.
- Produces: `runStreamLifecycle(input): StreamLifecycleRun`, `StreamProviderAdapter<TProviderPart>`, `StreamSignal`, `StreamLifecycleFrame`, `StreamSnapshot`, `StreamOutcome`, `StreamLifecyclePolicy`, `MonotonicClock`, and `StreamAlreadyConsumedError`.

- [ ] **Step 1: Write the failing policy and contract tests**

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamAlreadyConsumedError } from "./errors.ts";
import { resolveStreamLifecyclePolicy } from "./policy.ts";

describe("stream lifecycle contract", () => {
  it("preserves the approved timeout budgets", () => {
    const policy = resolveStreamLifecyclePolicy();
    assertEquals(policy.firstProgressTimeoutMs, 60_000);
    assertEquals(policy.semanticIdleTimeoutMs, 15_000);
    assertEquals(policy.toolInputIdleTimeoutMs, 15_000);
    assertEquals(policy.toolCommitGraceMs, 250);
    assertEquals(policy.statusIntervalMs, 5_000);
    assertEquals(policy.attemptTimeoutMs, 300_000);
  });

  it("uses a typed error for a second frame consumer", () => {
    assertInstanceOf(new StreamAlreadyConsumedError(), StreamAlreadyConsumedError);
  });
});
```

- [ ] **Step 2: Run the test and verify the contract is absent**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/types.test.ts`

Expected: FAIL because `types.ts`, `policy.ts`, and `errors.ts` do not exist.

- [ ] **Step 3: Add the exact public-within-the-repo types**

Create `types.ts` with these discriminants and signatures. Keep provider protocol events separate from lifecycle frames so an Adapter cannot pre-classify progress.

```ts
export type StreamLifecyclePhase =
  | "awaiting_first_progress"
  | "streaming"
  | "awaiting_tool_input"
  | "tool_handoff"
  | "completed"
  | "failed"
  | "cancelled";

export type StreamProviderDeadlineKind =
  | "first_progress"
  | "semantic_idle"
  | "tool_input_idle"
  | "tool_commit_grace";

export type StreamCancellationSource =
  | "user"
  | "parent"
  | "runtime"
  | "client_disconnected"
  | "consumer_stopped";

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  billingMode?: "direct" | "deferred";
  usageCaptureStatus?: "complete" | "partial" | "missing";
}

export type StreamProtocolEvent =
  | { type: "message_start"; messageId?: string }
  | { type: "step_start" }
  | { type: "text_start"; id?: string }
  | { type: "text_content"; id?: string; delta: string }
  | { type: "text_end"; id?: string }
  | { type: "reasoning_start"; id: string }
  | { type: "reasoning_content"; id: string; delta: string }
  | { type: "reasoning_end"; id: string; signature?: string; redactedData?: string }
  | { type: "tool_input_start"; toolCallId: string; toolName: string; providerExecuted?: boolean; dynamic?: boolean }
  | { type: "tool_input_content"; toolCallId: string; delta: string }
  | { type: "tool_input_ready"; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean; dynamic?: boolean }
  | { type: "tool_input_rejected"; toolCallId: string; toolName: string; reason: "invalid" | "malformed" | "unavailable" }
  | { type: "provider_tool_start"; toolCallId: string; toolName: string; providerExecuted: true }
  | { type: "provider_tool_result"; toolCallId: string; toolName: string; output: unknown; isError: boolean; providerExecuted: true; dynamic?: boolean; preliminary?: boolean }
  | { type: "provider_tool_denied"; toolCallId: string; toolName: string; providerExecuted: true }
  | { type: "provider_tool_cancelled"; toolCallId: string; toolName: string; providerExecuted: true }
  | { type: "step_finish"; finishReason: "stop" | "length" | "tool-calls" | "content-filter" | "other" | null }
  | { type: "custom"; name: string; data: unknown };

export type StreamSignal =
  | { kind: "protocol"; event: StreamProtocolEvent }
  | { kind: "usage"; usage: StreamUsage }
  | { kind: "provider_error"; error: StreamProviderError }
  | { kind: "diagnostic_candidate"; candidate: StreamRawDiagnosticCandidate };

export type StreamSemanticEvent =
  | StreamProtocolEvent
  | { type: "usage"; usage: StreamUsage };

export type StreamTelemetryEvent =
  | { type: "tool_input_status"; toolCallId: string; status: "pending_input" | "streaming_input" }
  | { type: "live_heartbeat" }
  | { type: "child_progress"; state: string };

export type StreamDiagnosticEvent =
  | { type: "provider_part_rejected"; partType?: string }
  | { type: "protocol_repair"; code: string }
  | { type: "protocol_violation"; code: "invalid_tool_transition" | "invalid_terminal_state" }
  | { type: "deadline"; action: "armed" | "advanced" | "fired"; code: string }
  | { type: "provider_cleanup_failed"; diagnosticId?: string }
  | { type: "provider_diagnostic"; event: StreamSafeDiagnosticEvent };

export type StreamLifecycleFrame = {
  sequence: number;
  elapsedMs: number;
} & (
  | { class: "semantic"; event: StreamSemanticEvent }
  | { class: "telemetry"; event: StreamTelemetryEvent }
  | { class: "diagnostic"; event: StreamDiagnosticEvent }
);

export interface StreamToolSnapshot {
  id: string;
  name: string;
  phase: "input_open" | "input_streaming" | "input_ready" | "input_rejected" | "running" | "succeeded" | "failed" | "denied" | "cancelled";
  inputText: string;
  inputDeltas: readonly string[];
  input?: unknown;
  rejectionReason?: "invalid" | "malformed" | "unavailable";
  output?: unknown;
  error?: unknown;
  preliminary?: boolean;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

export interface StreamSnapshot {
  phase: StreamLifecyclePhase;
  accumulatedText: string;
  reasoning: readonly { id: string; text: string; signature?: string; redactedData?: string }[];
  tools: readonly StreamToolSnapshot[];
  finishReason: "stop" | "length" | "tool-calls" | "content-filter" | "other" | null;
  usage: StreamUsage;
  hasStreamOutput: boolean;
  hasSemanticProgress: boolean;
}

export interface StreamProviderError {
  code: string;
  publicMessage: string;
  retryable: boolean;
  terminal: boolean;
  diagnosticId?: string;
}

export interface StreamRawDiagnosticCandidate {
  kind: string;
  value: unknown;
}

export interface StreamSafeDiagnosticEvent {
  kind: string;
  attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface StreamDiagnosticPolicy {
  rawCapture: "disabled" | "redacted";
  redact(candidate: StreamRawDiagnosticCandidate): StreamSafeDiagnosticEvent | null;
}

export interface StreamDiagnosticSink {
  report(event: StreamDiagnosticEvent): void;
}

export interface StreamCancellationInput {
  source: Exclude<StreamCancellationSource, "consumer_stopped">;
  signal: AbortSignal;
}

export interface MonotonicClock {
  nowMs(): number;
  waitUntil(deadlineMs: number, signal?: AbortSignal): Promise<"deadline" | "aborted">;
}

export interface StreamLifecyclePolicy {
  clock: MonotonicClock;
  firstProgressTimeoutMs: number;
  semanticIdleTimeoutMs: number;
  toolInputIdleTimeoutMs: number;
  toolCommitGraceMs: number;
  statusIntervalMs: number;
  attemptTimeoutMs: number;
}

export interface StreamProviderAdapter<TProviderPart> {
  open(signal: AbortSignal): AsyncIterable<TProviderPart>;
  decode(part: TProviderPart, snapshot: Readonly<StreamSnapshot>): readonly StreamSignal[];
  classifyError(error: unknown, snapshot: Readonly<StreamSnapshot>): StreamProviderError;
}

export interface StreamCommittedToolCall {
  id: string;
  name: string;
  arguments: string;
  inputDeltas: readonly string[];
  inputAnnounced: boolean;
  inputAvailable: true;
  providerExecuted?: false;
  dynamic?: boolean;
}

export interface StreamLifecycleError {
  code: "FIRST_PROGRESS_TIMEOUT" | "SEMANTIC_IDLE_TIMEOUT" | "TOOL_INPUT_TIMEOUT" | "TOOL_INPUT_INCOMPLETE" | "STREAM_ATTEMPT_TIMEOUT" | "PROTOCOL_VIOLATION" | "PROVIDER_STREAM_ERROR" | "PROVIDER_TERMINAL_ERROR";
  phase: StreamLifecyclePhase;
  source: "provider" | "runtime" | "tool";
  retryable: boolean;
  publicMessage: string;
  providerCode?: string;
  diagnosticId?: string;
}

export interface StreamOutcomeBase {
  snapshot: StreamSnapshot;
  usage: StreamUsage;
  elapsedMs: number;
  phase: StreamLifecyclePhase;
}

export type StreamOutcome =
  | (StreamOutcomeBase & { status: "completed"; finishReason: "stop" | "length" | "content-filter" | "other" })
  | (StreamOutcomeBase & { status: "tool_handoff"; finishReason: "tool-calls"; toolCalls: readonly StreamCommittedToolCall[] })
  | (StreamOutcomeBase & { status: "cancelled"; source: StreamCancellationSource; publicMessage: string; diagnosticId?: string })
  | (StreamOutcomeBase & { status: "failed"; error: StreamLifecycleError });

export interface StreamLifecycleInput<TProviderPart> {
  provider: StreamProviderAdapter<TProviderPart>;
  policy?: Partial<StreamLifecyclePolicy>;
  cancellations?: readonly StreamCancellationInput[];
  diagnostics?: StreamDiagnosticPolicy;
  diagnosticSink?: StreamDiagnosticSink;
}

export interface StreamLifecycleRun {
  frames: AsyncIterable<StreamLifecycleFrame>;
  outcome: Promise<StreamOutcome>;
}
```

- [ ] **Step 4: Add policy, clock, error, and internal barrel implementations**

```ts
// policy.ts
import { performanceMonotonicClock } from "./clock.ts";
import type { StreamLifecyclePolicy } from "./types.ts";

export const DEFAULT_STREAM_LIFECYCLE_POLICY: StreamLifecyclePolicy = {
  clock: performanceMonotonicClock,
  firstProgressTimeoutMs: 60_000,
  semanticIdleTimeoutMs: 15_000,
  toolInputIdleTimeoutMs: 15_000,
  toolCommitGraceMs: 250,
  statusIntervalMs: 5_000,
  attemptTimeoutMs: 300_000,
};

export function resolveStreamLifecyclePolicy(
  input: Partial<StreamLifecyclePolicy> = {},
): StreamLifecyclePolicy {
  return { ...DEFAULT_STREAM_LIFECYCLE_POLICY, ...input };
}
```

```ts
// clock.ts
import type { MonotonicClock } from "./types.ts";

export const performanceMonotonicClock: MonotonicClock = {
  nowMs: () => performance.now(),
  waitUntil(deadlineMs, signal) {
    if (signal?.aborted) return Promise.resolve("aborted");
    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: number | undefined;
      const onAbort = () => finish("aborted");
      const finish = (result: "deadline" | "aborted") => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      timeoutId = setTimeout(
        () => finish("deadline"),
        Math.max(0, deadlineMs - performance.now()),
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) finish("aborted");
    });
  },
};
```

```ts
// errors.ts
export class StreamAlreadyConsumedError extends Error {
  constructor() {
    super("Stream lifecycle frames support one consumer");
    this.name = "StreamAlreadyConsumedError";
  }
}
```

`index.ts` must export only lifecycle-internal symbols from these files. Do not update `deno.json`, `src/index.ts`, or `src/agent/index.ts`.

- [ ] **Step 5: Run focused checks**

Run: `deno fmt src/agent/streaming/lifecycle/`

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/types.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the frozen contract**

```bash
git add src/agent/streaming/lifecycle
git commit -m "Give stream attempts one internal contract" \
  -m "Constraint: Preserve public runtime and projection exports during migration" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: deno test --no-check --allow-all src/agent/streaming/lifecycle/types.test.ts"
```

### Task 2: Implement the pure text, reasoning, and progress reducer

**Files:**

- Create: `src/agent/streaming/lifecycle/reducer.ts`
- Create: `src/agent/streaming/lifecycle/reducer.test.ts`
- Modify: `src/agent/streaming/lifecycle/index.ts`

**Interfaces:**

- Consumes: `StreamSignal`, `StreamSnapshot`, `StreamLifecycleFrame`, and `StreamLifecyclePolicy` from Task 1.
- Produces: `createInitialReducerState()` and `reduceStreamSignal(state, signal, elapsedMs)` returning `{ state, frames, semanticProgress }`.

- [ ] **Step 1: Write failing invariant tests**

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInitialReducerState, reduceStreamSignal } from "./reducer.ts";
import type { StreamProtocolEvent } from "./types.ts";

const protocol = (event: StreamProtocolEvent) => ({
  kind: "protocol" as const,
  event,
});

describe("stream lifecycle reducer", () => {
  it("balances reasoning before text and creates a new text identity after end", () => {
    let state = createInitialReducerState();
    const events = [
      { type: "reasoning_start", id: "r1" },
      { type: "reasoning_content", id: "r1", delta: "thinking" },
      { type: "text_content", id: "provider-text", delta: "first" },
      { type: "text_end", id: "provider-text" },
      { type: "text_content", id: "provider-text", delta: "second" },
    ] as const;
    const frames = events.flatMap((event, index) => {
      const reduced = reduceStreamSignal(state, protocol(event), index + 1);
      state = reduced.state;
      return reduced.frames;
    });

    assertEquals(
      frames.filter((frame) => frame.class === "semantic").map((frame) => frame.event.type),
      ["reasoning_start", "reasoning_content", "reasoning_end", "text_start", "text_content", "text_end", "text_start", "text_content"],
    );
    assertEquals(state.snapshot.accumulatedText, "firstsecond");
  });

  it("does not count empty content, status, or metadata as semantic progress", () => {
    let state = createInitialReducerState();
    for (const event of [
      { type: "text_content", delta: "" },
      { type: "custom", name: "tool-call-status", data: { status: "pending_input" } },
    ] as const) {
      const reduced = reduceStreamSignal(state, protocol(event), 1);
      state = reduced.state;
      assertEquals(reduced.semanticProgress, false);
    }
  });

});
```

- [ ] **Step 2: Run the reducer test and verify it fails**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/reducer.test.ts`

Expected: FAIL because `reducer.ts` does not exist.

- [ ] **Step 3: Implement one reducer-owned sequencing function**

Use one mutable internal state and return immutable snapshots. All frame creation must pass through `emit()` so sequence numbers cannot diverge between classes.

```ts
import type {
  StreamLifecycleError,
  StreamLifecycleFrame,
  StreamLifecyclePhase,
  StreamProtocolEvent,
  StreamSignal,
  StreamSnapshot,
  StreamToolSnapshot,
} from "./types.ts";

export interface StreamReducerState {
  snapshot: StreamSnapshot;
  sequence: number;
  activeTextId: string | null;
  activeReasoningId: string | null;
  nextTextIndex: number;
  tools: Map<string, StreamToolSnapshot>;
  terminal: boolean;
  terminalError: StreamLifecycleError | null;
}

export interface StreamReduction {
  state: StreamReducerState;
  frames: StreamLifecycleFrame[];
  semanticProgress: boolean;
}

export function createInitialReducerState(): StreamReducerState {
  return {
    snapshot: {
      phase: "awaiting_first_progress",
      accumulatedText: "",
      reasoning: [],
      tools: [],
      finishReason: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      hasStreamOutput: false,
      hasSemanticProgress: false,
    },
    sequence: 0,
    activeTextId: null,
    activeReasoningId: null,
    nextTextIndex: 0,
    tools: new Map(),
    terminal: false,
    terminalError: null,
  };
}

export function reduceStreamSignal(
  current: StreamReducerState,
  signal: StreamSignal,
  elapsedMs: number,
): StreamReduction {
  let state = cloneReducerState(current);
  const frames: StreamLifecycleFrame[] = [];
  let semanticProgress = false;
  const emit = (
    frame: Omit<StreamLifecycleFrame, "sequence" | "elapsedMs">,
  ) => frames.push({ ...frame, sequence: ++state.sequence, elapsedMs } as StreamLifecycleFrame);

  if (state.terminal) {
    emit({ class: "diagnostic", event: { type: "provider_part_rejected" } });
    return { state, frames, semanticProgress };
  }

  if (signal.kind === "usage") {
    state.snapshot = { ...state.snapshot, usage: signal.usage };
    emit({ class: "semantic", event: { type: "usage", usage: signal.usage } });
    return { state, frames, semanticProgress };
  }
  if (signal.kind === "provider_error") {
    return { state, frames, semanticProgress };
  }
  if (signal.kind === "diagnostic_candidate") {
    return { state, frames, semanticProgress };
  }

  const closeReasoning = () => {
    if (state.activeReasoningId === null) return;
    emit({ class: "semantic", event: { type: "reasoning_end", id: state.activeReasoningId } });
    state.activeReasoningId = null;
  };
  const closeText = () => {
    if (state.activeTextId === null) return;
    emit({ class: "semantic", event: { type: "text_end", id: state.activeTextId } });
    state.activeTextId = null;
  };
  const markProgress = () => {
    semanticProgress = true;
    state.snapshot = { ...state.snapshot, phase: "streaming", hasSemanticProgress: true };
  };

  switch (signal.event.type) {
    case "reasoning_start":
      closeText();
      closeReasoning();
      state.activeReasoningId = signal.event.id;
      emit({ class: "semantic", event: signal.event });
      break;
    case "reasoning_content": {
      closeText();
      if (state.activeReasoningId !== signal.event.id) {
        closeReasoning();
        state.activeReasoningId = signal.event.id;
        emit({ class: "semantic", event: { type: "reasoning_start", id: signal.event.id } });
        emit({
          class: "diagnostic",
          event: { type: "protocol_repair", code: "implicit_reasoning_start" },
        });
      }
      const reasoning = [...state.snapshot.reasoning];
      const index = reasoning.findIndex((part) => part.id === signal.event.id);
      const prior = index >= 0 ? reasoning[index] : { id: signal.event.id, text: "" };
      const updated = { ...prior, text: prior.text + signal.event.delta };
      if (index >= 0) reasoning[index] = updated;
      else reasoning.push(updated);
      state.snapshot = { ...state.snapshot, reasoning };
      emit({ class: "semantic", event: signal.event });
      if (signal.event.delta.length > 0) markProgress();
      break;
    }
    case "reasoning_end":
      if (state.activeReasoningId === signal.event.id) {
        emit({ class: "semantic", event: signal.event });
        state.activeReasoningId = null;
      }
      break;
    case "text_start":
      closeReasoning();
      closeText();
      state.activeTextId = `text:${state.nextTextIndex++}`;
      emit({ class: "semantic", event: { type: "text_start", id: state.activeTextId } });
      break;
    case "text_content":
      closeReasoning();
      if (state.activeTextId === null) {
        state.activeTextId = `text:${state.nextTextIndex++}`;
        emit({ class: "semantic", event: { type: "text_start", id: state.activeTextId } });
        emit({
          class: "diagnostic",
          event: { type: "protocol_repair", code: "implicit_text_start" },
        });
      }
      state.snapshot = {
        ...state.snapshot,
        accumulatedText: state.snapshot.accumulatedText + signal.event.delta,
        hasStreamOutput: state.snapshot.hasStreamOutput || signal.event.delta.length > 0,
      };
      emit({ class: "semantic", event: { ...signal.event, id: state.activeTextId } });
      if (signal.event.delta.length > 0) markProgress();
      break;
    case "text_end":
      closeText();
      break;
    case "custom":
      if (signal.event.name === "tool-call-status") {
        const data = signal.event.data as { toolCallId?: unknown; status?: unknown };
        if (
          typeof data.toolCallId === "string" &&
          (data.status === "pending_input" || data.status === "streaming_input")
        ) {
          emit({ class: "telemetry", event: { type: "tool_input_status", toolCallId: data.toolCallId, status: data.status } });
        }
      } else {
        emit({ class: "semantic", event: signal.event });
      }
      break;
    default:
      ({ state, semanticProgress } = reduceNonTextProtocolEvent(
        state,
        signal.event,
        elapsedMs,
        emit,
        semanticProgress,
      ));
  }

  if (semanticProgress && !state.snapshot.hasSemanticProgress) {
    state.snapshot = { ...state.snapshot, hasSemanticProgress: true };
  }
  return { state, frames, semanticProgress };
}
```

Add these exact helpers below the interfaces. Task 3 replaces only the body of `reduceNonTextProtocolEvent()` with the complete non-text state machine.

```ts
type FrameEmitter = (
  frame: Omit<StreamLifecycleFrame, "sequence" | "elapsedMs">,
) => void;

function cloneReducerState(current: StreamReducerState): StreamReducerState {
  return {
    ...current,
    snapshot: {
      ...current.snapshot,
      reasoning: current.snapshot.reasoning.map((part) => ({ ...part })),
      tools: current.snapshot.tools.map((tool) => ({
        ...tool,
        inputDeltas: [...tool.inputDeltas],
      })),
      usage: { ...current.snapshot.usage },
    },
    tools: new Map(
      [...current.tools].map(([id, tool]) => [id, {
        ...tool,
        inputDeltas: [...tool.inputDeltas],
      }]),
    ),
    terminalError: current.terminalError ? { ...current.terminalError } : null,
  };
}

function reduceNonTextProtocolEvent(
  state: StreamReducerState,
  _event: StreamProtocolEvent,
  _elapsedMs: number,
  emit: FrameEmitter,
  semanticProgress: boolean,
): Pick<StreamReduction, "state" | "semanticProgress"> {
  emit({ class: "diagnostic", event: { type: "provider_part_rejected" } });
  return { state, semanticProgress };
}
```

- [ ] **Step 4: Run the focused test and format check**

Run: `deno fmt src/agent/streaming/lifecycle/`

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/reducer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the reducer invariant**

```bash
git add src/agent/streaming/lifecycle
git commit -m "Make balanced stream content a reducer invariant" \
  -m "Rejected: Repair text and reasoning independently in each projection | repeats lifecycle ownership" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: deno test --no-check --allow-all src/agent/streaming/lifecycle/reducer.test.ts"
```

### Task 3: Complete tool, usage, terminal, and diagnostic reduction

**Files:**

- Modify: `src/agent/streaming/lifecycle/reducer.ts`
- Modify: `src/agent/streaming/lifecycle/reducer.test.ts`
- Create: `src/agent/streaming/lifecycle/tool-input.ts`
- Create: `src/agent/streaming/lifecycle/tool-input.test.ts`
- Create: `src/agent/streaming/lifecycle/diagnostics.ts`
- Create: `src/agent/streaming/lifecycle/diagnostics.test.ts`
- Modify: `src/agent/streaming/lifecycle/index.ts`

**Interfaces:**

- Consumes: `mergeToolInputDelta()` and `stripLeadingEmptyObjectPlaceholder()` from `src/agent/streaming/data-stream.ts`.
- Produces: `parseCanonicalToolInput()`, complete `reduceNonTextProtocolEvent()`, `createDefaultDiagnosticPolicy()`, `acceptDiagnosticCandidate()`, `createDefaultDiagnosticSink()`, and `reportLifecycleDiagnostic()`.

- [ ] **Step 1: Add failing tool-state tests**

Add these exact cases to `reducer.test.ts`:

```ts
it("records reducer-approved tool progress in the canonical snapshot", () => {
  let state = createInitialReducerState();
  state = reduceStreamSignal(state, protocol({
    type: "tool_input_start",
    toolCallId: "t1",
    toolName: "create_file",
  }), 1).state;
  const reduced = reduceStreamSignal(state, protocol({
    type: "tool_input_content",
    toolCallId: "t1",
    delta: '{"path":"a.md"}',
  }), 2);

  assertEquals(reduced.semanticProgress, true);
  assertEquals(reduced.state.snapshot.hasSemanticProgress, true);
  assertEquals(reduced.state.snapshot.phase, "awaiting_tool_input");
});

it("keeps parallel tool inputs independent and hands off only valid local calls", () => {
  let state = createInitialReducerState();
  for (const event of [
    { type: "tool_input_start", toolCallId: "a", toolName: "create_file" },
    { type: "tool_input_start", toolCallId: "b", toolName: "create_file" },
    { type: "tool_input_content", toolCallId: "a", delta: '{"path":"a.md"}' },
    { type: "tool_input_content", toolCallId: "b", delta: '{"path":' },
    { type: "step_finish", finishReason: "tool-calls" },
  ] as const) {
    state = reduceStreamSignal(state, { kind: "protocol", event }, 1).state;
  }

  assertEquals(state.snapshot.phase, "tool_handoff");
  assertEquals(state.snapshot.tools.map((tool) => [tool.id, tool.phase]), [
    ["a", "input_ready"],
    ["b", "input_rejected"],
  ]);
});

it("rejects unavailable local input without handing it to execution", () => {
  let state = createInitialReducerState();
  state = reduceStreamSignal(state, {
    kind: "protocol",
    event: {
      type: "tool_input_rejected",
      toolCallId: "missing",
      toolName: "missing_tool",
      reason: "unavailable",
    },
  }, 1).state;
  state = reduceStreamSignal(state, {
    kind: "protocol",
    event: { type: "step_finish", finishReason: "tool-calls" },
  }, 2).state;

  assertEquals(state.snapshot.phase, "failed");
  assertEquals(state.snapshot.tools[0]?.phase, "input_rejected");
});

it("accepts provider tool output only for explicitly provider-executed input", () => {
  let state = createInitialReducerState();
  const resultWithoutInput = reduceStreamSignal(state, {
    kind: "protocol",
    event: {
      type: "provider_tool_result",
      toolCallId: "native-1",
      toolName: "web_search",
      output: "ok",
      isError: false,
      providerExecuted: true,
    },
  }, 1);
  assertEquals(resultWithoutInput.state.snapshot.phase, "failed");
});

it("requires the provider tool running transition before a terminal result", () => {
  let state = createInitialReducerState();
  for (const event of [
    { type: "tool_input_start", toolCallId: "native-1", toolName: "web_search", providerExecuted: true },
    { type: "tool_input_ready", toolCallId: "native-1", toolName: "web_search", input: {}, providerExecuted: true },
    { type: "provider_tool_start", toolCallId: "native-1", toolName: "web_search", providerExecuted: true },
    { type: "provider_tool_result", toolCallId: "native-1", toolName: "web_search", output: "ok", isError: false, providerExecuted: true },
  ] as const) {
    state = reduceStreamSignal(state, { kind: "protocol", event }, 1).state;
  }
  assertEquals(state.snapshot.tools[0]?.phase, "succeeded");
});

it("uses running as the only entry to every provider tool terminal state", () => {
  const terminals = [
    {
      event: { type: "provider_tool_result", output: "ok", isError: false },
      expected: "succeeded",
    },
    {
      event: { type: "provider_tool_result", output: "failed", isError: true },
      expected: "failed",
    },
    { event: { type: "provider_tool_denied" }, expected: "denied" },
    { event: { type: "provider_tool_cancelled" }, expected: "cancelled" },
  ] as const;

  for (const terminal of terminals) {
    let state = createInitialReducerState();
    for (const event of [
      { type: "tool_input_start", toolCallId: "native-1", toolName: "web_search", providerExecuted: true },
      { type: "tool_input_ready", toolCallId: "native-1", toolName: "web_search", input: {}, providerExecuted: true },
      { type: "provider_tool_start", toolCallId: "native-1", toolName: "web_search", providerExecuted: true },
      { ...terminal.event, toolCallId: "native-1", toolName: "web_search", providerExecuted: true },
    ] as const) {
      state = reduceStreamSignal(state, { kind: "protocol", event }, 1).state;
    }
    assertEquals(state.snapshot.tools[0]?.phase, terminal.expected);

    let invalid = createInitialReducerState();
    for (const event of [
      { type: "tool_input_start", toolCallId: "native-1", toolName: "web_search", providerExecuted: true },
      { type: "tool_input_ready", toolCallId: "native-1", toolName: "web_search", input: {}, providerExecuted: true },
      { ...terminal.event, toolCallId: "native-1", toolName: "web_search", providerExecuted: true },
    ] as const) {
      invalid = reduceStreamSignal(invalid, { kind: "protocol", event }, 1).state;
    }
    assertEquals(invalid.snapshot.phase, "failed");
  }
});
```

- [ ] **Step 2: Add failing diagnostic-policy tests**

```ts
import { acceptDiagnosticCandidate, createDefaultDiagnosticPolicy } from "./diagnostics.ts";

it("drops raw diagnostic candidates by default", () => {
  assertEquals(
    acceptDiagnosticCandidate(createDefaultDiagnosticPolicy(), {
      kind: "provider_payload",
      value: { authorization: "<REDACTED>" },
    }),
    null,
  );
});

it("publishes only the redactor result", () => {
  assertEquals(
    acceptDiagnosticCandidate({
      rawCapture: "redacted",
      redact: () => ({ kind: "provider_shape", attributes: { partType: "unknown" } }),
    }, { kind: "provider_payload", value: { secret: "<REDACTED>" } }),
    { kind: "provider_shape", attributes: { partType: "unknown" } },
  );
});
```

- [ ] **Step 3: Run both tests and verify the missing behavior**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/reducer.test.ts src/agent/streaming/lifecycle/diagnostics.test.ts`

Expected: FAIL on tool transitions and missing `diagnostics.ts` exports.

- [ ] **Step 4: Add strict tool-input parsing**

Add this test to `tool-input.test.ts`:

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCanonicalToolInput } from "./tool-input.ts";

describe("parseCanonicalToolInput", () => {
  it("distinguishes valid empty input from malformed and non-object input", () => {
    assertEquals(parseCanonicalToolInput("{}"), { ok: true, value: {} });
    assertEquals(parseCanonicalToolInput('{}{"path":"a.md"}'), {
      ok: true,
      value: { path: "a.md" },
    });
    assertEquals(parseCanonicalToolInput('{"path":'), { ok: false, reason: "malformed" });
    assertEquals(parseCanonicalToolInput("[]"), { ok: false, reason: "invalid" });
    assertEquals(parseCanonicalToolInput(null), { ok: false, reason: "invalid" });
  });
});
```

Create `tool-input.ts`:

```ts
import { stripLeadingEmptyObjectPlaceholder } from "#veryfront/agent/streaming/data-stream.ts";

export type CanonicalToolInputParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: "invalid" | "malformed" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCanonicalToolInput(input: unknown): CanonicalToolInputParseResult {
  if (isRecord(input)) return { ok: true, value: input };
  if (typeof input !== "string") return { ok: false, reason: "invalid" };

  const normalized = stripLeadingEmptyObjectPlaceholder(input);
  if (normalized.length === 0) return { ok: false, reason: "invalid" };
  try {
    const parsed: unknown = JSON.parse(normalized);
    return isRecord(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
```

- [ ] **Step 5: Replace the temporary non-text fallback with an exhaustive reducer**

Add the two imports at the top of `reducer.ts`, then replace the temporary helper with this exhaustive implementation:

```ts
import { mergeToolInputDelta } from "#veryfront/agent/streaming/data-stream.ts";
import { parseCanonicalToolInput } from "./tool-input.ts";
```

```ts
function reduceNonTextProtocolEvent(
  state: StreamReducerState,
  event: StreamProtocolEvent,
  elapsedMs: number,
  emit: FrameEmitter,
  semanticProgress: boolean,
): Pick<StreamReduction, "state" | "semanticProgress"> {
switch (event.type) {
  case "message_start":
  case "step_start":
    emit({ class: "semantic", event });
    return { state, semanticProgress };

  case "tool_input_start": {
    closeOpenContent(state, emit);
    state.tools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      phase: "input_open",
      inputText: "",
      inputDeltas: [],
      ...(event.providerExecuted !== undefined ? { providerExecuted: event.providerExecuted } : {}),
      ...(event.dynamic ? { dynamic: true } : {}),
    });
    syncToolSnapshot(state, "awaiting_tool_input");
    emit({ class: "semantic", event });
    return { state, semanticProgress };
  }

  case "tool_input_content": {
    const tool = state.tools.get(event.toolCallId);
    if (!tool || tool.phase === "input_rejected") return failProtocol(state, emit, elapsedMs);
    const inputText = mergeToolInputDelta(tool.inputText, event.delta);
    state.tools.set(event.toolCallId, {
      ...tool,
      phase: "input_streaming",
      inputText,
      inputDeltas: [...tool.inputDeltas, event.delta],
    });
    syncToolSnapshot(state, "awaiting_tool_input");
    emit({ class: "semantic", event });
    emit({
      class: "telemetry",
      event: {
        type: "tool_input_status",
        toolCallId: event.toolCallId,
        status: "streaming_input",
      },
    });
    return { state, semanticProgress: inputText !== tool.inputText };
  }

  case "tool_input_ready": {
    const prior = state.tools.get(event.toolCallId);
    if (!prior) {
      emit({
        class: "semantic",
        event: {
          type: "tool_input_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          ...(event.providerExecuted !== undefined
            ? { providerExecuted: event.providerExecuted }
            : {}),
          ...(event.dynamic ? { dynamic: true } : {}),
        },
      });
      emit({
        class: "diagnostic",
        event: { type: "protocol_repair", code: "implicit_tool_input_start" },
      });
    }
    state.tools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      phase: "input_ready",
      inputText: prior?.inputText ?? JSON.stringify(event.input ?? null),
      inputDeltas: prior?.inputDeltas ?? [],
      input: event.input,
      ...(event.providerExecuted !== undefined ? { providerExecuted: event.providerExecuted } : {}),
      ...(event.dynamic ? { dynamic: true } : {}),
    });
    syncToolSnapshot(state, "awaiting_tool_input");
    emit({ class: "semantic", event });
    return { state, semanticProgress: true };
  }

  case "tool_input_rejected": {
    const prior = state.tools.get(event.toolCallId);
    state.tools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      phase: "input_rejected",
      inputText: prior?.inputText ?? "",
      inputDeltas: prior?.inputDeltas ?? [],
      rejectionReason: event.reason,
    });
    syncToolSnapshot(state, "awaiting_tool_input");
    emit({ class: "semantic", event });
    return { state, semanticProgress };
  }

  case "provider_tool_start": {
    const tool = state.tools.get(event.toolCallId);
    if (!tool || tool.providerExecuted !== true || tool.phase !== "input_ready") {
      return failProtocol(state, emit, elapsedMs);
    }
    state.tools.set(event.toolCallId, { ...tool, phase: "running" });
    syncToolSnapshot(state, "streaming");
    emit({ class: "semantic", event });
    return { state, semanticProgress };
  }

  case "provider_tool_result":
  case "provider_tool_denied":
  case "provider_tool_cancelled": {
    const tool = state.tools.get(event.toolCallId);
    if (!tool || tool.providerExecuted !== true || tool.phase !== "running") {
      return failProtocol(state, emit, elapsedMs);
    }
    const phase = event.type === "provider_tool_result"
      ? event.isError ? "failed" : "succeeded"
      : event.type === "provider_tool_denied" ? "denied" : "cancelled";
    state.tools.set(event.toolCallId, {
      ...tool,
      phase,
      ...(event.type === "provider_tool_result" && !event.isError
        ? { output: event.output }
        : {}),
      ...(event.type === "provider_tool_result" && event.isError
        ? { error: event.output }
        : {}),
      ...(event.type === "provider_tool_denied"
        ? { error: "Tool output denied" }
        : {}),
      ...(event.type === "provider_tool_cancelled"
        ? { error: "Provider tool execution was cancelled" }
        : {}),
      ...(event.type === "provider_tool_result" && event.preliminary !== undefined
        ? { preliminary: event.preliminary }
        : {}),
    });
    syncToolSnapshot(state, "streaming");
    emit({ class: "semantic", event });
    return { state, semanticProgress: true };
  }

  case "step_finish": {
    closeOpenContent(state, emit);
    if (event.finishReason === "tool-calls") commitPendingLocalInputs(state, emit, elapsedMs);
    emit({ class: "semantic", event });
    const readyLocal = [...state.tools.values()].filter((tool) =>
      tool.phase === "input_ready" && tool.providerExecuted !== true
    );
    const rejectedLocal = [...state.tools.values()].filter((tool) =>
      tool.phase === "input_rejected" && tool.providerExecuted !== true
    );
    const phaseBeforeFinish = state.snapshot.phase;
    const terminalPhase = event.finishReason === "tool-calls" && readyLocal.length > 0
      ? "tool_handoff" as const
      : event.finishReason === "tool-calls"
      ? "failed" as const
      : "completed" as const;
    state.snapshot = {
      ...state.snapshot,
      finishReason: event.finishReason,
      phase: terminalPhase,
      hasSemanticProgress: true,
    };
    if (terminalPhase === "failed") {
      const incomplete = rejectedLocal.some((tool) =>
        tool.rejectionReason === "invalid" || tool.rejectionReason === "malformed"
      );
      state.terminalError = {
        code: incomplete ? "TOOL_INPUT_INCOMPLETE" : "PROTOCOL_VIOLATION",
        phase: phaseBeforeFinish,
        source: incomplete ? "tool" : "runtime",
        retryable: false,
        publicMessage: incomplete
          ? "Tool input ended before a valid object was complete"
          : "Provider requested tool handoff without an executable tool call",
      };
    }
    state.terminal = true;
    return { state, semanticProgress: true };
  }

  case "text_start":
  case "text_content":
  case "text_end":
  case "reasoning_start":
  case "reasoning_content":
  case "reasoning_end":
  case "custom":
    throw new Error(`Reducer routing error for ${event.type}`);
}
}
```

Add the helper implementations used by the switch:

```ts
function closeOpenContent(state: StreamReducerState, emit: FrameEmitter): void {
  if (state.activeReasoningId !== null) {
    emit({
      class: "semantic",
      event: { type: "reasoning_end", id: state.activeReasoningId },
    });
    state.activeReasoningId = null;
  }
  if (state.activeTextId !== null) {
    emit({ class: "semantic", event: { type: "text_end", id: state.activeTextId } });
    state.activeTextId = null;
  }
}

function syncToolSnapshot(
  state: StreamReducerState,
  phase: StreamLifecyclePhase,
): void {
  state.snapshot = {
    ...state.snapshot,
    phase,
    tools: [...state.tools.values()].map((tool) => ({ ...tool })),
    hasStreamOutput: state.snapshot.hasStreamOutput || [...state.tools.values()].some((tool) =>
      tool.rejectionReason !== "unavailable"
    ),
  };
}

function failProtocol(
  state: StreamReducerState,
  emit: FrameEmitter,
  _elapsedMs: number,
): Pick<StreamReduction, "state" | "semanticProgress"> {
  const failedFrom = state.snapshot.phase;
  state.terminal = true;
  state.terminalError = {
    code: "PROTOCOL_VIOLATION",
    phase: failedFrom,
    source: "runtime",
    retryable: false,
    publicMessage: "Provider stream violated the lifecycle protocol",
  };
  state.snapshot = { ...state.snapshot, phase: "failed" };
  emit({
    class: "diagnostic",
    event: { type: "protocol_violation", code: "invalid_tool_transition" },
  });
  return { state, semanticProgress: false };
}

function commitPendingLocalInputs(
  state: StreamReducerState,
  emit: FrameEmitter,
  _elapsedMs: number,
): void {
  for (const [toolCallId, tool] of state.tools) {
    if (
      tool.providerExecuted === true ||
      (tool.phase !== "input_open" && tool.phase !== "input_streaming")
    ) continue;

    const parsed = parseCanonicalToolInput(tool.inputText);
    if (parsed.ok) {
      const ready = { ...tool, phase: "input_ready" as const, input: parsed.value };
      state.tools.set(toolCallId, ready);
      emit({
        class: "semantic",
        event: {
          type: "tool_input_ready",
          toolCallId,
          toolName: tool.name,
          input: parsed.value,
          ...(tool.dynamic ? { dynamic: true } : {}),
        },
      });
      continue;
    }

    state.tools.set(toolCallId, {
      ...tool,
      phase: "input_rejected",
      rejectionReason: parsed.reason,
    });
    emit({
      class: "semantic",
      event: {
        type: "tool_input_rejected",
        toolCallId,
        toolName: tool.name,
        reason: parsed.reason,
      },
    });
  }
  syncToolSnapshot(state, state.snapshot.phase);
}
```

- [ ] **Step 6: Implement diagnostic gating**

```ts
import { serverLogger } from "#veryfront/utils";
import type {
  StreamDiagnosticEvent,
  StreamDiagnosticPolicy,
  StreamDiagnosticSink,
  StreamRawDiagnosticCandidate,
  StreamSafeDiagnosticEvent,
} from "./types.ts";

const diagnosticLogger = serverLogger.component("stream-lifecycle");

export function createDefaultDiagnosticPolicy(): StreamDiagnosticPolicy {
  return { rawCapture: "disabled", redact: () => null };
}

export function acceptDiagnosticCandidate(
  policy: StreamDiagnosticPolicy,
  candidate: StreamRawDiagnosticCandidate,
): StreamSafeDiagnosticEvent | null {
  if (policy.rawCapture !== "redacted") return null;
  return policy.redact(candidate);
}

export function createDefaultDiagnosticSink(): StreamDiagnosticSink {
  return {
    report(event) {
      diagnosticLogger.warn("Stream lifecycle diagnostic", {
        diagnosticType: event.type,
        ...(event.type === "provider_cleanup_failed" && event.diagnosticId
          ? { diagnosticId: event.diagnosticId }
          : {}),
      });
    },
  };
}

export function reportLifecycleDiagnostic(
  sink: StreamDiagnosticSink,
  event: StreamDiagnosticEvent,
): void {
  try {
    sink.report(event);
  } catch {
    // Diagnostic reporting is fail-open and cannot alter stream control flow.
  }
}
```

- [ ] **Step 7: Run reducer and diagnostic checks**

Run: `deno fmt src/agent/streaming/lifecycle/`

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/reducer.test.ts src/agent/streaming/lifecycle/tool-input.test.ts src/agent/streaming/lifecycle/diagnostics.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit tool and diagnostic semantics**

```bash
git add src/agent/streaming/lifecycle
git commit -m "Reject invalid tool inputs before execution ownership" \
  -m "Constraint: Local denial remains outside the provider stream attempt" \
  -m "Rejected: Treat malformed input as denied | conflates validation with authorization" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: reducer and diagnostic policy tests"
```

### Task 4: Add deterministic clocks and scripted providers

**Files:**

- Create: `src/agent/streaming/lifecycle/testing.ts`
- Create: `src/agent/streaming/lifecycle/testing.test.ts`
- Modify: `src/agent/streaming/lifecycle/index.ts`

**Interfaces:**

- Consumes: `MonotonicClock` and `StreamProviderAdapter<T>`.
- Produces: `ManualMonotonicClock`, `createDeferred<T>()`, and `createScriptedStreamProvider<T>()` for lifecycle tests.

- [ ] **Step 1: Write failing fake-clock and cleanup tests**

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ManualMonotonicClock, createScriptedStreamProvider } from "./testing.ts";

describe("stream lifecycle testing adapters", () => {
  it("releases only deadlines reached by a monotonic advance", async () => {
    const clock = new ManualMonotonicClock();
    const first = clock.waitUntil(10);
    const second = clock.waitUntil(20);
    clock.advanceBy(10);
    assertEquals(await first, "deadline");
    assertEquals(clock.pendingWaitCount, 1);
    clock.advanceBy(10);
    assertEquals(await second, "deadline");
  });

  it("records one provider open and one cleanup request", async () => {
    const provider = createScriptedStreamProvider([{ type: "text-delta", text: "ok" }]);
    const iterator = provider.open(new AbortController().signal)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    assertEquals(provider.openCount, 1);
    assertEquals(provider.returnCount, 1);
  });
});
```

- [ ] **Step 2: Run the test and verify helpers are absent**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/testing.test.ts`

Expected: FAIL because `testing.ts` does not exist.

- [ ] **Step 3: Implement the manual clock without wall-time sleeps**

```ts
export class ManualMonotonicClock implements MonotonicClock {
  #nowMs = 0;
  #waiters = new Set<{
    deadlineMs: number;
    finish: (value: "deadline" | "aborted") => void;
  }>();

  get pendingWaitCount(): number {
    return this.#waiters.size;
  }

  nowMs(): number {
    return this.#nowMs;
  }

  waitUntil(deadlineMs: number, signal?: AbortSignal): Promise<"deadline" | "aborted"> {
    if (signal?.aborted) return Promise.resolve("aborted");
    if (deadlineMs <= this.#nowMs) return Promise.resolve("deadline");
    return new Promise((resolve) => {
      const waiter = {
        deadlineMs,
        finish: (value: "deadline" | "aborted") => {
          this.#waiters.delete(waiter);
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
      };
      const onAbort = () => waiter.finish("aborted");
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(waiter);
      if (signal?.aborted) waiter.finish("aborted");
    });
  }

  advanceBy(durationMs: number): void {
    if (durationMs < 0) throw new RangeError("Clock duration must be non-negative");
    this.#nowMs += durationMs;
    for (const waiter of [...this.#waiters]) {
      if (waiter.deadlineMs <= this.#nowMs) waiter.finish("deadline");
    }
  }
}
```

- [ ] **Step 4: Implement a controllable single-source Adapter**

```ts
import type {
  StreamProviderAdapter,
  StreamProviderError,
  StreamSignal,
  StreamSnapshot,
} from "./types.ts";

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}

export interface ScriptedStreamProvider<T> extends StreamProviderAdapter<T> {
  readonly openCount: number;
  readonly nextCount: number;
  readonly returnCount: number;
  resolveNext(value: IteratorResult<T>): void;
  rejectNext(error: unknown): void;
}

export function createScriptedStreamProvider<T>(
  values: readonly T[],
  options: { autoComplete?: boolean; returnError?: unknown } = {},
): ScriptedStreamProvider<T> {
  const queue: IteratorResult<T>[] = values.map((value) => ({ done: false, value }));
  const autoComplete = options.autoComplete ?? true;
  let openCount = 0;
  let nextCount = 0;
  let returnCount = 0;
  let closed = false;
  let pending: Deferred<IteratorResult<T>> | null = null;

  const settlePending = (result: IteratorResult<T>): void => {
    if (pending === null) queue.push(result);
    else {
      const current = pending;
      pending = null;
      current.resolve(result);
    }
  };

  return {
    get openCount() {
      return openCount;
    },
    get nextCount() {
      return nextCount;
    },
    get returnCount() {
      return returnCount;
    },
    open(signal) {
      if (openCount > 0) throw new Error("Scripted provider supports one open");
      openCount++;
      const onAbort = () => settlePending({ done: true, value: undefined });
      signal.addEventListener("abort", onAbort, { once: true });
      return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
          return {
            next() {
              nextCount++;
              if (closed || signal.aborted) {
                return Promise.resolve({ done: true, value: undefined });
              }
              const queued = queue.shift();
              if (queued) return Promise.resolve(queued);
              if (autoComplete) return Promise.resolve({ done: true, value: undefined });
              if (pending !== null) {
                return Promise.reject(new Error("Only one scripted provider read may be pending"));
              }
              pending = createDeferred<IteratorResult<T>>();
              return pending.promise;
            },
            return() {
              if (!closed) {
                closed = true;
                returnCount++;
                signal.removeEventListener("abort", onAbort);
                settlePending({ done: true, value: undefined });
                if (options.returnError !== undefined) {
                  return Promise.reject(options.returnError);
                }
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      };
    },
    decode(part: T, _snapshot: Readonly<StreamSnapshot>): readonly StreamSignal[] {
      return [part as unknown as StreamSignal];
    },
    classifyError(): StreamProviderError {
      return {
        code: "PROVIDER_STREAM_ERROR",
        publicMessage: "Provider stream failed",
        retryable: true,
        terminal: false,
      };
    },
    resolveNext(result) {
      settlePending(result);
    },
    rejectNext(error) {
      if (pending === null) throw new Error("No scripted provider read is pending");
      const current = pending;
      pending = null;
      current.reject(error);
    },
  };
}

export function createControllableSignalProvider(): ScriptedStreamProvider<StreamSignal> {
  return createScriptedStreamProvider<StreamSignal>([], { autoComplete: false });
}
```

- [ ] **Step 5: Run helper tests**

Run: `deno fmt src/agent/streaming/lifecycle/`

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/testing.test.ts`

Expected: PASS without real-time delay.

- [ ] **Step 6: Commit deterministic test infrastructure**

```bash
git add src/agent/streaming/lifecycle
git commit -m "Make stream timing reproducible without wall time" \
  -m "Constraint: Deadline tests must not sleep" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: deno test --no-check --allow-all src/agent/streaming/lifecycle/testing.test.ts"
```

### Task 5: Own lazy consumption, cancellation, cleanup, and Stream Outcome

**Files:**

- Create: `src/agent/streaming/lifecycle/cancellation.ts`
- Create: `src/agent/streaming/lifecycle/runner.ts`
- Create: `src/agent/streaming/lifecycle/runner.test.ts`
- Modify: `src/agent/streaming/lifecycle/index.ts`

**Interfaces:**

- Consumes: Task 1 contracts, Task 3 reducer and diagnostics, Task 4 scripted provider.
- Produces: `runStreamLifecycle<TProviderPart>(input): StreamLifecycleRun` and internal `createCancellationCoordinator()`.

- [ ] **Step 1: Write failing lazy and single-consumer tests**

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StreamAlreadyConsumedError } from "./errors.ts";
import { runStreamLifecycle } from "./runner.ts";
import { createScriptedStreamProvider } from "./testing.ts";
import type { StreamDiagnosticEvent } from "./types.ts";

describe("runStreamLifecycle", () => {
  it("opens lazily and rejects a second frame consumer", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    assertEquals(provider.openCount, 0);
    const first = run.frames[Symbol.asyncIterator]();
    assertEquals(provider.openCount, 0);
    assertThrows(
      () => run.frames[Symbol.asyncIterator](),
      StreamAlreadyConsumedError,
    );
    await first.next();
    assertEquals(provider.openCount, 1);
  });

  it("keeps outcome pending until frame iteration starts", async () => {
    const provider = createScriptedStreamProvider([]);
    const run = runStreamLifecycle({ provider });
    let settled = false;
    void run.outcome.then(() => settled = true);
    await Promise.resolve();
    assertEquals(settled, false);
    await run.frames[Symbol.asyncIterator]().next();
    assertEquals((await run.outcome).status, "failed");
  });
});
```

- [ ] **Step 2: Write failing cancellation and cleanup tests**

```ts
it("uses pre-aborted source precedence and records phase", async () => {
  const user = new AbortController();
  const parent = new AbortController();
  parent.abort("parent");
  user.abort("user");
  const provider = createScriptedStreamProvider([]);
  const run = runStreamLifecycle({
    provider,
    cancellations: [
      { source: "parent", signal: parent.signal },
      { source: "user", signal: user.signal },
    ],
  });
  await run.frames[Symbol.asyncIterator]().next();
  const outcome = await run.outcome;
  assertEquals(outcome.status, "cancelled");
  if (outcome.status === "cancelled") assertEquals(outcome.source, "user");
  assertEquals(outcome.phase, "cancelled");
  assertEquals(outcome.snapshot.phase, "cancelled");
});

it("turns consumer return into one cleanup request", async () => {
  const provider = createScriptedStreamProvider([
    { kind: "protocol", event: { type: "text_content", delta: "hello" } },
  ]);
  const run = runStreamLifecycle({ provider });
  const iterator = run.frames[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return?.();
  const outcome = await run.outcome;
  assertEquals(outcome.status, "cancelled");
  if (outcome.status === "cancelled") assertEquals(outcome.source, "consumer_stopped");
  assertEquals(provider.returnCount, 1);
});

it("records an abort after run creation but before first next without opening the provider", async () => {
  const controller = new AbortController();
  const provider = createScriptedStreamProvider([]);
  const run = runStreamLifecycle({
    provider,
    cancellations: [{ source: "runtime", signal: controller.signal }],
  });

  controller.abort("runtime stop");
  assertEquals(provider.openCount, 0);
  await run.frames[Symbol.asyncIterator]().next();
  const outcome = await run.outcome;

  assertEquals(provider.openCount, 0);
  assertEquals(outcome.status, "cancelled");
  if (outcome.status === "cancelled") assertEquals(outcome.source, "runtime");
});

it("reports cleanup failure without replacing the committed outcome", async () => {
  const cleanupError = new Error("cleanup sentinel");
  const reported: StreamDiagnosticEvent[] = [];
  const provider = createScriptedStreamProvider([
    { kind: "protocol", event: { type: "text_content", delta: "hello" } },
  ], { returnError: cleanupError });
  const run = runStreamLifecycle({
    provider,
    diagnosticSink: { report: (event) => reported.push(event) },
  });
  const iterator = run.frames[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return?.();
  await Promise.resolve();

  const outcome = await run.outcome;
  assertEquals(outcome.status, "cancelled");
  if (outcome.status === "cancelled") assertEquals(outcome.source, "consumer_stopped");
  assertEquals(reported.map((event) => event.type), ["provider_cleanup_failed"]);
  assertEquals(JSON.stringify(reported).includes(cleanupError.message), false);
});

it("can stop before the first read without opening the provider", async () => {
  const provider = createScriptedStreamProvider([]);
  const run = runStreamLifecycle({ provider });
  const iterator = run.frames[Symbol.asyncIterator]();
  await iterator.return?.();
  const outcome = await run.outcome;
  assertEquals(outcome.status, "cancelled");
  if (outcome.status === "cancelled") {
    assertEquals(outcome.source, "consumer_stopped");
  }
  assertEquals(provider.openCount, 0);
  assertEquals(provider.returnCount, 0);
});
```

- [ ] **Step 3: Run the test and verify the runner is absent**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/runner.test.ts`

Expected: FAIL because `runner.ts` and `cancellation.ts` do not exist.

- [ ] **Step 4: Implement source-tagged cancellation before opening the provider**

```ts
const CANCELLATION_PRECEDENCE = [
  "user",
  "parent",
  "runtime",
  "client_disconnected",
] as const;

export function createCancellationCoordinator(
  inputs: readonly StreamCancellationInput[],
  onCancel: (source: StreamCancellationSource) => void,
) {
  const controller = new AbortController();
  let source: StreamCancellationSource | null = null;
  const listeners: Array<() => void> = [];
  const select = (next: StreamCancellationSource, reason?: unknown) => {
    if (source !== null) return;
    source = next;
    onCancel(next);
    controller.abort(reason);
  };

  const preAborted = CANCELLATION_PRECEDENCE.find((candidate) =>
    inputs.some((input) => input.source === candidate && input.signal.aborted)
  );
  if (preAborted) {
    const input = inputs.find((entry) => entry.source === preAborted);
    select(preAborted, input?.signal.reason);
  } else {
    for (const input of inputs) {
      const listener = () => select(input.source, input.signal.reason);
      input.signal.addEventListener("abort", listener, { once: true });
      listeners.push(() => input.signal.removeEventListener("abort", listener));
    }
  }

  return {
    signal: controller.signal,
    get source() {
      return source;
    },
    stopConsumer() {
      select("consumer_stopped");
    },
    abortProvider(reason?: unknown) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    dispose() {
      for (const remove of listeners) remove();
    },
  };
}
```

- [ ] **Step 5: Implement a lazy iterator around one provider iterator**

Use a deferred outcome whose `settle()` method ignores every call after the first. The returned `frames` object sets `consumed = true` in `[Symbol.asyncIterator]()` and creates the provider iterator only inside the first `next()` execution.

```ts
import {
  acceptDiagnosticCandidate,
  createDefaultDiagnosticPolicy,
  createDefaultDiagnosticSink,
  reportLifecycleDiagnostic,
} from "./diagnostics.ts";
import {
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
} from "#veryfront/agent/streaming/stream-outcome.ts";

export function runStreamLifecycle<TProviderPart>(
  input: StreamLifecycleInput<TProviderPart>,
): StreamLifecycleRun {
  const policy = resolveStreamLifecyclePolicy(input.policy);
  const diagnostics = input.diagnostics ?? createDefaultDiagnosticPolicy();
  const diagnosticSink = input.diagnosticSink ?? createDefaultDiagnosticSink();
  const outcome = createOutcomeDeferred();
  let consumed = false;
  let providerIterator: AsyncIterator<TProviderPart> | null = null;
  let cancellation: ReturnType<typeof createCancellationCoordinator> | null = null;
  let reducer = createInitialReducerState();
  let cleanupRequested = false;

  const settleCancelled = (source: StreamCancellationSource) => {
    if (outcome.settled) return;
    reducer = terminateReducer(reducer, "cancelled");
    outcome.settle(createCancelledOutcome(reducer.snapshot, source, policy.clock.nowMs()));
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
      providerIterator = input.provider.open(activeCancellation.signal)[Symbol.asyncIterator]();
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
          const reduced = reduceStreamSignal(reducer, signal, policy.clock.nowMs());
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
```

Add these private helpers. Task 11 moves the same terminal construction into the shared `resolveStreamOutcome()` without changing these outcomes.

```ts
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
  event: Extract<StreamLifecycleFrame, { class: "diagnostic" }>['event'],
  elapsedMs: number,
): StreamLifecycleFrame {
  return { class: "diagnostic", event, sequence: ++reducer.sequence, elapsedMs };
}
```

- [ ] **Step 6: Run consumption, cancellation, and existing outcome tests**

Run: `deno fmt src/agent/streaming/lifecycle/`

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/runner.test.ts src/agent/streaming/stream-outcome.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit exactly-once lifecycle settlement**

```bash
git add src/agent/streaming/lifecycle
git commit -m "Settle every provider stream attempt exactly once" \
  -m "Constraint: Consumer cleanup cannot replace a committed outcome" \
  -m "Rejected: Await provider iterator return before settling | a hanging provider would hang finalization" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: lifecycle runner and existing Stream Outcome tests"
```

### Task 6: Implement provider-wait deadlines and lifecycle-owned status cadence

**Files:**

- Create: `src/agent/streaming/lifecycle/deadlines.ts`
- Create: `src/agent/streaming/lifecycle/deadlines.test.ts`
- Modify: `src/agent/streaming/lifecycle/reducer.ts`
- Modify: `src/agent/streaming/lifecycle/reducer.test.ts`
- Modify: `src/agent/streaming/lifecycle/runner.ts`
- Modify: `src/agent/streaming/lifecycle/runner.test.ts`
- Modify: `src/agent/streaming/lifecycle/index.ts`

**Interfaces:**

- Consumes: `MonotonicClock`, resolved policy, current phase, active tool snapshots, and one pending provider-read promise.
- Produces: `createStreamDeadlineController()` and `raceProviderRead()` with results `part | status | provider_timeout | attempt_timeout | cancelled`.

- [ ] **Step 1: Write the heartbeat regression with a manual clock**

```ts
it("does not let five-second status telemetry extend tool-input idle", async () => {
  const clock = new ManualMonotonicClock();
  const provider = createControllableSignalProvider();
  const run = runStreamLifecycle({
    provider,
    policy: {
      clock,
      toolInputIdleTimeoutMs: 15_000,
      statusIntervalMs: 5_000,
      attemptTimeoutMs: 60_000,
    },
  });
  const iterator = run.frames[Symbol.asyncIterator]();
  provider.resolveNext({
    done: false,
    value: { kind: "protocol", event: { type: "tool_input_start", toolCallId: "t1", toolName: "create_file" } },
  });
  await iterator.next();

  for (let heartbeat = 0; heartbeat < 2; heartbeat++) {
    const pending = iterator.next();
    clock.advanceBy(5_000);
    const frame = await pending;
    assertEquals(frame.value?.class, "telemetry");
  }
  const terminal = iterator.next();
  clock.advanceBy(5_000);
  await terminal;
  const outcome = await run.outcome;
  assertEquals(outcome.status, "failed");
  if (outcome.status === "failed") assertEquals(outcome.error.code, "TOOL_INPUT_TIMEOUT");
  assertEquals(provider.nextCount, 2);
});
```

The final `nextCount` proves repeated status frames retained one in-flight provider read instead of starting a second read.

- [ ] **Step 2: Write both backpressure sides of the absolute-limit race**

```ts
it("pauses provider idle while a frame is held but keeps total attempt time", async () => {
  const clock = new ManualMonotonicClock();
  const provider = createControllableSignalProvider();
  const run = runStreamLifecycle({
    provider,
    policy: {
      clock,
      semanticIdleTimeoutMs: 15_000,
      statusIntervalMs: 5_000,
      attemptTimeoutMs: 30_000,
    },
  });
  const iterator = run.frames[Symbol.asyncIterator]();
  const firstRead = iterator.next();
  provider.resolveNext({
    done: false,
    value: { kind: "protocol", event: { type: "text_start", id: "text-1" } },
  });
  const held = await firstRead;
  assertEquals(held.value?.class, "semantic");
  clock.advanceBy(20_000);
  assertEquals((await Promise.race([run.outcome.then(() => "settled"), Promise.resolve("pending")])), "pending");

  const pending = iterator.next();
  clock.advanceBy(10_000);
  assertEquals((await pending).done, true);
  const outcome = await run.outcome;
  assertEquals(outcome.status, "failed");
  if (outcome.status === "failed") assertEquals(outcome.error.code, "STREAM_ATTEMPT_TIMEOUT");
});

it("resumes the remaining provider-wait budget after consumer backpressure", async () => {
  const clock = new ManualMonotonicClock();
  const provider = createControllableSignalProvider();
  const run = runStreamLifecycle({
    provider,
    policy: {
      clock,
      toolInputIdleTimeoutMs: 15_000,
      statusIntervalMs: 60_000,
      attemptTimeoutMs: 60_000,
    },
  });
  const iterator = run.frames[Symbol.asyncIterator]();
  provider.resolveNext({
    done: false,
    value: {
      kind: "protocol",
      event: {
        type: "tool_input_start",
        toolCallId: "t1",
        toolName: "create_file",
      },
    },
  });
  await iterator.next();

  // Registered custom metadata yields one semantic frame, but it is not one
  // of the reducer-approved semantic-progress events and cannot reset tool idle.
  const heldFrame = iterator.next();
  clock.advanceBy(5_000);
  provider.resolveNext({
    done: false,
    value: {
      kind: "protocol",
      event: { type: "custom", name: "provider-metadata", data: null },
    },
  });
  assertEquals((await heldFrame).value?.class, "semantic");

  clock.advanceBy(20_000);
  const pending = iterator.next();
  clock.advanceBy(9_999);
  assertEquals(
    await Promise.race([pending.then(() => "settled"), Promise.resolve("pending")]),
    "pending",
  );
  clock.advanceBy(1);
  assertEquals((await pending).done, true);
  const outcome = await run.outcome;
  assertEquals(outcome.status, "failed");
  if (outcome.status === "failed") {
    assertEquals(outcome.error.code, "TOOL_INPUT_TIMEOUT");
    assertEquals(outcome.error.source, "tool");
  }
});

it("discards a cached provider result when the attempt deadline wins", async () => {
  const clock = new ManualMonotonicClock();
  const provider = createControllableSignalProvider();
  const run = runStreamLifecycle({
    provider,
    policy: { clock, statusIntervalMs: 5_000, toolInputIdleTimeoutMs: 20_000, attemptTimeoutMs: 30_000 },
  });
  const iterator = run.frames[Symbol.asyncIterator]();
  provider.resolveNext({
    done: false,
    value: { kind: "protocol", event: { type: "tool_input_start", toolCallId: "t1", toolName: "create_file" } },
  });
  await iterator.next();
  const status = iterator.next();
  clock.advanceBy(5_000);
  await status;
  provider.resolveNext({
    done: false,
    value: { kind: "protocol", event: { type: "tool_input_content", toolCallId: "t1", delta: '{"path":"a.md"}' } },
  });
  clock.advanceBy(25_000);
  const outcome = await run.outcome;
  assertEquals(outcome.status, "failed");
  if (outcome.status === "failed") {
    assertEquals(outcome.error.code, "STREAM_ATTEMPT_TIMEOUT");
    assertEquals(outcome.error.source, "runtime");
  }
  assertEquals((await iterator.next()).done, true);
});
```

Add the companion case to `runner.test.ts`:

```ts
it("reduces a cached provider result when the consumer resumes before the attempt limit", async () => {
  const clock = new ManualMonotonicClock();
  const provider = createControllableSignalProvider();
  const run = runStreamLifecycle({
    provider,
    policy: {
      clock,
      statusIntervalMs: 5_000,
      toolInputIdleTimeoutMs: 60_000,
      attemptTimeoutMs: 30_000,
    },
  });
  const iterator = run.frames[Symbol.asyncIterator]();
  const firstRead = iterator.next();
  provider.resolveNext({
    done: false,
    value: {
      kind: "protocol",
      event: { type: "tool_input_start", toolCallId: "t1", toolName: "create_file" },
    },
  });
  await firstRead;

  const status = iterator.next();
  clock.advanceBy(5_000);
  await status;
  provider.resolveNext({
    done: false,
    value: {
      kind: "protocol",
      event: {
        type: "tool_input_content",
        toolCallId: "t1",
        delta: '{"path":"a.md"}',
      },
    },
  });
  clock.advanceBy(24_999);
  const cached = await iterator.next();
  assertEquals(cached.value?.class, "semantic");
  assertEquals(cached.value?.event.type, "tool_input_content");
});
```

- [ ] **Step 3: Run deadline tests and verify they fail**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/deadlines.test.ts src/agent/streaming/lifecycle/runner.test.ts`

Expected: FAIL because the runner waits directly on `providerIterator.next()` and has no phase scheduler.

- [ ] **Step 4: Implement one phase scheduler plus one independent attempt timer**

```ts
export interface TrackedProviderRead<T> {
  readonly promise: Promise<IteratorResult<T>>;
  readonly settled: boolean;
  readonly settledAtMs: number | null;
  readonly result: IteratorResult<T> | null;
  readonly error: unknown;
}

export type StreamReadRace<T> =
  | { kind: "part"; result: IteratorResult<T> }
  | { kind: "read_error"; error: unknown }
  | { kind: "status"; toolCallIds: readonly string[] }
  | { kind: "provider_deadline"; deadline: StreamProviderDeadlineKind }
  | { kind: "attempt_timeout" }
  | { kind: "cancelled" };

export interface StreamDeadlineController {
  readonly attemptDeadlineMs: number;
  resumeProviderWait(snapshot: Readonly<StreamSnapshot>): void;
  pauseProviderWait(): void;
  noteSemanticProgress(snapshot: Readonly<StreamSnapshot>): void;
  raceProviderRead<T>(read: TrackedProviderRead<T>, signal: AbortSignal): Promise<StreamReadRace<T>>;
  dispose(): void;
}
```

Create every provider read through this tracker so cached-read and deadline ties are observable without starting another read:

```ts
export function trackProviderRead<T>(
  promise: Promise<IteratorResult<T>>,
  clock: MonotonicClock,
): TrackedProviderRead<T> {
  let settled = false;
  let settledAtMs: number | null = null;
  let result: IteratorResult<T> | null = null;
  let error: unknown;
  const tracked = promise.then(
    (value) => {
      settled = true;
      settledAtMs = clock.nowMs();
      result = value;
      return value;
    },
    (caught) => {
      settled = true;
      settledAtMs = clock.nowMs();
      error = caught;
      throw caught;
    },
  );
  void tracked.catch(() => undefined);
  return {
    promise: tracked,
    get settled() {
      return settled;
    },
    get settledAtMs() {
      return settledAtMs;
    },
    get result() {
      return result;
    },
    get error() {
      return error;
    },
  };
}
```

The controller stores the remaining duration for only the provider deadline selected by the current snapshot:

| Snapshot state | Active provider deadline | Initial/reset budget |
|---|---|---:|
| no semantic progress | `first_progress` | `firstProgressTimeoutMs` |
| local input open or streaming | `tool_input_idle` | `toolInputIdleTimeoutMs` |
| at least one valid local input ready | `tool_commit_grace` | `toolCommitGraceMs` |
| other non-terminal streaming | `semantic_idle` | `semanticIdleTimeoutMs` |
| terminal | none | none |

`resumeProviderWait()` converts that remaining duration to an absolute provider deadline only while a read is pending. `pauseProviderWait()` subtracts elapsed provider-wait time and aborts the current phase wait. `noteSemanticProgress()` resets the budget selected by the new snapshot but does not start it until the next provider read.

Status cadence follows four exact rules:

1. Entering local `input_open` or `input_streaming` sets `nextStatusDueMs = nowMs + statusIntervalMs`.
2. Non-empty tool-input content resets `nextStatusDueMs` from that progress time.
3. A status wake-up advances only `nextStatusDueMs`; it never edits or resets a provider deadline.
4. Leaving local input wait clears status cadence. If any local call becomes ready, `tool_commit_grace` is selected even while another local call remains open.

`raceProviderRead()` re-evaluates ready conditions in this exact priority order after every wake-up:

1. A source-tagged external cancellation already recorded by the cancellation coordinator.
2. `clock.nowMs() >= attemptDeadlineMs`, even when the provider read is cached.
3. A provider read settled at or before the active provider deadline; return its result or error.
4. The active provider deadline.
5. A due status tick.

This makes the absolute attempt deadline win every tie with a cached provider part, while a provider read wins a tie with a provider-idle deadline. The wait promise uses the minimum of the attempt deadline, active provider deadline, and next status due time. It never calls `next()`.

The runner owns one dispose controller created alongside the outcome deferred: `const disposeController = new AbortController()` with `const disposeSignal = disposeController.signal`. Abort it in the generator's `finally` block after `cleanup()` and from `deadlines.dispose()`, so no clock wait outlives the run. Construct the controller once per consumption: `const deadlines = createStreamDeadlineController({ clock: policy.clock, policy, attemptDeadlineMs, disposeSignal })`.

Start the attempt wait once on first frame consumption. Its callback settles and aborts independently of generator demand, so it still fires while the consumer holds a yielded frame:

```ts
const attemptDeadlineMs = clock.nowMs() + policy.attemptTimeoutMs;
const settleAttemptTimeout = () => {
  if (outcome.settled) return;
  const failed = createFailedOutcome(reducer.snapshot, clock.nowMs(), {
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
void clock.waitUntil(attemptDeadlineMs, disposeSignal).then((result) => {
  if (result === "deadline") settleAttemptTimeout();
});
```

Before reducing any read result, check `clock.nowMs() >= attemptDeadlineMs`; return `attempt_timeout` when equal.

Add two reducer entry points for local deadline resolution:

```ts
export type LocalToolDeadlineResolution =
  | { kind: "handoff"; reduction: StreamReduction }
  | { kind: "failed"; reduction: StreamReduction; code: "TOOL_INPUT_TIMEOUT" | "TOOL_INPUT_INCOMPLETE" };

export function resolveLocalToolDeadline(
  current: StreamReducerState,
  reason: "tool_input_idle" | "tool_commit_grace",
  elapsedMs: number,
): LocalToolDeadlineResolution;
```

For `tool_commit_grace`, hand off every already-ready local call. For `tool_input_idle`, strictly parse each open or streaming local input with `parseCanonicalToolInput()`: emit `tool_input_ready` for valid objects and `tool_input_rejected` for invalid or malformed values. Hand off when at least one local call is ready. If none is ready, return `TOOL_INPUT_INCOMPLETE` when any non-placeholder input was received, otherwise `TOOL_INPUT_TIMEOUT`. A failed reduction retains the pre-terminal `awaiting_tool_input` phase so `StreamLifecycleError.phase` records where termination occurred; the outcome constructor changes its snapshot to `failed`. Provider-executed calls never enter local handoff.

- [ ] **Step 5: Integrate the scheduler without adding reads**

Replace the direct `await providerIterator.next()` in `runner.ts` with one retained promise:

```ts
let pendingRead: TrackedProviderRead<TProviderPart> | null = null;
while (!outcome.settled) {
  pendingRead ??= trackProviderRead(providerIterator.next(), policy.clock);
  deadlines.resumeProviderWait(reducer.snapshot);
  const raced = await deadlines.raceProviderRead(pendingRead, activeCancellation.signal);
  deadlines.pauseProviderWait();

  if (raced.kind === "status") {
    for (const toolCallId of raced.toolCallIds) {
      if (outcome.settled) return;
      const tool = reducer.snapshot.tools.find((entry) => entry.id === toolCallId);
      if (!tool || (tool.phase !== "input_open" && tool.phase !== "input_streaming")) {
        continue;
      }
      const frame = sequenceTelemetry(reducer, {
        type: "tool_input_status",
        toolCallId,
        status: tool.phase === "input_streaming"
          ? "streaming_input"
          : "pending_input",
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
      if (resolved.kind === "handoff") settleReducerTerminal(outcome, reducer, policy.clock.nowMs());
      else {
        const failed = createFailedOutcome(reducer.snapshot, policy.clock.nowMs(), {
          code: resolved.code,
          source: "tool",
          retryable: false,
          publicMessage: resolved.code === "TOOL_INPUT_TIMEOUT"
            ? "Tool input did not arrive before the deadline"
            : "Tool input ended before a valid object was complete",
        });
        reducer = { ...reducer, terminal: true, snapshot: failed.snapshot };
        outcome.settle(failed);
      }
      for (const frame of resolved.reduction.frames) yield frame;
    } else {
      const code = raced.deadline === "first_progress"
        ? "FIRST_PROGRESS_TIMEOUT" as const
        : "SEMANTIC_IDLE_TIMEOUT" as const;
      const failed = createFailedOutcome(reducer.snapshot, policy.clock.nowMs(), {
        code,
        source: "provider",
        retryable: true,
        publicMessage: code === "FIRST_PROGRESS_TIMEOUT"
          ? "Provider did not produce semantic progress"
          : "Provider stopped producing semantic progress",
      });
      reducer = { ...reducer, terminal: true, snapshot: failed.snapshot };
      outcome.settle(failed);
    }
    activeCancellation.abortProvider(new DOMException("Stream provider deadline reached", "AbortError"));
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
    const reduced = reduceStreamSignal(reducer, signal, policy.clock.nowMs());
    reducer = reduced.state;
    if (reduced.semanticProgress) deadlines.noteSemanticProgress(reducer.snapshot);
    const terminalCommitted = reducer.terminal;
    if (terminalCommitted) settleReducerTerminal(outcome, reducer, policy.clock.nowMs());
    for (const frame of reduced.frames) {
      if (!terminalCommitted && outcome.settled) return;
      yield frame;
      if (!terminalCommitted && outcome.settled) return;
    }
    if (reducer.terminal) return;
  }
}
```

Use this exact telemetry sequencer next to `sequenceDiagnostic()`:

```ts
function sequenceTelemetry(
  reducer: StreamReducerState,
  event: StreamTelemetryEvent,
  elapsedMs: number,
): StreamLifecycleFrame {
  return { class: "telemetry", event, sequence: ++reducer.sequence, elapsedMs };
}
```

The generator remains paused after every `yield`, so provider-wait clocks remain paused. A status wake-up retains `pendingRead`; a provider part sets it to `null` and does not prefetch. The attempt callback settles the outcome and aborts the provider even while the generator is suspended. Add assertions that every controller wait is aborted in `dispose()` and `ManualMonotonicClock.pendingWaitCount` returns to zero.

- [ ] **Step 6: Run all lifecycle tests**

Run: `deno fmt src/agent/streaming/lifecycle/`

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/`

Expected: PASS with no wall-time sleeps and no pending timer leak.

- [ ] **Step 7: Commit deadline ownership**

```bash
git add src/agent/streaming/lifecycle
git commit -m "Prevent telemetry and delivery stalls from extending provider deadlines" \
  -m "Constraint: Provider-wait clocks pause under consumer backpressure; total attempt time does not" \
  -m "Rejected: Restart relative timers after every frame | status heartbeats can postpone failure forever" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: complete lifecycle interface test directory"
```

### Task 7: Normalize the existing runtime stream boundary

**Files:**

- Create: `src/agent/streaming/lifecycle/runtime-provider-adapter.ts`
- Create: `src/agent/streaming/lifecycle/runtime-provider-adapter.test.ts`
- Modify: `src/agent/streaming/lifecycle/index.ts`
- Modify: `src/agent/runtime/runtime-tool-types.ts`

**Interfaces:**

- Consumes: `RuntimeStreamPart`, `mergeToolCallInput()`, `parseToolInputObject()`, `isDynamicTool()`, `getToolResultError()`, and existing provider error helpers.
- Produces: `createRuntimeStreamProviderAdapter(input)` and `decodeRuntimeStreamPart(part, snapshot, options)`.

- [ ] **Step 1: Write table-driven Adapter tests**

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInitialReducerState } from "./reducer.ts";
import { decodeRuntimeStreamPart } from "./runtime-provider-adapter.ts";

const snapshot = createInitialReducerState().snapshot;
const options = {
  availableToolNames: new Set(["create_file", "web_search"]),
  providerExecutedToolNames: new Set(["web_search"]),
};

describe("runtime stream Provider Adapter", () => {
  it("maps runtime parts to provider-neutral signals", () => {
    assertEquals(
      decodeRuntimeStreamPart({ type: "text-delta", text: "hi" }, snapshot, options),
      [{ kind: "protocol", event: { type: "text_content", delta: "hi" } }],
    );
    assertEquals(
      decodeRuntimeStreamPart({
        type: "data-tool-call-status",
        data: { toolCallId: "t1", status: "pending_input" },
      }, snapshot, options),
      [],
    );
  });

  it("normalizes result and output payload names", () => {
    const toolSnapshot = {
      ...snapshot,
      tools: [{
        id: "native-1",
        name: "web_search",
        phase: "input_ready" as const,
        inputText: "{}",
        inputDeltas: [],
        input: {},
        providerExecuted: true,
      }],
    };
    assertEquals(
      decodeRuntimeStreamPart({
        type: "tool-result",
        toolCallId: "native-1",
        toolName: "web_search",
        result: { answer: 42 },
      }, toolSnapshot, options),
      [
        {
          kind: "protocol",
          event: {
            type: "provider_tool_start",
            toolCallId: "native-1",
            toolName: "web_search",
            providerExecuted: true,
          },
        },
        {
          kind: "protocol",
          event: {
            type: "provider_tool_result",
            toolCallId: "native-1",
            toolName: "web_search",
            output: { answer: 42 },
            isError: false,
            providerExecuted: true,
          },
        },
      ],
    );
  });

  it("rejects unavailable tools before handoff", () => {
    assertEquals(
      decodeRuntimeStreamPart({
        type: "tool-input-start",
        id: "missing-1",
        toolName: "missing_tool",
      }, snapshot, options)[0],
      {
        kind: "protocol",
        event: {
          type: "tool_input_rejected",
          toolCallId: "missing-1",
          toolName: "missing_tool",
          reason: "unavailable",
        },
      },
    );
  });

  it("turns unknown provider parts into diagnostic candidates", () => {
    assertEquals(
      decodeRuntimeStreamPart({ type: "future-part", secret: "<REDACTED>" }, snapshot, options),
      [{
        kind: "diagnostic_candidate",
        candidate: { kind: "unknown_runtime_part", value: { partType: "future-part" } },
      }],
    );
  });
});
```

- [ ] **Step 2: Run the Adapter test and verify it fails**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/runtime-provider-adapter.test.ts`

Expected: FAIL because the Adapter does not exist.

- [ ] **Step 3: Implement exhaustive runtime-part decoding**

`decodeRuntimeStreamPart()` must handle every member of `RuntimeStreamPart` and an `unknown` fallback:

```ts
export interface RuntimeStreamProviderOptions {
  availableToolNames: ReadonlySet<string> | null;
  providerExecutedToolNames: ReadonlySet<string>;
}

export function decodeRuntimeStreamPart(
  part: unknown,
  snapshot: Readonly<StreamSnapshot>,
  options: RuntimeStreamProviderOptions,
): readonly StreamSignal[] {
  if (!part || typeof part !== "object" || typeof (part as { type?: unknown }).type !== "string") {
    return [{
      kind: "diagnostic_candidate",
      candidate: { kind: "unknown_runtime_part", value: { partType: typeof part } },
    }];
  }
  const rawType = (part as { type: string }).type;
  const typed = part as RuntimeStreamPart;
  if (typed.type.startsWith("data-")) {
    if (typed.type === "data-tool-call-status") return [];
    return [{
      kind: "protocol",
      event: { type: "custom", name: typed.type.slice(5), data: typed.data },
    }];
  }

  switch (typed.type) {
    case "text-delta":
      return [{ kind: "protocol", event: { type: "text_content", delta: typed.text } }];
    case "reasoning-start":
      return [{ kind: "protocol", event: { type: "reasoning_start", id: typed.id || "reasoning" } }];
    case "reasoning-delta":
      return [{ kind: "protocol", event: { type: "reasoning_content", id: typed.id || "reasoning", delta: typed.delta } }];
    case "reasoning-end":
      return [{ kind: "protocol", event: { type: "reasoning_end", id: typed.id || "reasoning", ...(typed.signature ? { signature: typed.signature } : {}), ...(typed.redactedData ? { redactedData: typed.redactedData } : {}) } }];
    case "tool-input-start":
      return [toolStartSignal(typed, options)];
    case "tool-input-delta":
      return [{ kind: "protocol", event: { type: "tool_input_content", toolCallId: typed.id, delta: typed.delta } }];
    case "tool-input-end":
      return [toolEndSignal(typed.id, snapshot)];
    case "tool-input-available":
      return [toolReadySignal(typed.toolCallId ?? typed.id, typed, options)];
    case "tool-call":
      return [toolReadySignal(typed.toolCallId, typed, options)];
    case "tool-result":
      return providerToolResultSignals(typed, snapshot, options);
    case "tool-error":
      return providerToolErrorSignals(typed, snapshot, options);
    case "finish":
      return [
        ...(typed.totalUsage ? [{ kind: "usage" as const, usage: normalizeRuntimeUsage(typed.totalUsage) }] : []),
        { kind: "protocol", event: { type: "step_finish", finishReason: normalizeFinishReason(typed.finishReason) } } as const,
      ];
    case "error":
      return [{ kind: "provider_error", error: classifyRuntimeProviderError(typed.error) }];
    default:
      return [{
        kind: "diagnostic_candidate",
        candidate: { kind: "unknown_runtime_part", value: { partType: rawType } },
      }];
  }
}
```

Helper rules are exact:

- `toolStartSignal()` returns `tool_input_rejected/unavailable` when the tool is absent from `availableToolNames`; otherwise it returns `tool_input_start` and resolves `providerExecuted` from the explicit flag first, then the configured name set.
- `toolEndSignal()` reads the matching `snapshot.tools[].inputText`, strips the transient empty-object placeholder, and returns `tool_input_ready` only for a parsed object. It returns `tool_input_rejected/malformed` for every other value.
- `toolReadySignal()` requires a non-empty ID, merges streamed and final input, parses with `parseToolInputObject()`, and preserves `dynamic` plus provider execution metadata.
- `providerToolResultSignals()` and `providerToolErrorSignals()` prepend `provider_tool_start` when the matching provider-executed tool is `input_ready`. When output arrives without input, they synthesize a documented `tool_input_start`, `tool_input_ready`, and `provider_tool_start` sequence, then append a sanitized compatibility-repair diagnostic candidate and the terminal provider-tool event. They never emit a provider terminal event directly from `input_ready`.
- `normalizeRuntimeUsage()` copies every usage field listed in `StreamUsage` without renaming or dropping billing fields.
- `classifyRuntimeProviderError()` uses `resolveKnownProviderTerminalError()` and `getStreamErrorMessage()` but exposes only the existing sanitized public provider message.
- `data-tool-call-status` always decodes to no signal. It is compatibility telemetry from an old wrapper, never semantic provider input, and active cadence comes only from the lifecycle scheduler.

`createRuntimeStreamProviderAdapter()` accepts an `open(signal)` callback rather than a raw iterable. Phase 1 can pass a pre-opened stream, while the target runtime can create the provider stream after cancellation listeners exist.

```ts
export function createRuntimeStreamProviderAdapter(input: {
  open(signal: AbortSignal): AsyncIterable<unknown>;
  options: RuntimeStreamProviderOptions;
}): StreamProviderAdapter<unknown> {
  return {
    open: input.open,
    decode: (part, snapshot) => decodeRuntimeStreamPart(part, snapshot, input.options),
    classifyError: (error) => classifyRuntimeProviderError(error),
  };
}
```

- [ ] **Step 4: Run Adapter and lifecycle tests**

Run: `deno fmt src/agent/streaming/lifecycle/ src/agent/runtime/runtime-tool-types.ts`

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/ src/agent/streaming/stream-outcome.test.ts`

Run:

```bash
deno check src/agent/streaming/lifecycle/index.ts \
  src/agent/streaming/lifecycle/runtime-provider-adapter.ts \
  src/agent/runtime/runtime-tool-types.ts
```

Expected: tests and targeted type checks PASS. This is the Gate 1 compile
preflight before shadow integration begins.

- [ ] **Step 5: Commit the provider-neutral seam**

```bash
git add src/agent/streaming/lifecycle src/agent/runtime/runtime-tool-types.ts
git commit -m "Stop runtime provider quirks at one Adapter" \
  -m "Constraint: Phase 1 starts at RuntimeStreamPart, not raw provider transport frames" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: runtime Provider Adapter and lifecycle tests"
```

### Task 8: Add the read-only shadow tap and divergence gate

**Files:**

- Create: `src/agent/runtime/stream-lifecycle-shadow.ts`
- Create: `src/agent/runtime/stream-lifecycle-shadow.test.ts`
- Create: `src/agent/runtime/stream-lifecycle-mode.ts`
- Create: `src/agent/runtime/stream-lifecycle-mode.test.ts`
- Modify: `src/agent/runtime/chat-stream-handler.ts:329-337, 601-622, 1070-1076`
- Modify: `src/agent/runtime/chat-stream-handler.test.ts`
- Modify: `src/agent/runtime/index.ts:1515-1548`

**Interfaces:**

- Consumes: pure runtime decoding and reducer functions. It does not consume `runStreamLifecycle()` and does not own an iterator.
- Produces: `createStreamLifecycleShadow()`, `StreamLifecycleShadowReport`, and rollout mode `legacy | shadow | active`.

- [ ] **Step 1: Write failing bounded-report tests**

```ts
it("reports only bounded divergence categories", () => {
  const shadow = createStreamLifecycleShadow({
    availableToolNames: ["create_file"],
    providerExecutedToolNames: [],
  });
  shadow.observePart({ type: "text-delta", text: "shadow secret" });
  const report = shadow.compareLegacySnapshot({
    ...createStreamState(),
    accumulatedText: "different secret",
  });
  assertEquals(report, { count: 1, categories: ["text"] });
  assertEquals(JSON.stringify(report).includes("secret"), false);
});

it("never reads from the provider", () => {
  const shadow = createStreamLifecycleShadow({
    availableToolNames: [],
    providerExecutedToolNames: [],
  });
  assertEquals("next" in shadow, false);
  assertEquals("open" in shadow, false);
});
```

Add mode tests:

```ts
assertEquals(resolveStreamLifecycleMode(undefined, "legacy"), "legacy");
assertEquals(resolveStreamLifecycleMode("shadow", "legacy"), "shadow");
assertEquals(resolveStreamLifecycleMode("invalid", "legacy"), "legacy");
```

- [ ] **Step 2: Run shadow tests and verify they fail**

Run: `deno test --no-check --allow-all src/agent/runtime/stream-lifecycle-shadow.test.ts src/agent/runtime/stream-lifecycle-mode.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement the shadow observer as a pure tap**

```ts
export type StreamLifecycleShadowDivergence =
  | "text"
  | "reasoning"
  | "tool_input"
  | "tool_result"
  | "finish_reason"
  | "usage"
  | "outcome"
  | "shadow_error";

export interface StreamLifecycleShadowReport {
  count: number;
  categories: readonly StreamLifecycleShadowDivergence[];
}

export function createStreamLifecycleShadow(options: {
  availableToolNames: readonly string[];
  providerExecutedToolNames: readonly string[];
}) {
  let reducer = createInitialReducerState();
  let failed = false;
  return {
    observePart(part: unknown) {
      if (failed) return;
      try {
        for (const signal of decodeRuntimeStreamPart(part, reducer.snapshot, {
          availableToolNames: new Set(options.availableToolNames),
          providerExecutedToolNames: new Set(options.providerExecutedToolNames),
        })) {
          reducer = reduceStreamSignal(reducer, signal, 0).state;
        }
      } catch {
        failed = true;
      }
    },
    compareLegacySnapshot(state: ChatStreamState): StreamLifecycleShadowReport {
      const categories = new Set<StreamLifecycleShadowDivergence>();
      if (failed) categories.add("shadow_error");
      if (state.accumulatedText !== reducer.snapshot.accumulatedText) categories.add("text");
      if (!equalReasoning(state.reasoningParts, reducer.snapshot.reasoning)) categories.add("reasoning");
      if (!equalToolInputs(state.toolCalls, reducer.snapshot.tools)) categories.add("tool_input");
      if (!equalToolResults(state.toolResults, reducer.snapshot.tools)) categories.add("tool_result");
      if (state.finishReason !== reducer.snapshot.finishReason) categories.add("finish_reason");
      if (!equalUsage(state.usage, reducer.snapshot.usage)) categories.add("usage");
      return { count: categories.size, categories: [...categories].sort() };
    },
  };
}
```

Comparison helpers compare values but return only enum categories. They must never log or return differing content, identifiers, tool input, output, or provider data.

- [ ] **Step 4: Insert the tap at the exact already-read seam**

Add optional callback fields without changing existing callers:

```ts
streamLifecycleMode?: "legacy" | "shadow" | "active";
onLifecycleShadowReport?: (report: StreamLifecycleShadowReport) => void;
```

Keep the test seam out of `ChatStreamCallbacks`. Rename the current `processStream()` body to `processStreamInternal()`, add the final `internals` parameter shown below, and keep it exported only from this source file. Do not re-export it from `src/agent/runtime/index.ts`. The public wrapper retains the current seven-argument signature:

```ts
interface ProcessStreamInternals {
  createShadow: typeof createStreamLifecycleShadow;
}

const defaultProcessStreamInternals: ProcessStreamInternals = {
  createShadow: createStreamLifecycleShadow,
};

export function processStream(
  result: RuntimeStreamResult,
  state: ChatStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks?: ChatStreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<void> {
  return processStreamInternal(
    result,
    state,
    controller,
    encoder,
    textPartId,
    callbacks,
    abortSignal,
    defaultProcessStreamInternals,
  );
}

export async function processStreamInternal(
  result: RuntimeStreamResult,
  state: ChatStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks: ChatStreamCallbacks | undefined,
  abortSignal: AbortSignal | undefined,
  internals: ProcessStreamInternals,
): Promise<void> {
  // This is the existing processStream body, moved without changing its
  // legacy read, reduction, SSE, or trace behavior. Use internals.createShadow
  // only for the shadow tap below.
}
```

At the top of the moved body, create the observer only for `shadow` and keep shadow failure outside the legacy control flow:

```ts
let shadowLifecycle = callbacks?.streamLifecycleMode === "shadow"
  ? internals.createShadow({
    availableToolNames: callbacks?.availableToolNames ?? [],
    providerExecutedToolNames: callbacks?.providerExecutedToolNames ?? [],
  })
  : null;
let shadowLifecycleFailed = false;
```

Add the exact tap:

```ts
const part = next.value;
throwIfAborted(abortSignal);
try {
  shadowLifecycle?.observePart(part);
} catch {
  shadowLifecycleFailed = true;
  shadowLifecycle = null;
}
eventCount++;
```

Keep it after `next.value` and the abort check and before record validation, the `data-*` branch, and the main switch. Do not pass `result.fullStream` or `streamIterator` into the shadow module. After the loop, merge an injected observer failure into the bounded report, pass the report to the callback, and set only these trace attributes:

```ts
if (callbacks?.streamLifecycleMode === "shadow") {
  let observed: StreamLifecycleShadowReport = { count: 0, categories: [] };
  try {
    observed = shadowLifecycle?.compareLegacySnapshot(state) ?? observed;
  } catch {
    shadowLifecycleFailed = true;
  }
  const categories = new Set(observed.categories);
  if (shadowLifecycleFailed) categories.add("shadow_error");
  const report: StreamLifecycleShadowReport = {
    count: categories.size,
    categories: [...categories].sort(),
  };
  callbacks.onLifecycleShadowReport?.(report);
  setActiveSpanAttributes({
    "stream.lifecycle_shadow.divergence_count": report.count,
    "stream.lifecycle_shadow.divergence_categories": report.categories,
  });
}
```

Resolve the host-level `VF_STREAM_LIFECYCLE_MODE` with `getHostEnv()`. During Gate 1 the default is `legacy`; `shadow` is an explicit rollout setting; `active` parses but remains unused until Gate 2.

- [ ] **Step 5: Add a regression proving shadow failure cannot change SSE**

Add this structure to `chat-stream-handler.test.ts`, using the existing `createMockResult()`, `createSSECollector()`, and state helpers:

```ts
type FixtureProcess = typeof processStream;

async function runTextFixture(input: {
  mode: "legacy" | "shadow";
  process?: FixtureProcess;
}) {
  const { events, controller, encoder } = createSSECollector();
  const state = createStreamState();
  let report: StreamLifecycleShadowReport | undefined;
  await (input.process ?? processStream)(
    createMockResult([
      { type: "text-delta", text: "hello" },
      { type: "finish", finishReason: "stop" },
    ]),
    state,
    controller,
    encoder,
    "text-1",
    {
      streamLifecycleMode: input.mode,
      onLifecycleShadowReport: (next) => report = next,
    },
    undefined,
  );
  return { events, state, report };
}

const throwingShadowFactory: typeof createStreamLifecycleShadow = () => ({
  observePart() {
    throw new Error("shadow-only failure");
  },
  compareLegacySnapshot() {
    return { count: 1, categories: ["shadow_error"] };
  },
});

const legacy = await runTextFixture({ mode: "legacy" });
const shadow = await runTextFixture({
  mode: "shadow",
  process: (result, state, controller, encoder, textPartId, callbacks, abortSignal) =>
    processStreamInternal(
      result,
      state,
      controller,
      encoder,
      textPartId,
      callbacks,
      abortSignal,
      { createShadow: throwingShadowFactory },
    ),
});

assertEquals(shadow.events, legacy.events);
assertEquals(shadow.state, legacy.state);
assertEquals(shadow.report, { count: 1, categories: ["shadow_error"] });
```

- [ ] **Step 6: Run the complete Gate 1 fixture corpus**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/streaming/lifecycle/ \
  src/agent/runtime/stream-lifecycle-shadow.test.ts \
  src/agent/runtime/stream-lifecycle-mode.test.ts \
  src/agent/runtime/chat-stream-handler.test.ts \
  src/provider/runtime-loader.test.ts \
  src/chat/stream-watchdog.test.ts \
  src/agent/ag-ui/browser-encoder.test.ts \
  src/agent/conversation/run-events.test.ts
```

Expected: PASS and zero unclassified shadow divergences. Store classification counts only in test assertions and telemetry; do not check in provider content.

- [ ] **Step 7: Commit the Gate 1 rollout seam**

```bash
git add src/agent/runtime src/agent/streaming/lifecycle
git commit -m "Measure lifecycle parity without changing stream behavior" \
  -m "Constraint: Shadow mode observes already-read parts and cannot open a provider stream" \
  -m "Rejected: Run the new iterator beside the legacy iterator | would duplicate provider reads" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Do not start Gate 2 while any shadow category is unclassified" \
  -m "Tested: Gate 1 lifecycle and compatibility fixture corpus"
```

**Gate 1 exit condition:** All lifecycle interface tests pass, the five compatibility fixture owners pass, shadow mode cannot affect legacy output, and observed divergence count is zero or every nonzero category has a documented cause and an approved reducer or fixture correction.

---

## Gate 2: Runtime ownership

### Task 9: Project canonical frames to current live SSE

**Files:**

- Create: `src/agent/streaming/lifecycle/live-adapter.ts`
- Create: `src/agent/streaming/lifecycle/live-adapter.test.ts`
- Modify: `src/agent/streaming/lifecycle/errors.ts`
- Modify: `src/agent/streaming/lifecycle/index.ts`
- Modify: `src/chat/protocol.ts`
- Modify: `src/agent/runtime/chat-stream-handler.ts`
- Modify: `src/agent/runtime/chat-stream-handler.test.ts`
- Modify: `src/agent/runtime/index.ts:1515-1548`

**Interfaces:**

- Consumes: validated lifecycle frames and outcomes.
- Produces: `createStreamLifecycleLiveAdapter({ textPartId })`, `applyLifecycleSnapshotToChatStreamState()`, and active-mode `processStream()` behavior while retaining the existing function signature.

- [ ] **Step 1: Lock current SSE with a golden Adapter test**

Use the existing `createSSECollector()` fixture and a canonical frame sequence containing text, a local tool call, and status telemetry. Assert the Adapter returns these current Data Stream Protocol shapes:

```ts
assertEquals(events, [
  { type: "text-start", id: "text-part" },
  { type: "text-delta", id: "text-part", delta: "hello" },
  { type: "text-end", id: "text-part" },
  { type: "tool-input-start", toolCallId: "local-1", toolName: "create_file" },
  { type: "tool-input-delta", toolCallId: "local-1", inputTextDelta: '{"path":"a.md"}' },
  { type: "tool-input-available", toolCallId: "local-1", toolName: "create_file", input: { path: "a.md" } },
  { type: "data-tool-call-status", data: { toolCallId: "local-1", status: "pending_input" } },
]);
```

Usage frames update callbacks and final state but do not create a live data event. Diagnostic frames never reach the Live Adapter.

Add companion cases asserting reasoning frames map to `reasoning-start/delta/end`, a provider-executed result maps to `tool-output-available` with `providerExecuted: true`, and usage plus diagnostic frames encode to no events.

- [ ] **Step 2: Run the Adapter test and verify it fails**

Run: `deno test --no-check --allow-all src/agent/streaming/lifecycle/live-adapter.test.ts`

Expected: FAIL because `live-adapter.ts` does not exist.

- [ ] **Step 3: Type the wire field that the runtime already emits**

The provider-result mapping already preserves a `preliminary` flag on the wire, but neither `ChatStreamEvent` nor the matching `ChatUiMessageChunk` member declares it. Add the optional field to both representations without changing emitted JSON.

In the `ChatStreamEvent` union:

```ts
| ({
  type: "tool-output-available";
  toolCallId: string;
  output: unknown;
  preliminary?: boolean;
} & ChatStreamEventBase)
```

In the `ChatUiMessageChunk` union:

```ts
| (ToolCallChunk<"tool-output-available"> & {
  output: unknown;
  preliminary?: boolean;
})
```

Run: `deno check src/chat/protocol.ts`

Expected: PASS.

- [ ] **Step 4: Implement a stateless canonical-to-chat mapping**

```ts
export function createStreamLifecycleLiveAdapter(input: { textPartId?: string }) {
  return {
    encode(frame: StreamLifecycleFrame): ChatStreamEvent[] {
      if (frame.class === "diagnostic") return [];
      if (frame.class === "telemetry") {
        return frame.event.type === "tool_input_status"
          ? [{
            type: "data-tool-call-status",
            data: {
              toolCallId: frame.event.toolCallId,
              status: frame.event.status,
            },
          }]
          : [];
      }
      const event = frame.event;
      switch (event.type) {
        case "text_start":
          return [{ type: "text-start", id: input.textPartId ?? event.id ?? "text" }];
        case "text_content":
          return [{ type: "text-delta", id: input.textPartId ?? event.id ?? "text", delta: event.delta }];
        case "text_end":
          return [{ type: "text-end", id: input.textPartId ?? event.id ?? "text" }];
        case "reasoning_start":
          return [{ type: "reasoning-start", id: event.id }];
        case "reasoning_content":
          return [{ type: "reasoning-delta", id: event.id, delta: event.delta }];
        case "reasoning_end":
          return [{ type: "reasoning-end", id: event.id, ...(event.signature ? { signature: event.signature } : {}), ...(event.redactedData ? { redactedData: event.redactedData } : {}) }];
        case "tool_input_start":
          return [{ type: "tool-input-start", toolCallId: event.toolCallId, toolName: event.toolName, ...(event.providerExecuted !== undefined ? { providerExecuted: event.providerExecuted } : {}), ...(event.dynamic ? { dynamic: true } : {}) }];
        case "tool_input_content":
          return [{ type: "tool-input-delta", toolCallId: event.toolCallId, inputTextDelta: event.delta }];
        case "tool_input_ready":
          return [{ type: "tool-input-available", toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, ...(event.providerExecuted !== undefined ? { providerExecuted: event.providerExecuted } : {}), ...(event.dynamic ? { dynamic: true } : {}) }];
        case "tool_input_rejected":
          return event.reason === "unavailable" ? [] : [{ type: "tool-input-error", toolCallId: event.toolCallId, toolName: event.toolName, input: null, errorText: "Tool input was rejected before handoff" }];
        case "provider_tool_start":
          return [];
        case "provider_tool_result":
          return event.isError
            ? [{ type: "tool-output-error", toolCallId: event.toolCallId, errorText: "Provider tool execution failed", providerExecuted: true }]
            : [{ type: "tool-output-available", toolCallId: event.toolCallId, output: event.output, providerExecuted: true, ...(event.dynamic ? { dynamic: true } : {}), ...(event.preliminary !== undefined ? { preliminary: event.preliminary } : {}) }];
        case "provider_tool_denied":
          return [{ type: "tool-output-denied", toolCallId: event.toolCallId }];
        case "provider_tool_cancelled":
          return [{ type: "tool-output-error", toolCallId: event.toolCallId, errorText: "Provider tool execution was cancelled", providerExecuted: true }];
        case "custom":
          return [{ type: `data-${event.name}`, data: event.data }];
        case "message_start":
        case "step_start":
        case "step_finish":
        case "usage":
          return [];
      }
    },
  };
}
```

- [ ] **Step 5: Add a provider factory while keeping pre-opened results compatible**

Extend the first parameter accepted by `processStream()` to `RuntimeStreamResult | RuntimeStreamSource` without removing the existing shape:

```ts
export interface RuntimeStreamSource {
  open(signal: AbortSignal): RuntimeStreamResult;
}

export function createRuntimeStreamSource(
  open: (signal: AbortSignal) => RuntimeStreamResult,
): RuntimeStreamSource {
  return { open };
}

export function isRuntimeStreamSource(
  value: RuntimeStreamResult | RuntimeStreamSource,
): value is RuntimeStreamSource {
  return typeof value === "object" && value !== null &&
    "open" in value && typeof value.open === "function";
}
```

The active runtime path passes a factory from `runtime/index.ts`, so `runStreamLifecycle()` installs source-tagged cancellation before `streamText()` receives its signal. Compatibility callers that pass a pre-opened `RuntimeStreamResult` receive the same behavior but cannot gain pre-request signal composition.

Add `streamLifecyclePolicy?: Partial<StreamLifecyclePolicy>` to
`ChatStreamCallbacks`. It is an internal active-mode policy/test seam. Existing
`streamIdleTimeoutMs` and `localToolInputIdleTimeoutMs` remain compatibility
inputs. Resolve them exactly once, with explicit lifecycle fields taking
precedence:

```ts
export function resolveRuntimeLifecyclePolicy(
  callbacks?: ChatStreamCallbacks,
): StreamLifecyclePolicy {
  const compatibility: Partial<StreamLifecyclePolicy> = {
    ...(callbacks?.streamIdleTimeoutMs === undefined
      ? {}
      : {
        firstProgressTimeoutMs: callbacks.streamIdleTimeoutMs,
        semanticIdleTimeoutMs: callbacks.streamIdleTimeoutMs,
      }),
    ...(callbacks?.localToolInputIdleTimeoutMs === undefined
      ? {}
      : { toolInputIdleTimeoutMs: callbacks.localToolInputIdleTimeoutMs }),
  };
  return resolveStreamLifecyclePolicy({
    ...compatibility,
    ...callbacks?.streamLifecyclePolicy,
  });
}
```

Add the typed failure to `lifecycle/errors.ts` and export it from the internal
lifecycle barrel:

```ts
export class StreamLifecycleFailure extends Error {
  constructor(readonly lifecycleError: StreamLifecycleError) {
    super(lifecycleError.publicMessage);
    this.name = "StreamLifecycleFailure";
  }
}
```

Add focused tests for the type guard, compatibility timeout mapping, explicit
policy precedence, and `StreamLifecycleFailure.lifecycleError` preservation
before using these helpers in the active branch.

- [ ] **Step 6: Route active mode through the lifecycle runner**

Extract the current implementation to `processLegacyStream()` without behavioral edits. Keep `legacy` and `shadow` on that function. For `active`:

```ts
const source = isRuntimeStreamSource(resultOrSource)
  ? resultOrSource
  : { open: () => resultOrSource };
const adapter = createRuntimeStreamProviderAdapter({
  open: (signal) => source.open(signal).fullStream,
  options: {
    availableToolNames: callbacks?.availableToolNames
      ? new Set(callbacks.availableToolNames)
      : null,
    providerExecutedToolNames: new Set(callbacks?.providerExecutedToolNames ?? []),
  },
});
const run = runStreamLifecycle({
  provider: adapter,
  policy: resolveRuntimeLifecyclePolicy(callbacks),
  cancellations: abortSignal ? [{ source: "runtime", signal: abortSignal }] : [],
});
const live = createStreamLifecycleLiveAdapter({ textPartId });
for await (const frame of run.frames) {
  if (frame.class === "semantic" && frame.event.type === "text_content") {
    callbacks?.onChunk?.(frame.event.delta);
  }
  if (frame.class === "semantic" && frame.event.type === "usage") {
    callbacks?.onUsage?.(frame.event.usage);
  }
  for (const event of live.encode(frame)) sendSSE(controller, encoder, event);
}
const streamOutcome = await run.outcome;
applyLifecycleSnapshotToChatStreamState(state, streamOutcome.snapshot);
state.streamOutcome = streamOutcome;
if (streamOutcome.status === "failed") {
  throw new StreamLifecycleFailure(streamOutcome.error);
}
if (streamOutcome.status === "cancelled" && abortSignal?.aborted) {
  throw abortSignal.reason;
}
```

Add `streamOutcome?: StreamOutcome` to `ChatStreamState`. Implement the compatibility projection exactly once in `live-adapter.ts` and call it only after the lifecycle settles:

```ts
function isAvailableTool(tool: StreamToolSnapshot): boolean {
  return tool.rejectionReason !== "unavailable";
}

function isInputAvailable(tool: StreamToolSnapshot): boolean {
  return tool.phase !== "input_open" &&
    tool.phase !== "input_streaming" &&
    tool.phase !== "input_rejected";
}

function isProviderToolTerminal(tool: StreamToolSnapshot): boolean {
  return tool.providerExecuted === true && (
    tool.phase === "succeeded" ||
    tool.phase === "failed" ||
    tool.phase === "denied" ||
    tool.phase === "cancelled"
  );
}

export function applyLifecycleSnapshotToChatStreamState(
  state: ChatStreamState,
  snapshot: Readonly<StreamSnapshot>,
): void {
  state.accumulatedText = snapshot.accumulatedText;
  state.reasoningParts = snapshot.reasoning.map((part) => ({ ...part }));
  state.finishReason = snapshot.finishReason;
  state.toolCalls = new Map(
    snapshot.tools.filter(isAvailableTool).map((tool) => [
      tool.id,
      {
        id: tool.id,
        name: tool.name,
        arguments: tool.inputText,
        inputDeltas: [...tool.inputDeltas],
        inputAnnounced: true,
        inputAvailable: isInputAvailable(tool),
        ...(tool.providerExecuted !== undefined
          ? { providerExecuted: tool.providerExecuted }
          : {}),
        ...(tool.dynamic !== undefined ? { dynamic: tool.dynamic } : {}),
      },
    ]),
  );
  state.toolResults = snapshot.tools.filter(isProviderToolTerminal).map((tool) => ({
    toolCallId: tool.id,
    toolName: tool.name,
    ...(tool.output !== undefined ? { output: tool.output } : {}),
    ...(tool.error !== undefined ? { error: tool.error } : {}),
    providerExecuted: true,
    ...(tool.dynamic !== undefined ? { dynamic: tool.dynamic } : {}),
    ...(tool.preliminary !== undefined ? { preliminary: tool.preliminary } : {}),
  }));
  state.suppressedToolCalls = snapshot.tools
    .filter((tool) => tool.rejectionReason === "unavailable")
    .map((tool) => ({ id: tool.id, name: tool.name }));
  state.usage = { ...snapshot.usage };
}
```

Add a focused test with two input deltas, an unavailable tool, one successful provider tool, one failed provider tool, reasoning metadata, and every optional usage field. Assert the projected state exactly, including `inputDeltas`, suppressed tool IDs, provider result `preliminary`, and a copied usage object. Do not expose `streamOutcome` in SSE data payloads.

In `runtime/index.ts`, replace the eager result with:

```ts
const streamSource = createRuntimeStreamSource((streamSignal) =>
  streamText({
    model: languageModel,
    system: currentSystemPrompt,
    messages: convertToTextGenerationRuntimeRequestMessages(currentMessages),
    tools: runtimeTools,
    experimental_repairToolCall: repairToolCall,
    maxOutputTokens,
    ...(temperature === undefined ? {} : { temperature }),
    ...(headers ? { headers } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(reasoning ? { reasoning } : {}),
    abortSignal: streamSignal,
  })
);
```

- [ ] **Step 7: Run current SSE, state, tool, usage, and abort tests in all modes**

Parameterize the current `chat-stream-handler.test.ts` fixtures over `legacy` and `active` for accumulated text, reasoning, tool input completion, provider tools, multiple tools, usage, late body-read errors, and abort. Keep byte-level event assertions unchanged except for the approved typed error on invalid or timed-out input.

Run:

```bash
deno test --no-check --allow-all \
  src/agent/streaming/lifecycle/live-adapter.test.ts \
  src/agent/runtime/chat-stream-handler.test.ts \
  src/agent/runtime/runtime-stream-cancel.test.ts
deno check src/chat/protocol.ts src/agent/streaming/lifecycle/live-adapter.ts \
  src/agent/runtime/chat-stream-handler.ts
```

Expected: PASS in both modes.

- [ ] **Step 8: Commit active runtime projection**

```bash
git add src/agent/streaming/lifecycle src/agent/runtime src/chat/protocol.ts
git commit -m "Let one lifecycle drive runtime stream output" \
  -m "Constraint: Existing processStream callers and SSE shapes remain compatible" \
  -m "Rejected: Change every caller in the same patch | removes the rollback seam" \
  -m "Confidence: high" \
  -m "Scope-risk: broad" \
  -m "Tested: live Adapter, chat stream handler, and runtime cancellation tests"
```

### Task 10: Move tool status cadence out of provider wrappers

**Files:**

- Modify: `extensions/ext-llm-openai/src/openai-provider.ts:34, 61, 494, 571`
- Modify: `extensions/ext-llm-anthropic/src/anthropic-provider.ts:32, 55, 310`
- Modify: `extensions/ext-llm-google/src/google-provider.ts:34, 64, 220`
- Modify: `src/provider/runtime-loader/tool-input-status.ts`
- Modify: `src/provider/runtime-loader.test.ts`
- Modify: `src/agent/runtime/chat-stream-handler.ts`
- Modify: `src/agent/runtime/chat-stream-handler.test.ts`

**Interfaces:**

- Consumes: lifecycle telemetry frames in active mode.
- Produces: raw internal provider streams for lifecycle consumption while retaining `withToolInputStatusTransitions()` as an exported compatibility utility.

- [ ] **Step 1: Add the end-to-end heartbeat regression before changing wrappers**

In `chat-stream-handler.test.ts`, create a raw stream that emits `tool-input-start`, keeps its next read pending, and uses `ManualMonotonicClock`. Run active mode with `toolInputIdleTimeoutMs: 15_000` and `statusIntervalMs: 5_000`. Assert two `data-tool-call-status` frames are emitted at 5 and 10 seconds, the next 5 seconds produce `StreamLifecycleFailure` with `TOOL_INPUT_TIMEOUT`, and provider `next()` was called only once for the pending read.

- [ ] **Step 2: Run the heartbeat regression and verify the old source path is visible**

Run: `deno test --no-check --allow-all src/agent/runtime/chat-stream-handler.test.ts --filter "heartbeat telemetry cannot extend tool input idle"`

Expected: FAIL until active mode consumes a raw stream and lifecycle telemetry owns cadence.

- [ ] **Step 3: Remove internal wrapper calls from all three provider extensions**

Replace each `withToolInputStatusTransitions(stream*Parts(...))` call with the underlying `stream*Parts(...)` iterable and remove only the now-unused imports. Do not delete `src/provider/runtime-loader/tool-input-status.ts`, its barrel exports, or its compatibility tests.

- [ ] **Step 4: Preserve exact legacy and shadow output at the compatibility boundary**

In `processLegacyStream()`, wrap the raw `fullStream` with `withToolInputStatusTransitions()` before creating its iterator. In active mode, pass the raw stream to the lifecycle Adapter. This locates legacy status behavior at the legacy Adapter instead of inside the true-external provider source.

The active runtime Adapter must ignore incoming `data-tool-call-status` parts from pre-opened third-party compatibility results. The lifecycle phase scheduler remains the only active-mode cadence owner.

- [ ] **Step 5: Verify no internal provider still wraps lifecycle input**

Run:

```bash
! rg -n "withToolInputStatusTransitions" \
  extensions/ext-llm-openai/src/openai-provider.ts \
  extensions/ext-llm-anthropic/src/anthropic-provider.ts \
  extensions/ext-llm-google/src/google-provider.ts
```

Expected: no matches.

Run:

```bash
deno test --no-check --allow-all \
  src/provider/runtime-loader.test.ts \
  src/agent/runtime/chat-stream-handler.test.ts \
  src/agent/streaming/lifecycle/
```

Expected: PASS. Compatibility utility tests still prove the exported wrapper works; active runtime tests prove it is not used internally.

- [ ] **Step 6: Commit status ownership migration**

```bash
git add extensions/ext-llm-openai/src/openai-provider.ts \
  extensions/ext-llm-anthropic/src/anthropic-provider.ts \
  extensions/ext-llm-google/src/google-provider.ts \
  src/provider/runtime-loader/tool-input-status.ts \
  src/provider/runtime-loader.test.ts \
  src/agent/runtime/chat-stream-handler.ts \
  src/agent/runtime/chat-stream-handler.test.ts
git commit -m "Make lifecycle status telemetry observational" \
  -m "Constraint: The compatibility wrapper remains exported but cannot wrap active lifecycle input" \
  -m "Rejected: Keep provider heartbeats in the semantic read path | repeats the original indefinite-timeout failure" \
  -m "Confidence: high" \
  -m "Scope-risk: broad" \
  -m "Tested: provider loader compatibility, active heartbeat regression, and lifecycle tests"
```

### Task 11: Centralize terminal interpretation and preserve delivery failures

**Files:**

- Modify: `src/agent/streaming/stream-outcome.ts`
- Modify: `src/agent/streaming/stream-outcome.test.ts`
- Modify: `src/agent/streaming/lifecycle/runner.ts`
- Modify: `src/agent/runtime/chat-stream-handler.ts`
- Modify: `src/agent/runtime/chat-stream-handler.test.ts`
- Modify: `src/agent/hosted/stream-finalization.ts`
- Modify: `src/agent/hosted/stream-finalization.test.ts`

**Interfaces:**

- Consumes: final lifecycle snapshot, optional cancellation source, optional thrown provider error, and classified provider error.
- Produces: `resolveStreamOutcome()` as the sole terminal classifier used by the lifecycle runner and hosted compatibility finalization.

- [ ] **Step 1: Add failing typed outcome matrix tests**

```ts
function snapshot(
  phase: StreamLifecyclePhase,
  finishReason: StreamSnapshot["finishReason"],
  hasStreamOutput: boolean,
): StreamSnapshot {
  return {
    phase,
    accumulatedText: hasStreamOutput ? "output" : "",
    reasoning: [],
    tools: [],
    finishReason,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    hasStreamOutput,
    hasSemanticProgress: hasStreamOutput || finishReason !== null,
  };
}

it("resolves every terminal path with phase on the outcome and snapshot", () => {
  const cases = [
    { snapshot: snapshot("completed", "stop", true), expected: "completed" },
    { snapshot: snapshot("tool_handoff", "tool-calls", true), expected: "tool_handoff" },
    { snapshot: snapshot("streaming", null, true), cancellation: "user" as const, expected: "cancelled" },
    { snapshot: snapshot("streaming", null, false), thrownError: new Error("provider failed"), expected: "failed" },
  ];
  for (const input of cases) {
    const outcome = resolveStreamOutcome({ ...input, elapsedMs: 12 });
    assertEquals(outcome.status, input.expected);
    assertEquals(outcome.phase, outcome.snapshot.phase);
  }
});

it("keeps late body-read completion behind output and finish gates", () => {
  assertEquals(resolveStreamOutcome({
    snapshot: snapshot("completed", "stop", true),
    elapsedMs: 10,
    thrownError: new Error("Error reading a body from connection"),
  }).status, "completed");
  assertEquals(resolveStreamOutcome({
    snapshot: snapshot("streaming", null, true),
    elapsedMs: 10,
    thrownError: new Error("Error reading a body from connection"),
  }).status, "failed");
});
```

- [ ] **Step 2: Add a delivery-error precedence test**

In active `chat-stream-handler.test.ts`, use a controller whose `enqueue()`
throws the sentinel `deliveryError` on the first semantic frame. Pass
`streamLifecycleMode: "active"`, capture the thrown object, and assert identity
rather than message equality:

```ts
let caught: unknown;
try {
  await processStream(source, state, throwingController, encoder, "t", {
    streamLifecycleMode: "active",
  });
} catch (error) {
  caught = error;
}
assertStrictEquals(caught, deliveryError);
assertEquals(state.streamOutcome?.status, "cancelled");
if (state.streamOutcome?.status === "cancelled") {
  assertEquals(state.streamOutcome.source, "consumer_stopped");
}
```

The `consumer_stopped` outcome is expected secondary cleanup evidence after
delivery stops consuming frames. It must never replace the delivery exception
as the primary run-finalization error.

- [ ] **Step 3: Run outcome, handler, and hosted tests and verify the new resolver is absent**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/streaming/stream-outcome.test.ts \
  src/agent/runtime/chat-stream-handler.test.ts \
  src/agent/hosted/stream-finalization.test.ts
```

Expected: FAIL on missing `resolveStreamOutcome()` and delivery precedence capture.

- [ ] **Step 4: Implement one outcome resolver**

```ts
export interface ResolveStreamOutcomeInput {
  snapshot: StreamSnapshot;
  elapsedMs: number;
  cancellation?: StreamCancellationSource;
  lifecycleError?: StreamLifecycleError;
  thrownError?: unknown;
  providerError?: StreamProviderError;
}

export function resolveStreamOutcome(input: ResolveStreamOutcomeInput): StreamOutcome {
  if (input.cancellation) {
    const snapshot = { ...input.snapshot, phase: "cancelled" as const };
    return {
      status: "cancelled",
      source: input.cancellation,
      publicMessage: "Stream was cancelled",
      snapshot,
      usage: snapshot.usage,
      elapsedMs: input.elapsedMs,
      phase: snapshot.phase,
    };
  }
  if (input.lifecycleError) {
    const snapshot = { ...input.snapshot, phase: "failed" as const };
    return {
      status: "failed",
      error: input.lifecycleError,
      snapshot,
      usage: snapshot.usage,
      elapsedMs: input.elapsedMs,
      phase: snapshot.phase,
    };
  }
  if (
    input.thrownError !== undefined &&
    !(
      input.snapshot.hasStreamOutput &&
      hasCompletedStepSignal(input.snapshot.finishReason) &&
      isLateProviderBodyReadError(input.thrownError)
    )
  ) {
    return failedClassifiedProviderOutcome(
      input,
      input.providerError ?? classifyThrownProviderError(input.thrownError),
    );
  }
  if (input.providerError) return failedClassifiedProviderOutcome(input, input.providerError);
  if (input.snapshot.phase === "tool_handoff") return toolHandoffOutcome(input);
  if (
    input.snapshot.phase === "completed" &&
    input.snapshot.finishReason !== null &&
    input.snapshot.finishReason !== "tool-calls"
  ) return completedOutcome(input);
  return failedRuntimeOutcome(input, "PROVIDER_STREAM_ERROR", "Provider stream ended before completion");
}
```

Add these helper constructors in the same module. Lifecycle `error.code` stays bounded; `providerCode` retains a known typed provider code without becoming a metric label.

```ts
function classifyThrownProviderError(error: unknown): StreamProviderError {
  const known = resolveKnownProviderTerminalError(error);
  if (known) {
    return {
      code: known.code,
      publicMessage: known.message,
      retryable: false,
      terminal: true,
    };
  }
  return {
    code: "PROVIDER_STREAM_ERROR",
    publicMessage: "Provider stream failed",
    retryable: true,
    terminal: false,
  };
}

function createFailedResolverOutcome(
  input: ResolveStreamOutcomeInput,
  error: Omit<StreamLifecycleError, "phase">,
): StreamOutcome {
  const failedFrom = input.snapshot.phase;
  const snapshot = { ...input.snapshot, phase: "failed" as const };
  return {
    status: "failed",
    error: { ...error, phase: failedFrom },
    snapshot,
    usage: snapshot.usage,
    elapsedMs: input.elapsedMs,
    phase: snapshot.phase,
  };
}

function failedClassifiedProviderOutcome(
  input: ResolveStreamOutcomeInput,
  providerError: StreamProviderError,
): StreamOutcome {
  return createFailedResolverOutcome(input, {
    code: providerError.terminal
      ? "PROVIDER_TERMINAL_ERROR"
      : "PROVIDER_STREAM_ERROR",
    providerCode: providerError.code,
    source: "provider",
    retryable: providerError.retryable,
    publicMessage: providerError.publicMessage,
    ...(providerError.diagnosticId
      ? { diagnosticId: providerError.diagnosticId }
      : {}),
  });
}

function failedRuntimeOutcome(
  input: ResolveStreamOutcomeInput,
  code: "PROVIDER_STREAM_ERROR" | "PROTOCOL_VIOLATION",
  publicMessage: string,
): StreamOutcome {
  return createFailedResolverOutcome(input, {
    code,
    source: "runtime",
    retryable: code === "PROVIDER_STREAM_ERROR",
    publicMessage,
  });
}

function toolHandoffOutcome(input: ResolveStreamOutcomeInput): StreamOutcome {
  const snapshot = { ...input.snapshot, phase: "tool_handoff" as const };
  return {
    status: "tool_handoff",
    finishReason: "tool-calls",
    toolCalls: collectCommittedLocalToolCalls(snapshot),
    snapshot,
    usage: snapshot.usage,
    elapsedMs: input.elapsedMs,
    phase: snapshot.phase,
  };
}

function completedOutcome(input: ResolveStreamOutcomeInput): StreamOutcome {
  const finishReason = input.snapshot.finishReason;
  if (finishReason === null || finishReason === "tool-calls") {
    return failedRuntimeOutcome(
      input,
      "PROTOCOL_VIOLATION",
      "Provider stream ended in an invalid lifecycle state",
    );
  }
  const snapshot = { ...input.snapshot, phase: "completed" as const };
  return {
    status: "completed",
    finishReason,
    snapshot,
    usage: snapshot.usage,
    elapsedMs: input.elapsedMs,
    phase: snapshot.phase,
  };
}
```

Move `collectCommittedLocalToolCalls()` with the terminal constructors into
`stream-outcome.ts`; do not return mutable lifecycle snapshots as executable
tool-call contracts.

Extend the matrix tests to assert that a known provider error yields `error.code === "PROVIDER_TERMINAL_ERROR"`, retains the known code in `error.providerCode`, and exposes only the sanitized mapped message. An unknown thrown value yields `PROVIDER_STREAM_ERROR`, no raw thrown string in `publicMessage`, and `retryable: true`.

- [ ] **Step 5: Make the runner and hosted finalizer consume the resolver**

Delete runner-private terminal classification and call `resolveStreamOutcome()` from every settlement path. Deadline and reducer terminal failures pass their recorded `StreamLifecycleError` through `lifecycleError`; the resolver preserves that error's recorded phase and never downgrades it to a generic provider error. In `stream-finalization.ts`, replace `hasFinalStepCompletionSignal()` and `shouldFailStreamError()` with a compatibility snapshot passed to the same resolver:

```ts
function readHostedFinishReason(finalStep: unknown): StreamSnapshot["finishReason"] {
  if (
    typeof finalStep !== "object" || finalStep === null ||
    !("finishReason" in finalStep) || typeof finalStep.finishReason !== "string"
  ) return null;
  return hasCompletedStepSignal(finalStep.finishReason)
    ? finalStep.finishReason as StreamSnapshot["finishReason"]
    : null;
}

function createHostedCompatibilitySnapshot(input: {
  hasOutput: boolean;
  finishReason: StreamSnapshot["finishReason"];
}): StreamSnapshot {
  const phase = input.finishReason === "tool-calls"
    ? "tool_handoff" as const
    : input.finishReason === null
    ? "streaming" as const
    : "completed" as const;
  return {
    phase,
    accumulatedText: input.hasOutput ? "<COMPATIBILITY_OUTPUT>" : "",
    reasoning: [],
    tools: [],
    finishReason: input.finishReason,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    hasStreamOutput: input.hasOutput,
    hasSemanticProgress: input.hasOutput || input.finishReason !== null,
  };
}

const streamOutcome = resolveStreamOutcome({
  snapshot: createHostedCompatibilitySnapshot({
    hasOutput,
    finishReason: readHostedFinishReason(finalStep),
  }),
  elapsedMs: 0,
  ...(isAborted ? { cancellation: "runtime" as const } : {}),
  ...(streamError == null ? {} : { thrownError: streamError }),
});
```

Add table tests for `readHostedFinishReason()` covering `stop`, `length`,
`content-filter`, `other`, `tool-calls`, an unknown string, a missing field,
and a non-object final step. The helper name in tests and production must remain
`readHostedFinishReason`.

Hosted empty-message policy remains a run-finalization concern. Hosted provider-stream failure now checks `streamOutcome.status === "failed"`; it no longer re-implements late body-read rules.

Wrap active frame delivery so the primary error survives:

```ts
let deliveryError: unknown;
let streamOutcome!: StreamOutcome;
try {
  for await (const frame of run.frames) {
    if (frame.class === "semantic" && frame.event.type === "text_content") {
      callbacks?.onChunk?.(frame.event.delta);
    }
    if (frame.class === "semantic" && frame.event.type === "usage") {
      callbacks?.onUsage?.(frame.event.usage);
    }
    for (const event of live.encode(frame)) sendSSE(controller, encoder, event);
  }
} catch (error) {
  deliveryError = error;
  throw error;
} finally {
  streamOutcome = await run.outcome;
  state.streamOutcome = streamOutcome;
  if (deliveryError === undefined) {
    applyLifecycleSnapshotToChatStreamState(state, streamOutcome.snapshot);
  }
}
if (streamOutcome.status === "failed") {
  throw new StreamLifecycleFailure(streamOutcome.error);
}
if (streamOutcome.status === "cancelled" && abortSignal?.aborted) {
  throw abortSignal.reason;
}
```

- [ ] **Step 6: Run the Gate 2 suite**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/streaming/lifecycle/ \
  src/agent/streaming/stream-outcome.test.ts \
  src/agent/runtime/chat-stream-handler.test.ts \
  src/agent/runtime/runtime-stream-cancel.test.ts \
  src/provider/runtime-loader.test.ts \
  src/agent/hosted/stream-finalization.test.ts
```

Expected: PASS. The heartbeat regression ends at 15,000 ms of provider wait, golden SSE is unchanged, and delivery failure remains primary.

- [ ] **Step 7: Commit centralized terminal meaning**

```bash
git add src/agent/streaming src/agent/runtime src/agent/hosted
git commit -m "Interpret provider stream endings in one place" \
  -m "Constraint: Delivery and empty-message failures remain separate finalization domains" \
  -m "Rejected: Let hosted finalization inspect provider error text independently | recreates split ownership" \
  -m "Confidence: high" \
  -m "Scope-risk: broad" \
  -m "Tested: Gate 2 lifecycle, runtime, provider-loader, cancellation, and hosted-finalization suite"
```

**Gate 2 exit condition:** `active` is eligible for a canary only after shadow evidence is green, live fixtures remain approved, provider status wrappers are absent from internal active sources, heartbeat-only telemetry cannot postpone the configured deadline, typed Stream Outcome drives runtime termination, and `legacy` remains the default plus explicit rollback mode until the operational soak in Task 18 passes.

---

## Gate 3: Deadline consolidation

### Task 12: Back the exported watchdog with lifecycle state and clocks

**Files:**

- Modify: `src/agent/streaming/lifecycle/deadlines.ts`
- Create: `src/agent/streaming/lifecycle/watchdog-compat-adapter.ts`
- Create: `src/agent/streaming/lifecycle/watchdog-compat-adapter.test.ts`
- Modify: `src/chat/stream-watchdog.ts`
- Modify: `src/chat/stream-watchdog.test.ts`
- Modify: `src/agent/hosted/chat-execution-runtime.ts`
- Modify: `src/agent/hosted/chat-execution-runtime.test.ts`

**Interfaces:**

- Consumes: canonical lifecycle phase, semantic progress classification, and the same absolute deadline primitive used by the provider runner.
- Produces: unchanged `createChatStreamWatchdog()` return shape and exported option/state types, implemented through lifecycle state rather than an independent timer state machine.

- [ ] **Step 1: Change tests to the approved hard-limit semantics**

Keep tests for exported state shape, `AbortError`, `lastTimeoutState`, injected timer functions, and `dispose()`. The watchdog's existing defaults — `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` (120,000 ms) and `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` (300,000 ms) — remain its compatibility defaults; this task changes who owns the timer, not the configured values, so long-running tools keep their current 300-second budget unless callers configure otherwise. Replace the test that allows configured long-running tools to run forever with:

```ts
it("keeps an absolute limit for configured long-running tools", () => {
  using time = new FakeTime();
  const watchdog = createChatStreamWatchdog({
    ...watchdogOptions,
    toolRunningTimeoutMs: 300,
  });
  watchdog.observe({
    type: "tool-input-available",
    toolCallId: "fork-2",
    toolName: "invoke_agent",
    input: {},
  });
  time.tick(301);
  assertEquals(watchdog.signal.aborted, true);
  assertEquals(watchdog.lastTimeoutState?.phase, "tool_running");
});
```

Add a heartbeat test proving empty message metadata and `data-tool-call-status` do not advance the lifecycle deadline.

- [ ] **Step 2: Run watchdog tests and verify old exemptions fail the new contract**

Run: `deno test --no-check --allow-all src/chat/stream-watchdog.test.ts`

Expected: FAIL because `isLongRunningToolRunning()` currently skips timer arming.

- [ ] **Step 3: Extract the shared absolute timer primitive**

Add this to `deadlines.ts` and use it from both the runner and watchdog wrapper:

```ts
export function createAbsoluteDeadline(
  input: {
    clock: MonotonicClock;
    deadlineMs: number;
    onDeadline: () => void;
  },
) {
  const controller = new AbortController();
  void input.clock.waitUntil(input.deadlineMs, controller.signal).then((result) => {
    if (result === "deadline") input.onDeadline();
  });
  return {
    dispose() {
      if (!controller.signal.aborted) controller.abort();
    },
  };
}
```

The runner's absolute attempt timer and watchdog timeout must both call this primitive. Delete direct timer creation from `createChatStreamWatchdog()`.

- [ ] **Step 4: Map compatibility chunks into lifecycle activity**

```ts
export type WatchdogLifecycleActivity =
  | { type: "semantic_progress"; phase: StreamLifecyclePhase; toolCallId?: string; toolName?: string }
  | { type: "phase_transition"; phase: StreamLifecyclePhase; toolCallId?: string; toolName?: string }
  | { type: "telemetry" }
  | { type: "completed" };

export function mapWatchdogChunkToLifecycleActivity(
  current: ChatStreamWatchdogState,
  chunk: ChatUiMessageChunk<MessageMetadata>,
): WatchdogLifecycleActivity {
  if (
    chunk.type === "message-metadata" ||
    isHeartbeatOnlyMetadataChunk(chunk) ||
    chunk.type === "data-tool-call-status"
  ) {
    return { type: "telemetry" };
  }
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.delta.length > 0
        ? { type: "semantic_progress", phase: "streaming" }
        : { type: "telemetry" };
    case "tool-input-start":
      return {
        type: "phase_transition",
        phase: "awaiting_tool_input",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
      };
    case "tool-input-delta":
      return chunk.inputTextDelta.length > 0
        ? {
          type: "semantic_progress",
          phase: "awaiting_tool_input",
          toolCallId: chunk.toolCallId,
          toolName: current.toolName,
        }
        : { type: "telemetry" };
    case "tool-input-available":
      return { type: "semantic_progress", phase: "tool_handoff", toolCallId: chunk.toolCallId, toolName: chunk.toolName };
    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied":
      return { type: "semantic_progress", phase: "streaming", toolCallId: chunk.toolCallId, toolName: current.toolName };
    case "finish":
      return { type: "completed" };
    default:
      return { type: "telemetry" };
  }
}
```

`createChatStreamWatchdog()` uses this Adapter only to preserve the old `observe(chunk)` API. A telemetry activity returns without changing the deadline. A phase transition selects the new phase budget without pretending that content arrived. A semantic activity derives the public compatibility state from the canonical phase, resets that phase budget, and arms one absolute deadline. `keepAlive()` is retained for provider bootstrap, but active stream chunks do not call it as semantic progress.

- [ ] **Step 5: Remove independent phase and long-running timer policy**

Keep `getNextChatStreamWatchdogState()` and `isLongRunningToolRunning()` exported as compatibility helpers, but make the watchdog runtime call `mapWatchdogChunkToLifecycleActivity()` and shared deadline code. `longRunningToolNames` and `longRunningToolPrefixes` remain accepted to avoid a type break; they no longer disable the absolute `toolRunningTimeoutMs` cap.

Update hosted runtime bootstrap so `keepAlive()` is called only while waiting for the first runtime stream object, not for message metadata or status telemetry.

- [ ] **Step 6: Run Gate 3 tests**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/streaming/lifecycle/deadlines.test.ts \
  src/agent/streaming/lifecycle/watchdog-compat-adapter.test.ts \
  src/chat/stream-watchdog.test.ts \
  src/agent/hosted/chat-execution-runtime.test.ts
```

Expected: PASS. Search the watchdog implementation and confirm it has no direct `setTimeout()` or `Date.now()` call:

```bash
! rg -n "setTimeout|Date\.now" src/chat/stream-watchdog.ts
```

Expected: no matches.

- [ ] **Step 7: Commit the Gate 3 deadline consolidation**

```bash
git add src/agent/streaming/lifecycle src/chat/stream-watchdog.ts \
  src/chat/stream-watchdog.test.ts src/agent/hosted/chat-execution-runtime.ts \
  src/agent/hosted/chat-execution-runtime.test.ts
git commit -m "Make one deadline engine own stream timing" \
  -m "Constraint: Public watchdog exports and timeout options remain available" \
  -m "Rejected: Exempt tool names from all deadlines | permits unbounded attempts" \
  -m "Confidence: high" \
  -m "Scope-risk: broad" \
  -m "Tested: lifecycle deadline, watchdog compatibility, and hosted execution tests"
```

**Gate 3 exit condition:** The lifecycle scheduler determines first progress, semantic idle, tool-input idle, local handoff, status cadence, and total attempt time. The exported watchdog uses the same absolute deadline primitive, telemetry cannot keep it alive, no tool-name exemption creates an infinite attempt, and the watchdog file owns no timer implementation.

---

## Gate 4: Versioned projection contracts

### Gate 4 deployment prerequisite: persist protocol version at run creation

The current Runs REST create schema is strict and has no top-level metadata field. The canonical run repository can store metadata, but the REST mapper does not forward it and the conversation agent-run projection does not expose it. Task 13 may add a tolerant read resolver locally, but do not enable production version 2 writes until a server-first control-plane release provides this contract:

```json
{
  "kind": "agent",
  "metadata": { "stream_protocol_version": 2 },
  "owner": { "kind": "conversation", "id": "<CONVERSATION_ID>" },
  "public_id": "<RUN_ID>",
  "request": {}
}
```

The same `metadata` object must be returned by the conversation agent-run create, get, list, and snapshot projections for pending, running, waiting, completed, failed, and cancelled runs. Metadata written only by the completion endpoint is not sufficient because in-progress and non-completed runs also need an unambiguous read mode.

This is an external Phase 5 deployment prerequisite, not a write task in this repository or Gate 4. Implement and release it in the control-plane repository before enabling version 2 clients. The server PR owns these exact surfaces:

- `src/api/http/rest/runs/shared/schemas.ts`: add optional top-level `metadata: z.record(z.unknown()).nullable()` to the strict create base.
- `src/api/http/rest/runs/shared/mappers.ts`: forward `body.metadata` to the domain create input.
- `src/usecases/runs/types.ts`: admit metadata on every create variant, with the agent path covered by a focused test.
- `src/usecases/runs/create-run.ts`: persist metadata atomically in `syncCanonicalRun()` and reject duplicate public IDs whose existing protocol version conflicts.
- `src/lib/types/agent-run.types.ts`, `src/usecases/agent-runs/run-summary.ts`, `src/api/http/rest/conversations/agent-runs/shared/schemas.ts`, and `src/api/http/rest/conversations/agent-runs/shared/mappers.ts`: expose canonical run metadata on every conversation agent-run projection.

Required server contract tests:

1. Version 2 metadata survives create then immediate get while the run is still active.
2. Failed and cancelled projections retain the same version.
3. A duplicate create with the same public ID and version is idempotent.
4. A duplicate create with a conflicting version returns a typed conflict.
5. An old create request with no metadata still succeeds and returns `metadata: null`.

Deploy this additive server contract first. Keep the Veryfront client from sending the new field until the server smoke test passes. This ordering is the Phase 5 stop condition for version skew; Gate 4 remains safe because it adds no version 2 create caller.

### Task 13: Read version metadata without enabling production writes

**Files:**

- Modify: `src/agent/conversation/durable-contracts.ts`
- Modify: `src/agent/conversation/durable-contracts.test.ts`

**Interfaces:**

- Consumes: the server-first read metadata contract above when it becomes available.
- Produces: `StreamProtocolVersion` and `streamProtocolVersion` on `ConversationRunProjection`. Gate 4 adds no version 2 create capability.

- [ ] **Step 1: Write failing projection tests**

Add these cases to `durable-contracts.test.ts`:

```ts
it("defaults unversioned and unknown run metadata to protocol version 1", () => {
  assertEquals(ConversationRunProjectionSchema.parse({
    run_id: "run-old",
    conversation_id: CONVERSATION_ID,
    message_id: MESSAGE_ID,
    latest_event_id: 0,
    latest_external_event_sequence: 0,
    status: "completed",
  }).streamProtocolVersion, 1);

  assertEquals(ConversationRunProjectionSchema.parse({
    run_id: "run-unknown",
    conversation_id: CONVERSATION_ID,
    message_id: MESSAGE_ID,
    latest_event_id: 0,
    latest_external_event_sequence: 0,
    status: "completed",
    metadata: { stream_protocol_version: 99 },
  }).streamProtocolVersion, 1);
});

it("reads protocol version 2 only from canonical run metadata", () => {
  assertEquals(ConversationRunProjectionSchema.parse({
    run_id: "run-v2",
    conversation_id: CONVERSATION_ID,
    message_id: MESSAGE_ID,
    latest_event_id: 0,
    latest_external_event_sequence: 0,
    status: "running",
    metadata: { stream_protocol_version: 2 },
  }).streamProtocolVersion, 2);
});
```

Repeat the version 2 assertion for completed, failed, and cancelled projection fixtures. This proves the resolver is status-independent.

- [ ] **Step 2: Run the contract tests and verify the version is absent**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/conversation/durable-contracts.test.ts
```

Expected: FAIL because the projection discards metadata.

- [ ] **Step 3: Implement one strict version resolver**

Add these definitions in `durable-contracts.ts`:

```ts
export type StreamProtocolVersion = 1 | 2;

function resolveStreamProtocolVersion(metadata: unknown): StreamProtocolVersion {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 1;
  return (metadata as Record<string, unknown>).stream_protocol_version === 2 ? 2 : 1;
}
```

Add `streamProtocolVersion: StreamProtocolVersion` to `ConversationRunProjection`. In the projection schema transform, read only `d.metadata` and set:

```ts
streamProtocolVersion: resolveStreamProtocolVersion(d.metadata),
```

Do not infer version 2 from event shapes or finalization metadata. Absent or unrecognized metadata is version 1.

- [ ] **Step 4: Keep write contracts unchanged**

Do not modify `CreateConversationAgentRunInput`, `createConversationAgentRun()`, bootstrap, root-run, child-run, hosted preparation, or finalization. The server-first create contract is documented now so Phase 5 can deploy in the correct order, but this gate cannot label compatibility UI-chunk writes as version 2.

- [ ] **Step 5: Prove production call sites remain version 1**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/conversation/durable-contracts.test.ts
deno check src/agent/conversation/durable-contracts.ts
! rg -n 'stream_protocol_version\s*:\s*2|streamProtocolVersion\s*:\s*2' src \
  --glob '!src/**/*.test.ts' \
  --glob '!src/agent/conversation/lifecycle-run-event-adapter.ts'
```

Expected: tests and checks PASS, and the negated `rg` succeeds because no
version 2 production write or caller exists. The excluded Task 14 Adapter path
may define version 2 event metadata only; it cannot create or update runs.

- [ ] **Step 6: Commit the dormant version contract**

```bash
git add src/agent/conversation/durable-contracts.ts \
  src/agent/conversation/durable-contracts.test.ts
git commit -m "Select historical projection rules from run metadata" \
  -m "Constraint: Hosted production has no lifecycle-frame delivery envelope yet" \
  -m "Rejected: Enable version 2 from active runtime mode | would label legacy UI-chunk projection as canonical" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Directive: Missing or unknown stream protocol metadata selects version 1, and production version 2 waits for Phase 5" \
  -m "Tested: durable projection parsing across statuses, production write scan, and deno check"
```

### Task 14: Project validated frames into version 2 durable events

**Files:**

- Create: `src/agent/conversation/lifecycle-run-event-adapter.ts`
- Create: `src/agent/conversation/lifecycle-run-event-adapter.test.ts`
- Modify: `src/agent/conversation/run-event-preparation.ts`
- Modify: `src/agent/conversation/run-event-preparation.test.ts`
- Modify: `src/agent/conversation/run-event-normalization.test.ts`

**Interfaces:**

- Consumes: validated `StreamLifecycleFrame` objects, stable run and attempt identity, and current payload-size normalization.
- Produces: `createLifecycleRunEventAdapter()` and a pure `prepareConversationRunLifecycleEvents()` fixture/helper. No production mirror calls this Adapter in Gate 4.

- [ ] **Step 1: Write failing balanced, coalescing, and telemetry tests**

Create an Adapter test with deterministic timer hooks. Feed `message_start`, `text_start`, two adjacent `text_content` frames, `text_end`, one repeated status state, and `step_finish`. Assert:

```ts
assertEquals(emitted.map((event) => event.type), [
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "CUSTOM",
]);
assertEquals(emitted[1]?.delta, "hello world");
assertEquals(emitted[3], {
  type: "CUSTOM",
  name: "tool-call-status",
  value: { toolCallId: "tool-1", status: "pending_input" },
  stream_protocol_version: 2,
  attempt_id: "attempt-1",
  attempt_index: 0,
  logical_sequence: 4,
  idempotency_key: "stream-v2:run-1:attempt-1:4",
});
assertEquals(emitted.every((event) => event.stream_protocol_version === 2), true);
assertEquals(new Set(emitted.map((event) => event.logical_sequence)).size, emitted.length);
assertEquals(new Set(emitted.map((event) => event.idempotency_key)).size, emitted.length);
```

Emit the same `pending_input` telemetry frame twice before another status and assert only one `CUSTOM` event is durable. Emit `streaming_input` then `pending_input` and assert both transitions are retained while repeated cadence ticks are dropped.

Feed a canonical `tool_input_rejected` frame with reason `unavailable` and no
preceding tool start. Assert it emits no `TOOL_CALL_START`, `TOOL_CALL_END`, or
`TOOL_CALL_RESULT`. This preserves balanced durable history when the Provider
Adapter rejects an unavailable tool before opening a canonical tool input.

Add a payload-size regression using a text delta larger than `MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES`. Assert normalization splits first, then every split event receives a unique logical sequence and idempotency key. This prevents cloned split events from inheriting duplicate identifiers.

- [ ] **Step 2: Run the new tests and verify the Adapter is absent**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/conversation/lifecycle-run-event-adapter.test.ts \
  src/agent/conversation/run-event-normalization.test.ts
```

Expected: FAIL because the version 2 Adapter and decoration order do not exist.

- [ ] **Step 3: Implement the buffered Adapter contract**

Use this public-within-the-repo interface:

```ts
export interface LifecycleRunEventAdapter {
  handleFrame(frame: StreamLifecycleFrame): void;
  flush(): void;
  dispose(): void;
}

export function createLifecycleRunEventAdapter(input: {
  runId: string;
  attemptId: string;
  attemptIndex: number;
  messageId: string;
  onEvents(events: readonly ConversationRunEvent[]): void;
  maxBufferedContentBytes?: number;
  flushDelayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (timerId: number) => void;
}): LifecycleRunEventAdapter;

export class StreamProjectionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamProjectionInvariantError";
  }
}
```

Defaults are 32 KiB of buffered content and 250 ms. The Adapter keeps only formatting state:

```ts
type PendingDurableContent = {
  type: "TEXT_MESSAGE_CONTENT" | "REASONING_MESSAGE_CONTENT" | "TOOL_CALL_ARGS";
  identity: string;
  event: ConversationRunEvent;
  delta: string;
};
```

Apply these exact buffer rules:

1. Adjacent text, reasoning, or tool-argument deltas with the same event type and identity append to one `delta`.
2. A different identity, lifecycle boundary, step finish, terminal outcome, byte threshold, or flush timer flushes the pending delta first.
3. `flush()` clears its timer, emits the pending event, and leaves no buffered data.
4. `dispose()` clears its timer without dropping data: call `flush()` first, then mark disposed.
5. Diagnostics never become durable events.
6. `tool_input_status` telemetry emits one `CUSTOM/tool-call-status` event only when that tool's status differs from its last durable status. `live_heartbeat` and `child_progress` remain non-durable in this Adapter.

Map semantic events to the existing durable names:

| Lifecycle event | Durable event |
|---|---|
| `text_start/content/end` | `TEXT_MESSAGE_START/CONTENT/END`, preserving frame content ID and Adapter message ID |
| `reasoning_start/content/end` | `REASONING_MESSAGE_START/CONTENT/END` |
| `tool_input_start/content/ready` | `TOOL_CALL_START/ARGS/END` |
| `tool_input_rejected` with `invalid` or `malformed` | `TOOL_CALL_END`, then error `TOOL_CALL_RESULT`; a matching start must already be open |
| `tool_input_rejected` with `unavailable` | no durable event |
| `provider_tool_start` | no durable event; start the in-memory execution-duration interval |
| `provider_tool_result` | `TOOL_CALL_RESULT` with sanitized serialized content and `isError` |
| `provider_tool_denied/cancelled` | error `TOOL_CALL_RESULT` with the existing public compatibility message |
| `custom` | `CUSTOM` with `name` and `value` |
| `message_start`, `step_start`, `step_finish`, `usage` | no durable event |

Store tool input values only until their terminal tool result, then delete them. This preserves the current `input` attachment without unbounded per-run state.

- [ ] **Step 4: Normalize before assigning version 2 identity**

All raw mapped events pass through `normalizeConversationRunEvents()` before decoration:

```ts
let logicalSequence = 0;

function publish(rawEvents: ConversationRunEvent[]): void {
  const normalized = normalizeConversationRunEvents(rawEvents);
  const versioned = normalized.map((event) => {
    const sequence = ++logicalSequence;
    return {
      ...event,
      stream_protocol_version: 2,
      attempt_id: input.attemptId,
      attempt_index: input.attemptIndex,
      logical_sequence: sequence,
      idempotency_key: `stream-v2:${input.runId}:${input.attemptId}:${sequence}`,
    };
  });
  if (versioned.length > 0) input.onEvents(versioned);
}
```

`attemptId` is stable for one provider attempt and `attemptIndex` is monotonic within the agent run. Gate 4 tests supply both explicitly; production allocation belongs to Phase 5's mixed agent-loop delivery envelope. A future delivery queue retries the same decorated objects so keys remain stable. Cross-process reconstruction of an unaccepted buffer belongs to Phase 5's persistent outbox. The append request continues to carry `expected_previous_event_id` and `expected_previous_external_event_sequence`; do not duplicate mutable cursors into each event.

- [ ] **Step 5: Add a pure preparation entry point without changing mirrors**

Keep `ConversationRunEventEncoder.encode(ChatStreamEvent)` and all of its public behavior intact for legacy external callers. Active version 2 code does not call it; the new buffered Adapter is the only version 2 encoder.

Add this helper to `run-event-preparation.ts` for fixtures and the future delivery module:

```ts
export function prepareConversationRunLifecycleEvents(input: {
  runId: string;
  attemptId: string;
  attemptIndex: number;
  messageId: string;
  frames: readonly StreamLifecycleFrame[];
}): ConversationRunEvent[] {
  const events: ConversationRunEvent[] = [];
  const adapter = createLifecycleRunEventAdapter({
    ...input,
    onEvents: (batch) => events.push(...batch),
  });
  for (const frame of input.frames) adapter.handleFrame(frame);
  adapter.flush();
  adapter.dispose();
  return events;
}
```

Keep `prepareConversationRunStreamEvents()`, `prepareConversationRunChunkEvents()`, `ConversationRunChunkMirror`, and `ConversationRunStreamMirror` unchanged. Wiring this helper into a hosted mirror before a source-tagged delivery contract exists would double-write lifecycle-owned UI chunks and lose local tool events that occur after handoff.

- [ ] **Step 6: Prove version 2 bypasses projection repair state and has no production caller**

Send balanced canonical frames through `prepareConversationRunLifecycleEvents()` and assert the result has the expected versioned events. Send the equivalent legacy `ChatStreamEvent` sequence through `prepareConversationRunStreamEvents()` and assert it still uses the compatibility encoder without version 2 fields. Add a test whose `text_content` has no prior `text_start`; the lifecycle reducer must reject or repair it before this Adapter, so calling the Adapter directly with that invalid sequence throws a typed `StreamProjectionInvariantError` rather than synthesizing a start.

Run:

```bash
! rg -n 'prepareConversationRunLifecycleEvents|createLifecycleRunEventAdapter' src \
  --glob '!src/**/*.test.ts' \
  --glob '!src/agent/conversation/lifecycle-run-event-adapter.ts' \
  --glob '!src/agent/conversation/run-event-preparation.ts'
```

Expected: no matches. No hosted, mirror, runtime, or other production caller
exists in Gate 4.

- [ ] **Step 7: Run durable projection checks**

Run:

```bash
deno fmt src/agent/conversation/
deno test --no-check --allow-all \
  src/agent/conversation/lifecycle-run-event-adapter.test.ts \
  src/agent/conversation/run-events.test.ts \
  src/agent/conversation/run-event-preparation.test.ts \
  src/agent/conversation/run-event-normalization.test.ts \
  src/agent/conversation/run-mirror.test.ts
deno check src/agent/conversation/lifecycle-run-event-adapter.ts \
  src/agent/conversation/run-event-preparation.ts
```

Expected: PASS. Version 2 projection never synthesizes lifecycle boundaries, repeated status cadence is not persisted, split events have unique identities, and no production caller can select the Adapter.

- [ ] **Step 8: Commit the durable projection Adapter**

```bash
git add src/agent/conversation/lifecycle-run-event-adapter.ts \
  src/agent/conversation/lifecycle-run-event-adapter.test.ts \
  src/agent/conversation/run-event-preparation.ts \
  src/agent/conversation/run-event-preparation.test.ts \
  src/agent/conversation/run-event-normalization.test.ts
git commit -m "Define canonical durable projection without enabling delivery" \
  -m "Constraint: Existing event names remain compatible and hosted production still receives UI chunks" \
  -m "Rejected: Decorate before payload normalization | split events would duplicate logical identity" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Directive: Do not add a production caller before the Phase 5 source-tagged delivery and backend dedupe contract" \
  -m "Tested: lifecycle durable Adapter, preparation, normalization, compatibility encoder, and caller scan"
```

### Task 15: Repair only unversioned historical reads

**Files:**

- Create: `src/agent/conversation/legacy-run-read-adapter.ts`
- Create: `src/agent/conversation/legacy-run-read-adapter.test.ts`
- Create: `src/agent/conversation/fixtures/legacy-content-after-end.json`
- Modify: `src/agent/streaming/lifecycle/reducer.ts`
- Modify: `src/agent/streaming/lifecycle/reducer.test.ts`

**Interfaces:**

- Consumes: immutable conversation run event arrays and the normalized run-level `StreamProtocolVersion` from Task 13.
- Produces: `readConversationRunLifecycleFrames()` with a strict version 2 path and a repair-tolerant version 1 path.

- [ ] **Step 1: Check in the malformed legacy fixture**

Create this exact fixture. It intentionally reuses a closed content ID and omits a new start:

```json
{
  "metadata": null,
  "events": [
    {
      "type": "TEXT_MESSAGE_START",
      "messageId": "legacy-message",
      "contentId": "legacy-content",
      "role": "assistant"
    },
    {
      "type": "TEXT_MESSAGE_CONTENT",
      "messageId": "legacy-message",
      "contentId": "legacy-content",
      "delta": "first"
    },
    {
      "type": "TEXT_MESSAGE_END",
      "messageId": "legacy-message",
      "contentId": "legacy-content"
    },
    {
      "type": "TEXT_MESSAGE_CONTENT",
      "messageId": "legacy-message",
      "contentId": "legacy-content",
      "delta": "second"
    }
  ]
}
```

- [ ] **Step 2: Write failing non-mutation and repair tests**

```ts
import fixture from "./fixtures/legacy-content-after-end.json" with { type: "json" };

it("repairs legacy content after end without rewriting source events", () => {
  const source = structuredClone(fixture.events);
  const result = readConversationRunLifecycleFrames({
    streamProtocolVersion: 1,
    events: fixture.events,
  });

  assertEquals(fixture.events, source);
  assertEquals(result.status, "ok");
  assertEquals(result.repairs, ["legacy_text_content_after_end"]);
  const text = result.frames.filter((frame) =>
    frame.class === "semantic" && frame.event.type === "text_content"
  );
  assertEquals(text.map((frame) => frame.event.delta), ["first", "second"]);
  assertEquals(new Set(text.map((frame) => frame.event.id)).size, 2);
  assertEquals(
    result.frames.filter((frame) =>
      frame.class === "semantic" && frame.event.type === "text_start"
    ).length,
    2,
  );
  assertEquals(
    result.frames.filter((frame) =>
      frame.class === "semantic" && frame.event.type === "text_end"
    ).length,
    2,
  );
});

it("rejects the same malformed sequence for version 2", () => {
  const result = readConversationRunLifecycleFrames({
    streamProtocolVersion: 2,
    events: fixture.events.map((event, index) => ({
      ...event,
      stream_protocol_version: 2,
      logical_sequence: index + 1,
      idempotency_key: `fixture:${index + 1}`,
    })),
  });
  assertEquals(result.status, "invalid");
  if (result.status === "invalid") {
    assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
  }
});
```

- [ ] **Step 3: Run the read tests and verify the Adapter is absent**

Run: `deno test --no-check --allow-all src/agent/conversation/legacy-run-read-adapter.test.ts`

Expected: FAIL because the fixture Adapter and projection-finalization helper do not exist.

- [ ] **Step 4: Add a projection-only reducer finalizer**

Add this function to `reducer.ts`:

```ts
export function finalizeStreamProjection(
  current: StreamReducerState,
  elapsedMs: number,
): StreamReduction {
  const state = cloneReducerState(current);
  const frames: StreamLifecycleFrame[] = [];
  const emit: FrameEmitter = (frame) => {
    frames.push({
      ...frame,
      sequence: ++state.sequence,
      elapsedMs,
    } as StreamLifecycleFrame);
  };
  closeOpenContent(state, emit);
  return { state, frames, semanticProgress: false };
}
```

This closes read projection segments only. It does not set a provider finish reason, settle a Stream Outcome, or change lifecycle terminal meaning.

- [ ] **Step 5: Implement explicit version selection**

Use this result contract:

```ts
export type ConversationRunLifecycleReadResult =
  | {
    status: "ok";
    frames: readonly StreamLifecycleFrame[];
    repairs: readonly "legacy_text_content_after_end"[];
  }
  | {
    status: "invalid";
    frames: readonly StreamLifecycleFrame[];
    code: "VERSION_2_LIFECYCLE_VIOLATION" | "UNSUPPORTED_DURABLE_EVENT";
  };

export function readConversationRunLifecycleFrames(input: {
  streamProtocolVersion: StreamProtocolVersion;
  events: readonly Readonly<Record<string, unknown>>[];
}): ConversationRunLifecycleReadResult;
```

Do not mutate, sort, or decorate `input.events`.

For version 1, map known durable event names to provider-neutral protocol signals and pass them through `reduceStreamSignal()`. The mapping is:

| Durable event | Protocol signal |
|---|---|
| `TEXT_MESSAGE_START/CONTENT/END` | `text_start/content/end` using `contentId` as the candidate ID |
| `REASONING_MESSAGE_START/CONTENT/END` | `reasoning_start/content/end` |
| `TOOL_CALL_START/ARGS/END` | `tool_input_start/content/ready`, with strict JSON parsing at end |
| `TOOL_CALL_RESULT` | provider result only when the preceding tool is marked provider-executed; otherwise retain it as a semantic custom compatibility event |
| `CUSTOM` | `custom` |
| unknown | sanitized `provider_part_rejected` diagnostic and continue |

Track closed legacy text content IDs. When content arrives for a closed ID, feed a `text_content` signal without reopening that external ID; the reducer creates a fresh internal content ID and record `legacy_text_content_after_end` once. Call `finalizeStreamProjection()` after the last event.

For version 2, first require every event to have `stream_protocol_version === 2`, a strictly increasing positive integer `logical_sequence`, and a unique non-empty `idempotency_key`. Then validate text, reasoning, and tool start/content/end order with a small validator. Map valid events directly to `StreamLifecycleFrame` objects while preserving content IDs and logical order. Do not call the repair reducer on version 2. Return `invalid` on the first invariant violation and include only the already-validated frame prefix.

- [ ] **Step 6: Test unknown events and source immutability**

Add a version 1 case with an unknown event carrying a sentinel secret. Assert the result contains only `provider_part_rejected` and that `JSON.stringify(result)` does not contain the sentinel. Add a frozen input-array case to prove the Adapter does not rely on mutation.

- [ ] **Step 7: Run read Adapter and reducer tests**

Run:

```bash
deno fmt src/agent/conversation/legacy-run-read-adapter.ts \
  src/agent/conversation/legacy-run-read-adapter.test.ts \
  src/agent/streaming/lifecycle/reducer.ts \
  src/agent/streaming/lifecycle/reducer.test.ts
deno test --no-check --allow-all \
  src/agent/conversation/legacy-run-read-adapter.test.ts \
  src/agent/streaming/lifecycle/reducer.test.ts
deno check src/agent/conversation/legacy-run-read-adapter.ts
```

Expected: PASS. The fixture remains byte-equivalent, version 1 repairs once, and version 2 refuses the malformed sequence.

- [ ] **Step 8: Commit the versioned read boundary**

```bash
git add src/agent/conversation/legacy-run-read-adapter.ts \
  src/agent/conversation/legacy-run-read-adapter.test.ts \
  src/agent/conversation/fixtures/legacy-content-after-end.json \
  src/agent/streaming/lifecycle/reducer.ts \
  src/agent/streaming/lifecycle/reducer.test.ts
git commit -m "Repair historical stream framing only at the read boundary" \
  -m "Constraint: Runs without stream protocol metadata are version 1 and source events remain immutable" \
  -m "Rejected: Rewrite persisted history | destroys audit provenance and complicates rollback" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Version 2 lifecycle violations are errors, never repair candidates" \
  -m "Tested: legacy fixture, strict version 2 validation, reducer finalization, and deno check"
```

### Task 16: Project validated frames to AG-UI without lifecycle repair

**Files:**

- Create: `src/agent/ag-ui/lifecycle-browser-adapter.ts`
- Create: `src/agent/ag-ui/lifecycle-browser-adapter.test.ts`

**Interfaces:**

- Consumes: validated lifecycle frames from a live run or Task 15's versioned read Adapter, plus one terminal Stream Outcome or historical run status.
- Produces: pure `createLifecycleAgUiBrowserAdapter()` capability while preserving every current browser encoder export and caller unchanged.

- [ ] **Step 1: Write a failing balanced projection test**

Feed one canonical sequence containing text, reasoning, a local tool input, a provider tool result, usage, and step finish. Assert the emitted `event` names match the current AG-UI profile and every start has exactly one matching end with the same identity.

Finalize a provider attempt with a `tool_handoff` outcome and assert no
`RunFinished` or `RunError` is emitted. Then finalize the same visible frame
history with an outer-loop historical `completed` status and assert exactly one
`RunFinished`. This prevents a provider-attempt boundary from terminating the
agent run before local tool execution and a later attempt.

Add the legacy fixture pipeline:

```ts
const read = readConversationRunLifecycleFrames({
  streamProtocolVersion: 1,
  events: fixture.events,
});
assertEquals(read.status, "ok");
if (read.status !== "ok") return;

const adapter = createLifecycleAgUiBrowserAdapter({ messageId: "legacy-message" });
const browserEvents = [
  ...read.frames.flatMap((frame) => adapter.encode(frame)),
  ...adapter.finalize({ terminalStatus: "completed" }),
];
assertEquals(
  browserEvents.filter((entry) => entry.event === "TextMessageContent")
    .map((entry) => entry.payload.delta).join(""),
  "firstsecond",
);
assertEquals(
  new Set(browserEvents.filter((entry) => entry.event.startsWith("TextMessage"))
    .map((entry) => entry.payload.messageId)),
  new Set(["legacy-message"]),
);
assertEquals(
  new Set(browserEvents.filter((entry) => entry.event === "TextMessageStart")
    .map((entry) => entry.payload.contentId)).size,
  2,
);
assertEquals(
  browserEvents.filter((entry) => entry.event === "TextMessageStart").length,
  browserEvents.filter((entry) => entry.event === "TextMessageEnd").length,
);
```

- [ ] **Step 2: Run the new AG-UI tests and verify the Adapter is absent**

Run: `deno test --no-check --allow-all src/agent/ag-ui/lifecycle-browser-adapter.test.ts`

Expected: FAIL because the lifecycle browser Adapter does not exist.

- [ ] **Step 3: Implement a formatting-only Adapter state**

```ts
export interface LifecycleAgUiBrowserState {
  messageId: string;
  activeStepName: string | null;
  stepCount: number;
  streamedToolInputIds: Set<string>;
  sawVisibleOutput: boolean;
  sawTerminalError: boolean;
  metadata: AgUiBrowserRunFinishedMetadata;
}

export interface LifecycleAgUiBrowserAdapter {
  encode(frame: StreamLifecycleFrame): AgUiBrowserEncodedEvent[];
  finalize(input:
    | { outcome: StreamOutcome; terminalStatus?: never }
    | { outcome?: never; terminalStatus: "completed" | "failed" | "cancelled" }
  ): AgUiBrowserEncodedEvent[];
  getState(): Readonly<LifecycleAgUiBrowserState>;
}

export function createLifecycleAgUiBrowserAdapter(input: {
  messageId: string;
  provider?: string;
  model?: string;
}): LifecycleAgUiBrowserAdapter;
```

The new state intentionally has no `textOpen`, `activeTextContentId`, `textContentIndex`, or `reasoningMessageId`. Those are lifecycle-repair fields, and canonical frames already carry balanced identities. Keep the exported `AgUiBrowserEncoderState` and its implementation unchanged for source compatibility in Gate 4.

- [ ] **Step 4: Implement the exhaustive frame mapping**

Use this exact mapping. A missing required ID throws `StreamProjectionInvariantError`; it never synthesizes a lifecycle boundary.

| Frame | AG-UI output and state effect |
|---|---|
| semantic `message_start` | update `messageId` when present, no output |
| semantic `step_start` | `StepStarted` with the next `step-N` name |
| semantic `text_start/content/end` | `TextMessageStart/Content/End` with Adapter `messageId` and frame `id` as `contentId` |
| semantic `reasoning_start/content/end` | `ReasoningMessageStart/Content/End` with `${messageId}:reasoning:${id}` |
| semantic `tool_input_start` | `ToolCallStart` |
| semantic `tool_input_content` | `ToolCallArgs`; remember that arguments streamed |
| semantic `tool_input_ready` | emit serialized `ToolCallArgs` only when no delta streamed, then `ToolCallEnd`; preserve the current provider-executed compatibility result when applicable |
| semantic `tool_input_rejected` | no output for `unavailable`; otherwise `ToolCallEnd` then error `ToolCallResult` |
| semantic `provider_tool_start` | no browser output |
| semantic `provider_tool_result` | `ToolCallResult` with output and `isError` |
| semantic `provider_tool_denied` | error `ToolCallResult` with `Tool output denied` |
| semantic `provider_tool_cancelled` | error `ToolCallResult` with `Provider tool execution was cancelled` |
| semantic `step_finish` | `StepFinished` using the active step name |
| semantic `custom` | `Custom` with `name` and `value` |
| semantic `usage` | merge every supported usage field into final metadata, no immediate output |
| telemetry `tool_input_status` | `Custom` named `tool-call-status` with the same current payload |
| other telemetry | no AG-UI output |
| diagnostic | no AG-UI output |

Every assistant-visible text, reasoning, tool, or custom event sets `sawVisibleOutput`. Serialization uses the same safe JSON fallback as the compatibility encoder.

- [ ] **Step 5: Make terminal projection explicit**

`finalize()` applies this exact table:

| Terminal input | Output |
|---|---|
| failed Stream Outcome | one `RunError` with typed code and sanitized `publicMessage` |
| cancelled Stream Outcome or historical cancelled status | one `RunError` with code `STREAM_CANCELLED` and `Stream was cancelled` |
| completed Stream Outcome with visible output | one `RunFinished` containing accumulated metadata |
| tool-handoff Stream Outcome | no run-terminal event; Phase 5 outer-loop delivery owns later local tool execution and final run status |
| historical completed with visible output | one `RunFinished` containing accumulated metadata |
| completed or historical completed without visible output | one `RunError` with `EMPTY_ASSISTANT_OUTPUT` |
| already terminal-error state | no duplicate event |

`finalize()` never closes text or reasoning. If a supposedly validated sequence is open, `encode()` has already thrown at the invalid frame boundary.

- [ ] **Step 6: Keep current exports and production callers unchanged**

Do not change `browser-encoder.ts`, `runtime-event-encoder.ts`, the signatures or public exports of `createAgUiBrowserEncoderState()`, `mapRuntimeStreamEventToAgUiBrowserEvents()`, `finalizeAgUiBrowserEvents()`, or `createAgUiRuntimeEventEncoder()`. Existing callers continue through the legacy byte/event path.

Do not re-export the new lifecycle constructor from `src/agent/index.ts`. Run:

```bash
! rg -n 'createLifecycleAgUiBrowserAdapter' src \
  --glob '!src/**/*.test.ts' \
  --glob '!src/agent/ag-ui/lifecycle-browser-adapter.ts'
```

Expected: no matches. Phase 5 will add the mixed lifecycle/runtime object
channel and the first production caller; Gate 4 must not leak lifecycle frames
as public `data-*` bytes.

- [ ] **Step 7: Run AG-UI compatibility and versioned fixture tests**

Run:

```bash
deno fmt src/agent/ag-ui/
deno test --no-check --allow-all \
  src/agent/ag-ui/lifecycle-browser-adapter.test.ts \
  src/agent/ag-ui/browser-encoder.test.ts \
  src/agent/ag-ui/runtime-event-encoder.test.ts \
  src/agent/ag-ui/browser-chunk-encoder.test.ts \
  src/internal-agents/ag-ui-sse.test.ts
deno check src/agent/ag-ui/lifecycle-browser-adapter.ts \
  src/agent/ag-ui/browser-encoder.ts
```

Expected: PASS. Legacy exports keep existing behavior, canonical projection performs no repairs, the immutable malformed fixture renders one logical message with two balanced content segments, and no production caller selects the new Adapter.

- [ ] **Step 8: Commit the AG-UI projection boundary**

```bash
git add src/agent/ag-ui/lifecycle-browser-adapter.ts \
  src/agent/ag-ui/lifecycle-browser-adapter.test.ts
git commit -m "Define canonical AG-UI projection without enabling delivery" \
  -m "Constraint: Hosted AG-UI has no lifecycle object channel and existing browser exports remain source compatible" \
  -m "Rejected: Emit lifecycle frames as public data events | leaks an internal protocol and still reparses bytes" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Directive: Phase 5 must merge lifecycle frames with outer-loop and local-tool events before production cutover" \
  -m "Tested: lifecycle AG-UI, legacy fixture, legacy browser, runtime encoder, chunk encoder, caller scan, and internal SSE tests"
```

### Task 17: Add bounded lifecycle observability

**Files:**

- Create: `src/observability/instruments/stream-lifecycle-instruments.ts`
- Create: `src/observability/instruments/stream-lifecycle-instruments.test.ts`
- Modify: `src/observability/metrics/types.ts`
- Modify: `src/observability/instruments/instruments-factory.ts`
- Modify: `src/observability/metrics/manager.ts`
- Modify: `src/observability/metrics/manager.test.ts`
- Modify: `src/observability/metrics/recorder.ts`
- Modify: `src/observability/metrics/recorder.test.ts`
- Modify: `src/observability/metrics/index.ts`
- Create: `src/agent/streaming/lifecycle/observability.ts`
- Create: `src/agent/streaming/lifecycle/observability.test.ts`
- Modify: `src/agent/streaming/lifecycle/types.ts`
- Modify: `src/agent/streaming/lifecycle/runner.ts`
- Modify: `src/agent/streaming/lifecycle/runner.test.ts`
- Modify: `src/agent/streaming/lifecycle/deadlines.ts`
- Modify: `src/agent/streaming/lifecycle/deadlines.test.ts`
- Modify: `src/agent/runtime/stream-lifecycle-shadow.ts`
- Modify: `src/agent/runtime/stream-lifecycle-shadow.test.ts`

**Interfaces:**

- Consumes: canonical frames, semantic-progress decisions, deadline firings, Stream Outcome, shadow category reports, the existing internal metrics manager, and the existing active span.
- Produces: typed lifecycle counters/histograms and `createStreamLifecycleObserver()` with a closed label vocabulary.

- [ ] **Step 1: Write failing instrument and cardinality tests**

Use a fake `Meter` to assert these exact instrument names are created under the configured prefix:

```text
<prefix>.stream.lifecycle.outcomes
<prefix>.stream.lifecycle.deadlines
<prefix>.stream.lifecycle.telemetry
<prefix>.stream.lifecycle.repairs
<prefix>.stream.lifecycle.shadow_divergences
<prefix>.stream.lifecycle.attempt.duration
<prefix>.stream.lifecycle.first_progress.duration
<prefix>.stream.lifecycle.semantic_idle.duration
<prefix>.stream.lifecycle.tool_input.duration
<prefix>.stream.lifecycle.tool_execution.duration
```

Add an observability test with provider, model, run, conversation, tool-call, and prompt sentinel strings. Record frames, a deadline, an outcome, and a shadow report. Assert every emitted metric attribute key belongs to this set:

```ts
const ALLOWED_LABEL_KEYS = new Set([
  "status",
  "phase",
  "error_code",
  "cancellation_source",
  "provider",
  "model_family",
  "deadline_kind",
  "telemetry_kind",
  "repair_code",
  "divergence_category",
  "mode",
]);
```

Assert serialized metric attributes contain none of the sentinels. Assert the active span receives only `stream.lifecycle.*` bounded values and no new span is started.

- [ ] **Step 2: Run focused tests and verify lifecycle instruments are absent**

Run:

```bash
deno test --no-check --allow-all \
  src/observability/instruments/stream-lifecycle-instruments.test.ts \
  src/agent/streaming/lifecycle/observability.test.ts
```

Expected: FAIL because neither instrument family nor observer exists.

- [ ] **Step 3: Add the typed internal instruments**

Create this instrument shape:

```ts
export interface StreamLifecycleInstruments {
  streamLifecycleOutcomeCounter: Counter | null;
  streamLifecycleDeadlineCounter: Counter | null;
  streamLifecycleTelemetryCounter: Counter | null;
  streamLifecycleRepairCounter: Counter | null;
  streamLifecycleShadowDivergenceCounter: Counter | null;
  streamLifecycleAttemptDuration: Histogram | null;
  streamLifecycleFirstProgressDuration: Histogram | null;
  streamLifecycleSemanticIdleDuration: Histogram | null;
  streamLifecycleToolInputDuration: Histogram | null;
  streamLifecycleToolExecutionDuration: Histogram | null;
}
```

`createStreamLifecycleInstruments(meter, config)` creates the five counters and five millisecond histograms listed in Step 1. Reuse `DURATION_HISTOGRAM_BOUNDARIES_MS` for every duration histogram.

Extend `MetricsInstruments`, both empty-instrument constructors in `instruments-factory.ts` and `manager.ts`, and `initializeInstruments()` with this family. Update mock builders in recorder and manager tests so every typed instrument is present as either a fake instrument or `null`.

- [ ] **Step 4: Add narrow recorder methods**

Add these methods to `MetricsRecorder`; none accepts an arbitrary metric name:

```ts
recordStreamLifecycleOutcome(attributes: Record<string, string>): void;
recordStreamLifecycleDeadline(attributes: Record<string, string>): void;
recordStreamLifecycleTelemetry(attributes: Record<string, string>): void;
recordStreamLifecycleRepair(attributes: Record<string, string>): void;
recordStreamLifecycleShadowDivergence(attributes: Record<string, string>): void;
recordStreamLifecycleDuration(
  kind: "attempt" | "first_progress" | "semantic_idle" | "tool_input" | "tool_execution",
  durationMs: number,
  attributes: Record<string, string>,
): void;
```

Each counter adds one. The duration method switches exhaustively to the corresponding histogram and records `Math.max(0, durationMs)`. Add internal forwarding functions in `src/observability/metrics/index.ts`; do not expose them through `src/metrics/index.ts` or a new public `veryfront/*` export.

- [ ] **Step 5: Define the lifecycle observer contract**

Add to `types.ts`:

```ts
export interface StreamLifecycleObserver {
  onFrame(frame: StreamLifecycleFrame): void;
  onSemanticProgress(input: {
    elapsedMs: number;
    sincePreviousProgressMs: number | null;
    phase: StreamLifecyclePhase;
  }): void;
  onDeadline(deadline: StreamProviderDeadlineKind | "attempt"): void;
  onOutcome(outcome: StreamOutcome): void;
}
```

Add optional `observer?: StreamLifecycleObserver` to `StreamLifecycleInput`. Observer exceptions are caught and ignored after a sanitized internal warning; observability must never alter frames, deadlines, cleanup, or outcome.

- [ ] **Step 6: Implement bounded label normalization and timings**

`observability.ts` exports:

```ts
export function createStreamLifecycleObserver(input: {
  provider?: string;
  model?: string;
  mode: "legacy" | "shadow" | "active";
  sink?: StreamLifecycleMetricSink;
  span?: Span;
}): StreamLifecycleObserver;

export function recordStreamLifecycleShadowReport(input: {
  report: StreamLifecycleShadowReport;
  mode: "shadow";
  sink?: StreamLifecycleMetricSink;
  span?: Span;
}): void;
```

Normalize provider strings to `openai`, `azure_openai`, `anthropic`, `google`, `aws_bedrock`, or `other`. Normalize model strings to `gpt`, `openai_o_series`, `claude`, `gemini`, `llama`, `mistral`, or `other`. Unknown input never becomes a label value.

Repair codes use an allowlist of `implicit_text_start`, `implicit_reasoning_start`, `implicit_tool_input_start`, `provider_tool_input_synthesized`, `legacy_text_content_after_end`, and `other`. Protocol violations are represented by the failed outcome and never increment the repair counter. Deadline, telemetry, outcome, phase, cancellation, divergence, and mode values come only from their TypeScript discriminated unions.

The observer may keep tool call IDs in an in-memory timing map, but never passes map keys to the sink or span. Apply these timings:

- First semantic progress: attempt start to the first reducer-approved progress callback.
- Semantic idle: `sincePreviousProgressMs` for later progress and the terminal semantic-idle deadline.
- Tool input: `tool_input_start` to ready or rejected.
- Visible tool execution: `provider_tool_start` to result, denied, or cancelled.
- Attempt: attempt start to outcome settlement.

Telemetry frames increment by bounded `telemetry_kind`. Diagnostic protocol repairs increment by bounded `repair_code`. `onDeadline()` increments by `deadline_kind`. `onOutcome()` records status, terminal phase, optional typed error/cancellation, provider family, model family, and mode. It also sets those bounded values on `input.span ?? trace.getActiveSpan()`; it does not start a span.

- [ ] **Step 7: Hook the observer at ownership points**

In `runner.ts`, call observer methods through a `notifyObserver()` helper that catches exceptions. Call `onFrame()` before each frame is yielded, `onSemanticProgress()` from the reducer's `semanticProgress` boolean, and `onOutcome()` inside the exactly-once outcome deferred before resolving its promise. Track `lastSemanticProgressMs` in the runner solely to calculate the callback duration.

In `deadlines.ts`, call `onDeadline()` only when a deadline actually wins the race, not when it is armed or paused. The independent attempt callback reports `attempt` once.

In `stream-lifecycle-shadow.ts`, call `recordStreamLifecycleShadowReport()` after building the bounded category report. Do not pass legacy or shadow snapshots to observability.

- [ ] **Step 8: Verify recorder, manager, runner, deadline, and shadow behavior**

Run:

```bash
deno fmt src/observability/ src/agent/streaming/lifecycle/ \
  src/agent/runtime/stream-lifecycle-shadow.ts \
  src/agent/runtime/stream-lifecycle-shadow.test.ts
deno test --no-check --allow-all \
  src/observability/instruments/stream-lifecycle-instruments.test.ts \
  src/observability/metrics/recorder.test.ts \
  src/observability/metrics/manager.test.ts \
  src/agent/streaming/lifecycle/observability.test.ts \
  src/agent/streaming/lifecycle/runner.test.ts \
  src/agent/streaming/lifecycle/deadlines.test.ts \
  src/agent/runtime/stream-lifecycle-shadow.test.ts
deno check src/observability/metrics/index.ts \
  src/agent/streaming/lifecycle/observability.ts \
  src/agent/streaming/lifecycle/runner.ts
```

Expected: PASS. Observer failures are fail-open, metrics use only bounded labels, and no identifier or payload sentinel reaches metrics.

- [ ] **Step 9: Commit lifecycle observability**

```bash
git add src/observability/instruments/stream-lifecycle-instruments.ts \
  src/observability/instruments/stream-lifecycle-instruments.test.ts \
  src/observability/metrics src/observability/instruments/instruments-factory.ts \
  src/agent/streaming/lifecycle src/agent/runtime/stream-lifecycle-shadow.ts \
  src/agent/runtime/stream-lifecycle-shadow.test.ts
git commit -m "Make stream lifecycle failures measurable without payload labels" \
  -m "Constraint: Metrics accept bounded categories only and observability fails open" \
  -m "Rejected: Reuse arbitrary project metrics | permits cardinality and tenant-data leaks" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Delivery retry, queue, append, and outbox metrics belong to the Phase 5 design" \
  -m "Tested: lifecycle instruments, recorder, manager, observer, runner, deadlines, shadow, and deno check"
```

### Task 18: Document the release boundary and verify every gate

**Files:**

- Modify: `CONTEXT.md`
- Modify: `docs/architecture/05-agent-runtime.md`
- Modify: `docs/architecture/27-agent-message-stream-dataflow.md`
- Create: `docs/internal/stream-lifecycle-rollout.md`

**Interfaces:**

- Consumes: the implemented lifecycle, mode resolver, compatibility Adapters, bounded observability, and the explicit Phase 5 boundary.
- Produces: one architecture narrative, one operational rollback runbook, and final verification evidence. It does not enable version 2 production writes.

- [ ] **Step 1: Record the documentation baseline**

Run:

```bash
rg -n "Stream Lifecycle|provider-wait|stream_protocol_version|VF_STREAM_LIFECYCLE_MODE" \
  CONTEXT.md \
  docs/architecture/05-agent-runtime.md \
  docs/architecture/27-agent-message-stream-dataflow.md \
  docs/internal
```

Expected before documentation edits: no complete description of the new owner, provider-wait pause rule, mode rollout, and version 2 stop condition exists across these four locations.

- [ ] **Step 2: Update the architecture vocabulary and flow**

Add these exact concepts without exposing internal hosts, credentials, payloads, or local paths:

1. `CONTEXT.md` defines Stream Lifecycle as one provider attempt, Stream Outcome as its exactly-once typed result, and Stream Delivery as the separate agent-loop fan-out boundary.
2. `docs/architecture/05-agent-runtime.md` shows `Provider Adapter -> Stream Lifecycle -> Live Adapter` for the current active runtime path. It states that provider idle time accrues only while one provider read is pending, while the absolute attempt limit and external cancellation continue under consumer backpressure.
3. `docs/architecture/27-agent-message-stream-dataflow.md` distinguishes semantic, telemetry, and diagnostic frames. It states that status telemetry cannot extend semantic deadlines and that local tool execution occurs after a `tool_handoff` outcome in the outer agent loop.
4. Both architecture documents state that hosted durable and AG-UI production still consume compatibility UI chunks in Gates 1 through 4. Version 2 projection Adapters exist and are tested, but they have no production caller until Phase 5 adds a mixed lifecycle/runtime object channel and backend idempotency.

Use this compact boundary diagram in `docs/architecture/27-agent-message-stream-dataflow.md`:

```text
provider attempt
  RuntimeStreamPart -> Provider Adapter -> Stream Lifecycle -> Live Adapter -> Data Stream bytes
                                              |
                                              +-> Stream Outcome

agent loop
  provider attempt -> local tool execution -> provider attempt -> finalization

hosted compatibility through Gate 4
  Data Stream bytes -> ChatUiMessageChunk -> durable mirror / AG-UI

Phase 5 target
  lifecycle frames + outcomes + local tool events + fallback + child progress
                              -> source-tagged Stream Delivery envelope
                              -> live / durable / AG-UI Adapters
```

- [ ] **Step 3: Add the operational rollout and rollback runbook**

Create `docs/internal/stream-lifecycle-rollout.md` with this gate table:

| Stage | Mode | Minimum evidence | Advance condition | Rollback |
|---|---|---|---|---|
| Build | `legacy` | focused and full verification below | all commands pass | revert the current task commit |
| Shadow | `shadow` | at least 10,000 attempts or 24 hours | zero unexplained divergence categories; no payload labels | set `VF_STREAM_LIFECYCLE_MODE=legacy` |
| Active canary | `active` on 1 percent | at least 1,000 attempts and one hour | no increase above 0.1 percentage points in failed/cancelled outcomes; timeout regression ends at policy budget | set mode to `legacy` |
| Active ramp | 10, 50, then 100 percent | at least six hours at each step and 24 hours at 50 percent | deadline, cancellation, latency, and provider-family dashboards remain within the canary bounds | set mode to `legacy` at the affected deployment scope |
| Projection capability | production version 1 | Gate 4 fixture suite | version 2 Adapters have no production caller | no action; writes remain version 1 |
| Phase 5 cutover | version 2 | separately approved delivery plan, server metadata smoke test, backend dedupe, byte backpressure, mixed-source replay | all Phase 5 gates pass | stop version 2 creates; preserve existing versioned reads |

The runbook must name the bounded dashboard dimensions from Task 17, the `legacy` kill switch, and the incident evidence to retain. It must explicitly forbid logging prompts, tool arguments, tool results, run IDs, conversation IDs, cookies, authorization headers, or raw provider payloads.

- [ ] **Step 4: Run the complete focused verification corpus**

Run:

```bash
deno test --no-check --allow-all \
  src/agent/streaming/lifecycle/ \
  src/agent/streaming/stream-outcome.test.ts \
  src/agent/runtime/stream-lifecycle-shadow.test.ts \
  src/agent/runtime/stream-lifecycle-mode.test.ts \
  src/agent/runtime/chat-stream-handler.test.ts \
  src/agent/runtime/runtime-stream-cancel.test.ts \
  src/provider/runtime-loader.test.ts \
  src/chat/stream-watchdog.test.ts \
  src/agent/hosted/chat-execution-runtime.test.ts \
  src/agent/hosted/stream-finalization.test.ts \
  src/agent/conversation/durable-contracts.test.ts \
  src/agent/conversation/lifecycle-run-event-adapter.test.ts \
  src/agent/conversation/legacy-run-read-adapter.test.ts \
  src/agent/conversation/run-event-preparation.test.ts \
  src/agent/conversation/run-events.test.ts \
  src/agent/ag-ui/lifecycle-browser-adapter.test.ts \
  src/agent/ag-ui/browser-encoder.test.ts \
  src/observability/instruments/stream-lifecycle-instruments.test.ts \
  src/observability/metrics/recorder.test.ts \
  src/observability/metrics/manager.test.ts
```

Expected: PASS with no wall-time sleep in lifecycle tests, no pending manual-clock wait, and the immutable legacy fixture unchanged.

- [ ] **Step 5: Run repository-wide static and test gates**

Run:

```bash
deno fmt --check
deno lint
deno check \
  src/agent/runtime/index.ts \
  src/agent/runtime/chat-stream-handler.ts \
  src/agent/streaming/lifecycle/index.ts \
  src/chat/stream-watchdog.ts \
  src/agent/conversation/lifecycle-run-event-adapter.ts \
  src/agent/ag-ui/lifecycle-browser-adapter.ts \
  src/observability/metrics/index.ts
deno test --no-check --allow-all --parallel \
  '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
VF_DISABLE_LRU_INTERVAL=1 \
  SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
  REVALIDATION_PER_PROJECT_LIMIT=0 \
  NODE_ENV=production \
  LOG_FORMAT=text \
  deno test --no-check --allow-all --unstable-worker-options --unstable-net
git diff --check
```

Expected: every command PASS. If a pre-existing unrelated failure appears, capture the exact command and evidence, prove it reproduces at the implementation base commit, and do not weaken or delete a test.

- [ ] **Step 6: Run release-boundary searches**

Run:

```bash
! rg -n "withToolInputStatusTransitions" \
  extensions/ext-llm-openai/src/openai-provider.ts \
  extensions/ext-llm-anthropic/src/anthropic-provider.ts \
  extensions/ext-llm-google/src/google-provider.ts
! rg -n "setTimeout|Date\.now" src/chat/stream-watchdog.ts
! rg -n 'stream_protocol_version\s*:\s*2|streamProtocolVersion\s*:\s*2' src \
  --glob '!src/**/*.test.ts' \
  --glob '!src/agent/conversation/lifecycle-run-event-adapter.ts'
! rg -n "createLifecycleAgUiBrowserAdapter|prepareConversationRunLifecycleEvents|createLifecycleRunEventAdapter" src \
  --glob '!src/**/*.test.ts' \
  --glob '!src/agent/ag-ui/lifecycle-browser-adapter.ts' \
  --glob '!src/agent/conversation/lifecycle-run-event-adapter.ts' \
  --glob '!src/agent/conversation/run-event-preparation.ts'
git diff -- deno.json deno.lock
```

Expected: all four negated searches succeed because they find no forbidden
match. The dependency diff has no task-owned change. If `deno.lock` was already
dirty before execution, compare it to the recorded implementation base and
leave the unrelated change untouched.

- [ ] **Step 7: Commit documentation and release evidence**

```bash
git add CONTEXT.md docs/architecture/05-agent-runtime.md \
  docs/architecture/27-agent-message-stream-dataflow.md \
  docs/internal/stream-lifecycle-rollout.md
git commit -m "Make stream lifecycle rollout and rollback explicit" \
  -m "Constraint: Production version 2 waits for source-tagged delivery and backend deduplication" \
  -m "Rejected: Cut hosted projections over through serialized UI chunks | loses attempt identity and double-writes lifecycle events" \
  -m "Confidence: high" \
  -m "Scope-risk: broad" \
  -m "Directive: Keep legacy rollback until the Phase 5 delivery plan and soak gates complete" \
  -m "Tested: focused lifecycle corpus, repository unit and full tests, format, lint, type checks, boundary searches, and diff check"
```

**Gate 4 exit condition:** Version-aware reads, balanced durable and AG-UI projection Adapters, the immutable legacy repair fixture, bounded observability, architecture documentation, and the release runbook all pass. Production remains on stream protocol version 1. The Stream Lifecycle runtime fix may roll out through `shadow` and `active`; hosted version 2 projection waits for a separately approved Phase 5 Stream Delivery design and server-first metadata/deduplication deployment.
