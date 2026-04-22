---
title: "veryfront/agent"
description: "AI agents with memory, tools, and multi-agent composition."
order: 9
---

# veryfront/agent

AI agents with memory, tools, and multi-agent composition.

Route examples below use the default app router. The hosted AG-UI path is owned by the application; `/api/ag-ui` is the default package convention, not a required fixed route.

## Import

```ts
import {
  agent,
  agentAsTool,
  AgentRuntime,
  AgUiDetachedStartRequestSchema,
  AgUiRequestSchema,
  AgUiResumeSignalSchema,
  AgUiRuntimeRequestSchema,
  buildAgUiBrowserFinalizeResponse,
  createAgUiBrowserEncoderState,
  createAgUiCancelHandler,
  createAgUiDetachedStartHandler,
  createAgUiHandler,
  createAgUiResumeHandler,
  createAgUiRunErrorEvent,
  createAgUiRuntimeHandler,
  createAgUiSseErrorResponse,
  createMemory,
  executeAgUiDetachedStart,
  expandAllowedRemoteToolNames,
  getAgentsAsTools,
  getProviderNativeToolNames,
  HostedLifecycleTerminalState,
  HumanInputRequestSchema,
  normalizeAgUiMessages,
  normalizeAgUiRuntimeMessages,
  parseAgUiRequest,
  parseAgUiRequestOrError,
  parseAgUiRuntimeRequest,
  parseAgUiRuntimeRequestOrError,
  registerAgent,
  runHostedChildLifecycle,
  runHostedLifecycle,
  RunResumeSessionManager,
  waitForHumanInput,
} from "veryfront/agent";
```

## Examples

### Basic agent

```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
});
```

### Agent with tools

```ts
import { agent } from "veryfront/agent";
import { tool } from "veryfront/tool";
import { z } from "zod";

const searchTool = tool({
  id: "search",
  description: "Search the knowledge base",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ results: [] }),
});

const assistant = agent({
  system: "You are a helpful assistant.",
  tools: { search: searchTool },
  memory: { type: "conversation", maxMessages: 50 },
});
```

### Agent with remote MCP tools

```ts
import { agent } from "veryfront/agent";
import { createRemoteMCPToolSource } from "veryfront/tool";

const docsTools = createRemoteMCPToolSource({
  id: "docs-mcp",
  endpoint: "https://docs.example.com/mcp",
  headers: { Authorization: `Bearer ${Deno.env.get("DOCS_TOKEN")}` },
});

const assistant = agent({
  system: "Use the docs tools when the question needs external product docs.",
  remoteTools: [docsTools],
});
```

### Agent with skills

```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  system: "You are a support engineer. Use skills when relevant.",
  skills: ["incident-response", "repo-maintainer"], // or `true` for all discovered skills
  tools: {
    Read: true,
    "github:list-issues": true,
  },
});
```

### Streaming API route

```ts
// app/api/chat/route.ts
import { agent } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
});

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = await assistant.stream({ messages });
  return result.toDataStreamResponse();
}
```

### AG-UI route

```ts
// app/api/ag-ui/route.ts
import { agent, createAgUiHandler } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
});

export const POST = createAgUiHandler({
  agent: assistant,
});
```

### AG-UI run control routes

```ts
// app/api/ag-ui/runs/route.ts
import { createAgUiDetachedStartHandler, RunResumeSessionManager } from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

export const POST = createAgUiDetachedStartHandler({
  agent: assistant,
  sessionManager,
});
```

```ts
// app/api/ag-ui/runs/[runId]/resume/route.ts
import { createAgUiResumeHandler, RunResumeSessionManager } from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

export const POST = createAgUiResumeHandler({ sessionManager });
```

```ts
// app/api/ag-ui/runs/[runId]/route.ts
import { createAgUiCancelHandler, RunResumeSessionManager } from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

export const DELETE = createAgUiCancelHandler({ sessionManager });
```

### Hosted durable lifecycle runner

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

For a conversations/control-plane host composition that combines
`runHostedLifecycle()` with the public durable-run helpers, see
[`Conversation-backed agent hosts`](./agent-conversation-control-plane.md).
For higher-level root-run and child-run adapter factories over those same public exports, see [`Conversation-backed lifecycle adapters`](./agent-conversation-lifecycle.md).
For a small helper that carries durable run lineage and effective parent lineage together, see [`Conversation run context helpers`](./agent-conversation-run-context.md).
For helpers that start or normalize a conversation-backed root run before host execution begins, see [`Conversation root-run helpers`](./agent-conversation-root-run-context.md).

### Browser AG-UI encoder

```ts
import {
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

### Provider-native tool inventory

```ts
import { expandAllowedRemoteToolNames, getProviderNativeToolNames } from "veryfront/agent";

