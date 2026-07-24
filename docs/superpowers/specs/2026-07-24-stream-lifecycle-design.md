# Enterprise stream lifecycle design

Status: Approved architecture direction, implementation not started

Date: 2026-07-24

## Summary

Veryfront must interpret provider streams through one authoritative Stream
Lifecycle module before sending data to live clients, durable run storage,
diagnostics, or usage accounting.

The module owns provider stream consumption, lifecycle validation, semantic
progress classification, monotonic deadlines, cancellation, cleanup, and the
typed Stream Outcome. Output formats become Adapters at the lifecycle Seam.

The canonical durable run history records compact semantic events that can
reconstruct messages, reasoning segments, tool transitions, usage, and the
terminal outcome. Token timing, status heartbeats, and raw provider frames are
not canonical history. They belong to live telemetry or restricted, short-lived
diagnostics.

This design replaces a class of failures rather than patching the observed
heartbeat timeout and duplicate text symptoms independently.

## Problem statement

Stream lifecycle behavior is currently distributed across modules with
overlapping state and different interpretations:

- `src/agent/runtime/chat-stream-handler.ts` consumes provider parts, manages
  relative read timeouts, tracks text, reasoning, and tool state, captures
  usage, and writes SSE.
- `src/provider/runtime-loader/tool-input-status.ts` inserts repeated tool input
  status events into the provider stream.
- `src/chat/stream-watchdog.ts` derives another timeout state from emitted UI
  chunks.
- `src/agent/conversation/run-events.ts` derives durable lifecycle events with
  its own state.
- `src/agent/ag-ui/browser-encoder.ts` derives AG-UI events and repairs lifecycle
  gaps independently.
- `src/agent/streaming/stream-outcome.ts` centralizes part of terminal stream
  interpretation, but it does not yet own the complete lifecycle.

This distribution caused the observed failure:

1. A local tool input opened but never committed.
2. The provider wrapper emitted `pending_input` telemetry every five seconds.
3. Each telemetry frame satisfied the runtime's next-read race.
4. The runtime restarted a relative 15-second timeout after every frame.
5. The local tool input deadline never fired.
6. The run remained incomplete until another layer terminated it after about
   five minutes with the generic `STREAM_ERROR: terminated` result.

The same ownership problem permits unbalanced durable text framing. A text
segment can end, a tool can run, and more text can be persisted under the old
content identifier without a new start event.

## Goals

- Give stream lifecycle semantics exactly one owner.
- Separate semantic progress from telemetry at the type level.
- Use absolute deadlines based on a monotonic clock.
- Return one typed Stream Outcome for every provider stream attempt.
- Enforce balanced text, reasoning, and tool lifecycles before projection.
- Preserve existing public stream and run-event shapes during migration.
- Support provider-specific normalization without provider conditionals in
  callers.
- Keep live token streaming responsive without making token deltas the durable
  audit format.
- Emit the metadata required for durable history to be reconstructable,
  ordered, versioned, and idempotent.
- Make raw diagnostics opt-in, redacted, access-controlled, and short-lived.
- Provide deterministic interface-level tests for time, ordering, races,
  cancellation, and compatibility.
- Add no new dependency.

## Non-goals

- This design does not guarantee that a model's statements are true.
- This design does not redesign project file tools, TODO tools, or agent
  instructions.
- This design does not implement the model catalog or `ModelRef` contract.
- This design does not implement the step-level Usage Ledger or change the chat
  usage UI.
- This design does not migrate or rewrite existing durable run data.
- This design does not require exact replay of token arrival timing.
- This design does not make the Runs backend store raw provider payloads.

The excluded work remains important, but it belongs to separate modules and
separate implementation plans.

## Terminology

### Stream Lifecycle

The ordered interpretation of one provider stream attempt, from the first
provider read until completion, tool handoff, cancellation, or failure. Stream
Lifecycle includes protocol validation, semantic progress, deadlines, cleanup,
and Stream Outcome.

### Stream Outcome

The single typed result of a Stream Lifecycle. It includes terminal status,
phase, source, retryability, sanitized public error information, usage, and a
snapshot of semantic state.

### Semantic frame

A validated event that changes the reconstructable run state. Text content,
reasoning content, committed tool input, tool output, usage records, and step
completion are semantic frames.

### Telemetry frame

An observational event for active clients or operational visibility. A status
heartbeat is telemetry. It cannot satisfy semantic progress, extend a semantic
deadline, or turn an empty response into a valid response.

### Diagnostic frame

Restricted evidence about provider behavior, protocol repair, adapter failure,
or a deadline decision. Diagnostic frames are not public run history.

### Canonical run history

The ordered, schema-versioned durable semantic frames plus the Stream Outcome.
It can reconstruct user-visible messages and tool transitions without retaining
the exact timing or fragmentation of provider transport frames.

## Design principles

1. Semantic truth has one owner.
2. Telemetry observes execution but never controls it.
3. Provider quirks stop at the Provider Adapter.
4. Deadlines are absolute, monotonic, and phase-specific.
5. Every execution path settles exactly once.
6. Durable history stores meaning, not transport noise.
7. Compatibility uses Adapters, not parallel lifecycle logic.
8. Stream lifecycle remains independent of delivery reliability. The delivery
   module applies fail-open or fail-closed policy for each Adapter.
