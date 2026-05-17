---
title: "Agent hosted lifecycle"
description: "Durable hosted run lifecycle helpers for agent streams and child runs."
order: 12
---

# Agent hosted lifecycle

Use the hosted lifecycle helpers when a host owns durable run storage but wants
the package to sequence stream observation, finalization, cancellation, and
child-run terminal handling.

This page covers generic lifecycle helpers. For AG-UI route handlers, use
[`Agent runtime AG-UI`](./agent-runtime-ag-ui.md). For conversation-backed
control-plane adapters, use
[`Conversation-backed agent hosts`](./agent-conversation-control-plane.md).

## Root run lifecycle

`runHostedLifecycle()` starts a durable run through a host adapter, observes an
execution stream, appends events, and finalizes or cancels the run from the
resolved terminal state.

```ts
import { type HostedLifecycleAdapter, runHostedLifecycle } from "veryfront/agent";

type DurableChunk = { type: string; payload: unknown };
type DurableRunContext = { runId: string; latestCursor: number };

const adapter: HostedLifecycleAdapter<DurableRunContext, DurableChunk> = {
  startRun: async () => ({ runId: "run_123", latestCursor: 0 }),
  appendEvents: async (_run, _chunk) => {},
  finalizeRun: async (_run, _terminalState) => {},
  cancelRun: async (_run, _terminalState) => {},
};

await runHostedLifecycle({
  abortSignal: new AbortController().signal,
  execution: {
    stream: {
      async *[Symbol.asyncIterator]() {
        yield { type: "text-delta", payload: "hello" } satisfies DurableChunk;
      },
    },
    waitForFinish: async () => {},
  },
  adapter,
  resolveTerminalState: () => ({ status: "completed" }),
});
```

The host adapter owns auth, durable storage, append policy, transcript policy,
and terminal dispatch. The package owns the orchestration order and cancellation
handoff.

## Response stream heartbeat

`runHostedResponseStreamWithHeartbeat()` streams hosted execution chunks through
one writer while the package owns heartbeat timing and the generic hosted
lifecycle loop.

Use it when the host keeps the heartbeat chunk shape and logging policy local
but wants the lifecycle consume/wait/heartbeat sequence to stay shared.

## Child run lifecycle

`runHostedChildLifecycle()` sequences child-run progress through
pending, running, completed, failed, and cancelled states while the host keeps
the control-plane transport and progress payload policy.

`runHostedChildExecutionLifecycle()` wraps the child lifecycle around local
child execution snapshots and normalizes terminal child-run errors.

| Export                                       | Use                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `runHostedChildLifecycle()`                  | Orchestrate child-run progress with host-owned adapters.                      |
| `runHostedChildExecutionLifecycle()`         | Bind child lifecycle sequencing to local child execution.                     |
| `hostedChildTerminalErrorCodes`              | Canonical terminal error codes for externally controlled child runs.          |
| `isHostedChildTerminalErrorCode()`           | Check whether an unknown value is one of the terminal child-run error codes.  |
| `shouldSkipHostedChildTerminalPersistence()` | Decide whether durable child persistence already reflects the terminal state. |

## Conversation adapters

Conversation-backed helpers bind the generic hosted lifecycle to the public
conversation control-plane APIs:

- `createConversationHostedStreamLifecycleAdapter()`
- `createConversationHostedTerminalAdapter()`
- `prepareConversationRootRunLifecycle()`
- `finalizeHostedResponse()`
- `finalizeHostedDetached()`

Those helpers are documented in
[`Conversation-backed agent hosts`](./agent-conversation-control-plane.md)
because their primary concern is control-plane host composition.