const providerNativeToolNames = getProviderNativeToolNames({
  model: "anthropic/claude-sonnet-4-6",
});

const allowedRemoteToolNames = expandAllowedRemoteToolNames({
  model: "anthropic/claude-sonnet-4-6",
  toolNames: ["create_file"],
});
```

### Human input over hosted AG-UI runs

```ts
import {
  HostedLifecycleTerminalState,
  HumanInputRequestSchema,
  runHostedChildLifecycle,
  runHostedLifecycle,
  RunResumeSessionManager,
  waitForHumanInput,
} from "veryfront/agent";

const sessionManager = new RunResumeSessionManager<{
  result: unknown;
  isError: boolean;
}>();

const request = HumanInputRequestSchema.parse({
  title: "Deployment confirmation",
  fields: [
    {
      type: "confirm",
      name: "approved",
      label: "Ship this change?",
    },
  ],
});

const result = await waitForHumanInput({
  sessionManager,
  runId: "run_123",
  toolCallId: "tool_approve",
  request,
  onRequest: async (pending) => {
    // Persist or publish `pending` through your host control plane.
  },
});
```

### Multi-agent composition

```ts
import { agent, getAgentsAsTools, registerAgent } from "veryfront/agent";

const researcher = agent({ system: "Research topics thoroughly." });
const writer = agent({ system: "Write clear prose." });

registerAgent(researcher);
registerAgent(writer);