9. Public errors are safe. Internal diagnostics remain actionable.
10. Migration proceeds behind existing interfaces with shadow comparison.

## Architecture

```text
True-external provider stream
             |
             v
      Provider Adapter
             |
             v
     Stream Lifecycle module
       - protocol reducer
       - progress classifier
       - deadline scheduler
       - cancellation and cleanup
       - outcome resolver
             |
             v
     Stream Delivery module
        |      |       |
        v      v       v
      Live   Durable  Diagnostics
     Adapter  Adapter   Adapter
             |
             v
        Runs backend
```

The Stream Lifecycle module is a deep Module. Its Interface remains small while
its implementation hides provider normalization, lifecycle state, timing,
repair policy, cancellation races, cleanup, and terminal interpretation.

The Seam sits after a Provider Adapter has decoded a true-external provider
part and before any live or durable output format is chosen.

## External interface

The target Interface has one entry point and one returned run handle:

```ts
export function runStreamLifecycle<TProviderPart>(
  input: StreamLifecycleInput<TProviderPart>,
): StreamLifecycleRun;

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

export interface StreamCancellationInput {
  source: "user" | "parent" | "runtime" | "client_disconnected";
  signal: AbortSignal;
}

export interface StreamDiagnosticPolicy {
  rawCapture: "disabled" | "redacted";
  redact(
    candidate: StreamRawDiagnosticCandidate,
  ): StreamSafeDiagnosticEvent | null;
}

export interface StreamDiagnosticSink {
  report(event: StreamDiagnosticEvent): void;
}

export interface StreamProviderAdapter<TProviderPart> {
  open(signal: AbortSignal): AsyncIterable<TProviderPart>;
  decode(
    part: TProviderPart,
    snapshot: Readonly<StreamSnapshot>,
  ): readonly StreamSignal[];
  classifyError(
    error: unknown,
    snapshot: Readonly<StreamSnapshot>,
  ): StreamProviderError;
}
```

The frame iterator is single-consumer and lazy. The first `next()` starts
provider consumption. Before calling `provider.open()`, the lifecycle installs
source listeners, composes cancellation, and records any pre-aborted source.
Calling `[Symbol.asyncIterator]()` a second time throws
`StreamAlreadyConsumedError`. Awaiting `outcome` does not start consumption and
remains pending until iteration starts and reaches a terminal state.

Iteration owns the one pending provider read and applies natural backpressure.
Calling `return()`, including the implicit call made by `for await` on `break`,
requests provider cleanup and produces a cancelled `consumer_stopped` outcome
unless a terminal outcome was already committed. A consumer that manually
drives `next()` must call `return()` when abandoning iteration.

Production passes the frames to a separate Stream Delivery module that routes
each frame by class. Tests consume frames directly. Stream Lifecycle does not
interpret persistence, live transport, or diagnostic delivery failures as
provider stream endings.

```ts
const run = runStreamLifecycle({
  provider: runtimeStreamProviderAdapter,
  cancellations: [
    { source: "user", signal: userCancellation },
    { source: "parent", signal: parentCancellation },
  ],
});

for await (const frame of run.frames) {
  await streamDelivery.publish(frame);
}

const outcome = await run.outcome;
await streamDelivery.settle(outcome);
```

The common runtime caller no longer needs to understand text closure, tool
input assembly, telemetry significance, deadline selection, late provider body
errors, iterator cleanup, or terminal classification.

## Canonical frames

Every emitted frame has a strictly increasing sequence number within one stream
attempt. Monotonic elapsed time is used for decisions and durations. Wall-clock
time may be attached for correlation, but it never drives a deadline.

```ts
export type StreamLifecycleFrame =
  | {
    class: "semantic";
    sequence: number;
    elapsedMs: number;
    event: StreamSemanticEvent;
  }
  | {
    class: "telemetry";
    sequence: number;
    elapsedMs: number;
    event: StreamTelemetryEvent;
  }
  | {
    class: "diagnostic";
    sequence: number;
    elapsedMs: number;
    event: StreamDiagnosticEvent;
  };
```

`StreamSignal` is the provider-neutral input to the lifecycle reducer:

```ts
export type StreamSignal =
  | { kind: "protocol"; event: StreamProtocolEvent }
  | { kind: "usage"; usage: StreamUsage }
  | { kind: "provider_error"; error: StreamProviderError }
  | {
    kind: "diagnostic_candidate";
    candidate: StreamRawDiagnosticCandidate;
  };
```

`StreamProtocolEvent` covers provider-neutral message, text, reasoning, tool,
step, finish, and registered custom events. A Provider Adapter cannot emit a
`StreamLifecycleFrame`, cannot classify a signal as semantic progress, and
cannot synthesize lifecycle status telemetry. The lifecycle reducer owns those
decisions. An unknown provider-specific event becomes a diagnostic candidate,
not an implicitly semantic custom event.

Semantic events cover these concepts:

- Message and step start.
- Text start, content, and end.
- Reasoning start, content, and end.
- Tool input start, content, ready, and rejected.
- Provider-executed tool start, success, error, denial, and cancellation.
- Usage for one provider step.
- Step finish.

Telemetry events cover these concepts:

- Tool input is streaming.
- Tool input is pending.
- A live connection heartbeat.
- Bounded progress from a durable child run.

Diagnostic events cover these concepts:

