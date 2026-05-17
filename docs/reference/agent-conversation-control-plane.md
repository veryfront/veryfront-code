---
title: "Conversation-backed agent hosts"
description: "Compose veryfront/agent with a control-plane conversations API while keeping host policy local."
order: 11
---

# Conversation-backed agent hosts

Use this composition when your host owns auth, project access, and
control-plane policy but wants the runtime sequencing to come from
`veryfront/agent`.

## Package-owned building blocks

The reusable pieces are public:

- `runHostedLifecycle()` / `runHostedChildLifecycle()` for lifecycle sequencing
- `createConversationAgentRun()`, `appendConversationRunEvents()`,
  `getConversationRun()`, `isAppendableConversationRunProjection()`,
  `monitorConversationRunStatus()`, and `finalizeConversationAgentRun()` for
  canonical conversation-run transport
- `bootstrapConversationAgentRun()` for child conversation + handoff + run
  creation in one flow
- `resolveConversationRunTargets()` for project / preview-branch target metadata
- `publishInvokeAgentChildRunProgress()` plus the paired builder helpers for
  canonical child-run lifecycle events

These helpers let hosts share the same conversations/control-plane contract
without reaching into app-private internals.

## Lifecycle adapters

Use `createConversationHostedLifecycleAdapter()` when your host starts the
conversation-owned run, encodes runtime chunks into control-plane events, and
decides the final model, provider, and usage payload.

The adapter owns:

- appending events through the canonical conversation-run events route
- mutating the live run cursor after successful appends
- finalizing or cancelling the canonical conversation run

Use `createConversationChildLifecycleAdapter()` when your host wants the
framework to own the default child lifecycle progression:

- pending
- running
- completed
- failed
- cancelled

The child adapter composes `publishInvokeAgentChildRunProgress()` and
`finalizeConversationAgentRun()`. It can publish lifecycle events through a
shared parent-run publisher or through the canonical conversation-run events
route.

## Run context helpers

Use `createConversationRunContext()` when your host wants one canonical object
for:

- the current conversation-backed run projection
- the effective parent run id
- the effective parent message id
- an optional shared parent-run publisher

Use `prepareConversationRootRunContext()` when your host wants one call that:

- starts or normalizes the root run
- derives effective parent lineage
- preserves an optional shared parent-run publisher

These helpers keep durable run lineage and effective parent lineage aligned
without moving auth policy, transcript persistence, retry policy, or
host-specific tracing into the package.

## Recommended root-run composition

For a conversation-backed root run, keep one host-owned run context with the
canonical projection fields returned by `createConversationAgentRun()`. If the
host also wants the framework to package root-run startup, effective parent
lineage, and optional mirror attachment in one step, use
`prepareConversationRootRunLifecycle()` with a host-supplied `createMirror()`
callback and keep only user-message persistence policy outside the framework.

```ts
type HostConversationRun = {
  conversationId: string;
  runId: string;
  messageId: string;
  latestEventId: number;
  latestExternalEventSequence: number;
};
```

Then compose the public helpers like this:

```ts
import {
  appendConversationRunEvents,
  createConversationAgentRun,
  finalizeConversationAgentRun,
  runHostedLifecycle,
} from "veryfront/agent";

const run = await createConversationAgentRun({
  authToken,
  apiUrl,
  conversationId,
  agentId,
  projectId,
  branchId,
});

await runHostedLifecycle({
  abortSignal,
  execution,
  adapter: {
    startRun: () => run,
    appendEvents: async (currentRun, chunk) => {
      const events = encodeHostChunk(chunk);
      if (events.length === 0) return;

      const appended = await appendConversationRunEvents({
        authToken,
        apiUrl,
        conversationId: currentRun.conversationId,
        runId: currentRun.runId,
        expectedPreviousEventId: currentRun.latestEventId,
        expectedPreviousExternalEventSequence: currentRun.latestExternalEventSequence,
        events,
      });

      currentRun.latestEventId = appended.latestEventId;
      currentRun.latestExternalEventSequence = appended.latestExternalEventSequence;
    },
    finalizeRun: async (currentRun, terminalState) => {
      const model = terminalState.metadata?.modelId ?? fallbackModel;
      await finalizeConversationAgentRun({
        authToken,
        apiUrl,
        conversationId: currentRun.conversationId,
        runId: currentRun.runId,
        status: terminalState.status,
        model,
        provider: resolveProvider(model),
        usage: terminalState.metadata?.usage
          ? {
            inputTokens: terminalState.metadata.usage.inputTokens ?? 0,
            outputTokens: terminalState.metadata.usage.outputTokens ?? 0,
            totalTokens: (terminalState.metadata.usage.inputTokens ?? 0) +
              (terminalState.metadata.usage.outputTokens ?? 0),
          }
          : undefined,
        terminalErrorCode: terminalState.terminalErrorCode,
        terminalErrorMessage: terminalState.terminalErrorMessage,
      });
    },
    cancelRun: (currentRun, terminalState) =>
      finalizeConversationAgentRun({
        authToken,
        apiUrl,
        conversationId: currentRun.conversationId,
        runId: currentRun.runId,
        status: "cancelled",
        model: terminalState.metadata?.modelId ?? fallbackModel,
        provider: resolveProvider(terminalState.metadata?.modelId ?? fallbackModel),
        terminalErrorCode: terminalState.terminalErrorCode,
        terminalErrorMessage: terminalState.terminalErrorMessage,
      }),
  },
  resolveTerminalState,
});
```

Keep these pieces host-local:

- auth / project access enforcement
- conversation linking rules
- chunk-to-event encoding
- append retry / cursor recovery policy
- transcript persistence policy
- host logging / tracing

