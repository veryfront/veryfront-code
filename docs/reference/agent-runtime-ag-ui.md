---
title: "Agent Runtime AG-UI"
description: "Canonical AG-UI request and transport conventions for package-hosted agent runtimes."
order: 10
---

# Agent Runtime AG-UI

The `veryfront/agent` package supports a generic AG-UI transport for hosted
agent runtimes.

## Contract

- canonical hosted runtime request contract: `AgUiRuntimeRequestSchema`
- response body: AG-UI SSE
- default endpoint convention: `/api/ag-ui`
- default hosted resume endpoint: `POST /api/ag-ui/runs/:runId/resume`
- default hosted cancel endpoint: `DELETE /api/ag-ui/runs/:runId`
- host path: overrideable by the application

The package defines the runtime contract. The host chooses where to mount it.

## Package API

Use `createAgUiHandler()` as a convenience wrapper when you want a direct
route handler:

```ts
import { agent, createAgUiHandler } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
});

export const POST = createAgUiHandler({
  agent: assistant,
});
```

`createAgUiHandler()` validates the higher-level `AgUiRequestSchema` convenience
shape and normalizes it into the canonical hosted runtime contract.

For resumable hosted runs, the package also exposes:

- `createAgUiResumeHandler()`
- `createAgUiCancelHandler()`
- `AgUiResumeSignalSchema`

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
import {
  createAgUiCancelHandler,
  createAgUiResumeHandler,
  RunResumeSessionManager,
} from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

export const POST = createAgUiResumeHandler({ sessionManager });
export const DELETE = createAgUiCancelHandler({ sessionManager });
```

These handlers are generic package surfaces. They do not include Veryfront
control-plane auth/signature requirements.

## Current Limitation

Injected client tools in `tools` are not supported yet by the package AG-UI
handler. Requests that include them receive `501` until the package exposes
generic wait/resume primitives for client-mediated tool execution.