- Provider part rejected by the Adapter.
- Known compatibility repair applied.
- Deadline armed, advanced, or fired.
- Provider iterator cleanup failed.
- A safe, redacted provider diagnostic accepted by diagnostic policy.

Raw prompts, tool arguments, tool results, cookies, credentials, and provider
payloads are not diagnostic metadata by default. Raw candidates never become
frames directly. The default policy uses `rawCapture: "disabled"` and returns
no raw diagnostic event. A redacted policy must run before frame publication.

## Lifecycle state

The module owns one global stream phase and per-tool state.

```text
awaiting_first_progress
  -> streaming
       <-> awaiting_tool_input
       -> tool_handoff
       -> completed
       -> failed
       -> cancelled
```

Terminal phases are absorbing. No semantic frame is accepted after completion,
failure, or cancellation.

Each local tool call follows this state machine inside one provider stream
attempt:

```text
input_open
  -> input_streaming
       -> input_ready
            -> tool_handoff
       -> input_rejected
  -> input_rejected
```

`input_rejected` means the proposed local input never became a valid tool call,
for example malformed input, failed input validation, or an unavailable tool
before handoff. It is terminal for that tool input and cannot proceed to local
execution. `denied` means a valid tool call was blocked by authorization, human
approval, or provider policy. Local denial occurs after handoff in the tool
execution module. Only a provider-executed denial can appear inside the same
provider stream attempt.

Local tool execution happens after `StreamOutcome.status === "tool_handoff"` in
the runtime tool-execution module. Its success, error, denial, or cancellation
is not part of the completed provider stream attempt. A later provider stream
attempt receives those tool outcomes as input context.

A provider-executed tool may complete inside the true-external provider source.
Only that case uses this state machine:

```text
input_ready
  -> running
       -> succeeded
       -> failed
       -> denied
       -> cancelled
```

The Provider Adapter must mark the tool as provider-executed before emitting
`running` or a terminal tool execution event.

The module supports parallel tool calls by storing independent state keyed by
tool call identifier. A tool result must identify an existing tool call. The
Provider Adapter may synthesize documented provider omissions before canonical
validation. The core reducer does not silently invent state.

## Text and reasoning invariants

- At most one text segment and one reasoning segment are active for a message.
- Text and reasoning are not active at the same time.
- A transition to tool input closes open text and reasoning first.
- Content requires an open segment.
- The Provider Adapter or lifecycle reducer may apply a documented missing-start
  compatibility repair, but the lifecycle must emit a diagnostic repair frame.
- Content after an end creates a new internal content identifier. It cannot
  resume the closed identifier.
- End events are idempotent only when they repeat without new content. Any other
  duplicate is a protocol violation.
- The Durable Adapter and AG-UI Adapter receive balanced canonical frames. They
  do not maintain competing repair state.

These invariants prevent the observed post-tool duplicate summary from entering
new durable history.

## Semantic progress

Semantic progress is explicit. The following actions advance a semantic idle
deadline:

- Non-empty text content.
- Non-empty reasoning content when reasoning is enabled for the stream.
- Tool input content that changes the accumulated input.
- Tool input becoming ready.
- A provider-executed tool output becoming terminal inside the same provider
  stream attempt.
- A step finish event.

The following actions do not advance a semantic idle deadline:

- `pending_input` or `streaming_input` status.
- Empty deltas.
- Trace attributes.
- Message metadata.
- A live connection heartbeat.
- Repeated provider metadata.

The distinction is encoded in the canonical event type. Callers cannot override
it.

## Deadline engine

All lifecycle deadlines are absolute values derived from one injected monotonic
clock. The implementation keeps one pending provider read, one phase scheduler
timer for the nearest active provider deadline or status due time, and one
independent absolute stream-attempt timer. The attempt timer can terminate the
attempt even while the consumer holds a yielded frame.

```ts
export interface MonotonicClock {
  nowMs(): number;
  waitUntil(
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<"deadline" | "aborted">;
}
```

The default policy preserves current behavioral budgets initially:

- First semantic progress: 60 seconds.
- Semantic output idle: 15 seconds.
- Local tool input idle: 15 seconds.
- Local tool commit grace: 250 milliseconds.
- Tool input status interval: 5 seconds.

The exact defaults remain centralized and configurable through policy. A status
interval is a scheduler wake-up, not a failure deadline, and cannot change one.

### Provider wait accounting

First-progress, semantic-idle, tool-input-idle, and commit-grace deadlines
measure provider wait time. They accrue only while the lifecycle is actively
waiting for the pending provider read and the consumer is not holding a yielded
frame.

When a provider read settles, the lifecycle pauses provider-wait accounting and
stores the remaining duration for every active provider deadline before
reducing the part or yielding any derived frames. The clocks stay paused until
all frames derived from that part have been consumed and the lifecycle is ready
to await the next provider read. It then resumes each deadline as a new absolute
monotonic value using the stored remaining duration. It does not grant a new
full timeout budget.

When a status wake-up wins while a provider read remains pending, the lifecycle
also pauses provider-wait accounting before yielding telemetry. That same read
may stay in flight while the consumer holds the telemetry frame. If it resolves
during that interval, the lifecycle caches the result without reducing it. If
the consumer resumes before the absolute attempt limit, the lifecycle consumes
the cached result. Otherwise, the attempt limit wins, the cached result is
discarded, and iterator cleanup is requested. This is intentional: the absolute
limit bounds total wall-clock ownership of an attempt, not provider availability.
It is classified as a runtime attempt timeout, never provider semantic idle.
The lifecycle does not create a second provider read. A semantic frame does not
trigger prefetch: the next provider read starts only after every frame derived
from the current part has been consumed.

