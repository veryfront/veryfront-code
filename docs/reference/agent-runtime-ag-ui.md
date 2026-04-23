---
title: "Agent Runtime AG-UI"
description: "Canonical AG-UI request and transport conventions for package-hosted agent runtimes."
order: 10
---

# Agent Runtime AG-UI

The `veryfront/agent` package supports a generic AG-UI transport for hosted
agent runtimes.

This is the package-level AG-UI contract. The public control-plane wrapper convention is `/api/control-plane/agents/*`; Veryfront Studio's legacy `/internal/agents/*` routes remain compatibility aliases, not the canonical public package surface.

## Contract

- canonical hosted runtime request contract: `AgUiRuntimeRequestSchema`
- response body: AG-UI SSE
- default endpoint convention: `/api/ag-ui`
- default detached hosted start endpoint: `POST /api/ag-ui/runs`
- default hosted resume endpoint: `POST /api/ag-ui/runs/:runId/resume`
- default hosted cancel endpoint: `DELETE /api/ag-ui/runs/:runId`
- host path: overrideable by the application

The package defines the runtime contract. The host chooses where to mount it.

## Package API

Use `createAgUiHandler()` as a convenience wrapper when you want a direct
route handler:

```ts
import { agent, createAgUiHandler, RunResumeSessionManager } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
});

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

export const POST = createAgUiHandler({
  agent: assistant,
  sessionManager,
});
```

Mount the hosted run-control routes separately with the same session manager.

`createAgUiHandler()` validates the higher-level `AgUiRequestSchema` convenience
shape and normalizes it into the canonical hosted runtime contract. When a host
accepts injected client tools in `tools`, pass the same public
`RunResumeSessionManager` used by the hosted resume/cancel handlers.

For resumable hosted runs, the package also exposes:

- `createAgUiDetachedStartHandler()`
- `createAgUiResumeHandler()`
- `createAgUiCancelHandler()`
- `parseAgUiRequest()`
- `parseAgUiRequestOrError()`
- `normalizeAgUiMessages()`
- `createAgUiRunErrorEvent()`
- `createAgUiSseErrorResponse()`
- `AgUiResumeSignalSchema`
- `waitForHumanInput()`

## Host Parse / Normalize Helpers

Hosts that keep auth, project-access, or runtime preparation local can still
reuse the package AG-UI request plumbing directly:

```ts
import {
  createAgUiRunErrorEvent,
  createAgUiSseErrorResponse,
  normalizeAgUiMessages,
  parseAgUiRequestOrError,
} from "veryfront/agent";

export async function POST(request: Request) {
  const parsed = await parseAgUiRequestOrError(request);
  if (parsed instanceof Response) {
    return parsed;
  }

  const normalizedMessages = normalizeAgUiMessages(parsed.messages);

  try {
    // host-local auth/project/runtime preparation here
    return new Response(JSON.stringify({ ok: true, count: normalizedMessages.length }));
  } catch (error) {
    return createAgUiSseErrorResponse(
      createAgUiRunErrorEvent(
        error instanceof Error ? error.message : "Agent setup failed",
        "SETUP_ERROR",
      ),
      500,
    );
  }
}
```

This helper layer is intentionally narrower than `createAgUiHandler()`:

- the package owns AG-UI request validation/normalization
- the host still owns auth, project access, and runtime preparation

When a host needs to override only the final thread/run ids before opening a
browser stream, `normalizeAgUiBrowserRuntimeRequest()` applies those defaults
while preserving only object-like `state` snapshots for the browser framing
path.

Hosts that keep a custom execute path can also use
`createAgUiBrowserResponseStream()` to emit the same bootstrap AG-UI SSE
framing (`RunStarted`, `StateSnapshot`, `MessagesSnapshot`) while supplying a
host-local encoder for their own chunk type.

When that custom execute path only needs the canonical SSE headers around an
already-built stream, `createAgUiSseResponse()` returns the standard AG-UI
streaming `Response`.

When a host wants one helper that applies browser request defaults and wraps the
resulting browser stream in the canonical SSE `Response`, use
`createAgUiRuntimeBrowserResponse()`.

When a host already has a local chunk encoder but wants to avoid rebuilding the
same finish-reason / token-usage / RunError suppression bookkeeping, use
`createAgUiBrowserFinalizeTracker()`.