const orchestrator = agent({
  system: "Coordinate research and writing.",
  tools: getAgentsAsTools(["researcher", "writer"]),
});
```

## API

### `agent(config)`

Create an agent

When `model` is omitted, Veryfront defaults to the runtime convention: local
inference by default, automatically upgrading to an available cloud provider
when bootstrap credentials are present.

| Property                 | Type                                                                                                                                                | Description                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `id?`                    | `string`                                                                                                                                            | Unique identifier (auto-generated if omitted)                                        |
| `model?`                 | `ModelString`                                                                                                                                       | Provider/model override. Omit or use `"auto"` for runtime defaults.                  |
| `system`                 | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code>                                                                | System prompt — string, function, or async function                                  |
| `tools?`                 | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code>                                                                                  | Tools available to the agent                                                         |
| `remoteTools?`           | `RemoteToolSource[]`                                                                                                                                | Remote tool sources queried per request (for example remote MCP)                     |
| `maxSteps?`              | `number`                                                                                                                                            | Max tool-call iterations per request                                                 |
| `streaming?`             | `boolean`                                                                                                                                           | Enable streaming responses                                                           |
| `memory?`                | `MemoryConfig`                                                                                                                                      | Conversation memory settings                                                         |
| `middleware?`            | `AgentMiddleware[]`                                                                                                                                 | Execution middleware pipeline                                                        |
| `edge?`                  | `EdgeConfig`                                                                                                                                        | Edge runtime configuration                                                           |
| `multimodal?`            | <code>&#123; vision?: boolean; audio?: boolean &#125;</code>                                                                                        | Enable vision and/or audio                                                           |
| `allowedModels?`         | `ModelString[]`                                                                                                                                     | Restrict runtime model overrides to these "provider/model" strings.                  |
| `resolveModelTransport?` | <code>(request: ModelTransportRequest) =&gt; ResolvedModelTransport &#124; Promise&lt;ResolvedModelTransport&gt;</code>                             | Inject request-aware model runtime, headers, or provider options.                    |
| `resolveRuntimeState?`   | <code>(request: RuntimeStateRequest) =&gt; ResolvedRuntimeState &#124; Promise&lt;ResolvedRuntimeState &#124; undefined&gt; &#124; undefined</code> | Refresh the current system prompt and host-owned runtime context at step boundaries. |
| `skills?`                | `true \| string[]`                                                                                                                                  | Enable skills for this agent.                                                        |

**Returns:** `Agent`

### Browser AG-UI stream encoder

Use these helpers when a host needs to turn the framework runtime stream event
family into browser/public AG-UI events without importing internal transport
modules.

| Export                                                   | Type                                                                                               | Description                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAgUiBrowserEncoderState()`                        | `() => AgUiBrowserEncoderState`                                                                    | Create mutable encoder state for one browser AG-UI stream.                                                                                                                          |
| `buildAgUiBrowserFinalizeResponse()`                     | `(metadata) => AgentResponse \| null`                                                              | Convert browser-finished metadata into the canonical final AgentResponse.                                                                                                           |
| `runHostedLifecycle()`                                   | `(options) => Promise<HostedLifecycleRunResult>`                                                   | Orchestrate start/observe/finalize/cancel sequencing with host-owned adapters.                                                                                                      |
| `runHostedChildLifecycle()`                              | `(options) => Promise<HostedChildLifecycleRunResult>`                                              | Orchestrate pending/running/completed/failed/cancelled child lifecycle sequencing with host-owned adapters.                                                                         |
| `createConversationAgentRun()`                           | `(input) => Promise<ConversationRunProjection>`                                                    | Create a conversation-owned durable agent run and read back its canonical projection.                                                                                               |
| `getConversationRun()`                                   | `(input) => Promise<ConversationRunProjection>`                                                    | Read the canonical projection for an existing conversation-owned durable run.                                                                                                       |
| `appendConversationRunEvents()`                          | `(input) => Promise<AppendConversationRunEventsResponse>`                                          | Append control-plane events to a conversation-owned durable run through the canonical events route.                                                                                 |
| `flushConversationRunEventBatches()`                     | `(input) => Promise<{ outcome, latestEventId, latestExternalEventSequence, ... }>`                 | Flush one host-owned queue of conversation-run events through canonical batching plus append-execution recovery.                                                                    |
| `flushConversationRunEventQueue()`                       | `(input) => Promise<{ outcome, latestEventId, latestExternalEventSequence, pendingEvents?, ... }>` | Drain one host-owned queue of conversation-run events until it fully flushes, stops, or yields a canonical retry payload.                                                           |
| `createConversationRunEventQueueController()`            | `(input) => ConversationRunEventQueueController`                                                   | Create a timerless queue controller that owns pending-event buffering plus canonical flush/retry state while the host keeps scheduling and logging policy.                          |
| `createConversationRunMirror()`                          | `(input) => ConversationRunMirror`                                                                 | Create a reusable conversation-run mirror that owns queue flushing, in-flight coordination, and retry scheduling while the host still controls event shaping and logging callbacks. |
| `normalizeConversationRunEvent()`                        | `(event) => ConversationRunEvent[]`                                                                | Normalize one conversation-run event to stay under control-plane payload limits by splitting or summarizing oversized payloads.                                                     |
| `normalizeConversationRunEvents()`                       | `(events) => ConversationRunEvent[]`                                                               | Normalize a whole conversation-run event list through the shared payload-limit rules before it is queued or appended.                                                               |
| `getConversationRunEventJsonByteLength()`                | `(value) => number`                                                                                | Measure the UTF-8 JSON payload size used by the conversation-run event normalization helpers.                                                                                       |
| `ConversationRunEventEncoder`                            | `class`                                                                                            | Encode public chat stream events into canonical conversation-run events without rebuilding the control-plane event contract in each host.                                           |
| `encodeConversationRunEvents()`                          | `(events, encoder?) => ConversationRunEvent[]`                                                     | Encode a whole list of public chat stream events into canonical conversation-run events.                                                                                            |
| `normalizeEncodedConversationRunEvents()`                | `(events, encoder?) => ConversationRunEvent[]`                                                     | Encode and normalize public chat stream events into payload-safe conversation-run events in one step.                                                                               |
| `prepareConversationRunStreamEvents()`                   | `(events, encoder?) => ConversationRunEvent[]`                                                     | Encode and normalize public chat stream events in one host-facing helper before queueing them into a conversation-run mirror.                                                       |
| `prepareConversationRunExternalEvents()`                 | `(events) => ConversationRunEvent[]`                                                               | Normalize already-encoded conversation-run events before they are appended or queued.                                                                                               |
| `createConversationRunStreamMirror()`                    | `(input) => ConversationRunStreamMirror`                                                           | Create a higher-level conversation-run mirror that accepts public chat stream events, normalizes them, and forwards them through the reusable mirror runtime.                       |
| `isAppendableConversationRunProjection()`                | `(run) => boolean`                                                                                 | Check whether a conversation-owned durable run is still appendable or has already moved into a waiting/terminal state.                                                              |
| `resyncConversationRunAppendCursor()`                    | `(input) => Promise<{ result, run }>`                                                              | Re-read a conversation-owned durable run after an append cursor mismatch and classify whether the cursor advanced, stayed appendable, or became non-appendable.                     |
| `recoverConversationRunCursorMismatch()`                 | `(input) => Promise<{ outcome, latestEventId, latestExternalEventSequence, ... }>`                 | Apply retry-limit gating plus canonical cursor-resync classification for a conversation-run cursor mismatch in one reusable helper.                                                 |
| `recoverConversationRunAppendFailure()`                  | `(input) => Promise<{ outcome, latestEventId, latestExternalEventSequence, ... }>`                 | Classify append failures into resume/stop/retry outcomes while sharing the canonical cursor-mismatch and ignorable-rejection rules.                                                 |
| `recoverConversationRunAppendExecution()`                | `(input) => Promise<{ outcome, latestEventId, latestExternalEventSequence, pendingEvents?, ... }>` | Apply append-failure recovery to a host-owned pending-events queue while preserving canonical control-plane resume/stop/retry decisions.                                            |
| `monitorConversationRunStatus()`                         | `(input) => Promise<void>`                                                                         | Poll a conversation-owned durable run until it reaches a terminal state and report the terminal projection through a typed error callback.                                          |
| `finalizeConversationAgentRun()`                         | `(input) => Promise<void>`                                                                         | Finalize a conversation-owned durable agent run through the canonical complete route.                                                                                               |
| `resolveConversationRunTargets()`                        | `({ projectId?, branchId? }) => ConversationRunTargets`                                            | Resolve project/branch target metadata for durable conversation-backed runs.                                                                                                        |
| `bootstrapConversationAgentRun()`                        | `(input) => Promise<BootstrapConversationAgentRunResult>`                                          | Create a conversation, seed it with a handoff message, and create a conversation-owned agent run in one reusable flow.                                                              |
| `ensureConversationProjectLink()`                        | `(input) => Promise<void>`                                                                         | Link a conversation to a project when it is currently unowned.                                                                                                                      |
| `createConversationRecord()`                             | `(input) => Promise<ConversationRecord>`                                                           | Create a conversation through the control-plane conversations API.                                                                                                                  |
| `createConversationMessage()`                            | `(input) => Promise<ConversationMessageRecord>`                                                    | Create a conversation message through the control-plane conversations API.                                                                                                          |
| `buildInvokeAgentChildRunStateDelta()`                   | `(input) => InvokeAgentChildRunStateDelta`                                                         | Build the canonical `invokeAgentChildRuns` state-delta payload for one child-run lifecycle transition.                                                                              |
| `buildInvokeAgentChildRunLifecycleCustomEvent()`         | `(input) => InvokeAgentChildRunLifecycleCustomEvent`                                               | Build the AG-UI custom lifecycle event emitted for invoke-agent child-run progress.                                                                                                 |
| `buildInvokeAgentChildRunProgressEvents()`               | `(input) => readonly [InvokeAgentChildRunStateDelta, InvokeAgentChildRunLifecycleCustomEvent]`     | Build the paired state-delta and custom lifecycle events for invoke-agent child-run progress.                                                                                       |
| `publishInvokeAgentChildRunProgress()`                   | `(input) => Promise<void>`                                                                         | Publish invoke-agent child-run progress through a shared parent-run publisher or the canonical conversation-run events route.                                                       |
| `mapRuntimeStreamEventToAgUiBrowserEvents(state, event)` | `(state, event) => AgUiBrowserEncodedEvent[]`                                                      | Map one runtime stream event into zero or more browser/public AG-UI events.                                                                                                         |
| `finalizeAgUiBrowserEvents(state, response)`             | `(state, response) => AgUiBrowserEncodedEvent[]`                                                   | Emit terminal browser/public AG-UI events after the runtime stream finishes.                                                                                                        |

