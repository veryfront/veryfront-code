---
title: "Conversation-backed agent hosts"
description: "Compose veryfront/agent with a control-plane conversations API while keeping host policy local."
order: 1
---

# Conversation-backed agent hosts

Use this composition when your host owns auth, project access, and
control-plane policy but wants the runtime sequencing to come from
`veryfront/agent`.

## Package-owned building blocks

Today the reusable pieces are already public:

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

## Recommended root-run composition

For a conversation-backed root run, keep one host-owned run context with the
canonical projection fields returned by `createConversationAgentRun()`:

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
read to decide whether it should keep retrying appends or stop because the run
is already waiting for a tool result or has reached a terminal state.

If the host specifically needs to recover from an append cursor mismatch, use
`resyncConversationRunAppendCursor()` to do the canonical projection read and
classification in one step. It reports whether the external cursor advanced,
stayed unchanged but still appendable, or reached a non-appendable state.

If the host also wants a reusable retry-limit gate around cursor mismatches,
`recoverConversationRunCursorMismatch()` packages that decision and returns
whether the host should resume, stop, or bubble the failure while still using
the canonical conversation-run state model.

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

## Current framework boundary

The remaining gap is **not** the conversations API contract itself. The missing
piece is a higher-level reusable adapter that packages the composition above for
hosts that all want the same conversation-backed lifecycle shell.

The next public seam should own only the generic parts:

- carrying `ConversationRunProjection` through hosted lifecycle execution
- updating `latestEventId` / `latestExternalEventSequence` after successful
  appends
- normalizing terminal metadata into `finalizeConversationAgentRun()` payloads
- composing child-run lifecycle sequencing with canonical progress publishing

It should still leave these concerns to the host:

- auth and access policy
- project-linking rules
- transcript storage semantics
- retry / backoff / cursor-recovery policy
- product-specific child-run lineage semantics

That boundary keeps reusable transport and lifecycle substrate in the package
without promoting product-specific control-plane behavior into the framework.