When a host keeps local append retry or cursor recovery logic, use
`isAppendableConversationRunProjection()` after a fresh `getConversationRun()`
read to decide whether it keeps retrying appends or stops because the run
is already waiting for a tool result or has reached a terminal state.

If the host specifically needs to recover from an append cursor mismatch, use
`resyncConversationRunAppendCursor()` to do the canonical projection read and
classification in one step. It reports whether the external cursor advanced,
stayed unchanged but still appendable, or reached a non-appendable state.

If the host also wants a reusable retry-limit gate around cursor mismatches,
`recoverConversationRunCursorMismatch()` packages that decision and returns
whether the host resumes, stops, or bubbles the failure while still using
the canonical conversation-run state model.

For the broader append-failure branch, `recoverConversationRunAppendFailure()`
adds the canonical ignorable-append rejection handling as well, so hosts can
share one resume/stop/retry classification while keeping only scheduling and
logging policy local.

If the host also keeps its own pending-event queue, use
`recoverConversationRunAppendExecution()` to merge the queue-management outcome
with the canonical append-failure classification instead of rebuilding that
state transition locally.

If the host wants the framework to own the batch loop too, use
`flushConversationRunEventBatches()` to send one queued event list through the
canonical batching and append-execution recovery path while keeping timer
creation and logging policy local.

If the host wants the framework to keep retrying the same queue until it either
fully flushes, stops, or produces a canonical retry payload, use
`flushConversationRunEventQueue()` instead of rebuilding that inner flush loop
locally.

If the host also wants the framework to own the mutable pending-event queue
state, use `createConversationRunEventQueueController()` and keep only timer
creation plus host logging policy outside the framework.

If the host also wants the framework to own the timer-driven flush orchestration
around that queue, use `createConversationRunMirror()` and keep only event
shaping plus host-specific retry/log callbacks outside the framework.

If the host still owns event shaping, use `normalizeConversationRunEvent()` or
`normalizeConversationRunEvents()` before enqueueing/appending so payload-limit
splitting and summarization stay consistent across hosts.

If the host wants to reuse the canonical event contract itself, use
`ConversationRunEventEncoder` (or the `encodeConversationRunEvents()` /
`normalizeEncodedConversationRunEvents()` helpers) to turn public
`ChatStreamEvent` values into conversation-run events before they hit the queue.

If the host prefers one entry point per source, use
`prepareConversationRunStreamEvents()` for public chat stream events and
`prepareConversationRunExternalEvents()` for already-encoded conversation-run
events.

If the host wants the framework to own both event preparation and mirror
orchestration, use `createConversationRunStreamMirror()` and keep only
host-specific logging callbacks outside the framework.

If the host is already running `runHostedLifecycle()` over public chat stream
events, use `createConversationHostedStreamLifecycleAdapter()` so the append
path can reuse the same conversation-run event encoding and normalization
without a separate host-local mapper.

If the host still keeps terminal tracing or product metrics local, use
`createConversationHostedTerminalAdapter()` to normalize terminal metadata and
dispatch the durable finalize/cancel call while leaving host-owned terminal
observers outside the framework.

If the host also wants the framework to own the generic finish-time sequence
around fallback chunk append, mirror flush, terminal dispatch, and cleanup, use
`finalizeHostedResponse()` / `finalizeHostedDetached()` and keep only the
message-part fallback semantics plus empty-response interpretation local.

For long-running delegated or background work, use
`monitorConversationRunStatus()` to detect when a conversation-owned run became
terminal before local execution finished.

## Recommended child-run composition

For child or delegated runs, use the higher-level bootstrap and progress
helpers instead of rebuilding the transport contract:

1. `bootstrapConversationAgentRun()` creates the child conversation, writes the
   handoff message, and creates the child run.
2. `resolveConversationRunTargets()` computes the canonical project /
   preview-branch targeting metadata.
3. `publishInvokeAgentChildRunProgress()` emits the canonical
   `invokeAgentChildRuns` lifecycle events through either:
   - a shared parent-run publisher, or
   - the canonical conversation-run events route.
4. `finalizeConversationAgentRun()` closes the child run at terminal states.
5. `monitorConversationRunStatus()` lets the host stop local execution if the
   child run completes, fails, or is cancelled externally first.

This keeps business semantics such as prompt construction, child selection, and
project policy in the host while keeping the control-plane contract shared.

## Child-run tool lifecycle contract

Child and delegated runs must preserve tool lifecycle state from the provider
stream through durable events and host UI replay. On the happy path, downstream
layers must not infer missing tool state.

The canonical lifecycle is:

1. Emit tool input start with a stable tool call id and tool name.
2. Emit tool input deltas while preserving the same tool call id.
3. Emit either completed structured input or a structured `tool-input-error`.
4. Emit either tool output success or tool output error.
5. Close any pending tool lifecycle before the child run reaches a terminal
   state.

Schema preservation is part of the same contract. MCP `inputSchemaJson` must
survive remote discovery, adaptation, host wrappers, and child tool
materialization. Wrappers can enrich behavior, but they must not silently
replace a specific schema with permissive `{}` input.

When streamed input is malformed, surface the first failure as
`tool-input-error`. Later artifact checks can still fail, but they must not
mask the original malformed input failure.

When changing this contract, run or add tests for:

- `src/agent/hosted/child-fork-stream-execution.test.ts`
- `src/agent/hosted/child-pending-tool-lifecycle.test.ts`
- `src/agent/hosted/child-tool-input.test.ts`
- `src/agent/hosted/child-fork-tool-sources.test.ts`
- `src/agent/conversation/run-event-normalization.test.ts`