### Provider-native tool inventory

Use these helpers when a host needs to derive provider-native remote-tool
allowlists for forked or runtime-isolated executions without hardcoding
provider/tool mappings outside the package.

| Export                                  | Type                                                                       | Description                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `getProviderNativeToolNames(options)`   | `({ model?: string; provider?: string }) => string[]`                      | Return the provider-native tool ids currently available for the provider/model.                               |
| `expandAllowedRemoteToolNames(options)` | `({ model?: string; provider?: string; toolNames: string[] }) => string[]` | Expand a local remote-tool allowlist with the package-owned provider-native tool ids for that provider/model. |

### Request-aware model transport

Hosts that need request-scoped provider transport behavior can use
`resolveModelTransport` to inject a model runtime override, request headers,
and provider options without forking the runtime loop.

```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  model: "openai/gpt-5.4-mini",
  system: "You are a helpful assistant.",
  resolveModelTransport: async ({ context, resolvedModel }) => ({
    headers: {
      Authorization: `Bearer ${String(context?.apiToken ?? "")}`,
      "x-veryfront-model": resolvedModel,
    },
    providerOptions: {
      gateway: {
        projectSlug: context?.projectSlug,
      },
    },
  }),
});
```

### Step-boundary runtime refresh

Hosts that need long-lived runs to react to changing steering or project state
can use `resolveRuntimeState`. The hook runs before each model step with the
current system string, accumulated messages, and host-owned runtime context.

```ts
import { agent } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
  resolveRuntimeState: async ({ step, messages, context, system }) => {
    if (step === 0) {
      return undefined;
    }

    const switchedProject = messages.some((message) =>
      message.role === "tool" &&
      message.parts.some((part) =>
        part.type === "tool-result" &&
        part.toolName === "switch_project"
      )
    );

    if (!switchedProject) {
      return { system, context };
    }

    return {
      system: `${system}\n\nActive project: project-b`,
      context: { ...context, projectId: "project-b" },
    };
  },
});
```

