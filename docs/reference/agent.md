---
title: "veryfront/agent"
description: "AI agents with memory, tools, handlers, and composition."
order: 9
---

# veryfront/agent

Use `veryfront/agent` to define agents, attach tools and memory, run complete or
streaming responses, mount chat handlers, and compose agents as tools.

This page covers the core module surface and full export list. Focused runtime
and host-integration details live in the related reference pages.

## Import

```ts
import {
  agent,
  agentAsTool,
  createChatHandler,
  createMemory,
  getAgentsAsTools,
  registerAgent,
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

### Agent with local tools and memory

```ts
import { agent } from "veryfront/agent";
import { defineSchema, lazySchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

const getSearchInput = defineSchema((v) => v.object({ query: v.string() }));

const searchTool = tool({
  id: "search",
  description: "Search the knowledge base",
  inputSchema: lazySchema(getSearchInput),
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
  headers: { Authorization: "Bearer <TOKEN>" },
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
  skills: ["incident-response", "repo-maintainer"],
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

Create an agent.

When `model` is omitted, Veryfront defaults to the runtime convention: local
inference by default, automatically upgrading to an available cloud provider
when bootstrap credentials are present.

| Property                 | Type                                                                                                                                                | Description                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `id?`                    | `string`                                                                                                                                            | Unique identifier, auto-generated if omitted.                                        |
| `name?`                  | `string`                                                                                                                                            | Human-readable display name for listings.                                            |
| `description?`           | `string`                                                                                                                                            | Optional summary for listings.                                                       |
| `model?`                 | `ModelString`                                                                                                                                       | Provider/model override. Omit or use `"auto"` for runtime defaults.                  |
| `system`                 | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code>                                                                | System prompt as a string, function, or async function.                              |
| `tools?`                 | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code>                                                                                  | Tools available to the agent.                                                        |
| `remoteTools?`           | `RemoteToolSource[]`                                                                                                                                | Remote tool sources queried per request, such as remote MCP.                         |
| `allowedRemoteTools?`    | `string[]`                                                                                                                                          | Restrict `remoteTools` exposure and execution to these tool names.                   |
| `maxSteps?`              | `number`                                                                                                                                            | Max tool-call iterations per request.                                                |
| `streaming?`             | `boolean`                                                                                                                                           | Enable streaming responses.                                                          |
| `memory?`                | `MemoryConfig`                                                                                                                                      | Conversation memory settings.                                                        |
| `middleware?`            | `AgentMiddleware[]`                                                                                                                                 | Execution middleware pipeline.                                                       |
| `edge?`                  | `EdgeConfig`                                                                                                                                        | Edge runtime configuration.                                                          |
| `multimodal?`            | <code>&#123; vision?: boolean; audio?: boolean &#125;</code>                                                                                        | Enable vision and/or audio.                                                          |
| `allowedModels?`         | `ModelString[]`                                                                                                                                     | Restrict runtime model overrides to these provider/model strings.                    |
| `resolveModelTransport?` | <code>(request: ModelTransportRequest) =&gt; ResolvedModelTransport &#124; Promise&lt;ResolvedModelTransport&gt;</code>                             | Inject request-aware model runtime, headers, or provider options.                    |
| `resolveRuntimeState?`   | <code>(request: RuntimeStateRequest) =&gt; ResolvedRuntimeState &#124; Promise&lt;ResolvedRuntimeState &#124; undefined&gt; &#124; undefined</code> | Refresh the current system prompt and host-owned runtime context at step boundaries. |
| `skills?`                | `true \| string[]`                                                                                                                                  | Enable skills for this agent.                                                        |

**Returns:** `Agent`

### `agent.generate(input)`

Run the agent and return a complete response. Accepts a string or message array
as input.

| Property   | Type                                       | Description                                                                                    |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `input`    | `string \| Message[]`                      | Prompt string or message history.                                                              |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent.                                                        |
| `model?`   | `ModelString`                              | Override the agent's default model for this request. Must be in `allowedModels` if configured. |

**Returns:** <code>Promise&lt;AgentResponse&gt;</code>

### `agent.stream(input)`

Run the agent and stream the response. Returns a result with
`.toDataStreamResponse()` for API routes.

| Property      | Type                                         | Description                                                                                    |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `input?`      | `string`                                     | Prompt string.                                                                                 |
| `messages?`   | `Message[]`                                  | Conversation message history.                                                                  |
| `context?`    | <code>Record&lt;string, unknown&gt;</code>   | Additional context passed to the agent.                                                        |
| `model?`      | `ModelString`                                | Override the agent's default model for this request. Must be in `allowedModels` if configured. |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback fired when a tool is invoked.                                                         |
| `onChunk?`    | <code>(chunk: string) =&gt; void</code>      | Callback fired for each text chunk.                                                            |

**Returns:** <code>Promise&lt;AgentStreamResult&gt;</code>

### `agent.respond(request)`

Handle an incoming HTTP request and return a streaming `Response`. Reads
messages from the request body.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `createChatHandler(agentId, options?)`

Create a POST chat route handler with request validation, UI-message
normalization, server-memory reset, and `NO_AI_AVAILABLE` fallback handling.

| Property                | Type                                                                                                                                                           | Description                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId`               | `string`                                                                                                                                                       | Registered agent ID.                                                                                                                                           |
| `options?.context`      | <code>Record&lt;string, unknown&gt; &#124; ((request: Request) =&gt; Record&lt;string, unknown&gt; &#124; Promise&lt;Record&lt;string, unknown&gt;&gt;)</code> | Context passed to `agent.stream()`.                                                                                                                            |
| `options?.beforeStream` | <code>(input) =&gt; void &#124; Response &#124; ChatHandlerBeforeStreamResult &#124; Promise&lt;...&gt;</code>                                                 | Hook that runs after validation and before `agent.stream()`. Can prepend, append, replace messages, override context, or return a `Response` to short-circuit. |

`beforeStream` input includes the original `request`, normalized `messages`,
resolved `context`, and `lastUserText` extracted from the last user message.

### Memory methods

| Method                   | Use                                                                            |
| ------------------------ | ------------------------------------------------------------------------------ |
| `agent.getMemory()`      | Get the agent's memory instance.                                               |
| `agent.getMemoryStats()` | Get memory usage statistics: message count, estimated tokens, and memory type. |
| `agent.clearMemory()`    | Clear all stored messages from memory.                                         |

### Registry and composition

| Export               | Use                                                   |
| -------------------- | ----------------------------------------------------- |
| `registerAgent()`    | Register an agent for discovery and lookup.           |
| `getAgent()`         | Get a registered agent by id.                         |
| `getAllAgentIds()`   | List registered agent ids.                            |
| `agentAsTool()`      | Wrap one agent as a callable tool.                    |
| `getAgentsAsTools()` | Convert registered agents into tools for composition. |

## Focused references

- [`Agent runtime AG-UI`](./agent-runtime-ag-ui.md) covers AG-UI request shapes, browser stream encoding, injected client tools, run control, and human input waits.
- [`Agent hosted lifecycle`](./agent-hosted-lifecycle.md) covers durable hosted run lifecycle helpers and child-run sequencing.
- [`Agent service runtime`](./agent-service-runtime.md) covers separately deployed agent services, Veryfront Cloud bootstrap, registration, discovery, and telemetry.
- [`Agent tooling and runtime state`](./agent-tooling.md) covers remote tool allowlists, provider-native tool discovery, request-aware model transport, and step-boundary runtime refresh.
- [`Conversation-backed agent hosts`](./agent-conversation-control-plane.md) covers control-plane conversation host composition.

## Exports

### Functions

| Name                                                                  | Description                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `agent`                                                               | Create an agent                                                          |
| `agentAsTool`                                                         | Wrap agent as callable tool                                              |
| `createAgUiCancelHandler`                                             | Create a DELETE handler for hosted AG-UI run cancellation                |
| `createAgUiDetachedStartHandler`                                      | Create a POST handler for detached hosted AG-UI run kickoff              |
| `executeAgUiDetachedStart`                                            | Run detached hosted-start lifecycle from a validated request object      |
| `createAgUiHandler`                                                   | Create a POST handler for an AG-UI route                                 |
| `createAgUiRuntimeHandler`                                            | Create a POST handler for the canonical runtime AG-UI request contract   |
| `createAgUiRunErrorEvent`                                             | Create a `RunError` AG-UI SSE event                                      |
| `createAgUiSseErrorResponse`                                          | Create an AG-UI SSE error `Response`                                     |
| `createAgUiResumeHandler`                                             | Create a POST handler for hosted AG-UI run resume values                 |
| `createAgentServiceRegistrationLifecycle`                             | Register and heartbeat a push runtime service with the control plane     |
| `createAgentServiceRuntime`                                           | Create an agent service runtime with default service routes              |
| `createAgentServiceRouteSet`                                          | Create default agent-service route handlers                              |
| `createDefaultAgentServiceProjectSteeringRefresh`                     | Create the default agent-service project steering refresh callback       |
| `createAgentServiceProjectSteering`                                   | Create agent-service agent-definition and project-steering bindings      |
| `createAgentServiceAuth`                                              | Create request auth and project-access checks for an agent service       |
| `buildVeryfrontCloudRuntimeInstructions`                              | Adapt agent-service preparation input to Veryfront Cloud system messages |
| `createVeryfrontCloudAgentServiceChatExecutionRootRunOptions`         | Create Veryfront Cloud agent-service root-run preparation defaults       |
| `createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions` | Create Veryfront Cloud prepared execution runtime defaults               |
| `createVeryfrontCloudRuntimeSystemMessages`                           | Create Veryfront Cloud runtime system messages                           |
| `fetchDefaultAgentServiceProjectSteering`                             | Fetch initial agent-service project instructions and skills              |
| `deriveAgentServiceAgUiChatContext`                                   | Derive chat context from canonical AG-UI runtime input                   |
| `filterAgentTraceAttributes`                                          | Filter unknown records to valid agent trace attributes                   |
| `createNodeAgentServiceRuntimeInfrastructure`                         | Create Node service config, logger, tracer, and telemetry bundle         |
| `createNodeVeryfrontCloudAgentServiceRuntime`                         | Create a full Veryfront Cloud agent-service runtime bundle               |
| `loadAgentServiceEnvFiles`                                            | Load service env files while preserving host process env                 |
| `initializeNodeAgentServiceOpenTelemetry`                             | Initialize Node OpenTelemetry for an agent service                       |
| `parseAgentServiceChatRequestFromRequest`                             | Parse the agent-service chat request body and auth context               |
| `loadRuntimeAgentMarkdownDefinitionFromFile`                          | Load and parse a markdown agent definition from an agents directory      |
| `createRuntimeAgentFromMarkdownDefinition`                            | Convert a markdown agent definition into a runtime agent                 |
| `discoverProjectAgentRuntime`                                         | Discover project agents and primitives for runtime hosts                 |
| `getProjectAgentRuntimeAgentIdCandidates`                             | Split discovered runtime agents into code and markdown candidates        |
| `resolveSingleProjectAgentRuntimeAgentId`                             | Resolve the single default runtime agent for a source policy             |
| `parseAgentServiceConfig`                                             | Parse default agent service environment config                           |
| `resolveAgentServiceRegistrationInput`                                | Resolve push runtime registration input from service config              |
| `resolveNodeAgentServiceTelemetryConfig`                              | Resolve Node service OpenTelemetry config from environment               |
| `prepareVeryfrontCloudAgentServiceChatExecution`                      | Prepare agent-service chat execution with Veryfront Cloud defaults       |
| `normalizeAgUiRuntimeMessages`                                        | Normalize runtime AG-UI messages into package `Message[]`                |
| `parseAgUiRuntimeRequest`                                             | Parse and validate the canonical runtime AG-UI request body              |
| `parseAgUiRuntimeRequestOrError`                                      | Parse runtime AG-UI input or return a `400` validation `Response`        |
| `parseRuntimeAgentRunInvocation`                                      | Parse and validate a control-plane runtime agent invocation body         |
| `startAgentService`                                                   | Run the default cross-runtime bootstrap for a Veryfront Cloud service    |
| `startNodeAgentService`                                               | Start an agent service with the Node service server adapter              |
| `startNodeVeryfrontCloudAgentService`                                 | Start a Veryfront Cloud agent service with the Node server adapter       |
| `parseRuntimeAgentRunInvocationOrError`                               | Parse a runtime agent invocation or return a `400` validation `Response` |
| `resolveRuntimeAgentDefinitionsDir`                                   | Resolve a hosted service `agents/` directory from source/bundled paths   |
| `createChatHandler`                                                   | Create a POST handler for a chat API route.                              |
| `createMemory`                                                        | Create memory (buffer, conversation, summary)                            |
| `createRedisMemory`                                                   | Create Redis-backed memory                                               |
| `createWorkflow`                                                      | Create sequential agent workflow                                         |
| `getAgent`                                                            | Get agent by ID                                                          |
| `getAgentsAsTools`                                                    | Get agents as tools (multi-agent)                                        |
| `getAllAgentIds`                                                      | List registered agent IDs                                                |
| `getTextFromParts`                                                    | Extract text from multi-part message                                     |
| `getToolArguments`                                                    | Extract parsed tool call args                                            |
| `hasArgs`                                                             | Check for parsed args on tool call                                       |
| `hasInput`                                                            | Check for raw input on tool call                                         |
| `registerAgent`                                                       | Register agent for discovery                                             |
| `waitForHumanInput`                                                   | Wait for a canonical human-input response over hosted AG-UI run control  |

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

| Name                                | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `AgUiDetachedStartRequestSchema`    | Canonical detached hosted-run kickoff request schema                   |
| `AgUiRequestSchema`                 | Convenience request schema for `createAgUiHandler()`                   |
| `AgUiRuntimeRequestSchema`          | Canonical open-source AG-UI runtime request contract for hosted runs   |
| `AgUiResumeSignalSchema`            | Canonical hosted-run resume payload for AG-UI tool-result continuation |
| `HumanInputFieldSchema`             | Canonical human-input field schema                                     |
| `HumanInputOptionSchema`            | Canonical human-input option schema                                    |
| `HumanInputPendingRequestSchema`    | Canonical pending human-input request envelope for hosts               |
| `HumanInputRequestSchema`           | Canonical human-input request payload                                  |
| `HumanInputResultSchema`            | Canonical human-input resumed result payload                           |
| `RuntimeAgentContextItemSchema`     | Control-plane runtime agent invocation context item schema             |
| `RuntimeAgentIdSchema`              | Control-plane runtime agent id schema                                  |
| `RuntimeAgentProjectContextSchema`  | Control-plane runtime agent project and target context schema          |
| `RuntimeAgentRunContextSchema`      | Control-plane runtime agent run identity and lineage context schema    |
| `RuntimeAgentRunIdSchema`           | Control-plane runtime agent run id schema                              |
| `RuntimeAgentRunInvocationSchema`   | Control-plane runtime agent invocation wrapper schema                  |
| `RuntimeAgentServiceIdSchema`       | Control-plane runtime agent service id schema                          |
| `RuntimeAgentSourceContextSchema`   | Control-plane runtime agent source context schema                      |
| `RuntimeAgentTargetKindSchema`      | Control-plane runtime target kind schema                               |
| `RuntimeAgentToolCallIdSchema`      | Control-plane runtime tool call id schema                              |
| `RuntimeAgentToolNameSchema`        | Control-plane runtime tool name schema                                 |
| `RuntimeAgentToolSchema`            | Control-plane runtime tool descriptor schema                           |
| `RuntimeAgentValidatedClaimsSchema` | Control-plane runtime validated claims schema                          |

### Types

| Name                                       | Description                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `AgUiDetachedStartAccepted`                | Accepted response shape for detached hosted AG-UI kickoff                                                                     |
| `AgUiDetachedStartHandlerOptions`          | Options for `createAgUiDetachedStartHandler`                                                                                  |
| `AgUiDetachedStartRequest`                 | Validated detached hosted AG-UI kickoff request                                                                               |
| `ExecuteAgUiDetachedStartInput`            | Input shape for `executeAgUiDetachedStart`                                                                                    |
| `Agent`                                    | `agent()` return type                                                                                                         |
| `AgentConfig`                              | Agent configuration                                                                                                           |
| `AgentContext`                             | Agent handler context                                                                                                         |
| `AgentMiddleware`                          | Agent execution middleware                                                                                                    |
| `AgentResponse`                            | Agent execution response                                                                                                      |
| `AgentStatus`                              | Agent status (idle, running, etc.)                                                                                            |
| `AgentStreamResult`                        | Streaming result (`.toDataStreamResponse()`)                                                                                  |
| `AgUiContextItem`                          | AG-UI runtime context item                                                                                                    |
| `AgUiHandlerConfigWithAgent`               | Direct-agent form for `createAgUiHandler`                                                                                     |
| `AgUiHandlerOptions`                       | Options for `createAgUiHandler`                                                                                               |
| `AgUiCancelHandlerOptions`                 | Options for `createAgUiCancelHandler`                                                                                         |
| `AgUiInjectedTool`                         | AG-UI client-injected tool descriptor                                                                                         |
| `AgUiRequest`                              | Validated AG-UI runtime request body                                                                                          |
| `AgUiSseEvent`                             | AG-UI SSE event object used by host-facing AG-UI helpers                                                                      |
| `AgUiResumeHandlerOptions`                 | Options for `createAgUiResumeHandler`                                                                                         |
| `AgUiResumeSignal`                         | Validated hosted-run resume payload                                                                                           |
| `HumanInputField`                          | Canonical form/input field definition                                                                                         |
| `HumanInputFieldInput`                     | Input shape accepted by `waitForHumanInput()` before defaults normalize                                                       |
| `HumanInputOption`                         | Canonical select/radio option definition                                                                                      |
| `HumanInputPendingRequest`                 | Pending human-input envelope passed to `onRequest`                                                                            |
| `HumanInputRequest`                        | Normalized human-input request payload                                                                                        |
| `HumanInputRequestInput`                   | Input shape accepted by `HumanInputRequestSchema`                                                                             |
| `HumanInputResult`                         | Validated human-input resumed result                                                                                          |
| `RunResumeSessionManagerOptions`           | Options for `RunResumeSessionManager`                                                                                         |
| `RunSessionStatus`                         | Status of a resumable run session                                                                                             |
| `SubmitResumeValueOutcome`                 | Result of submitting an accepted or duplicate resume value                                                                    |
| `WaitForHumanInputOptions`                 | Options for `waitForHumanInput()`                                                                                             |
| `ChatHandlerBeforeStream`                  | Hook signature for `createChatHandler` customization before streaming.                                                        |
| `ChatHandlerBeforeStreamContext`           | Input passed to `beforeStream` hook.                                                                                          |
| `ChatHandlerBeforeStreamResult`            | Message/context mutations returned from `beforeStream`.                                                                       |
| `ChatHandlerMessageInput`                  | Message shape for `prepend`/`append`/`replaceMessages` in `beforeStream`.                                                     |
| `ChatHandlerOptions`                       | Options for `createChatHandler`: customize context and pre-stream behavior.                                                   |
| `BuildChatStreamChunkMessageMetadataInput` | Input for building canonical hosted chunk metadata from streamed finish parts.                                                |
| `ChatMessageMetadata`                      | Canonical hosted message metadata shape for streamed assistant messages.                                                      |
| `ChatMessageMetadataUsage`                 | Usage counters nested under `ChatMessageMetadata.usage`.                                                                      |
| `EdgeConfig`                               | Agent-to-agent edge config                                                                                                    |
| `Memory`                                   | Memory interface                                                                                                              |
| `MemoryConfig`                             | Memory creation config                                                                                                        |
| `MemoryPersistence`                        | Memory storage backend                                                                                                        |
| `MemoryStats`                              | Memory usage stats                                                                                                            |
| `Message`                                  | Chat message (user, assistant, system, tool)                                                                                  |
| `MessagePart`                              | Multi-part message segment                                                                                                    |
| `ModelTransportRequest`                    | Request-aware model transport hook input                                                                                      |
| `ModelTransportResolver`                   | Hook that resolves request-aware model runtime/transport behavior                                                             |
| `ModelProvider`                            | Model provider interface                                                                                                      |
| `ModelString`                              | Model configuration string format: "provider/model-name"                                                                      |
| `RemoteToolSource`                         | Runtime-discovered remote tool source                                                                                         |
| `RedisClient`                              | Redis client interface (compatible with ioredis and node-redis)                                                               |
| `RedisMemoryConfig`                        | Redis memory configuration                                                                                                    |
| `ResolvedModelTransport`                   | Request-aware model runtime / headers / providerOptions resolution                                                            |
| `ResolvedRuntimeState`                     | Step-boundary system/context refresh result                                                                                   |
| `RuntimeStateRequest`                      | Step-boundary runtime refresh hook input                                                                                      |
| `RuntimeStateResolver`                     | Hook that refreshes system/context state during long-lived runs                                                               |
| `RuntimeAgentContextItem`                  | Validated control-plane runtime agent invocation context item                                                                 |
| `RuntimeAgentProjectContext`               | Validated control-plane runtime agent project and target context                                                              |
| `RuntimeAgentRunContext`                   | Validated control-plane runtime agent run identity and lineage context                                                        |
| `RuntimeAgentRunInvocation`                | Validated control-plane runtime agent invocation wrapper                                                                      |
| `RuntimeAgentSourceContext`                | Validated control-plane runtime agent source context                                                                          |
| `RuntimeAgentTargetKind`                   | Runtime target kind for a control-plane runtime agent invocation                                                              |
| `RuntimeAgentTool`                         | Validated control-plane runtime agent tool descriptor                                                                         |
| `RuntimeAgentValidatedClaims`              | Validated claims attached to a control-plane runtime agent invocation                                                         |
| `StreamToolCall`                           | Streaming tool call                                                                                                           |
| `ToolCall`                                 | Completed tool call                                                                                                           |
| `ToolCallPart`                             | Tool call message segment                                                                                                     |
| `ToolCallPartWithArgs`                     | Tool call with parsed args                                                                                                    |
| `ToolCallPartWithInput`                    | Tool call with raw input                                                                                                      |
| `ToolResultPart`                           | Tool execution result segment                                                                                                 |
| `ChatUiMessageChunk`                       | Canonical hosted UI-stream chunk union for message lifecycle, text, reasoning, tool, file, source, approval, and data events. |
| `ChildRunAudit`                            | Child-run audit summary nested inside hosted message metadata.                                                                |
| `ChildRunAuditToolCall`                    | Child-run audit tool-call entry.                                                                                              |
| `ChildRunAuditToolResult`                  | Child-run audit tool-result entry.                                                                                            |
| `WorkflowConfig`                           | `createWorkflow` config                                                                                                       |
| `WorkflowResult`                           | Completed workflow result                                                                                                     |
| `WorkflowStep`                             | Workflow step definition                                                                                                      |

## Related

- [`Agent runtime AG-UI`](./agent-runtime-ag-ui.md), AG-UI request shapes, browser stream encoding, run control, and human input waits.
- [`Agent hosted lifecycle`](./agent-hosted-lifecycle.md), durable hosted run lifecycle helpers and child-run sequencing.
- [`Agent service runtime`](./agent-service-runtime.md), separately deployed agent services.
- [`Agent tooling and runtime state`](./agent-tooling.md), tool allowlists, provider-native tool discovery, and runtime state hooks.
- [`Conversation-backed agent hosts`](./agent-conversation-control-plane.md), control-plane conversation host composition.
- [`veryfront/chat`](./chat.md), client-side chat UI for agents.
- [`veryfront/tool`](./tool.md), tool definitions for agents and MCP.
- [`veryfront/provider`](./provider.md), AI model provider configuration.
- [`veryfront/workflow`](./workflow.md), multi-agent workflows.