The absolute stream-attempt limit and external cancellation do not pause during
consumer backpressure. The attempt timer remains armed, may abort the provider,
and settles the Stream Outcome independently of whether the consumer has
requested another frame. The frame iterator returns done when the consumer next
resumes. Delivery latency is measured by Stream Delivery and is never reported
as provider semantic idle time.

The engine also supports an absolute stream-attempt limit. No tool name or
prefix disables all time limits. A long-running tool must use an explicit
execution policy and, when appropriate, a durable child run that reports
bounded semantic progress.

When a provider part and a provider-wait deadline become ready together, the
implementation first consumes a provider read that has already resolved. It
then evaluates the monotonic clock. Otherwise, the provider-wait deadline wins
when `nowMs() >= deadlineMs`. The absolute attempt timer is different: the
lifecycle checks `nowMs() >= attemptDeadlineMs` before reducing any provider
part that is not already reduced, so the attempt deadline wins ties. Once it
fires, it settles the outcome even if the consumer still holds a non-terminal
frame. This rule makes race tests deterministic.

## Status telemetry

Tool input status is synthesized from the lifecycle snapshot, not inserted into
the true-external provider iterator. Stream Lifecycle owns status cadence.

While a provider read is pending, the phase scheduler races that one read
promise against the nearest provider deadline and status due time. The separate
attempt-limit signal can abort that race at any time. When status becomes due
first, the lifecycle emits a telemetry frame and retains the same provider read
promise. It schedules the next status time only after iteration resumes. Status
emission cannot reset or advance a provider deadline.

The Live Adapter maps lifecycle telemetry to `data-tool-call-status` for
compatibility. It does not own a second cadence timer. These events remain
available to active clients but cannot satisfy provider reads or affect
lifecycle deadlines.

The Durable Adapter records a status transition at most once per state. It may
include final duration and heartbeat count when the state closes. It does not
persist each repeated heartbeat.

## Stream Outcome

Every execution resolves exactly one Stream Outcome. Stream Outcome continues
to mean how the provider stream attempt ended. Delivery and control-plane
failures remain separate run-finalization concerns.

```ts
export interface StreamOutcomeBase {
  snapshot: StreamSnapshot;
  usage: StreamUsage;
  elapsedMs: number;
  phase: StreamLifecyclePhase;
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

export type StreamOutcome =
  | (StreamOutcomeBase & {
    status: "completed";
    finishReason: "stop" | "length" | "content-filter" | "other";
  })
  | (StreamOutcomeBase & {
    status: "tool_handoff";
    finishReason: "tool-calls";
    toolCalls: readonly StreamCommittedToolCall[];
  })
  | (StreamOutcomeBase & {
    status: "cancelled";
    source: StreamCancellationSource;
    publicMessage: string;
    diagnosticId?: string;
  })
  | (StreamOutcomeBase & {
    status: "failed";
    error: StreamLifecycleError;
  });

export interface StreamLifecycleError {
  code: StreamLifecycleErrorCode;
  phase: StreamLifecyclePhase;
  source: "provider" | "runtime" | "tool";
  retryable: boolean;
  publicMessage: string;
  providerCode?: string;
  diagnosticId?: string;
}
```

Initial error codes include:

- `FIRST_PROGRESS_TIMEOUT`
- `SEMANTIC_IDLE_TIMEOUT`
- `TOOL_INPUT_TIMEOUT`
- `TOOL_INPUT_INCOMPLETE`
- `STREAM_ATTEMPT_TIMEOUT`
- `PROTOCOL_VIOLATION`
- `PROVIDER_STREAM_ERROR`
- `PROVIDER_TERMINAL_ERROR`

`STREAM_ATTEMPT_TIMEOUT` is a failed runtime outcome, not an external
cancellation. Its independent timer settles the outcome and aborts the provider
even when downstream delivery currently holds a frame.

Cancellation uses `StreamCancellationSource`, not failure error codes. Sources
include `user`, `parent`, `runtime`, `consumer_stopped`, and
`client_disconnected`. When more than one source is already aborted before a
read, precedence is `user`, `parent`, `runtime`, then `client_disconnected`.
The first source observed after streaming begins wins and cannot be replaced.
The compatibility caller decides whether a client disconnect becomes an input
or only detaches a live projection.

`phase` is present on `StreamOutcomeBase`, so completed, tool-handoff,
cancelled, and failed outcomes all identify the lifecycle phase at termination.
`StreamSnapshot.phase` contains the same value for projection and diagnostic
consumers.

Public messages remain concise and sanitized. Detailed provider errors and raw
abort reasons stay in restricted diagnostics. The existing late body-read
compatibility and provider error classification in
`src/agent/streaming/stream-outcome.ts` move behind this Interface rather than
being duplicated.

## Cancellation and cleanup

- The lifecycle accepts source-tagged cancellation inputs.
- The lifecycle composes their signals internally after installing source
  listeners.