### `agent.generate(input)`

Run the agent and return a complete response. Accepts a string or message array as input.

| Property   | Type                                       | Description                                                                                    |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `input`    | `string \| Message[]`                      | Prompt string or message history                                                               |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent                                                         |
| `model?`   | `ModelString`                              | Override the agent's default model for this request. Must be in `allowedModels` if configured. |

**Returns:** <code>Promise&lt;AgentResponse&gt;</code>

### `agent.stream(input)`

Run the agent and stream the response. Returns a result with `.toDataStreamResponse()` for API routes.

| Property      | Type                                         | Description                                                                                    |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `input?`      | `string`                                     | Prompt string                                                                                  |
| `messages?`   | `Message[]`                                  | Conversation message history                                                                   |
| `context?`    | <code>Record&lt;string, unknown&gt;</code>   | Additional context passed to the agent                                                         |
| `model?`      | `ModelString`                                | Override the agent's default model for this request. Must be in `allowedModels` if configured. |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback fired when a tool is invoked                                                          |
| `onChunk?`    | <code>(chunk: string) =&gt; void</code>      | Callback fired for each text chunk                                                             |

**Returns:** <code>Promise&lt;AgentStreamResult&gt;</code>

### `agent.respond(request)`

Handle an incoming HTTP request and return a streaming `Response`. Reads messages from the request body.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `createChatHandler(agentId, options?)`

Create a POST chat route handler with built-in request validation, UI-message normalization, server-memory reset, and `NO_AI_AVAILABLE` fallback handling.

