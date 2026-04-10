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
  AgUiRuntimeRequestSchema,
  createAgUiHandler,
  createMemory,
  getAgentsAsTools,
  registerAgent,
  RunResumeSessionManager,
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
| `skills?`        | `true \| string[]`                                                                   | Enable skills for this agent.                                       |

**Returns:** `Agent`

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

- validates the AG-UI runtime request body
- clears server memory before each run
- converts the package data-stream output into AG-UI SSE events
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

Current limitation:

- injected client tools in `tools` are rejected with `501` until the package
  exposes generic wait/resume primitives for them

| Property           | Type                                                                                                                                                           | Description                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `agentIdOrConfig`  | `string \| { agent: Agent, context?: ... }`                                                                                                                    | Agent registry id or direct agent instance          |
| `options?.context` | <code>Record&lt;string, unknown&gt; &#124; ((request: Request) =&gt; Record&lt;string, unknown&gt; &#124; Promise&lt;Record&lt;string, unknown&gt;&gt;)</code> | Extra context merged into the AG-UI runtime context |

### `AgUiRequestSchema`

Validate AG-UI runtime requests for `createAgUiHandler()`.

### `AgUiRuntimeRequestSchema`

Validate the canonical open-source AG-UI runtime request contract for hosted
agent execution. This is the package-facing schema downstream runtimes should
target; the older internal compatibility route remains a wrapper around this
contract.

### `RunResumeSessionManager`

Coordinate resumable waits for hosted agent runs without depending on any
product-specific control plane.

Use this when a host runtime needs to start a resumable run-local session,
pause on an external signal, and later submit a resume value for that run.

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

| Name                | Description                                   |
| ------------------- | --------------------------------------------- |
| `agent`             | Create an agent                               |
| `agentAsTool`       | Wrap agent as callable tool                   |
| `createAgUiHandler` | Create a POST handler for an AG-UI route      |
| `createChatHandler` | Create a POST handler for a chat API route.   |
| `createMemory`      | Create memory (buffer, conversation, summary) |
| `createRedisMemory` | Create Redis-backed memory                    |
| `createWorkflow`    | Create sequential agent workflow              |
| `getAgent`          | Get agent by ID                               |
| `getAgentsAsTools`  | Get agents as tools (multi-agent)             |
| `getAllAgentIds`    | List registered agent IDs                     |
| `getTextFromParts`  | Extract text from multi-part message          |
| `getToolArguments`  | Extract parsed tool call args                 |
| `hasArgs`           | Check for parsed args on tool call            |
| `hasInput`          | Check for raw input on tool call              |
| `registerAgent`     | Register agent for discovery                  |

### Classes

| Name                      | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `AgentRuntime`            | Agent execution runtime                           |
| `BufferMemory`            | In-memory message buffer                          |
| `ConversationMemory`      | Full conversation history                         |
| `RedisMemory`             | Redis-backed persistent memory                    |
| `RunResumeSessionManager` | Generic wait/resume manager for hosted agent runs |
| `SummaryMemory`           | Compresses old messages into summaries            |

### Schemas

| Name                       | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `AgUiRequestSchema`        | Convenience request schema for `createAgUiHandler()`                 |
| `AgUiRuntimeRequestSchema` | Canonical open-source AG-UI runtime request contract for hosted runs |

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
| `AgUiInjectedTool`               | AG-UI client-injected tool descriptor                                        |
| `AgUiRequest`                    | Validated AG-UI runtime request body                                         |
| `RunResumeSessionManagerOptions` | Options for `RunResumeSessionManager`                                        |
| `RunSessionStatus`               | Status of a resumable run session                                            |
| `SubmitResumeValueOutcome`       | Result of submitting an accepted or duplicate resume value                   |
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
| `ModelProvider`                  | Model provider interface                                                     |
| `ModelString`                    | Model configuration string format: "provider/model-name"                     |
| `RemoteToolSource`               | Runtime-discovered remote tool source                                        |
| `RedisClient`                    | Redis client interface (compatible with ioredis and node-redis)              |
| `RedisMemoryConfig`              | Redis memory configuration                                                   |
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