- Cancellation source is recorded before abort propagation.
- The provider request receives the internally composed signal.
- `iterator.return()` is requested at most once.
- Cleanup failure reports a sanitized `provider_cleanup_failed` diagnostic but
  cannot replace an already committed terminal outcome. When frame iteration is
  still open it may be sequenced as a diagnostic frame; after frame delivery is
  closed it goes only to the restricted lifecycle diagnostic sink.
- Explicit user cancellation remains distinct from client transport loss.
- A durable detached run may continue after its live client disconnects.
- A foreground compatibility Adapter may map client disconnect to cancellation
  until detached execution is enabled for that caller.

## Stream Delivery and Projection Adapters

Stream Delivery is a separate module that consumes the single canonical frame
iterator, fans frames out to Adapters, and settles the durable run after Stream
Outcome resolves. This separation preserves the existing Stream Outcome domain
meaning and prevents persistence failures from being misclassified as provider
failures.

### Live Adapter

The Live Adapter maps canonical frames to the existing Data Stream Protocol and
AG-UI shapes. It preserves token-level responsiveness and current custom status
events.

A live client failure detaches that client. It does not corrupt lifecycle state.
Whether transport loss cancels a foreground run is a caller policy, not a
provider stream interpretation.

### Durable Adapter

The Durable Adapter maps semantic frames to existing conversation run event
names where possible. It coalesces adjacent content within lifecycle boundaries
and flushes on segment end, tool transition, step finish, terminal outcome,
byte threshold, or bounded time threshold.

Canonical durable events have:

- A stream protocol version.
- A per-attempt logical sequence.
- A stable idempotency key.
- An expected previous durable cursor.
- A sanitized payload.

The Runs backend remains the remote-owned dependency. The production Adapter
uses expected-cursor append. An in-memory cursor-enforcing Adapter provides the
test implementation.

A persistent outbox and full cross-process resume belong to the follow-up
durable delivery design. Until then, the compatibility Adapter uses the current
mirror and queue implementation behind Stream Delivery.

### Diagnostic Adapter

The Diagnostic Adapter is optional and fails open. Enterprise policy controls
whether restricted raw evidence is recorded.

Recommended defaults:

- Disabled raw payload capture.
- Redaction before write.
- Encryption in transit and at rest.
- Tenant and role scoped access.
- Region-aware storage.
- Retention of 24 to 72 hours.
- Audit records for diagnostic access.
- Legal hold applies only when explicitly configured.

### Usage Adapter

The initial Adapter preserves current aggregate usage output. A follow-up Usage
Ledger design will record one entry per provider step and distinguish logical
runs, provider calls, token categories, cache use, and cost.

## Durable retention contract

The enterprise retention recommendation has three classes:

1. Canonical run history is long-lived according to tenant retention, residency,
   deletion, and legal-hold policy.
2. Live telemetry is ephemeral and exists for connected clients.
3. Raw diagnostics are optional, restricted, and short-lived.

Historical replay guarantees semantic reconstruction. It does not guarantee the
original token chunk boundaries or arrival timestamps.

## Downstream delivery constraints

This section is informative for the follow-up Stream Delivery design. Phases 1
through 4 use the current mirror, queue, and live writers behind compatibility
Adapters. The Stream Lifecycle implementation plan does not add an outbox,
cross-process resume, or new delivery failure policy.

The follow-up Stream Delivery module must apply bounded backpressure.

- Semantic frames are required. The production Durable Adapter waits for
  bounded durable acceptance or a recoverable outbox write.
- Live delivery is best effort after a bounded buffer. A slow client is detached
  rather than blocking the provider indefinitely.
- Diagnostics are best effort and sampled under load.
- Buffers have explicit byte and frame limits.
- A required Durable Adapter failure may ask the caller to abort further
  provider consumption and produces a separate run-finalization error. It does
  not rewrite an already committed Stream Outcome.
- Retrying durable writes uses idempotency keys and expected cursors.
- Retry attempts do not create duplicate canonical events.

If `streamDelivery.publish(frame)` throws, `for await` closes the lifecycle
iterator. A cancelled `consumer_stopped` Stream Outcome is the expected record
of how provider consumption ended. Stream Delivery keeps its delivery failure
as the primary run-finalization error and may attach the Stream Outcome as
secondary cleanup evidence. It must not replace the delivery error with
`consumer_stopped`, and it must not rewrite an outcome that was already
committed before delivery failed.

### Agent-loop and hosted delivery boundary

Stream Lifecycle owns one provider attempt, not the whole agent loop. One agent
run can contain several provider attempts separated by local tool execution.
Local tool results, child-run progress, and finalization fallback events are
runtime events outside the provider-attempt lifecycle and still belong in
canonical run history.

The current hosted path receives serialized Data Stream output through
`HostedChatRuntimeStreamResult.toUIMessageStream()`. It does not expose
`StreamLifecycleFrame` or Stream Outcome, and its durable mirror consumes
`ChatUiMessageChunk`. Therefore changing `processStream()` alone cannot make
the hosted Durable Adapter or AG-UI Adapter direct consumers of lifecycle
frames. A projection Adapter with no production frame transport is testable,
but it is not a production cutover.

The production cutover requires the Phase 5 Stream Delivery design to define:

- A source-tagged envelope for lifecycle frames, local tool execution,
  finalization fallback, and external child progress.
- Stable run, attempt, and per-source sequence identity across multiple
  provider attempts.
- One fan-out path that prevents a lifecycle-owned event from also being
  persisted from its compatibility UI chunk.