When a host has its own chunk type but can express each chunk as one or more
runtime stream events, `createAgUiChunkEncoderBridge()` reuses the canonical
browser AG-UI event mapper without rebuilding the encoder state machine.

When a host wants one helper that combines browser-request defaults, chunk
encoding, and finalize tracking into a canonical SSE response, use
`createAgUiTrackedBrowserResponse()`.

When a host already has runtime stream events and only needs browser encoder
state plus `ToolCallResult` input enrichment, use
`createAgUiRuntimeEventEncoder()`.

When a host still has its own chunk type but no longer wants to keep separate
chunk-bridge and finalize-metadata wiring, `createAgUiBrowserChunkEncoder()`
combines chunk metadata tracking with runtime-event mapping in one helper.

When a host accumulates browser-finished metadata separately,
`buildAgUiBrowserFinalizeResponse()` converts that metadata into the canonical
final `AgentResponse` consumed by the browser encoder finalization path.

For durable control-plane integration, `runHostedLifecycle()` provides a
framework-owned orchestration loop while the host keeps ownership of auth, run
creation, append/mirror policy, finalize/cancel calls, and transcript policy.

Hosts that keep a browser response-stream execute path can also use
`runHostedResponseStreamWithHeartbeat()` to reuse the generic
consume/wait/heartbeat loop while keeping heartbeat chunk shape and logging
policy local.

For child-run or delegated durable progress flows,
`runHostedChildLifecycle()` provides the same kind of framework-owned
orchestration around pending/running/completed/failed/cancelled transitions
while the host keeps the actual control-plane transport and progress payload
policy.

For canonical runtime AG-UI hosts using `createAgUiRuntimeHandler()`, the
package can also invoke optional lifecycle callbacks when the default hosted
stream path sees tool calls, finishes, or fails:

- `onToolCallSeen`
- `onFinish`
- `onError`

## Convenience Request Shape

`AgUiRequestSchema` accepts:

- `messages`
- optional `threadId`
- optional `runId`
- optional `context`
- optional `forwardedProps`
- optional `model`
- optional `maxOutputTokens`
- optional `tools`

## Runtime Context

The handler forwards AG-UI metadata into `agent.stream()` context as:

```ts
{
  threadId,
  runId,
  agUi: {
    context,
    forwardedProps,
  }
}
```

## Hosted Run Control

Package-hosted resumable runs can expose generic control endpoints using the
same `RunResumeSessionManager` that the runtime uses internally:

```ts
import { createAgUiDetachedStartHandler, RunResumeSessionManager } from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

// app/api/ag-ui/runs/route.ts
export const POST = createAgUiDetachedStartHandler({
  agent: assistant,
  sessionManager,
});
```

Hosts that need to keep their own detached execution pipeline can pass
`startDetachedExecution` instead of `agent`. The package still owns request
validation, duplicate detection, session-manager lifecycle, and the accepted
response shape.

```ts
import {
  createAgUiCancelHandler,
  createAgUiResumeHandler,
  RunResumeSessionManager,
} from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

// app/api/ag-ui/runs/[runId]/resume/route.ts
export const POST = createAgUiResumeHandler({ sessionManager });
```

```ts
import { createAgUiCancelHandler, RunResumeSessionManager } from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

// app/api/ag-ui/runs/[runId]/route.ts
export const DELETE = createAgUiCancelHandler({ sessionManager });
```

These handlers are generic package surfaces. They do not include Veryfront
control-plane auth/signature requirements.

## Human Input / Approval Waits

Hosts that need a structured user-input or approval step can compose the same
public run-control seam with `waitForHumanInput()`:

```ts
import {
  HumanInputRequestSchema,
  RunResumeSessionManager,
  waitForHumanInput,
} from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

const result = await waitForHumanInput({
  sessionManager,
  runId: "run_123",
  toolCallId: "tool_approval",
  request: HumanInputRequestSchema.parse({
    title: "Deploy to production?",
    fields: [{ type: "confirm", name: "approved", label: "Approve deploy?" }],
  }),
  onRequest: async (pending) => {
    // Persist or publish the pending request through your host control plane.
  },
});
```

The host still owns persistence and UI delivery, but the request/result schema
and the wait/resume loop are now public package substrate.

## Injected Client Tools

Injected client tools in `tools` are supported when the host wires
`createAgUiHandler()` to a public `RunResumeSessionManager`.

If `tools` are present and no `sessionManager` is configured, the handler
returns `501` with guidance to provide the public run-control seam.
