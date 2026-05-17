---
title: "Agent runtime AG-UI"
description: "Canonical AG-UI request and transport conventions for package-hosted agent runtimes."
order: 10
---

# Agent runtime AG-UI

The `veryfront/agent` package supports a generic AG-UI transport for hosted
agent runtimes.

This is the package-level AG-UI contract. The control-plane wrapper convention is `/api/control-plane/agents/*`.

## Contract

- canonical hosted runtime request contract: `AgUiRuntimeRequestSchema`
- response body: AG-UI SSE
- default endpoint convention: `/api/ag-ui`
- default detached hosted start endpoint: `POST /api/runs`
- default hosted resume endpoint: `POST /api/runs/:runId/resume`
- default hosted cancel endpoint: `DELETE /api/runs/:runId`
- host path: overrideable by the application

The package defines the runtime contract. The host chooses where to mount it.

`AgUiRuntimeRequestSchema` is defined in
[`src/agent/runtime/ag-ui-contract.ts`](../../src/agent/runtime/ag-ui-contract.ts).
It accepts the AG-UI-aligned request fields used by the runtime:

- `threadId`
- `runId`
- `parentRunId`
- `state`
- `messages`
- `tools`
- `context`
- `forwardedProps`

The message subset accepts `system`, `user`, `assistant`, and `tool` roles with
text content. Assistant tool calls and tool messages with `toolCallId` are part
of the contract. Runtime context supports text, JSON, and resource entries.

Signed control-plane invocation uses `RuntimeAgentRunInvocationSchema` around
the runtime request when a trusted control plane owns durable run identity,
project context, and validated claims. Public AG-UI runtime routes use
`AgUiRuntimeRequestSchema`.

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

Browser chat UIs can consume this route with:

```tsx
import { useChat } from "veryfront/chat";

const chat = useChat({ api: "/api/chat", transport: "ag-ui" });
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
- `createAgUiBrowserResponseStream()`
- `createAgUiBrowserEncoderState()`
- `mapRuntimeStreamEventToAgUiBrowserEvents()`
- `finalizeAgUiBrowserEvents()`
- `parseAgUiRequest()`
- `parseAgUiRequestOrError()`
- `normalizeAgUiMessages()`
- `createAgUiRunErrorEvent()`
- `createAgUiSseErrorResponse()`
- `AgUiResumeSignalSchema`
- `waitForHumanInput()`

## Host parse / normalize helpers

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

When a host still receives runtime stream events but wants the framework to own
the canonical `ChatStreamEvent` bridging logic for step/text/reasoning/tool/data
events, use `createAgUiRuntimeChatStreamEncoder()`.

When a host already has runtime stream events and only needs browser encoder
state plus `ToolCallResult` input enrichment, use
`createAgUiRuntimeEventEncoder()`.

When a host still has its own chunk type but no longer wants to keep separate
chunk-bridge and finalize-metadata wiring, `createAgUiBrowserChunkEncoder()`
combines chunk metadata tracking with runtime-event mapping in one helper.

When a host accumulates browser-finished metadata separately,
`buildAgUiBrowserFinalizeResponse()` converts that metadata into the canonical
final `AgentResponse` consumed by the browser encoder finalization path.

For canonical runtime AG-UI hosts using `createAgUiRuntimeHandler()`, the
package can also invoke optional lifecycle callbacks when the default hosted
stream path sees tool calls, finishes, or fails:

- `onToolCallSeen`
- `onFinish`
- `onError`

For durable run lifecycle sequencing outside the AG-UI transport contract, use
[`Agent hosted lifecycle`](./agent-hosted-lifecycle.md).

## Convenience request shape

`AgUiRequestSchema` accepts:

- `messages`
- optional `threadId`
- optional `runId`
- optional `context`
- optional `forwardedProps`
- optional `model`
- optional `maxOutputTokens`
- optional `tools`

## Runtime context

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

## Browser stream encoder

Use the browser encoder helpers when a host needs to turn the framework runtime
stream event family into public AG-UI events without importing internal
transport modules.

```ts
import {
  buildAgUiBrowserFinalizeResponse,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "veryfront/agent";

const state = createAgUiBrowserEncoderState();
const events = mapRuntimeStreamEventToAgUiBrowserEvents(state, {
  type: "tool-input-available",
  toolCallId: "tool-1",
  toolName: "web_search",
  input: { query: "Veryfront" },
});

const finalEvents = finalizeAgUiBrowserEvents(state, null);
const finalResponse = buildAgUiBrowserFinalizeResponse(state.metadata);
```

| Export                                       | Use                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `createAgUiBrowserEncoderState()`            | Create mutable encoder state for one browser AG-UI stream.                                        |
| `mapRuntimeStreamEventToAgUiBrowserEvents()` | Map one runtime stream event into zero or more browser AG-UI events.                              |
| `finalizeAgUiBrowserEvents()`                | Emit terminal browser AG-UI events after the runtime stream finishes.                             |
| `buildAgUiBrowserFinalizeResponse()`         | Convert browser-finished metadata into the canonical final `AgentResponse`.                       |
| `createAgUiBrowserChunkEncoder()`            | Combine host chunk metadata tracking with runtime-event mapping for host-owned chunk types.       |
| `createAgUiRuntimeChatStreamEncoder()`       | Bridge runtime stream events into `ChatStreamEvent` values.                                       |
| `createAgUiRuntimeEventEncoder()`            | Track browser encoder state and enrich `ToolCallResult` events with captured tool input.          |
| `createToolExecutionDataEventBridgeStream()` | Merge host-published tool execution data events into a framework data-stream SSE response.        |
| `createAgUiBrowserFinalizeTracker()`         | Track finish metadata and RunError suppression for one host-owned stream.                         |
| `createAgUiChunkEncoderBridge()`             | Reuse browser AG-UI event mapping for host-owned chunks that project to runtime stream events.    |
| `normalizeAgUiBrowserRuntimeRequest()`       | Apply host thread/run defaults and preserve object-like state snapshots for browser framing.      |
| `createAgUiSseResponse()`                    | Wrap an AG-UI SSE stream in canonical browser response headers.                                   |
| `createAgUiRuntimeBrowserResponse()`         | Apply browser defaults, construct the browser stream, and wrap it in canonical SSE headers.       |
| `createAgUiTrackedBrowserResponse()`         | Combine browser request defaulting, chunk encoding, finalize tracking, and SSE response assembly. |

## Hosted run control

Package-hosted resumable runs can expose generic control endpoints using the
same `RunResumeSessionManager` that the runtime uses internally:

```ts
import { createAgUiDetachedStartHandler, RunResumeSessionManager } from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

// app/api/runs/route.ts
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

// app/api/runs/[runId]/resume/route.ts
export const POST = createAgUiResumeHandler({ sessionManager });
```

```ts
import { createAgUiCancelHandler, RunResumeSessionManager } from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

// app/api/runs/[runId]/route.ts
export const DELETE = createAgUiCancelHandler({ sessionManager });
```

These handlers are generic package surfaces. They do not include Veryfront
control-plane auth/signature requirements.

## Human input / approval waits

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

The host owns persistence and UI delivery. The request/result schema and the
wait/resume loop are public package substrate.

## Injected client tools

Injected client tools in `tools` are supported when the host wires
`createAgUiHandler()` to a public `RunResumeSessionManager`.

If `tools` are present and no `sessionManager` is configured, the handler
returns `501` with guidance to provide the public run-control seam.