| Property                | Type                                                                                                                                                           | Description                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agentId`               | `string`                                                                                                                                                       | Registered agent ID                                                                                                                                          |
| `options?.context`      | <code>Record&lt;string, unknown&gt; &#124; ((request: Request) =&gt; Record&lt;string, unknown&gt; &#124; Promise&lt;Record&lt;string, unknown&gt;&gt;)</code> | Context passed to `agent.stream()`                                                                                                                           |
| `options?.beforeStream` | <code>(input) =&gt; void &#124; Response &#124; ChatHandlerBeforeStreamResult &#124; Promise&lt;...&gt;</code>                                                 | Hook that runs after validation and before `agent.stream()`. Can prepend/append/replace messages, override context, or return a `Response` to short-circuit. |

`beforeStream` input includes:

| Property       | Type                                       | Description                                                      |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `request`      | `Request`                                  | Original request                                                 |
| `messages`     | `Message[]`                                | Normalized message history                                       |
| `context`      | <code>Record&lt;string, unknown&gt;</code> | Resolved context (default `{ userId: "current-user" }`)          |
| `lastUserText` | `string`                                   | Text extracted from the last user message (empty string if none) |

### `createAgUiHandler(agentIdOrConfig, options?)`

Create a POST route handler for AG-UI requests. The package default convention
is `/api/ag-ui`, but the host application owns the actual path.

The handler:

- validates the higher-level `AgUiRequestSchema` wrapper body
- clears server memory before each run
- converts the package data-stream output into AG-UI SSE events
- normalizes the wrapper request into the canonical hosted runtime contract
- supports injected client tools in `tools` when `options.sessionManager` is
  provided
- passes AG-UI request metadata into `agent.stream()` context as:

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

Injected client tools:

- accepted when `options.sessionManager` is a public
  `RunResumeSessionManager<{ result: unknown; isError: boolean }>`
- rejected with `501` when `tools` are present but `options.sessionManager` is
  omitted

| Property                  | Type                                                                                                                                                           | Description                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `agentIdOrConfig`         | `string \| { agent: Agent, context?: ..., sessionManager?: ... }`                                                                                              | Agent registry id or direct agent instance                    |
| `options?.context`        | <code>Record&lt;string, unknown&gt; &#124; ((request: Request) =&gt; Record&lt;string, unknown&gt; &#124; Promise&lt;Record&lt;string, unknown&gt;&gt;)</code> | Extra context merged into the AG-UI runtime context           |
| `options?.sessionManager` | `RunResumeSessionManager<{ result: unknown; isError: boolean }>`                                                                                               | Required when the request can include injected client `tools` |

### `AgUiRequestSchema`

Validate the convenience wrapper request shape for `createAgUiHandler()`.

This schema accepts the higher-level host request format based on message
`parts`. `createAgUiHandler()` normalizes it into the canonical
`AgUiRuntimeRequestSchema` before invoking the runtime.

### `parseAgUiRequest(request)`

Parse and validate the convenience AG-UI wrapper request body into
`AgUiRequestSchema`.

### `parseAgUiRequestOrError(request)`

Parse the convenience AG-UI wrapper request body and return either the parsed
request or a `400` JSON `Response` when validation fails.

### `normalizeAgUiMessages(messages)`

Normalize convenience AG-UI `messages` into the runtime `Message[]` shape used
by the agent runtime.

### `createAgUiRunErrorEvent(message, code?)`

Create a `RunError` AG-UI SSE event payload.

### `createAgUiSseErrorResponse(event, status)`

Create an AG-UI SSE `Response` from a prepared AG-UI event, preserving the
existing `RunError` wire shape used by hosted routes.

### `AgUiRuntimeRequestSchema`

Validate the canonical open-source AG-UI runtime request contract for hosted
agent execution. This is the package-facing schema downstream runtimes should
target; the older internal compatibility route remains a wrapper around this
contract.

### `parseAgUiRuntimeRequest(request)`

Parse and validate the canonical runtime AG-UI request body into
`AgUiRuntimeRequestSchema`.

### `parseAgUiRuntimeRequestOrError(request)`

Parse the canonical runtime AG-UI request body and return either the parsed
request or a `400` JSON `Response` when validation fails.

### `normalizeAgUiRuntimeMessages(messages)`

Normalize canonical runtime AG-UI `messages` into the package `Message[]`
shape used by `agent.stream()` and `AgentRuntime.stream()`.

### `createAgUiBrowserResponseStream(input)`

Create a host-facing AG-UI SSE stream for custom execution pipelines when the
host already owns its own chunk type but wants to reuse package browser-event
framing and bootstrap event conventions.

### `createAgUiRuntimeHandler(config)`

Create a POST route handler for the canonical runtime AG-UI request contract.

This handler:

- validates `AgUiRuntimeRequestSchema`
- optionally resolves extra host context
- can stream directly through a package `agent`
- can hand off to a host-provided `execute` callback for custom auth,
  preparation, or execution while keeping package-owned runtime-request parsing
- can notify host lifecycle callbacks (`onToolCallSeen`, `onFinish`, `onError`)
  while the package still owns the default AG-UI stream path

### `AgUiResumeSignalSchema`

Validate the canonical hosted-run resume payload for AG-UI tool-result
continuations.

### `AgUiDetachedStartRequestSchema`

Validate the canonical detached hosted-run kickoff payload for AG-UI routes.
This schema requires explicit `runId` and `threadId`.

### `createAgUiDetachedStartHandler(options)`

Create a generic POST handler for detached hosted AG-UI run kickoff.

Default route convention:

- `POST /api/ag-ui/runs`

Response shape:

- `202 { accepted: true, duplicate: false, runId, threadId }`
- `202 { accepted: true, duplicate: true, runId, threadId }`

Options may provide either:

- `agent` to use the package runtime directly
- `startDetachedExecution` to let the host run its own detached execution path
  while the package still owns request validation, duplicate detection, and
  session-manager lifecycle

### `executeAgUiDetachedStart(options, input)`

Run the detached hosted-start lifecycle from a validated
`AgUiDetachedStartRequest` object instead of an HTTP request.

Use this when the host already owns outer request parsing/auth and wants the
package to keep duplicate detection, session-manager lifecycle, and detached
task orchestration without reserializing through a synthetic `Request`.

### `createAgUiResumeHandler(options)`

Create a generic POST handler for hosted resumable AG-UI runs.

Default route convention:

- `POST /api/ag-ui/runs/:runId/resume`

### `createAgUiCancelHandler(options)`

Create a generic DELETE handler for cancelling hosted resumable AG-UI runs.

Default route convention:

- `DELETE /api/ag-ui/runs/:runId`

### `RunResumeSessionManager`

Coordinate resumable waits for hosted agent runs without depending on any
product-specific control plane.

Use this when a host runtime needs to start a resumable run-local session,
pause on an external signal, and later submit a resume value for that run.

### `HumanInputRequestSchema`

Validate the canonical request shape for human-input / form-response prompts
that pause a hosted AG-UI run.

### `HumanInputResultSchema`

Validate the canonical resumed result for a human-input wait. The result is
submitted through the existing hosted run-control seam as a `tool_result`.

### `waitForHumanInput(options)`

Publish a canonical pending human-input request, wait on a public
`RunResumeSessionManager`, and validate the resumed result.

Use this when your host runtime needs a generic user-input or approval step
without re-owning the underlying AG-UI wait/resume mechanics.

### `agent.getMemory()`

Get the agent's memory instance.

**Returns:** <code>Memory&lt;Message&gt;</code>

### `agent.getMemoryStats()`

Get memory usage statistics (message count, estimated tokens, type).

**Returns:** <code>Promise&lt;&#123; totalMessages: number; estimatedTokens: number; type: string &#125;&gt;</code>

### `agent.clearMemory()`

Clear all stored messages from memory.

**Returns:** <code>Promise&lt;void&gt;</code>

## Exports

### Functions

| Name                             | Description                                                             |
| -------------------------------- | ----------------------------------------------------------------------- |
| `agent`                          | Create an agent                                                         |
| `agentAsTool`                    | Wrap agent as callable tool                                             |
| `createAgUiCancelHandler`        | Create a DELETE handler for hosted AG-UI run cancellation               |
| `createAgUiDetachedStartHandler` | Create a POST handler for detached hosted AG-UI run kickoff             |
| `executeAgUiDetachedStart`       | Run detached hosted-start lifecycle from a validated request object     |
| `createAgUiHandler`              | Create a POST handler for an AG-UI route                                |
| `createAgUiRuntimeHandler`       | Create a POST handler for the canonical runtime AG-UI request contract  |
| `createAgUiRunErrorEvent`        | Create a `RunError` AG-UI SSE event                                     |
| `createAgUiSseErrorResponse`     | Create an AG-UI SSE error `Response`                                    |
| `createAgUiResumeHandler`        | Create a POST handler for hosted AG-UI run resume values                |
| `normalizeAgUiRuntimeMessages`   | Normalize runtime AG-UI messages into package `Message[]`               |
| `parseAgUiRuntimeRequest`        | Parse and validate the canonical runtime AG-UI request body             |
| `parseAgUiRuntimeRequestOrError` | Parse runtime AG-UI input or return a `400` validation `Response`       |
| `createChatHandler`              | Create a POST handler for a chat API route.                             |
| `createMemory`                   | Create memory (buffer, conversation, summary)                           |
| `createRedisMemory`              | Create Redis-backed memory                                              |
| `createWorkflow`                 | Create sequential agent workflow                                        |
| `getAgent`                       | Get agent by ID                                                         |
| `getAgentsAsTools`               | Get agents as tools (multi-agent)                                       |
| `getAllAgentIds`                 | List registered agent IDs                                               |
| `getTextFromParts`               | Extract text from multi-part message                                    |
| `getToolArguments`               | Extract parsed tool call args                                           |
| `hasArgs`                        | Check for parsed args on tool call                                      |
| `hasInput`                       | Check for raw input on tool call                                        |
| `registerAgent`                  | Register agent for discovery                                            |
| `waitForHumanInput`              | Wait for a canonical human-input response over hosted AG-UI run control |

### Classes

| Name                           | Description                                                              |
| ------------------------------ | ------------------------------------------------------------------------ |
| `AgentRuntime`                 | Agent execution runtime                                                  |
| `BufferMemory`                 | In-memory message buffer                                                 |
| `ConversationMemory`           | Full conversation history                                                |
| `HumanInputResumeError`        | Error thrown when a host resumes a human-input wait with `isError: true` |
| `InvalidHumanInputResultError` | Error thrown when a resumed human-input payload fails schema validation  |
| `RedisMemory`                  | Redis-backed persistent memory                                           |
| `RunResumeSessionManager`      | Generic wait/resume manager for hosted agent runs                        |
| `SummaryMemory`                | Compresses old messages into summaries                                   |

### Schemas

| Name                             | Description                                                            |
| -------------------------------- | ---------------------------------------------------------------------- |
| `AgUiDetachedStartRequestSchema` | Canonical detached hosted-run kickoff request schema                   |
| `AgUiRequestSchema`              | Convenience request schema for `createAgUiHandler()`                   |
| `AgUiRuntimeRequestSchema`       | Canonical open-source AG-UI runtime request contract for hosted runs   |
| `AgUiResumeSignalSchema`         | Canonical hosted-run resume payload for AG-UI tool-result continuation |
| `HumanInputFieldSchema`          | Canonical human-input field schema                                     |
| `HumanInputOptionSchema`         | Canonical human-input option schema                                    |
| `HumanInputPendingRequestSchema` | Canonical pending human-input request envelope for hosts               |
| `HumanInputRequestSchema`        | Canonical human-input request payload                                  |
| `HumanInputResultSchema`         | Canonical human-input resumed result payload                           |

### Types

| Name                              | Description                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `AgUiDetachedStartAccepted`       | Accepted response shape for detached hosted AG-UI kickoff                    |
| `AgUiDetachedStartHandlerOptions` | Options for `createAgUiDetachedStartHandler`                                 |
| `AgUiDetachedStartRequest`        | Validated detached hosted AG-UI kickoff request                              |
| `ExecuteAgUiDetachedStartInput`   | Input shape for `executeAgUiDetachedStart`                                   |
| `Agent`                           | `agent()` return type                                                        |
| `AgentConfig`                     | Agent configuration                                                          |
| `AgentContext`                    | Agent handler context                                                        |
| `AgentMiddleware`                 | Agent execution middleware                                                   |
| `AgentResponse`                   | Agent execution response                                                     |
| `AgentStatus`                     | Agent status (idle, running, etc.)                                           |
| `AgentStreamResult`               | Streaming result (`.toDataStreamResponse()`)                                 |
| `AgUiContextItem`                 | AG-UI runtime context item                                                   |
| `AgUiHandlerConfigWithAgent`      | Direct-agent form for `createAgUiHandler`                                    |
| `AgUiHandlerOptions`              | Options for `createAgUiHandler`                                              |
| `AgUiCancelHandlerOptions`        | Options for `createAgUiCancelHandler`                                        |
| `AgUiInjectedTool`                | AG-UI client-injected tool descriptor                                        |
| `AgUiRequest`                     | Validated AG-UI runtime request body                                         |
| `AgUiSseEvent`                    | AG-UI SSE event object used by host-facing AG-UI helpers                     |
| `AgUiResumeHandlerOptions`        | Options for `createAgUiResumeHandler`                                        |
| `AgUiResumeSignal`                | Validated hosted-run resume payload                                          |
| `HumanInputField`                 | Canonical form/input field definition                                        |
| `HumanInputFieldInput`            | Input shape accepted by `waitForHumanInput()` before defaults normalize      |
| `HumanInputOption`                | Canonical select/radio option definition                                     |
| `HumanInputPendingRequest`        | Pending human-input envelope passed to `onRequest`                           |
| `HumanInputRequest`               | Normalized human-input request payload                                       |
| `HumanInputRequestInput`          | Input shape accepted by `HumanInputRequestSchema`                            |
| `HumanInputResult`                | Validated human-input resumed result                                         |
| `RunResumeSessionManagerOptions`  | Options for `RunResumeSessionManager`                                        |
| `RunSessionStatus`                | Status of a resumable run session                                            |
| `SubmitResumeValueOutcome`        | Result of submitting an accepted or duplicate resume value                   |
| `WaitForHumanInputOptions`        | Options for `waitForHumanInput()`                                            |
| `ChatHandlerBeforeStream`         | Hook signature for `createChatHandler` customization before streaming.       |
| `ChatHandlerBeforeStreamContext`  | Input passed to `beforeStream` hook.                                         |
| `ChatHandlerBeforeStreamResult`   | Message/context mutations returned from `beforeStream`.                      |
| `ChatHandlerMessageInput`         | Message shape for `prepend`/`append`/`replaceMessages` in `beforeStream`.    |
| `ChatHandlerOptions`              | Options for `createChatHandler` — customize context and pre-stream behavior. |
| `EdgeConfig`                      | Agent-to-agent edge config                                                   |
| `Memory`                          | Memory interface                                                             |
| `MemoryConfig`                    | Memory creation config                                                       |
| `MemoryPersistence`               | Memory storage backend                                                       |
| `MemoryStats`                     | Memory usage stats                                                           |
| `Message`                         | Chat message (user, assistant, system, tool)                                 |
| `MessagePart`                     | Multi-part message segment                                                   |
| `ModelTransportRequest`           | Request-aware model transport hook input                                     |
| `ModelTransportResolver`          | Hook that resolves request-aware model runtime/transport behavior            |
| `ModelProvider`                   | Model provider interface                                                     |
| `ModelString`                     | Model configuration string format: "provider/model-name"                     |
| `RemoteToolSource`                | Runtime-discovered remote tool source                                        |
| `RedisClient`                     | Redis client interface (compatible with ioredis and node-redis)              |
| `RedisMemoryConfig`               | Redis memory configuration                                                   |
| `ResolvedModelTransport`          | Request-aware model runtime / headers / providerOptions resolution           |
| `ResolvedRuntimeState`            | Step-boundary system/context refresh result                                  |
| `RuntimeStateRequest`             | Step-boundary runtime refresh hook input                                     |
| `RuntimeStateResolver`            | Hook that refreshes system/context state during long-lived runs              |
| `StreamToolCall`                  | Streaming tool call                                                          |
| `ToolCall`                        | Completed tool call                                                          |
| `ToolCallPart`                    | Tool call message segment                                                    |
| `ToolCallPartWithArgs`            | Tool call with parsed args                                                   |
| `ToolCallPartWithInput`           | Tool call with raw input                                                     |
| `ToolResultPart`                  | Tool execution result segment                                                |
| `WorkflowConfig`                  | `createWorkflow` config                                                      |
| `WorkflowResult`                  | Completed workflow result                                                    |
| `WorkflowStep`                    | Workflow step definition                                                     |

## Related

- [`veryfront/chat`](./chat.md) — Client-side chat UI for agents
- [`veryfront/tool`](./tool.md) — Define tools for agents
- [`veryfront/provider`](./provider.md) — Configure AI model providers
- [`veryfront/workflow`](./workflow.md) — Orchestrate multi-agent workflows