- Bounded frame and byte backpressure with an explicit required versus
  best-effort delivery policy.
- Backend deduplication by idempotency key for ambiguous append outcomes.
- Terminal ordering that flushes required durable events before run
  finalization without rewriting Stream Outcome.

Until that contract is implemented end to end, production runs remain on
stream protocol version 1. Phase 4 may add and verify version 2 projection
Adapters, client/server metadata capability, and legacy reads, but it must not
write `metadata.stream_protocol_version: 2` from the hosted production path.

## Compatibility

Existing public exports and event shapes remain available during migration.

- `processStream()` becomes a compatibility Adapter over Stream Lifecycle.
- During migration, `processStream()` may use a pre-opened Provider Adapter that
  returns the existing `result.fullStream`. The target runtime passes a provider
  factory so cancellation is composed before the provider request starts.
- `createChatStreamWatchdog()` remains exported while its phase decisions move
  to the deadline engine.
- `withToolInputStatusTransitions()` remains exported until all internal callers
  use telemetry projection. Its compatibility implementation must not wrap the
  provider source consumed by Stream Lifecycle.
- `ConversationRunEventEncoder` remains exported while it maps validated frames
  instead of repairing lifecycle independently.
- The AG-UI browser encoder remains exported while its lifecycle state shrinks
  to formatting state.
- Existing run event names remain unchanged unless a separately versioned public
  contract is approved.

After the Phase 5 delivery cutover, new runs record
`metadata.stream_protocol_version: 2`. Runs without that field use a legacy
read Adapter that tolerates and repairs known historical framing defects. The
rollout does not rewrite old events, and Phase 4 capability work alone does not
enable version 2 production writes.

## Migration strategy

### Phase 1: Interface and shadow reducer

- Add the Stream Lifecycle types, reducer, fake clock, and scripted Provider
  Adapter.
- Add a shadow tap in `processStream()` after `const part = next.value` and the
  abort check, but before the `data-*` branch and main part switch, currently
  `src/agent/runtime/chat-stream-handler.ts:613-622`.
- Feed each already-read part from that tap to the existing logic and the shadow
  Provider Adapter plus reducer. Never call `iterator.next()` from the shadow
  path and never issue a second provider request.
- Compare semantic snapshots and Stream Outcomes.
- Record low-cardinality divergence metrics without content.

Exit condition: the fixture corpus exercised by
`src/agent/runtime/chat-stream-handler.test.ts`,
`src/provider/runtime-loader.test.ts`, `src/chat/stream-watchdog.test.ts`,
`src/agent/ag-ui/browser-encoder.test.ts`, and
`src/agent/conversation/run-events.test.ts` produces zero unclassified semantic
divergences.

### Phase 2: Runtime ownership

- Make `processStream()` call Stream Lifecycle.
- Preserve current SSE through a Live Adapter.
- Populate the legacy `ChatStreamState` from the final snapshot.
- Move tool status synthesis to telemetry projection.

Exit condition: the heartbeat-only regression times out at the configured
semantic deadline, the listed runtime fixture corpus passes, and golden SSE
fixtures have no unapproved shape changes.

### Phase 3: Deadline consolidation

- Back `createChatStreamWatchdog()` with lifecycle phase and deadline state.
- Remove independent deadline re-derivation from UI chunks.
- Preserve compatibility exports and configurable timeout values.

Exit condition: one deadline engine determines first progress, semantic idle,
tool input idle, and local handoff timing.

### Phase 4: Projection consolidation

- Add durable and AG-UI Adapters that consume validated frames directly.
- Add the legacy read Adapter for old runs.
- Prove the versioned projection contracts and balanced fixtures without
  routing hosted production writes through an unversioned UI-chunk transport.
- Keep production writes on version 1 until Phase 5 provides the agent-loop
  delivery envelope and backend deduplication contract.

Exit condition: all version 2 projection fixtures are balanced, a checked-in
legacy fixture containing content after text end renders one complete message
without rewriting the source events, and no production caller can select
version 2 before the Phase 5 capability gate.

### Phase 5: Durable delivery follow-up

- Transport lifecycle frames, Stream Outcomes, local tool execution, fallback
  projection, and external progress through one source-tagged agent-loop
  delivery envelope.
- Cut hosted durable and AG-UI production projections over to that envelope
  without double-writing compatibility UI chunks.
- Add the persistent outbox, resumable cursor, and cross-process recovery.
- Enforce backend idempotency keys for ambiguous append results.
- Introduce retention policy enforcement and compacted historical projection.
- Measure event count, append latency, replay latency, and storage reduction.

This phase requires its own approved design and implementation plan.

## Observability

Required metrics use bounded-cardinality labels:

- Stream Outcome status and error code.
- Lifecycle phase at termination.
- Provider and model family.
- Time to first semantic progress.
- Semantic idle duration.
- Tool input assembly duration.
- Tool execution duration when visible to the lifecycle.
- Telemetry heartbeat count.
- Protocol repair count by repair code.
- Shadow divergence count by category.

The follow-up Stream Delivery design adds durable retry, outbox, queue depth,
and append latency metrics.

Run identifiers, conversation identifiers, tool call identifiers, prompts, tool
arguments, and provider error bodies do not appear in metric labels. Trace and
restricted log records may carry sanitized correlation identifiers.

