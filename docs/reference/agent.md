---
title: "veryfront/agent"
description: "AI agents with memory, tools, and multi-agent composition."
order: 9
---

# veryfront/agent

AI agents with memory, tools, and multi-agent composition.

## Import

```ts
import {
  agent,
  agentAsTool,
  AgentRuntime,
  AgUiRequestSchema,
  AgUiResumeSignalSchema,
  AgUiRuntimeRequestSchema,
  createAgUiCancelHandler,
  createAgUiHandler,
  createAgUiResumeHandler,
  createMemory,
  getAgentsAsTools,
  HumanInputRequestSchema,
  registerAgent,
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

### Human input over hosted AG-UI runs

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

| Property         | Type                                                                                 | Description                                                         |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `id?`            | `string`                                                                             | Unique identifier (auto-generated if omitted)                       |
| `model?`         | `ModelString`                                                                        | Provider/model override. Omit or use `"auto"` for runtime defaults. |
| `system`         | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code> | System prompt — string, function, or async function                 |
| `tools?`         | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code>                   | Tools available to the agent                                        |
| `remoteTools?`   | `RemoteToolSource[]`                                                                 | Remote tool sources queried per request (for example remote MCP)    |
| `maxSteps?`      | `number`                                                                             | Max tool-call iterations per request                                |
| `streaming?`     | `boolean`                                                                            | Enable streaming responses                                          |
| `memory?`        | `MemoryConfig`                                                                       | Conversation memory settings                                        |
| `middleware?`    | `AgentMiddleware[]`                                                                  | Execution middleware pipeline                                       |
| `edge?`          | `EdgeConfig`                                                                         | Edge runtime configuration                                          |
| `multimodal?`    | <code>&#123; vision?: boolean; audio?: boolean &#125;</code>                         | Enable vision and/or audio                                          |
| `allowedModels?` | `ModelString[]`                                                                      | Restrict runtime model overrides to these "provider/model" strings. |
| `resolveModelTransport?` | <code>(request: ModelTransportRequest) =&gt; ResolvedModelTransport &#124; Promise&lt;ResolvedModelTransport&gt;</code> | Inject request-aware model runtime, headers, or provider options. |
| `skills?`        | `true \| string[]`                                                                   | Enable skills for this agent.                                       |

**Returns:** `Agent`

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

### `AgUiRuntimeRequestSchema`

Validate the canonical open-source AG-UI runtime request contract for hosted
agent execution. This is the package-facing schema downstream runtimes should
target; the older internal compatibility route remains a wrapper around this
contract.

### `AgUiResumeSignalSchema`

Validate the canonical hosted-run resume payload for AG-UI tool-result
continuations.

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

| Name                      | Description                                                             |
| ------------------------- | ----------------------------------------------------------------------- |
| `agent`                   | Create an agent                                                         |
| `agentAsTool`             | Wrap agent as callable tool                                             |
| `createAgUiCancelHandler` | Create a DELETE handler for hosted AG-UI run cancellation               |
| `createAgUiHandler`       | Create a POST handler for an AG-UI route                                |
| `createAgUiResumeHandler` | Create a POST handler for hosted AG-UI run resume values                |
| `createChatHandler`       | Create a POST handler for a chat API route.                             |
| `createMemory`            | Create memory (buffer, conversation, summary)                           |
| `createRedisMemory`       | Create Redis-backed memory                                              |
| `createWorkflow`          | Create sequential agent workflow                                        |
| `getAgent`                | Get agent by ID                                                         |
| `getAgentsAsTools`        | Get agents as tools (multi-agent)                                       |
| `getAllAgentIds`          | List registered agent IDs                                               |
| `getTextFromParts`        | Extract text from multi-part message                                    |
| `getToolArguments`        | Extract parsed tool call args                                           |
| `hasArgs`                 | Check for parsed args on tool call                                      |
| `hasInput`                | Check for raw input on tool call                                        |
| `registerAgent`           | Register agent for discovery                                            |
| `waitForHumanInput`       | Wait for a canonical human-input response over hosted AG-UI run control |

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
| `AgUiRequestSchema`              | Convenience request schema for `createAgUiHandler()`                   |
| `AgUiRuntimeRequestSchema`       | Canonical open-source AG-UI runtime request contract for hosted runs   |
| `AgUiResumeSignalSchema`         | Canonical hosted-run resume payload for AG-UI tool-result continuation |
| `HumanInputFieldSchema`          | Canonical human-input field schema                                     |
| `HumanInputOptionSchema`         | Canonical human-input option schema                                    |
| `HumanInputPendingRequestSchema` | Canonical pending human-input request envelope for hosts               |
| `HumanInputRequestSchema`        | Canonical human-input request payload                                  |
| `HumanInputResultSchema`         | Canonical human-input resumed result payload                           |

### Types

| Name                             | Description                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `Agent`                          | `agent()` return type                                                        |
| `AgentConfig`                    | Agent configuration                                                          |
| `AgentContext`                   | Agent handler context                                                        |
| `AgentMiddleware`                | Agent execution middleware                                                   |
| `AgentResponse`                  | Agent execution response                                                     |
| `AgentStatus`                    | Agent status (idle, running, etc.)                                           |
| `AgentStreamResult`              | Streaming result (`.toDataStreamResponse()`)                                 |
| `AgUiContextItem`                | AG-UI runtime context item                                                   |
| `AgUiHandlerConfigWithAgent`     | Direct-agent form for `createAgUiHandler`                                    |
| `AgUiHandlerOptions`             | Options for `createAgUiHandler`                                              |
| `AgUiCancelHandlerOptions`       | Options for `createAgUiCancelHandler`                                        |
| `AgUiInjectedTool`               | AG-UI client-injected tool descriptor                                        |
| `AgUiRequest`                    | Validated AG-UI runtime request body                                         |
| `AgUiResumeHandlerOptions`       | Options for `createAgUiResumeHandler`                                        |
| `AgUiResumeSignal`               | Validated hosted-run resume payload                                          |
| `HumanInputField`                | Canonical form/input field definition                                        |
| `HumanInputFieldInput`           | Input shape accepted by `waitForHumanInput()` before defaults normalize      |
| `HumanInputOption`               | Canonical select/radio option definition                                     |
| `HumanInputPendingRequest`       | Pending human-input envelope passed to `onRequest`                           |
| `HumanInputRequest`              | Normalized human-input request payload                                       |
| `HumanInputRequestInput`         | Input shape accepted by `HumanInputRequestSchema`                            |
| `HumanInputResult`               | Validated human-input resumed result                                         |
| `RunResumeSessionManagerOptions` | Options for `RunResumeSessionManager`                                        |
| `RunSessionStatus`               | Status of a resumable run session                                            |
| `SubmitResumeValueOutcome`       | Result of submitting an accepted or duplicate resume value                   |
| `WaitForHumanInputOptions`       | Options for `waitForHumanInput()`                                            |
| `ChatHandlerBeforeStream`        | Hook signature for `createChatHandler` customization before streaming.       |
| `ChatHandlerBeforeStreamContext` | Input passed to `beforeStream` hook.                                         |
| `ChatHandlerBeforeStreamResult`  | Message/context mutations returned from `beforeStream`.                      |
| `ChatHandlerMessageInput`        | Message shape for `prepend`/`append`/`replaceMessages` in `beforeStream`.    |
| `ChatHandlerOptions`             | Options for `createChatHandler` — customize context and pre-stream behavior. |
| `EdgeConfig`                     | Agent-to-agent edge config                                                   |
| `Memory`                         | Memory interface                                                             |
| `MemoryConfig`                   | Memory creation config                                                       |
| `MemoryPersistence`              | Memory storage backend                                                       |
| `MemoryStats`                    | Memory usage stats                                                           |
| `Message`                        | Chat message (user, assistant, system, tool)                                 |
| `MessagePart`                    | Multi-part message segment                                                   |
| `ModelTransportRequest`          | Request-aware model transport hook input                                     |
| `ModelTransportResolver`         | Hook that resolves request-aware model runtime/transport behavior            |
| `ModelProvider`                  | Model provider interface                                                     |
| `ModelString`                    | Model configuration string format: "provider/model-name"                     |
| `RemoteToolSource`               | Runtime-discovered remote tool source                                        |
| `RedisClient`                    | Redis client interface (compatible with ioredis and node-redis)              |
| `RedisMemoryConfig`              | Redis memory configuration                                                   |
| `ResolvedModelTransport`         | Request-aware model runtime / headers / providerOptions resolution           |
| `StreamToolCall`                 | Streaming tool call                                                          |
| `ToolCall`                       | Completed tool call                                                          |
| `ToolCallPart`                   | Tool call message segment                                                    |
| `ToolCallPartWithArgs`           | Tool call with parsed args                                                   |
| `ToolCallPartWithInput`          | Tool call with raw input                                                     |
| `ToolResultPart`                 | Tool execution result segment                                                |
| `WorkflowConfig`                 | `createWorkflow` config                                                      |
| `WorkflowResult`                 | Completed workflow result                                                    |
| `WorkflowStep`                   | Workflow step definition                                                     |

## Related

- [`veryfront/chat`](./chat.md) — Client-side chat UI for agents
- [`veryfront/tool`](./tool.md) — Define tools for agents
- [`veryfront/provider`](./provider.md) — Configure AI model providers
- [`veryfront/workflow`](./workflow.md) — Orchestrate multi-agent workflows
