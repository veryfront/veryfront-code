---
title: "Agent Runtime AG-UI"
description: "Canonical AG-UI request and transport conventions for package-hosted agent runtimes."
order: 10
---

# Agent Runtime AG-UI

The `veryfront/agent` package supports a generic AG-UI transport for hosted
agent runtimes.

This is the package-level AG-UI contract. Veryfront Studio's internal `/internal/agents/*` routes are compatibility/control-plane wrappers, not the canonical public package surface.

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
- `AgUiResumeSignalSchema`
- `waitForHumanInput()`

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