Every failed outcome exposes a diagnostic identifier when restricted evidence
exists. This replaces opaque `terminated` errors without exposing provider or
infrastructure detail to users.

## Security and privacy

- Redact before any diagnostic or log write.
- Never place raw credentials, cookies, provider keys, or authorization headers
  in frames.
- Treat tool arguments and results as potentially sensitive.
- Keep public Stream Outcome messages separate from internal diagnostic detail.
- Apply tenant retention and deletion policy to canonical history.
- Make raw diagnostics opt-in and role restricted.
- Record diagnostic access.
- Keep cancellation and provider errors from exposing stack traces in user
  output.

## Testing strategy

The Stream Lifecycle Interface is the primary test surface. Tests use a scripted
Provider Adapter, a direct frame collector, a fake monotonic clock, and
AbortController.

### Lifecycle tests

- Provider Adapters return only defined `StreamSignal` variants and cannot
  inject pre-classified lifecycle frames.
- Unknown provider-specific events become diagnostic candidates or protocol
  violations according to policy. They do not become semantic progress.
- Text, reasoning, and tool transitions are balanced.
- Content after end receives a new content identifier.
- Parallel tool calls remain independent.
- Tool output cannot precede ready input in canonical state.
- Malformed, invalid, and unavailable local inputs transition to
  `input_rejected` and never reach `tool_handoff`.
- Local authorization denial remains outside this provider stream attempt.
- Local tool execution events cannot occur after local `tool_handoff` in the
  same provider stream attempt.
- Provider-executed tool events require the provider-executed marker.
- A terminal state accepts no later semantic frame.
- Exactly one Stream Outcome settles every path.

### Consumption tests

- The first `next()` starts provider consumption.
- The internally composed cancellation signal is passed to `provider.open()`.
- Awaiting `outcome` before iteration does not start the provider.
- A second frame iterator fails with `StreamAlreadyConsumedError`.
- `return()` during a pending provider read requests cleanup once and resolves a
  cancelled `consumer_stopped` outcome.
- Breaking a `for await` loop follows the same cleanup path.

### Deadline tests

- Five-second telemetry heartbeats cannot extend a 15-second tool input
  deadline.
- Empty deltas cannot extend a semantic idle deadline.
- Real tool input content advances the correct deadline.
- Provider-read and deadline races follow the documented ordering rule.
- Holding a yielded frame for 20 seconds does not consume a 15-second provider
  idle budget.
- Provider idle time resumes with the prior remaining duration after consumer
  backpressure ends.
- The absolute stream-attempt limit settles the outcome and aborts the provider
  while the consumer holds a frame; iteration returns done when resumed.
- A provider part that resolves behind a held telemetry frame is reduced when
  the consumer resumes before the absolute limit, but discarded when the
  attempt timer fires first.
- Status cadence uses the phase scheduler and retains one in-flight provider
  read across repeated status frames.
- Long-running execution still has an absolute limit.
- Fake clock tests do not depend on wall time.

### Error and cancellation tests

- Late provider body-read errors preserve established completion behavior.
- Known provider terminal errors retain typed codes.
- Unknown provider failures become sanitized, retryable or non-retryable typed
  outcomes.
- User cancellation, parent cancellation, client disconnect, and timeout remain
  distinct.
- Pre-aborted source ties use the documented source precedence.
- The first cancellation observed after start wins.
- Iterator cleanup is requested once.
- Cleanup failure cannot replace a committed outcome.
- Every cancelled outcome records the termination phase directly and in its
  snapshot.

### Diagnostic policy tests

- Raw capture is disabled by default.
- A raw candidate cannot be published without passing through `redact()`.
- A redactor can reject a candidate by returning `null`.
- Default diagnostic frames contain no prompt, tool argument, tool result,
  credential, authorization header, or provider payload.
- Encryption, access control, retention, and access-audit tests belong to the
  follow-up Diagnostic Adapter design.

### Projection tests

- Current SSE and AG-UI fixtures remain byte-compatible where the public
  contract requires it.
- Telemetry remains visible live but is not counted as assistant output.
- Durable text and reasoning frames are balanced.
- Repeated status heartbeats do not produce repeated durable events.
- Legacy malformed event sequences still render through the read Adapter.

### Integration tests

- A scripted provider reproduces the stalled parallel `create_file` shape and
  terminates at the local tool input deadline.
- A post-tool text continuation produces a new balanced segment and one rendered
  summary.
- A live client can disconnect without corrupting a detached durable run.
- A delivery publish failure remains the primary run-finalization error, with a
  delivery-triggered `consumer_stopped` outcome retained only as secondary
  cleanup evidence.

### Shadow verification

- Compare legacy and new accumulated text.
- Compare reasoning content.
- Compare committed tool identifiers and inputs.
- Compare tool outputs and errors.
- Compare finish reason and aggregate usage.
- Classify every divergence before enabling the new path by default.

## Acceptance criteria

1. Repeated telemetry cannot postpone any semantic deadline in deterministic
   fake-clock tests.
2. Every provider stream attempt produces exactly one typed Stream Outcome.
3. Every failed outcome includes code, phase, source, retryability, and a
   sanitized public message.
4. Newly written text, reasoning, and tool events satisfy lifecycle ordering
   invariants.
5. The observed post-tool continuation regression writes a new text segment and
   renders one summary.
6. The observed incomplete parallel tool-input regression terminates locally at
   the configured tool-input deadline.
7. Existing public SSE, AG-UI, run-event, and exported compatibility interfaces
   remain available during migration.
8. Existing stored runs render through the legacy read Adapter without data
   rewrite.
9. The canonical frame iterator is ordered, single-consumer, and backpressured.
   Delivery Adapter failures cannot be misclassified as provider Stream
   Outcomes.
10. No metric label or public error includes prompt content, tool arguments,
    credentials, stack traces, or unbounded identifiers.
11. Focused runtime, watchdog, Stream Outcome, AG-UI, conversation run, and
    provider loader tests pass.
12. Shadow mode reports no unexplained semantic divergence before default-on
    rollout.
13. Cancellation source is preserved using the documented precedence and cannot
    be replaced after observation.
14. Local post-handoff tool execution is outside the completed provider Stream
    Outcome, while provider-executed tools are explicitly marked.
15. Raw diagnostic capture is disabled by default and redaction runs before any
    raw diagnostic frame is published.
16. Consumer-held delivery time does not consume provider idle budgets, while
    the absolute stream-attempt limit continues to accrue.
17. Stream Lifecycle owns status cadence, emits status through one phase
    scheduler, retains one in-flight provider read across status frames, and
    keeps the absolute attempt limit independent.
18. Provider Adapters emit only defined `StreamSignal` values. The lifecycle
    reducer alone classifies semantic, telemetry, and diagnostic frames.
19. Invalid local tool input reaches `input_rejected`; `denied` remains reserved
    for a valid tool call blocked by policy or authorization.
20. All Stream Outcome variants expose lifecycle phase, and delivery-triggered
    `consumer_stopped` remains secondary to the primary delivery failure.
21. Production version 2 writes remain disabled until the hosted agent-loop
    delivery envelope and backend idempotency contract are deployed together.

## Risks and mitigations

### Compatibility drift

Risk: Existing clients may rely on undocumented event ordering or repeated
status events.

Mitigation: Keep live shapes through compatibility Adapters, add golden fixtures,
run shadow comparison, and version durable semantics.

### Oversized first implementation

Risk: Replacing runtime, watchdog, persistence, and UI projection in one change
would be difficult to review and roll back.

Mitigation: Use the five migration phases. Each phase preserves current exports
and has an independent exit condition.

### Silent provider repair

Risk: Tolerant normalization can hide new provider defects.

Mitigation: Keep the core reducer strict. Provider Adapters may apply only named,
tested repairs and must emit diagnostic repair codes.

### Durable backpressure stalls live output

Risk: Required persistence can delay the live stream.

Mitigation: Use bounded batching and the follow-up persistent outbox. Measure
append latency and detach slow live clients independently.

### Sensitive diagnostic capture

Risk: Raw provider frames can contain prompts, customer data, tool payloads, or
secrets.

Mitigation: Disable raw capture by default, redact before write, restrict access,
and use short retention.

### Ambiguous cancellation source

Risk: A shared AbortSignal can collapse user cancellation, client disconnect,
parent cancellation, timeout, and server shutdown into one error.

Mitigation: Record a typed cancellation source before signal propagation and
keep public and internal messages separate.

## Alternatives considered

### Patch current modules independently

Rejected. It produces a smaller initial diff but preserves duplicate lifecycle
state and allows telemetry, timeout, and framing interpretations to diverge
again.

### Expand only Stream Outcome

Rejected as incomplete. It improves terminal error classification but does not
own provider iteration, semantic progress, deadlines, lifecycle validation, or
projection ordering.

### Persist every raw provider frame before processing

Rejected as the default. It increases latency, provider coupling, storage cost,
and sensitive-data exposure. Restricted raw diagnostics remain available as an
optional Adapter.

### Replace all stream consumers at once

Rejected. The final architecture may be clean, but a big-bang migration has
unnecessary compatibility and rollback risk.

## Adjacent follow-up designs

After Stream Lifecycle is implemented and verified, create separate designs for:

1. Durable delivery, persistent outbox, compaction, historical projection, and
   retention enforcement.
2. Catalog-backed `ModelRef` validation shared by tools, skills, configuration,
   and runtime model resolution.
3. Structured `ToolOutcome`, revision-aware file mutations, and agent
   conformance evals.
4. Step-level Usage Ledger and explicit run-total UI presentation.

These modules must integrate through typed results. They must not add lifecycle
logic back into projections or callers.

## Decision record

Decision: Build a deep Stream Lifecycle module after Provider Adapters and
before a separate Stream Delivery module. Stream Delivery routes canonical
frames to live, durable, diagnostic, and usage Adapters. Store compact semantic
history as the canonical run record. Keep raw transport evidence optional and
short-lived.

Drivers:

- One authoritative interpretation of provider stream behavior.
- Enterprise liveness, auditability, privacy, and compatibility.
- Incremental migration with deterministic verification.

Consequences:

- The first implementation is broader than a timeout patch.
- Existing exports remain as compatibility Adapters during migration.
- Projections become simpler after lifecycle state moves upstream.
- Durable outbox and retention enforcement remain a deliberate follow-up.
- Tests move toward the Stream Lifecycle Interface and away from internal state.

Directive: Do not add provider-specific repair, deadline reset, or lifecycle
state to a projection Adapter. Add it at the Provider Adapter or Stream
Lifecycle Seam with an interface-level regression test.
