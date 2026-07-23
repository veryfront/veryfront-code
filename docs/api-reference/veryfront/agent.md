---
title: "veryfront/agent"
description: "AI agents with memory, tools, and multi-agent composition."
order: 2
---

## Import

```ts
import {
  agent,
  AgentRuntime,
  registerAgent,
  getAgentsAsTools,
  createMemory,
  addFirstTurnStarterIntentRootOwnershipReminder,
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
import { defineSchema } from "veryfront/schemas";

const searchTool = tool({
  id: "search",
  description: "Search the knowledge base",
  inputSchema: defineSchema((v) =>
    v.object({
      query: v.string().describe("Knowledge base search query"),
    })
  )(),
  execute: async ({ query }) => ({ results: [] }),
});

const assistant = agent({
  system: "You are a helpful assistant.",
  tools: { search: searchTool },
  maxSteps: 5,
  memory: { type: "conversation", maxMessages: 50 },
});
```

### Agent with materialized runtime tools

```ts
import { agent } from "veryfront/agent";
import { createRemoteMCPToolSource, loadRemoteToolsFromSource } from "veryfront/tool";

const docsTools = createRemoteMCPToolSource({
  id: "docs-mcp",
  endpoint: "https://docs.example.com/mcp",
  headers: { Authorization: "Bearer <TOKEN>" },
});

const runtimeTools = await loadRemoteToolsFromSource(docsTools, {
  context: { projectId: "proj_123" },
  toolNameAliases: { search_docs: "docs_search" },
});

const assistant = agent({
  system: "Use the docs tools when the answer needs project documentation.",
  tools: runtimeTools,
  maxSteps: 5,
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
    github__list_issues: true,
  },
});
```

### Streaming API route

```ts
// app/api/ag-ui/route.ts
import { agent, createAgUiHandler } from "veryfront/agent";

const assistant = agent({
  system: "You are a helpful assistant.",
});

export const POST = createAgUiHandler({ agent: assistant });
```

### Multi-agent composition

```ts
import { agent, registerAgent, getAgentsAsTools } from "veryfront/agent";

const researcher = agent({ system: "Research topics thoroughly." });
const writer = agent({ system: "Write clear prose." });

registerAgent(researcher);
registerAgent(writer);

const orchestrator = agent({
  system: "Coordinate research and writing.",
  tools: getAgentsAsTools(["researcher", "writer"]),
  maxSteps: 8,
});
```

## API

### `agent(config)`

Agent helper.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id?` | `string` | Resource identifier. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L146) |
| `name?` | `string` | Human-readable display name for registry and control-plane listings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L148) |
| `avatarUrl?` | `string` | Absolute avatar URL for registry, Studio, and chat identity surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L150) |
| `avatar_url?` | `string` | Deprecated serialized avatar URL retained for compatibility. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L156) |
| `description?` | `string` | Optional summary shown in registry and control-plane listings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L158) |
| `model?` | `ModelString` | Optional model string in "provider/model" format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L166) |
| `system` | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code> | System prompt or a lazy system-prompt resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L168) |
| `tools?` | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code> | Enable registered tools or provide inline tool definitions by name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L170) |
| `sandbox?` | `object` | Optional sandbox selection for runtime-owned sandbox tools such as `bash`. `id` attaches to an existing sandbox session and detaches on run cleanup. When omitted, sandbox tools lazily create a request/project-scoped session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L176) |
| `providerTools?` | `string[]` | Provider-native tools executed by the selected model provider, such as Anthropic `web_search` and `web_fetch`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L186) |
| `mcpServers?` | `AgentMcpServerConfig[]` | Remote MCP servers available to this agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L188) |
| `maxSteps?` | `number` | Maximum number of model and tool-execution steps per invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L190) |
| `temperature?` | `number` | Sampling temperature for model generation. Defaults to 0. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L192) |
| `streaming?` | `boolean` | Whether the agent prefers streaming responses. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L194) |
| `memory?` | <code>MemoryConfig &#124; Memory&lt;Message&gt;</code> | Conversation memory used by `stream()` and `generate()`. Omit it for stateless operation. Provide a built-in configuration to persist history in memory, or provide a `Memory` implementation such as the value returned by `createRedisMemory()` to attach an external store. Set `enabled: false` on a built-in configuration to force stateless behavior explicitly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L202) |
| `middleware?` | `AgentMiddleware[]` | Middleware applied in declaration order around generation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L204) |
| `edge?` | `EdgeConfig` | Edge-runtime limits and streaming settings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L206) |
| `multimodal?` | <code>&#123; vision?: boolean; audio?: boolean &#125;</code> | Multimodal capabilities advertised by the agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L208) |
| `allowedModels?` | `ModelString[]` | Restrict runtime model overrides to these "provider/model" strings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L213) |
| `resolveModelTransport?` | `ModelTransportResolver` | Optional request-aware hook for overriding the resolved model runtime and provider transport options on a per-call basis. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L218) |
| `resolveRuntimeState?` | `RuntimeStateResolver` | Optional step-boundary hook for refreshing the runtime system prompt and host-owned context during a long-lived run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L223) |
| `onToolResult?` | `ToolExecutionResultHandler` | Optional hook invoked after the runtime executes a configured local, registry, integration, or remote tool and before the tool result is persisted or streamed back to callers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L229) |
| `skills?` | `true \| string[]` | Enable skills for this agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L239) |
| `suggestions?` | `Suggestions` | Conversation starters shown by compatible clients. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L241) |
| `security?` | `false` | Set to false to disable the default security middleware | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L243) |

**Returns:** `Agent`

### `agent.generate(input)`

Generate a complete response.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input` | `string \| Message[]` | Prompt string or message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L398) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L399) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L401) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L403) |
| `abortSignal?` | `AbortSignal` | Abort signal for cooperative cancellation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L405) |
| `memoryMode?` | `AgentInvocationMemoryMode` | Memory behavior for this invocation. `configured` uses the agent's configured persistent memory. `isolated` uses only the supplied input and never reads from or writes to shared memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L411) |

**Returns:** <code>Promise&lt;AgentResponse&gt;</code>

### `agent.stream(input)`

Stream a response and optional tool lifecycle callbacks.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input?` | `string` | Prompt string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L416) |
| `messages?` | `Message[]` | Conversation message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L417) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L418) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L420) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L422) |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback fired when a tool is invoked | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L423) |
| `onChunk?` | <code>(chunk: string) =&gt; void</code> | Callback fired for each text chunk | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L424) |
| `onFinish?` | <code>(response: AgentResponse) =&gt; void</code> |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L425) |
| `abortSignal?` | `AbortSignal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L426) |
| `memoryMode?` | `AgentInvocationMemoryMode` | Memory behavior for this invocation. `configured` uses the agent's configured persistent memory. `isolated` uses only the supplied messages and never reads from or writes to shared memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L432) |

**Returns:** <code>Promise&lt;AgentStreamResult&gt;</code>

### `agent.respond(request)`

Convert an HTTP request into an AG-UI streaming response for route handlers.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `agent.getMemory()`

Return the configured memory store.

**Returns:** <code>Memory&lt;Message&gt;</code>

### `agent.getMemoryStats()`

Return current memory usage statistics.

**Returns:** <code>Promise&lt;&#123; totalMessages: number; estimatedTokens: number; type: string &#125;&gt;</code>

### `agent.clearMemory()`

Clears memory.

**Returns:** <code>Promise&lt;void&gt;</code>

## Type Reference

### `MemoryConfig`

Built-in in-memory conversation retention configuration.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `type` | `"conversation" \| "buffer" \| "summary"` | Retention strategy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L19) |
| `maxTokens?` | `number` | Approximate token capacity before older context is trimmed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L21) |
| `maxMessages?` | `number` | Message capacity before older context is trimmed or summarized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L23) |
| `enabled?` | `boolean` | Whether history persists across calls on this agent instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L25) |

### `EdgeConfig`

Edge-execution settings for an agent.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `enabled` | `boolean` | Whether edge execution is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L31) |
| `maxSteps?` | `number` | Maximum model steps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L33) |
| `timeoutMs?` | `number` | Execution timeout in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L35) |
| `streaming?` | `boolean` | Whether responses stream incrementally. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L37) |

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AGENT_CATALOG_ACTIONS` | Canonical agent catalog actions value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L11) |
| `AGENT_CATALOG_KINDS` | Canonical agent catalog kinds value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L2) |
| `AGENT_DELEGATE_TOOL_PREFIX` | Prefix used for the delegate tool exposed to the coordinator agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation-names.ts#L2) |
| `AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE` | Durable event type emitted when runtime context is compacted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/context-budget-manager.ts#L11) |
| `AgUiDetachedStartAcceptedSchema` | Schema for AG-UI detached start accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L129) |
| `AgUiDetachedStartRequestSchema` | Schema for AG-UI detached start request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L123) |
| `AgUiRequestSchema` | Schema for AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L175) |
| `AgUiResumeSignalSchema` | Schema for AG-UI resume signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L45) |
| `AppendConversationRunEventsResponseSchema` | Schema for append conversation run events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L430) |
| `CompleteConversationRunResponseSchema` | Schema for complete conversation run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L361) |
| `CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE` | Shared conversation hosted aborted terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L23) |
| `CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE` | Shared conversation hosted incomplete tool calls terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L25) |
| `CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE` | Shared conversation hosted stream error terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L21) |
| `ConversationMessageRecordSchema` | Schema for conversation message record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L66) |
| `ConversationRecordSchema` | Schema for conversation record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L45) |
| `ConversationRunEventSchema` | Schema for conversation run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L39) |
| `ConversationRunProjectionSchema` | Schema for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L178) |
| `ConversationRunStatusSchema` | Schema for conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L90) |
| `ConversationRunTargetsSchema` | Schema for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L18) |
| `DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS` | Default value for fork response promise timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L85) |
| `DEFAULT_HOSTED_CHILD_AGENT_ID` | Default value for hosted child agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L13) |
| `DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES` | Default value for hosted child excluded tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L45) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS` | Default value for hosted child fork stream active tool timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L61) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS` | Default value for hosted child fork stream finalization timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L65) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L59) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream post tool idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L63) |
| `DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS` | Default value for hosted child requested tool companions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L53) |
| `DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN` | Default value for hosted child sandbox required cue pattern. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L61) |
| `DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS` | Default value for hosted child status poll interval ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L67) |
| `DEFAULT_PROJECT_STEERING_PATHS` | Default value for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L2) |
| `DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER` | Default value for runtime agent context marker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L95) |
| `DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL` | Shared delegate only when materially helpful value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L9) |
| `ExternalAgentWorkerRequestSnapshotSchema` | Zod schema for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L161) |
| `ExternalAgentWorkerRunSchema` | Zod schema for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L211) |
| `ExternalAgentWorkerSchema` | Zod schema for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L132) |
| `ExternalAgentWorkerSessionSchema` | Zod schema for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L182) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE` | Shared first turn starter intent root ownership block message value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L139) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY` | Shared first turn starter intent root ownership context key value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L136) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER` | Shared first turn starter intent root ownership reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L133) |
| `HOSTED_CHILD_FORK_INSTRUCTIONS_BASE` | Shared hosted child fork instructions base value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L9) |
| `HOSTED_CHILD_STREAM_TIMEOUT_TOKEN` | Shared hosted child stream timeout token value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L35) |
| `InvokeAgentChildRunLifecycleCustomEventSchema` | Schema for invoke agent child run lifecycle custom event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L145) |
| `InvokeAgentChildRunLifecycleValueSchema` | Schema for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L76) |
| `InvokeAgentChildRunStateDeltaSchema` | Schema for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L114) |
| `KEEP_ROOT_ASSISTANT_VISIBLE_OWNER` | Shared keep root assistant visible owner value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L7) |
| `LOAD_SKILL_CONTINUATION_REMINDER` | Shared load skill continuation reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L124) |
| `LOAD_SKILL_CONTINUE_SAME_TURN` | Shared load skill continue same turn value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L19) |
| `LOAD_SKILL_CONTINUE_SAME_TURN_NOW` | Shared load skill continue same turn now value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L21) |
| `LOAD_SKILL_DELEGATION_THRESHOLD` | Shared load skill delegation threshold value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L29) |
| `LOAD_SKILL_OVERRIDE_FORWARDING` | Shared load skill override forwarding value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L32) |
| `LOAD_SKILL_ROOT_OWNERSHIP` | Shared load skill root ownership value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L23) |
| `LOAD_SKILL_TOOL_INTERSECTION` | Shared load skill tool intersection value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L35) |
| `LOAD_SKILL_USE_ALLOWED_TOOLS` | Shared load skill use allowed tools value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L26) |
| `MAX_RUNTIME_SKILL_PROMPT_ENTRIES` | Maximum value for runtime skill prompt entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L12) |
| `NO_DELEGATION_NARRATION_UNLESS_ASKED` | Shared no delegation narration unless asked value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L12) |
| `PROJECT_AGENT_EXECUTION_KINDS` | Canonical project agent execution kinds value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L29) |
| `PROJECT_AGENT_KINDS` | Canonical project agent kinds value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L20) |
| `PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES` | Shared project steering file mutation tool names value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L8) |
| `ROOT_OWNED_CHILD_RESULT_INSTRUCTION` | Shared root owned child result instruction value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L44) |
| `RUNTIME_LOAD_SKILL_CONTINUATION_NOTE` | Shared runtime load skill continuation note value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L34) |
| `RUNTIME_LOAD_SKILL_DESCRIPTION` | Shared runtime load skill description value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L38) |
| `RuntimeAgentContextItemSchema` | Schema for runtime agent context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L246) |
| `RuntimeAgentIdSchema` | Schema for runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L170) |
| `RuntimeAgentProjectContextSchema` | Schema for runtime agent project context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L353) |
| `RuntimeAgentRunContextSchema` | Schema for runtime agent run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L445) |
| `RuntimeAgentRunIdSchema` | Schema for runtime agent run ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L140) |
| `RuntimeAgentRunInvocationSchema` | Schema for runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L490) |
| `RuntimeAgentServiceIdSchema` | Schema for runtime agent service ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L161) |
| `RuntimeAgentSourceContextSchema` | Schema for runtime agent source context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L273) |
| `RuntimeAgentTargetKindSchema` | Schema for runtime agent target kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L285) |
| `RuntimeAgentToolCallIdSchema` | Schema for runtime agent tool call ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L147) |
| `RuntimeAgentToolNameSchema` | Schema for runtime agent tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L182) |
| `RuntimeAgentToolSchema` | Schema for runtime agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L210) |
| `RuntimeAgentValidatedClaimsSchema` | Schema for runtime agent validated claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L371) |
| `RuntimeSkillFrontmatterSchema` | Schema for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L86) |
| `SLASH_COMMAND_ARTIFACT_REMINDER` | Shared slash command artifact reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L127) |
| `SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE` | Shared synthesize delegated findings in root voice value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L15) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addFirstTurnStarterIntentRootOwnershipReminder` | Add first turn starter intent root ownership reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L242) |
| `addLoadSkillContinuationReminder` | Add load skill continuation reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L306) |
| `addSlashCommandArtifactReminder` | Add slash command artifact reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L329) |
| `agent` | Agent helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/factory.ts#L157) |
| `agentAsTool` | Performs the agent as tool operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L52) |
| `appendAgentServiceChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L202) |
| `appendConversationRunEvents` | Append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L991) |
| `appendHostedChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L202) |
| `appendMissingChildRunToolCalls` | Append missing child run tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L24) |
| `appendMissingChildRunToolResults` | Append missing child run tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L40) |
| `applyAgentProjectContextChange` | Apply agent project context change helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L18) |
| `applyDefaultResearchArtifactPath` | Apply default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L223) |
| `applyPartToStreamedStepState` | State for apply part to streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L87) |
| `bootstrapAgentService` | Bootstrap agent service helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L56) |
| `bootstrapConversationAgentRun` | Bootstrap conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L335) |
| `bootstrapHostedChildRun` | Bootstrap hosted child run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L101) |
| `buildAgentDelegateTools` | Builds the opt-in delegate tools for a coordinator agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L63) |
| `buildAgentRunTraceAttributes` | Builds agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L184) |
| `buildAgUiBrowserFinalizeResponse` | Response payload for build AG-UI browser finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L401) |
| `buildAgUiSseTraceSignature` | Build a compact ordered event-type signature for regression checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L89) |
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L329) |
| `buildChildRunExecutionSnapshot` | Builds child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L104) |
| `buildChildRunExhaustedStepBudgetErrorMessage` | Message shape for build child run exhausted step budget error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L56) |
| `buildChildRunFailureResult` | Result returned from build child run failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L143) |
| `buildChildRunFailureSnapshot` | Builds child run failure snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L160) |
| `buildChildRunResultCommon` | Builds child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L121) |
| `buildChildRunResultSummary` | Builds child run result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L321) |
| `buildChildRunSuccessResult` | Result returned from build child run success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L126) |
| `buildChildRunSuccessSnapshot` | Builds child run success snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L179) |
| `buildDefaultHostedChildForkToolSet` | Builds default hosted child fork tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L412) |
| `buildDefaultResearchArtifactPathReminder` | Builds default research artifact path reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L102) |
| `buildDefaultResearchArtifactPaths` | Builds default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L124) |
| `buildDetachedAgUiStartRequest` | Request payload for build detached AG-UI start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L163) |
| `buildDetachedFallbackChunks` | Builds detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L187) |
| `buildDetachedFallbackMessageState` | State for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L127) |
| `buildExecuteToolTraceAttributes` | Builds execute tool trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L223) |
| `buildFinalizedAgentRunTraceAttributes` | Builds finalized agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L284) |
| `buildFinalizedMessageFallbackChunks` | Builds finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L151) |
| `buildFinalizedMessageState` | State for build finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L95) |
| `buildForkRuntimeStepFromResponse` | Build a fork runtime step from an agent response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-progress.ts#L12) |
| `buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation` | Builds hosted chat request forwarded props from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L153) |
| `buildHostedChatRequestFromRuntimeAgentInvocation` | Builds hosted chat request from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L203) |
| `buildHostedChatRequestInputFromRuntimeAgentInvocation` | Builds hosted chat request input from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L172) |
| `buildHostedChildCompletedLog` | Builds hosted child completed log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L75) |
| `buildHostedChildConversationBody` | Builds hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L80) |
| `buildHostedChildErrorLog` | Builds hosted child error log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L95) |
| `buildHostedChildExhaustedStepBudgetLog` | Builds hosted child exhausted step budget log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L54) |
| `buildHostedChildForkInstructions` | Builds hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L65) |
| `buildHostedChildToolDescription` | Builds hosted child tool description. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L437) |
| `buildHostedDurableChildInvokeFailureResult` | Result returned from build hosted durable child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L176) |
| `buildHostedDurableChildInvokeSuccessResult` | Result returned from build hosted durable child invoke success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L233) |
| `buildHostedDurableChildInvokeTerminalFailureResult` | Result returned from build hosted durable child invoke terminal failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L201) |
| `buildInputRequestLifecycleDataEvent` | Event emitted for build input request lifecycle data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L345) |
| `buildInvokeAgentChildRunLifecycleCustomEvent` | Event emitted for build invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L211) |
| `buildInvokeAgentChildRunProgressEvents` | Builds invoke agent child run progress events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L222) |
| `buildInvokeAgentChildRunStateDelta` | Builds invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L194) |
| `buildInvokeAgentFollowupInstruction` | Builds invoke agent followup instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L109) |
| `buildInvokeAgentTraceAttributes` | Builds invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L238) |
| `buildParsedAgentServiceAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L197) |
| `buildParsedAgentServiceChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L145) |
| `buildParsedHostedAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L197) |
| `buildParsedHostedChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L145) |
| `buildProjectServiceTraceAttributes` | Builds Datadog unified service trace attributes for a hosted project run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L96) |
| `buildRecoveredStepParts` | Builds recovered step parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L76) |
| `buildRootOwnedChildResultHint` | Builds root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L48) |
| `buildRootOwnedChildRunResultHint` | Builds root owned child run result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L348) |
| `buildRootOwnedChildRunResultText` | Builds root owned child run result text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L333) |
| `buildRootOwnedDelegatedFindingsInstruction` | Builds root owned delegated findings instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L39) |
| `buildRuntimeAgentControlPlaneStreamRequestFromInvocation` | Builds runtime agent control plane stream request from invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L510) |
| `buildRuntimeAvailableSkillsPromptBlock` | Builds runtime available skills prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L41) |
| `buildRuntimeLoadedSkillResponse` | Response payload for build runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L275) |
| `buildRuntimeSkillDefinition` | Definition for build runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L224) |
| `buildScheduleTraceAttributes` | Builds schedule trigger trace attributes from schedule forwarded props. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L79) |
| `buildStarterIntentRootOwnershipBlockMessage` | Message shape for build starter intent root ownership block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L119) |
| `buildStarterIntentRootOwnershipReminder` | Builds starter intent root ownership reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L114) |
| `buildStudioMcpHeaders` | Builds studio MCP headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L30) |
| `buildVeryfrontCloudRuntimeInstructions` | Builds Veryfront Cloud runtime instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L71) |
| `cleanupAfterHostedChatExecutionFinalization` | Cleanup after hosted chat execution finalization helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L272) |
| `clearProjectAgentRuntimeRegistries` | Clear project agent runtime registries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L83) |
| `clientAllowsStudioMcp` | Client allows studio MCP helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L161) |
| `cloneMirroredToolChunkState` | State for clone mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L57) |
| `closeAgentServiceChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L215) |
| `closeAgentServiceChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L235) |
| `closeChildRunExecutionBuffers` | Close child run execution buffers helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L27) |
| `closeHostedChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L215) |
| `closeHostedChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L235) |
| `closeHostedMirroredOpenToolCalls` | Close hosted mirrored open tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L224) |
| `composeAbortSignals` | Compose abort signals helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L66) |
| `computeOpenToolCalls` | Compute open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L194) |
| `containsExactArtifactPathValue` | Contains exact artifact path value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L202) |
| `convertAgentRuntimeMessagesToProviderMessages` | Convert agent runtime messages to provider messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L674) |
| `convertCompactedProviderMessagesToChildForkRuntimeMessages` | Convert compacted provider messages to child fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L101) |
| `convertProviderMessagesToAgentRuntimeMessages` | Convert provider messages to agent runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L662) |
| `createAgentServiceAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L175) |
| `createAgentServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L300) |
| `createAgentServiceChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L255) |
| `createAgentServiceFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L39) |
| `createAgentServiceProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L83) |
| `createAgentServiceRegistrationLifecycle` | Create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L381) |
| `createAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L197) |
| `createAgentServiceRuntime` | Create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L209) |
| `createAgentServiceServerRuntime` | Create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L54) |
| `createAgUiBrowserChunkEncoder` | Create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L100) |
| `createAgUiBrowserEncoderState` | State for create AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L93) |
| `createAgUiBrowserFinalizeTracker` | Create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L27) |
| `createAgUiBrowserResponseStream` | Create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L77) |
| `createAgUiCancelHandler` | Handler for create AG-UI cancel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L163) |
| `createAgUiChatUiChunkBrowserEncoder` | Create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L257) |
| `createAgUiChatUiTrackedBrowserResponse` | Response payload for create AG-UI chat UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L275) |
| `createAgUiChunkEncoderBridge` | Create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L28) |
| `createAgUiDetachedStartHandler` | Handler for create AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L441) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L517) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L522) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L527) |
| `createAgUiResumeHandler` | Handler for create AG-UI resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L93) |
| `createAgUiRunErrorEvent` | Event emitted for create AG-UI run error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L478) |
| `createAgUiRuntimeBrowserResponse` | Response payload for create AG-UI runtime browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L37) |
| `createAgUiRuntimeChatStreamEncoder` | Create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L256) |
| `createAgUiRuntimeContextMap` | Create AG-UI runtime context map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L12) |
| `createAgUiRuntimeEventEncoder` | Create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L29) |
| `createAgUiRuntimeHandler` | Handler for create AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L425) |
| `createAgUiSseErrorResponse` | Response payload for create AG-UI sse error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L489) |
| `createAgUiSseResponse` | Response payload for create AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L502) |
| `createAgUiTrackedBrowserResponse` | Response payload for create AG-UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L26) |
| `createBootstrappedHostedChatExecutionRuntime` | Create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L479) |
| `createChatUiMessageStreamFromDataStream` | Create chat UI message stream from data stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L522) |
| `createConversationAgentRun` | Create conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1068) |
| `createConversationChildLifecycleAdapter` | Create conversation child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L235) |
| `createConversationHostedLifecycleAdapter` | Create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L60) |
| `createConversationHostedStreamLifecycleAdapter` | Create conversation hosted stream lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L146) |
| `createConversationHostedTerminalAdapter` | Create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L214) |
| `createConversationMessage` | Message shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L204) |
| `createConversationRecord` | Record shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L188) |
| `createConversationRootRunContext` | Context for create conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L55) |
| `createConversationRootRunStartAdapter` | Create conversation root run start adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L109) |
| `createConversationRunChunkMirror` | Create conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L200) |
| `createConversationRunContext` | Context for create conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L16) |
| `createConversationRunEventQueueController` | Create conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L696) |
| `createConversationRunMirror` | Create conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L115) |
| `createConversationRunStreamMirror` | Create conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L29) |
| `createDefaultAgentServiceChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L324) |
| `createDefaultAgentServiceInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L606) |
| `createDefaultAgentServiceProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L177) |
| `createDefaultHostedChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L324) |
| `createDefaultHostedInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L606) |
| `createDefaultHostedProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L177) |
| `createDefaultResearchRunArtifactMirrorHandler` | Handler for create default research run artifact mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L367) |
| `createDetachedRunShutdownLifecycle` | Create detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L164) |
| `createDetachedRunTracker` | Create detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L81) |
| `createExternalAgentWorkerClient` | Create external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L492) |
| `createForkRuntimeStreamMappingState` | State for create fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L180) |
| `createForkRuntimeUserMessage` | Message shape for create fork runtime user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L404) |
| `createFrameworkStreamState` | State for create framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L349) |
| `createHostedAgentProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L83) |
| `createHostedAgentRunSpanController` | Create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L98) |
| `createHostedAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L197) |
| `createHostedAgentServiceRuntime` | Create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L276) |
| `createHostedAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L175) |
| `createHostedChatExecutionRuntime` | Create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L775) |
| `createHostedChatExecutionRuntimeBootstrap` | Create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L366) |
| `createHostedChatFinalizeDetachedBuildState` | State for create hosted chat finalize detached build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L591) |
| `createHostedChatFinalizeResponseBuildState` | State for create hosted chat finalize response build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L551) |
| `createHostedChatRuntimeAgentAdapter` | Create hosted chat runtime agent adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L43) |
| `createHostedChatStreamFinalizationHooks` | Create hosted chat stream finalization hooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L516) |
| `createHostedChildExecutionLogWriter` | Create hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L45) |
| `createHostedChildForkRunContext` | Context for create hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L180) |
| `createHostedChildInvokeTool` | Create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L68) |
| `createHostedChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L255) |
| `createHostedChildPendingToolLifecycle` | Create hosted child pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L120) |
| `createHostedChildPendingToolLifecycleLogger` | Create hosted child pending tool lifecycle logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L70) |
| `createHostedConversationRunChunkMirror` | Create hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L397) |
| `createHostedDurableChildForkRunContext` | Context for create hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L220) |
| `createHostedDurableChildInvokeTraceRecorder` | Create hosted durable child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L276) |
| `createHostedFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L39) |
| `createHostedMirroredUiStream` | Create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L271) |
| `createHostedProjectRemoteToolSource` | Create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L87) |
| `createHostedProjectRemoteToolSources` | Create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L341) |
| `createHostedProjectSteeringAdapter` | Create hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L138) |
| `createHostedRootRunLifecycleRuntimeAdapter` | Create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L199) |
| `createHostedRuntimeStateResolver` | Create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L72) |
| `createHostedServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L300) |
| `createInitialForkRuntimeMessages` | Create initial fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L418) |
| `createInputRequest` | Request payload for create input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L273) |
| `createLiveStudioMcpTools` | Create live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L71) |
| `createMemory` | Create an in-memory store from a validated built-in configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L429) |
| `createMirroredToolChunkState` | State for create mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L45) |
| `createNodeAgentServiceRuntimeInfrastructure` | Create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L51) |
| `createNodeVeryfrontCloudAgentServiceRuntime` | Create node Veryfront Cloud agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1208) |
| `createRedisMemory` | Create a validated Redis-backed memory instance for an agent and user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L369) |
| `createRequestAuthCache` | Create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L22) |
| `createRuntimeAgentDefinitionFromAgent` | Create runtime agent definition from agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L141) |
| `createRuntimeAgentFromMarkdownDefinition` | Definition for create runtime agent from markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L9) |
| `createRuntimeAgentSystemMessages` | Create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L254) |
| `createRuntimeLoadSkillTool` | Create runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L431) |
| `createRuntimeProjectFilesClient` | Create runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L121) |
| `createRuntimeProjectSkillLoader` | Create runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L327) |
| `createRuntimePromptBlock` | Create runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L9) |
| `createStreamedStepState` | State for create streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L55) |
| `createToolExecutionDataEventBridgeStream` | Create tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L41) |
| `createToolResultPart` | Create a chat tool-result part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L414) |
| `createVeryfrontCloudAgentServiceChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L44) |
| `createVeryfrontCloudHostedChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L44) |
| `createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L82) |
| `createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L82) |
| `createVeryfrontCloudRuntimeSystemMessages` | Create Veryfront Cloud runtime system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L44) |
| `createWorkflow` | Create workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L120) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L384) |
| `defineAgentService` | Define an agent service and expose a policy-neutral runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L408) |
| `deriveAgentServiceAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L128) |
| `deriveAgUiForwardedConfig` | Configuration used by derive AG-UI forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L72) |
| `deriveHostedAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L128) |
| `describeProjectAgentRuntimeAgentIdCandidates` | Describe project agent runtime agent ID candidates helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L193) |
| `discoverProjectAgentRuntime` | Discover project agent runtime helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L92) |
| `dispatchConversationHostedStreamErrorState` | State for dispatch conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L111) |
| `dispatchConversationHostedTerminalState` | State for dispatch conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L96) |
| `doesProjectAgentRuntimeAgentMatchSource` | Does project agent runtime agent match source helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L128) |
| `encodeConversationRunEvents` | Encode conversation run events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L289) |
| `ensureConversationProjectLink` | Ensure conversation project link helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L161) |
| `evaluateSlashCommandArtifactPolicy` | Evaluate slash command artifact policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L207) |
| `evaluateStarterIntentTurnPolicy` | Evaluate starter intent turn policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L224) |
| `executeAgUiDetachedStart` | Execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L339) |
| `executeDefaultAgentServiceInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L427) |
| `executeDefaultHostedInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L427) |
| `executeDurableHumanInputFlow` | Execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L398) |
| `executeHostedChildForkRunContextStream` | Execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L275) |
| `executeHostedChildForkStream` | Execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L543) |
| `executeHostedChildForkToolInput` | Input payload for execute hosted child fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L248) |
| `executeHostedChildForkWithPreparedTools` | Execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L302) |
| `executeHostedDurableChatRun` | Execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L229) |
| `executeHostedDurableChildFork` | Execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L701) |
| `executeHostedLocalChildInvoke` | Execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L378) |
| `expandAllowedRemoteToolNames` | Normalize allowed remote tool names without adding undeclared provider-native tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L60) |
| `expandHostedChildRequestedTools` | Expand hosted child requested tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L95) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L323) |
| `extractLatestUserText` | Extract latest user text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L73) |
| `extractStarterIntentId` | Extract starter intent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L206) |
| `fetchConversationRecord` | Record shape for fetch conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L147) |
| `fetchDefaultAgentServiceProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L66) |
| `fetchDefaultHostedProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L66) |
| `fetchLatestConversationUserText` | Fetch latest conversation user text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L117) |
| `filterAgentTraceAttributes` | Filter agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L64) |
| `filterHostedChatRuntimeLocalTools` | Filter hosted chat runtime local tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L187) |
| `finalizeAgUiBrowserEvents` | Finalize AG-UI browser events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L892) |
| `finalizeChildRunExecutionResources` | Finalize child run execution resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L35) |
| `finalizeConversationAgentRun` | Finalize conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1149) |
| `finalizeHostedChildForkCompletion` | Finalize hosted child fork completion helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L212) |
| `finalizeHostedChildForkRunContextResources` | Finalize hosted child fork run context resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L357) |
| `finalizeHostedDetached` | Finalize hosted detached helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L246) |
| `finalizeHostedResponse` | Response payload for finalize hosted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L181) |
| `findLatestUserConversationMessageContext` | Context for find latest user conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L263) |
| `findSubmittedFormInputResult` | Find the latest submitted form_input result persisted after the latest user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L212) |
| `flattenSystemInstructions` | Flatten system instructions helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L43) |
| `flushConversationRunEventBatches` | Flush conversation run event batches. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L474) |
| `flushConversationRunEventQueue` | Flush conversation run event queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L588) |
| `formatChildRunStreamPartError` | Error shape for format child run stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L31) |
| `formatRuntimeSkillMetadata` | Formats runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L15) |
| `getAgent` | Return agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L214) |
| `getAgentRuntimeTextPart` | Return a runtime text part when the value carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L320) |
| `getAgentRuntimeToolCallPart` | Return a runtime tool-call part when the value carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L346) |
| `getAgentRuntimeToolResultPart` | Return a runtime tool-result part when the value carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L376) |
| `getAgentsAsTools` | Return agents as tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L263) |
| `getAgentServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L193) |
| `getAgUiChatUiMessageChunkMetadata` | Return AG-UI chat UI message chunk metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L133) |
| `getAgUiChatUiMessageMetadataFromChunk` | Return AG-UI chat UI message metadata from chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L42) |
| `getAgUiChatUiMessageUsageMetadata` | Return AG-UI chat UI message usage metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L57) |
| `getAgUiSseEventsOfType` | Filter parsed AG-UI SSE events by normalized event type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L81) |
| `getAgUiSseStringField` | Return a string field from a parsed AG-UI SSE event record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L75) |
| `getAllAgentIds` | Return all agent IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L224) |
| `getChildRunSnapshotUsage` | Return child run snapshot usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L97) |
| `getConfirmedProjectContextSwitchId` | Return confirmed project context switch ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L63) |
| `getConversationRun` | Return conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L915) |
| `getConversationRunEventJsonByteLength` | Return conversation run event JSON byte length. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L21) |
| `getEmptyHostedFinalizedMessageTerminalError` | Error shape for get empty hosted finalized message terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L118) |
| `getForkRuntimeAllowedToolNames` | Return fork runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L67) |
| `getForwardedHostedModelId` | Return forwarded hosted model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L52) |
| `getForwardedHostedRuntimeOverrides` | Return forwarded hosted runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L62) |
| `getHostedChildWrittenArtifactPath` | Return hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L118) |
| `getHostedMirroredAbortErrorText` | Return hosted mirrored abort error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L183) |
| `getHostedServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L193) |
| `getHostedStreamErrorText` | Return hosted stream error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L113) |
| `getInputRequest` | Request payload for get input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L317) |
| `getMaxForkRuntimeStepCount` | Return max fork runtime step count. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L435) |
| `getProjectAgentRuntimeAgentIdCandidates` | Return project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L172) |
| `getProjectSteeringMutation` | Return project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L92) |
| `getProviderNativeToolNames` | Return provider native tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L48) |
| `getProviderToolProfile` | Return provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L56) |
| `getRuntimeAgentMarkdownDefinition` | Definition for get runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L54) |
| `getRuntimeProjectFile` | Return runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L131) |
| `getRuntimeProjectFiles` | Return runtime project files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L167) |
| `getRuntimeProjectInstructions` | Return runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L114) |
| `getRuntimeProjectSkillCatalog` | Return runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L134) |
| `getRuntimeUploadUrl` | Return runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L38) |
| `getTextFromParts` | Return text from parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L350) |
| `getToolArguments` | Return tool arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L368) |
| `handleHostedChildForkFailure` | Process a hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L336) |
| `handleHostedChildForkRunContextError` | Error shape for handle hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L318) |
| `handleHostedChildForkStreamPart` | Process a hosted child fork stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L374) |
| `hasArgs` | Check whether args is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L358) |
| `hasInput` | Check whether a tool-call part stores its parsed input in `input`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L363) |
| `initializeNodeAgentServiceOpenTelemetry` | Initialize node agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L470) |
| `initializeNodeHostedAgentServiceOpenTelemetry` | Initialize node hosted agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L416) |
| `installAbortRejectionGuard` | Install abort rejection guard helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L114) |
| `isAbortRejectionReason` | Check whether a rejection came from an abort signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L50) |
| `isActiveConversationRunStatus` | Check whether a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L121) |
| `isAgentCatalogAction` | Return true when a value is a supported agent catalog action. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L84) |
| `isAgentCatalogKind` | Return true when a value is a supported agent catalog kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L79) |
| `isAgentServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L40) |
| `isAgentTraceAttributeValue` | Check whether a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L55) |
| `isAlreadyMirroredAgentServiceChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L69) |
| `isAlreadyMirroredHostedChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L69) |
| `isAppendableConversationRunProjection` | Check whether a conversation run projection can accept more events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L128) |
| `isChildRunAbortError` | Error shape for is child run abort. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L26) |
| `isCursorMismatchConversationRunAppendError` | Error shape for is cursor mismatch conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L92) |
| `isDurableMirroredOutputChunk` | Check whether a durable chunk mirrors tool output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L4) |
| `isHostedChildCreateFileAlreadyExistsResult` | Result returned from is hosted child create file already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L113) |
| `isHostedChildTerminalErrorCode` | Check whether a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L37) |
| `isHostedChildTextProjectArtifactPrompt` | Check whether a prompt asks for a hosted child text project artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L107) |
| `isHostedServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L40) |
| `isIgnorableConversationRunAppendError` | Error shape for is ignorable conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L43) |
| `isInstalledProjectAgentKind` | Return true when a project agent kind identifies an installed agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L96) |
| `isProjectAgentExecutionKind` | Return true when a value is a supported project agent execution kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L103) |
| `isProjectAgentKind` | Return true when a value is a supported project agent kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L91) |
| `isProviderSafeDelegateId` | Whether a delegate id produces a provider-safe `agent_{id}` tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation-names.ts#L8) |
| `isResponseLike` | Check whether a value behaves like a Response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/response-like.ts#L2) |
| `isRuntimeAgentMarkdownAgent` | Check whether a runtime agent uses markdown configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L61) |
| `isStarterIntentRootOwnershipRequired` | Check whether starter intent root ownership is required. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L251) |
| `isSuccessfulProjectSteeringMutationResult` | Result returned from is successful project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L131) |
| `listRuntimeBuiltinSkillReferenceFiles` | List runtime builtin skill reference files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L112) |
| `listRuntimeBuiltinSkillReferences` | List runtime builtin skill references. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L128) |
| `loadAgentServiceEnvFiles` | Loads agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L32) |
| `loadRuntimeAgentMarkdownDefinitionFromFile` | Loads runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L156) |
| `loadRuntimeBuiltinSkillCatalog` | Loads runtime builtin skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L61) |
| `mapAgUiRuntimeEventToForkParts` | Map AG-UI runtime event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L192) |
| `mapFrameworkEventToForkParts` | Handles map framework event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L358) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L271) |
| `mapRuntimeStreamEventToAgUiBrowserEvents` | Map runtime stream event to AG-UI browser events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L663) |
| `mergeToolCallInput` | Input payload for merge tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L112) |
| `mergeToolInputDelta` | Merge tool input delta helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L54) |
| `mirrorDefaultResearchRunArtifact` | Mirror default research run artifact helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L304) |
| `monitorConversationRunStatus` | Monitor conversation run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L932) |
| `monitorHostedChildRunStatus` | Monitor hosted child run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L168) |
| `normalizeAgUiBrowserRuntimeRequest` | Request payload for normalize AG-UI browser runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L334) |
| `normalizeAgUiMessages` | Normalizes AG-UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L434) |
| `normalizeAgUiRuntimeMessages` | Normalizes AG-UI runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-support.ts#L18) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L278) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L353) |
| `normalizeChatUiMessageChunkToAgUiRuntimeEvent` | Event emitted for normalize chat UI message chunk to AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L221) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L450) |
| `normalizeConversationRunEvent` | Event emitted for normalize conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L30) |
| `normalizeConversationRunEvents` | Normalizes conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L83) |
| `normalizeEncodedConversationRunEvents` | Normalizes encoded conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L297) |
| `normalizeHostedChildArtifactPath` | Normalizes hosted child artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L139) |
| `normalizeParsedAgentServiceChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L257) |
| `normalizeParsedHostedChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L257) |
| `normalizeRuntimeSkillReferencePath` | Normalizes runtime skill reference path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L259) |
| `parseAgentServiceChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L206) |
| `parseAgentServiceConfig` | Configuration used by parse agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L210) |
| `parseAgUiContextBoolean` | Parses AG-UI context boolean. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L56) |
| `parseAgUiContextJsonValue` | Parses AG-UI context JSON value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L27) |
| `parseAgUiContextNullableString` | Parses AG-UI context nullable string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L46) |
| `parseAgUiContextSchema` | Zod schema for parse AG-UI context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L62) |
| `parseAgUiContextString` | Parses AG-UI context string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L40) |
| `parseAgUiRequest` | Request payload for parse AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L419) |
| `parseAgUiRequestOrError` | Error shape for parse AG-UI request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L424) |
| `parseAgUiRuntimeRequest` | Request payload for parse AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L358) |
| `parseAgUiRuntimeRequestOrError` | Error shape for parse AG-UI runtime request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L363) |
| `parseAgUiSseResponse` | Parse an AG-UI SSE `Response` into normalized events, text, tool starts, and terminal error state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L272) |
| `parseAppendConversationRunEventsErrorBody` | Parses append conversation run events error body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L25) |
| `parseDataStreamSseEvents` | Parses data stream sse events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L14) |
| `parseHostedAgentServiceConfig` | Configuration used by parse hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L218) |
| `parseHostedChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L206) |
| `parseRuntimeAgentMarkdownDefinition` | Definition for parse runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L196) |
| `parseRuntimeAgentRunInvocation` | Parses runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L529) |
| `parseRuntimeAgentRunInvocationAgentServiceChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L235) |
| `parseRuntimeAgentRunInvocationHostedChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L235) |
| `parseRuntimeAgentRunInvocationOrError` | Error shape for parse runtime agent run invocation or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L536) |
| `parseRuntimeSkillDocument` | Parses runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L188) |
| `parseRuntimeSkillMetadata` | Parses runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L216) |
| `parseToolInputObject` | Parses tool input object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L135) |
| `persistConversationUserMessage` | Message shape for persist conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L224) |
| `persistLatestConversationUserMessage` | Message shape for persist latest conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L290) |
| `prepareAgentRuntimeMessagesFromUiMessages` | Prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L34) |
| `prepareAgentServiceChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L394) |
| `prepareAgentServiceChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L292) |
| `prepareAgentServiceChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L511) |
| `prepareAgentServiceConversationRootRunContext` | Context for prepare hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L150) |
| `prepareConversationRootRunContext` | Context for prepare conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L135) |
| `prepareConversationRootRunLifecycle` | Prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L44) |
| `prepareConversationRunChunkEvents` | Prepare conversation run chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L65) |
| `prepareConversationRunExternalEvents` | Prepare conversation run external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L76) |
| `prepareConversationRunStreamEvents` | Prepare conversation run stream events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L57) |
| `prepareDefaultHostedChildForkRuntimeTools` | Prepare default hosted child fork runtime tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L312) |
| `prepareDefaultHostedChildForkSandboxToolSources` | Prepare default hosted child fork sandbox tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L182) |
| `prepareDefaultHostedChildForkToolAssembly` | Prepare default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L366) |
| `prepareDefaultHostedChildForkToolSources` | Prepare default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L85) |
| `prepareHostedChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L394) |
| `prepareHostedChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L292) |
| `prepareHostedChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L511) |
| `prepareHostedChatRuntimeToolAssembly` | Prepare hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L201) |
| `prepareHostedChildForkRuntimeStepMessages` | Prepare hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L113) |
| `prepareHostedConversationRootRunContext` | Context for prepare hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L150) |
| `prepareVeryfrontCloudAgentServiceChatExecution` | Prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L75) |
| `prepareVeryfrontCloudHostedChatExecution` | Prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L75) |
| `publishInvokeAgentChildRunProgress` | Publish invoke agent child run progress helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L232) |
| `readRuntimeBuiltinDirectorySkill` | Read runtime builtin directory skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L83) |
| `readRuntimeBuiltinFlatSkill` | Read runtime builtin flat skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L96) |
| `readRuntimeBuiltinSkill` | Read runtime builtin skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L106) |
| `readRuntimeBuiltinSkillEntries` | Read runtime builtin skill entries helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L30) |
| `readRuntimeBuiltinSkillReferenceFile` | Read runtime builtin skill reference file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L69) |
| `recordMirroredToolChunkState` | State for record mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L71) |
| `recoverConversationRunAppendExecution` | Recover conversation run append execution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L350) |
| `recoverConversationRunAppendFailure` | Recover conversation run append failure helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L252) |
| `recoverConversationRunCursorMismatch` | Recover conversation run cursor mismatch helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L180) |
| `registerAgent` | Registers agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L201) |
| `resolveAgentServiceRegistrationInput` | Input payload for resolve agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L269) |
| `resolveConversationHostedStreamErrorState` | State for resolve conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L76) |
| `resolveConversationHostedTerminalState` | State for resolve conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L51) |
| `resolveConversationRunTargets` | Resolves conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L41) |
| `resolveForkRuntimeContinuationState` | State for resolve fork runtime continuation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L443) |
| `resolveForkStepResponse` | Response payload for resolve fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L295) |
| `resolveHostedChildForkRuntimeConfig` | Configuration used by resolve hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L222) |
| `resolveHostedChildForkThinkingOverride` | Resolves hosted child fork thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L182) |
| `resolveHostedChildPromiseWithTimeout` | Resolves hosted child promise with timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L154) |
| `resolveHostedChildStreamWatchdogState` | State for resolve hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L38) |
| `resolveHostedChildTerminalErrorCode` | Resolves a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L104) |
| `resolveHostedDurableRunSetupErrorResponse` | Response payload for resolve hosted durable run setup error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L85) |
| `resolveHostedRuntimeRequestConfig` | Configuration used by resolve hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L128) |
| `resolveHostedRuntimeThinkingOverride` | Resolves hosted runtime thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L83) |
| `resolveNodeAgentServiceTelemetryConfig` | Configuration used by resolve node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L379) |
| `resolveNodeHostedAgentServiceTelemetryConfig` | Configuration used by resolve node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L315) |
| `resolveRuntimeAgentDefinitionsDir` | Resolves runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L100) |
| `resolveRuntimeAgentMarkdownDefinitionFilePath` | Resolves runtime agent markdown definition file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L144) |
| `resolveRuntimeBuiltinSkillReferenceFilePath` | Resolves runtime builtin skill reference file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L47) |
| `resolveRuntimeBuiltinSkillsDir` | Resolves runtime builtin skills dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L17) |
| `resolveRuntimeClientProfile` | Resolves runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L128) |
| `resolveRuntimeMessageFileUrls` | Resolves runtime message file urls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L67) |
| `resolveSingleProjectAgentRuntimeAgentId` | Resolves single project agent runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L203) |
| `resyncConversationRunAppendCursor` | Resync conversation run append cursor helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L140) |
| `runAgentRuntimeForkStep` | Run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L289) |
| `runAgentServiceMain` | Run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L69) |
| `runFrameworkForkStep` | Handles run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L374) |
| `runHostedChildExecutionLifecycle` | Run hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L326) |
| `runHostedChildLifecycle` | Run hosted child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L193) |
| `runHostedLifecycle` | Run hosted lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L158) |
| `runHostedResponseStreamWithHeartbeat` | Run hosted response stream with heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L79) |
| `runPreparedAgentServiceChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L158) |
| `runPreparedHostedChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L158) |
| `runWithProjectAgentRuntime` | Execute a project-runtime lifetime without allowing an outer policy to widen. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L54) |
| `sanitizeDefaultHostedChildRequestedTools` | Sanitize default hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L276) |
| `sanitizeHostedChildRequestedTools` | Sanitize hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L65) |
| `sanitizeProviderToolSchema` | Zod schema for sanitize provider tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L414) |
| `selectDefaultHostedChildForkRuntimeTools` | Select default hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L291) |
| `selectHostedChildForkRuntimeTools` | Select hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L216) |
| `selectProviderCompatibleToolNames` | Select provider compatible tool names helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L95) |
| `selectProviderCompatibleTools` | Select provider compatible tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L123) |
| `shouldBlockHostedChildSameTurnRetry` | Should block hosted child same turn retry helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L61) |
| `shouldContinueForkRuntimeStep` | Should continue fork runtime step helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-progress.ts#L42) |
| `shouldFailEmptyHostedFinalizedMessage` | Message shape for should fail empty hosted finalized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L132) |
| `shouldInjectDefaultResearchArtifactPath` | Should inject default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L83) |
| `shouldPruneSandboxToolsFromHostedChildRequest` | Request payload for should prune sandbox tools from hosted child. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L130) |
| `shouldReinforceLoadSkillContinuation` | Should reinforce load skill continuation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L256) |
| `shouldRetryCreateResearchArtifactAsUpdate` | Should retry create research artifact as update helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L269) |
| `shouldSkipHostedChildTerminalPersistence` | Should skip hosted child terminal persistence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L117) |
| `snapshotHostedRuntimeSourceIdentity` | Capture a service-owned immutable copy of a declared runtime source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L18) |
| `startAgentRuntimeFork` | Starts agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L472) |
| `startAgentRuntimeForkWithHostTools` | Starts agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L167) |
| `startAgentService` | Starts agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1239) |
| `startAgentServiceRuntime` | Starts agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L321) |
| `startAgentServiceServer` | Starts agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L93) |
| `startConversationRootRun` | Starts conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L70) |
| `startHostedChildForkRuntimeWithHostTools` | Starts hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L43) |
| `startNodeAgentService` | Starts node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L286) |
| `startNodeAgentServiceServer` | Starts node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L76) |
| `startNodeHostedAgentService` | Starts node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L311) |
| `startNodeVeryfrontCloudAgentService` | Starts node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1218) |
| `streamDataStreamEvents` | Stream data stream events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L49) |
| `streamPreparedAgentServiceChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L123) |
| `streamPreparedHostedChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L123) |
| `stringifyAgUiSseEvent` | Stringify an AG-UI SSE event or fallback value for diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L70) |
| `stripLeadingEmptyObjectPlaceholder` | Normalize provider tool input by removing transient empty-object prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L10) |
| `summarizeChildRunResultText` | Summarize child run result text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L304) |
| `summarizeChildRunResultValue` | Summarize child run result value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L358) |
| `throwIfChildRunAborted` | Throw if child run aborted helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L19) |
| `toChildRunToolInputRecord` | Record shape for to child run tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L2) |
| `toConversationHostedTerminalState` | State for to conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L187) |
| `toConversationRunStreamEvent` | Event emitted for to conversation run stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L29) |
| `toHostedChatExecutionFinalState` | State for to hosted chat execution final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L262) |
| `toMirroredAgentServiceStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L111) |
| `toMirroredHostedStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L111) |
| `updateDefaultResearchArtifacts` | Update default research artifacts helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L171) |
| `validateRuntimeAgentTargetSelection` | Validates runtime agent target selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L300) |
| `verifyHostedRuntimeSourceBinding` | Verify that a control-plane request addresses the exact source snapshot served here. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L25) |
| `veryfrontApiMcpServer` | Veryfront API MCP server helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L162) |
| `veryfrontStudioMcpServer` | Veryfront Studio MCP server helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L169) |
| `waitForDurableHumanInputResolution` | Wait for durable human input resolution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L485) |
| `waitForHumanInput` | Input payload for wait for human. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L459) |
| `withDefaultResearchArtifactPath` | Applies default research artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L171) |
| `withHostedChildRerunnableFileWriteFallbacks` | Applies hosted child rerunnable file write fallbacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L44) |
| `withHostedChildStreamIdleTimeout` | Applies hosted child stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L80) |
| `withRootOwnedChildResultHint` | Applies root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L94) |
| `withRuntimeToolInventory` | Applies runtime tool inventory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L27) |
| `wrapHostedChildProjectSwitchTool` | Wrap hosted child project switch tool helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L73) |
| `wrapHostedChildSteeringMutationTool` | Wrap hosted child steering mutation tool helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L37) |
| `writeHostedChildExecutionLogEntry` | Entry shape for write hosted child execution log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L27) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AgentRuntime` | Implement agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/index.ts#L513) |
| `AgentRuntimeMessageConversionError` | Error shape for agent runtime message conversion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L122) |
| `AgentServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L18) |
| `AppendConversationRunEventsError` | Error shape for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L4) |
| `BufferMemory` | Implement buffer memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L178) |
| `ConversationMemory` | Implement conversation memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L129) |
| `ConversationRunEventEncoder` | Implement conversation run event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L67) |
| `ConversationRunTerminalStateError` | Error shape for conversation run terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L105) |
| `HostedChildStreamIdleTimeoutError` | Error shape for hosted child stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L15) |
| `HostedChildTerminalStateError` | Error shape for hosted child terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L84) |
| `HostedServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L18) |
| `HumanInputResumeError` | Error shape for human input resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L378) |
| `InvalidHumanInputResultError` | Error shape for invalid human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L389) |
| `RedisMemory` | Redis-backed memory with atomic append and bounded retention. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L225) |
| `RunAlreadyExistsError` | Error shape for run already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L16) |
| `RunCancelledError` | Error shape for run cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L7) |
| `RunNotActiveError` | Error shape for run not active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L25) |
| `RunResumeSessionManager` | Implement run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L105) |
| `RuntimeProjectFilesApiAuthError` | Error shape for runtime project files API auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L105) |
| `SummaryMemory` | Implement summary memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L214) |
| `WaitConflictError` | Error shape for wait conflict. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L43) |
| `WaitNotPendingError` | Error shape for wait not pending. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L34) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbortRejectionEvent` | Event emitted for abort rejection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L13) |
| `AbortRejectionEventTarget` | Public API contract for abort rejection event target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L19) |
| `AbortRejectionGuardLogger` | Public API contract for abort rejection guard logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L2) |
| `AbortRejectionProcessTarget` | Public API contract for abort rejection process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L7) |
| `ActiveConversationRunStatus` | Public API contract for a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L183) |
| `Agent` | Executable agent returned by {@link agent}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L390) |
| `AgentCatalogAction` | Agent catalog action contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L17) |
| `AgentCatalogKind` | Agent catalog kind contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L8) |
| `AgentConfig` | Configuration accepted by the public agent factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L144) |
| `AgentContext` | Context passed through agent middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L208) |
| `AgentContract` | Framework-owned agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L132) |
| `AgentHttpMcpServerConfig` | HTTP MCP server available to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L125) |
| `AgentInvocationMemoryMode` | Memory behavior selected for one agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L453) |
| `AgentMcpHttpTransport` | HTTP transport configuration for one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L93) |
| `AgentMcpServerAuth` | Authentication configuration for one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L101) |
| `AgentMcpServerConfig` | MCP server available to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L141) |
| `AgentMcpToolPolicy` | Policy for tools exposed by one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L83) |
| `AgentMessage` | Message exchanged with an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L100) |
| `AgentMiddleware` | Public API contract for agent middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L343) |
| `AgentPushRuntimeServiceRest` | Public API contract for agent push runtime service rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L39) |
| `AgentRegistry` | Public API contract for agent registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L79) |
| `AgentResponse` | Final response returned by an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L190) |
| `AgentResponseUsage` | Token and billing usage attached to an agent response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L144) |
| `AgentRuntimeForkStepRunner` | Public API contract for agent runtime fork step runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L118) |
| `AgentRuntimeMessage` | Message shape for agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L87) |
| `AgentRuntimeMessageLikePart` | Message part variants accepted by the provider message adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L17) |
| `AgentRuntimeMessagePart` | Public API contract for agent runtime message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L68) |
| `AgentServiceActiveSpanAttributes` | Public API contract for agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L53) |
| `AgentServiceAgUiChatForwardedConfig` | Forwarded hosted chat configuration parsed from AG-UI context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L22) |
| `AgentServiceAuth` | Authentication operations exposed by an agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L147) |
| `AgentServiceAuthConfig` | Authentication configuration used by an agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L141) |
| `AgentServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L51) |
| `AgentServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L7) |
| `AgentServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L100) |
| `AgentServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L88) |
| `AgentServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L113) |
| `AgentServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L94) |
| `AgentServiceBootstrapExit` | Public API contract for agent service bootstrap exit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L17) |
| `AgentServiceChatProjectAccessError` | Error shape for hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L31) |
| `AgentServiceChatProjectAccessResult` | Result returned from hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L38) |
| `AgentServiceChatRequestPrincipal` | Public API contract for hosted chat request principal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L25) |
| `AgentServiceChatRuntimeAgent` | Public API contract for hosted chat runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L84) |
| `AgentServiceChatRuntimeCreationOptions` | Options accepted by hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L116) |
| `AgentServiceChatRuntimeCreationResult` | Result returned from hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L91) |
| `AgentServiceChatRuntimeFinishPart` | Public API contract for hosted chat runtime finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L14) |
| `AgentServiceChatRuntimeOnFinishEvent` | Event emitted for hosted chat runtime on finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L51) |
| `AgentServiceChatRuntimeProjectSteering` | Public API contract for hosted chat runtime project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L99) |
| `AgentServiceChatRuntimeStreamInput` | Input payload for hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L70) |
| `AgentServiceChatRuntimeStreamResult` | Result returned from hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L76) |
| `AgentServiceChatRuntimeToolAssemblyResult` | Result returned from hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L63) |
| `AgentServiceChatRuntimeToUiMessageStreamOptions` | Options accepted by hosted chat runtime to UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L60) |
| `AgentServiceChildChunkMirror` | Public API contract for hosted child chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L5) |
| `AgentServiceChildMirrorContext` | Context for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L19) |
| `AgentServiceChildMirrorPart` | Public API contract for hosted child mirror part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L108) |
| `AgentServiceChildMirrorState` | State for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L11) |
| `AgentServiceConfig` | Configuration used by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L58) |
| `AgentServiceConfigInput` | Input payload for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L91) |
| `AgentServiceContractBase` | Fields shared by single-agent and registry service contracts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L82) |
| `AgentServiceConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L77) |
| `AgentServiceConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L63) |
| `AgentServiceCorsConfig` | Configuration used by agent service cors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L28) |
| `AgentServiceDefinition` | Type-preserving service definition for request-native agent service runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L157) |
| `AgentServiceDetachedCleanupInput` | Input payload for agent service detached cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L83) |
| `AgentServiceDetachedExecutionInput` | Input payload for agent service detached execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L72) |
| `AgentServiceEnvFileLoadOptions` | Options accepted by agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L13) |
| `AgentServiceEnvFileLoadResult` | Result returned from agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L7) |
| `AgentServiceFormInputToolContext` | Context for hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L25) |
| `AgentServiceGenericMcpServerConfig` | Generic remote MCP server configuration for an agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/mcp-server-config.ts#L27) |
| `AgentServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L57) |
| `AgentServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L64) |
| `AgentServiceMcpServerConfig` | MCP server configurations accepted by an agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/mcp-server-config.ts#L47) |
| `AgentServiceOptions` | Options accepted by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L225) |
| `AgentServicePathOption` | Filesystem path or URL accepted by agent service startup options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L176) |
| `AgentServicePreparedExecution` | Public API contract for agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L256) |
| `AgentServiceProcessTarget` | Public API contract for agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L258) |
| `AgentServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L69) |
| `AgentServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L76) |
| `AgentServiceProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L61) |
| `AgentServiceProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L67) |
| `AgentServiceProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L54) |
| `AgentServiceProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L59) |
| `AgentServiceProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L27) |
| `AgentServiceRegistrationConfig` | Configuration used by agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L9) |
| `AgentServiceRegistrationLifecycle` | Public API contract for agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L193) |
| `AgentServiceRegistrationLogger` | Public API contract for agent service registration logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L177) |
| `AgentServiceRegistrationMode` | Public API contract for agent service registration mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L7) |
| `AgentServiceRegistryContract` | Multi-agent service contract. Framework services route to `defaultAgentId` unless the host chooses another registered agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L100) |
| `AgentServiceRoute` | Public API contract for agent service route. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L52) |
| `AgentServiceRouteMethod` | Host-facing server config for the agent service runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L25) |
| `AgentServiceRouteSet` | Route handlers exposed by an agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L150) |
| `AgentServiceRouteSetOptions` | Options accepted by hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L87) |
| `AgentServiceRoutesLogger` | Public API contract for hosted agent service routes logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L30) |
| `AgentServiceRoutesTrace` | Public API contract for hosted agent service routes trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L38) |
| `AgentServiceRuntime` | Transport-neutral runtime created from an agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L62) |
| `AgentServiceRuntimeBundle` | Public API contract for agent service runtime bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L116) |
| `AgentServiceRuntimeConfig` | Configuration used by agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L47) |
| `AgentServiceRuntimeLogger` | Public API contract for agent service runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L56) |
| `AgentServiceRuntimeTrace` | Public API contract for agent service runtime trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L65) |
| `AgentServiceServer` | Public API contract for agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L45) |
| `AgentServiceServerConfig` | Configuration used by agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L42) |
| `AgentServiceServerLifecycle` | Public API contract for agent service server lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L13) |
| `AgentServiceSingleAgentContract` | Single-agent convenience accepted by `defineAgentService()`. Implementations must normalize this shape into the same registry path used by multi-agent services so framework users are not boxed into one-agent-per-process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L117) |
| `AgentServiceStreamExecutionInput` | Input payload for agent service stream execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L62) |
| `AgentServiceTraceContext` | Context for agent service trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L8) |
| `AgentServiceTraceContextGetter` | Public API contract for agent service trace context getter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L14) |
| `AgentServiceVeryfrontApiMcpServerConfig` | Veryfront API MCP server configuration for an agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/mcp-server-config.ts#L7) |
| `AgentServiceVeryfrontStudioMcpServerConfig` | Veryfront Studio MCP server configuration for an agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/mcp-server-config.ts#L17) |
| `AgentStatus` | Runtime lifecycle states reported by an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L8) |
| `AgentStreamResult` | Result returned from agent stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L380) |
| `AgentTraceAttributes` | Public API contract for agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L13) |
| `AgentTraceAttributeValue` | Public API contract for a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L7) |
| `AgentTraceUsage` | Public API contract for agent trace usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L16) |
| `AgentVeryfrontMcpServerConfig` | Veryfront-owned MCP server available to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L115) |
| `AgentVeryfrontMcpServerKind` | Veryfront-owned MCP server kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L112) |
| `AgUiBeforeStream` | Public API contract for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L41) |
| `AgUiBeforeStreamContext` | Context for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L17) |
| `AgUiBeforeStreamMessageInput` | Input payload for AG-UI before stream message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L4) |
| `AgUiBeforeStreamResult` | Result returned from AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L29) |
| `AgUiBrowserChunkEncoder` | Public API contract for AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L14) |
| `AgUiBrowserEncodedEvent` | Event emitted for AG-UI browser encoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L85) |
| `AgUiBrowserEncoderState` | State for AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L59) |
| `AgUiBrowserFinalizeTracker` | Public API contract for AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L9) |
| `AgUiBrowserResponseEncoder` | Public API contract for AG-UI browser response encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L43) |
| `AgUiBrowserResponseExecution` | Public API contract for AG-UI browser response execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L33) |
| `AgUiBrowserResponseRequestState` | State for AG-UI browser response request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L21) |
| `AgUiBrowserRunFinishedMetadata` | Public API contract for AG-UI browser run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L7) |
| `AgUiCancelHandlerOptions` | Options accepted by AG-UI cancel handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L76) |
| `AgUiChatUiChunkBrowserEncoder` | Public API contract for AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L16) |
| `AgUiChunkEncoderBridge` | Public API contract for AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L12) |
| `AgUiCompletion` | Payload handed to {@link AgUiHandlerOptions.onComplete} after an AG-UI run streams to completion successfully - the server-side counterpart to the client's `useConversationChat` persistence path. Lets an application persist the finalized conversation without reconstructing it from the SSE stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L56) |
| `AgUiContextItem` | Context item supplied in an AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L28) |
| `AgUiContextValue` | Static or request-derived context for detached AG-UI executions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L27) |
| `AgUiDetachedExecutionStarter` | Starts a detached AG-UI execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L233) |
| `AgUiDetachedStartAccepted` | Acceptance response for a detached AG-UI run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L42) |
| `AgUiDetachedStartExecutionInput` | Input passed to a detached AG-UI execution starter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L219) |
| `AgUiDetachedStartHandlerOptions` | Options accepted by AG-UI detached start handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L264) |
| `AgUiDetachedStartHandlerOptionsBase` | Shared options for detached AG-UI start handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L238) |
| `AgUiDetachedStartRequest` | Validated request used to start a detached AG-UI run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L34) |
| `AgUiForwardedConfigOptions` | Options accepted by AG-UI forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L6) |
| `AgUiHandlerConfigWithAgent` | Public API contract for AG-UI handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L503) |
| `AgUiHandlerOptions` | Options accepted by AG-UI handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L485) |
| `AgUiInjectedTool` | Client-defined tool declaration supplied in an AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L18) |
| `AgUiOnComplete` | Called once after a successful AG-UI run with the finalized conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L86) |
| `AgUiRequest` | Validated AG-UI request payload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L48) |
| `AgUiRequestMessage` | Message accepted by the AG-UI request schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L34) |
| `AgUiResumeHandlerOptions` | Options accepted by AG-UI resume handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L70) |
| `AgUiResumeSignal` | Signal submitted to resume a waiting AG-UI tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L19) |
| `AgUiResumeValue` | Public API contract for AG-UI resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tool-shared.ts#L12) |
| `AgUiRunControlHandlerOptions` | Shared options for AG-UI run-control handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L62) |
| `AgUiRuntimeChatStreamEncoder` | Public API contract for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L51) |
| `AgUiRuntimeChatStreamEncoderState` | State for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L41) |
| `AgUiRuntimeChatStreamUsage` | Usage metadata captured from an AG-UI runtime finish event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L11) |
| `AgUiRuntimeContextItem` | Context item supplied with a canonical runtime AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L29) |
| `AgUiRuntimeEventEncoder` | Public API contract for AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L13) |
| `AgUiRuntimeHandlerConfig` | Configuration used by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L420) |
| `AgUiRuntimeHandlerConfigWithAgent` | Public API contract for AG-UI runtime handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L414) |
| `AgUiRuntimeHandlerExecute` | Public API contract for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L363) |
| `AgUiRuntimeHandlerExecuteInput` | Input payload for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L351) |
| `AgUiRuntimeHandlerOptions` | Options accepted by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L392) |
| `AgUiRuntimeInjectedTool` | Tool definition supplied with a canonical runtime AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L15) |
| `AgUiRuntimeLifecycleContext` | Context for AG-UI runtime lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L34) |
| `AgUiRuntimeMessage` | Message accepted by the canonical runtime AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L60) |
| `AgUiRuntimeRequest` | Canonical request accepted by the runtime AG-UI handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L137) |
| `AgUiRuntimeRequestGate` | Gate invoked before an AG-UI request body is parsed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L374) |
| `AgUiRuntimeRequestGateInput` | Input passed to an AG-UI request gate. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L368) |
| `AgUiRuntimeStreamEvent` | Event emitted for AG-UI runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L4) |
| `AgUiRuntimeValidationErrorInput` | Input passed to an AG-UI validation error responder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L379) |
| `AgUiRuntimeValidationErrorResponse` | Rewrites an AG-UI validation error response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L387) |
| `AgUiSseEvent` | Event emitted for AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L68) |
| `AgUiSseEventType` | Normalized AG-UI runtime event type value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L27) |
| `AgUiSseProgressSnapshot` | Progress snapshot emitted while parsing an AG-UI SSE response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L48) |
| `AppendConversationRunEventsResponse` | Response payload for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L367) |
| `AppendExternalAgentWorkerRunEventsInput` | Input payload for append external agent worker run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L285) |
| `BootstrapAgentServiceOptions` | Options accepted by bootstrap agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L20) |
| `BootstrapConversationAgentRunResult` | Result returned from bootstrap conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L325) |
| `BootstrapHostedChildRunInput` | Input payload for bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L22) |
| `BootstrapHostedChildRunResult` | Result returned from bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L46) |
| `BootstrappedHostedChatExecutionRuntime` | Public API contract for bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L242) |
| `BuildAgentDelegateToolsInput` | Input payload for build agent delegate tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L14) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L12) |
| `BuildChildRunResultSummaryOptions` | Options accepted when building child run result summaries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L40) |
| `BuildDetachedFallbackChunksInput` | Input payload for build detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L79) |
| `BuildDetachedFallbackMessageInput` | Input payload for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L33) |
| `BuildFinalizedMessageFallbackChunksInput` | Input payload for build finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L63) |
| `BuildFinalizedMessageStateInput` | Input payload for build finalized message state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L21) |
| `BuildHostedDurableChildInvokeFailureResultInput` | Input payload for build hosted durable child invoke failure result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L62) |
| `BuildParsedAgentServiceAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L84) |
| `BuildParsedHostedAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L84) |
| `CachedRequestAuthResult` | Result returned from cached request auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L3) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L372) |
| `ChatUiMessageStreamFinish` | Public API contract for chat UI message stream finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L59) |
| `ChatUiMessageStreamFinishPart` | Public API contract for chat UI message stream finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L24) |
| `ChatUiMessageStreamOptions` | Options accepted by chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L68) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L136) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L121) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L128) |
| `ChildRunContractFacts` | Structured contract facts extracted from delegated result text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L45) |
| `ChildRunExecutionBufferCleanupInput` | Input payload for child run execution buffer cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L4) |
| `ChildRunExecutionResourceFinalizeInput` | Input payload for child run execution resource finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L12) |
| `ChildRunExecutionResult` | Result returned from child run execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L58) |
| `ChildRunExecutionSnapshot` | Public API contract for child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L36) |
| `ChildRunExecutionUsage` | Public API contract for child run execution usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L4) |
| `ChildRunResultCommon` | Public API contract for child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L81) |
| `ChildRunResultMode` | Result return modes supported by delegated child runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L37) |
| `ChildRunResultSummary` | Summary metadata returned to parent runs after child delegation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L53) |
| `ChildRunToolCallSnapshot` | Public API contract for child run tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L14) |
| `ChildRunToolResultSnapshot` | Public API contract for child run tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L24) |
| `ClaimExternalAgentWorkerRunInput` | Input payload for claim external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L251) |
| `CloseHostedMirroredOpenToolCallsInput` | Input payload for close hosted mirrored open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L161) |
| `CompleteConversationRunResponse` | Response returned after completing a conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L333) |
| `CompleteExternalAgentWorkerRunInput` | Input payload for complete external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L273) |
| `ContextBudgetDiagnostics` | Measurements produced while enforcing a context budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/context-budget-manager.ts#L123) |
| `ContextBudgetManagerOptions` | Token budgets and hooks used by context compaction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/context-budget-manager.ts#L101) |
| `ContextCompactionEventPayload` | Durable payload describing one context compaction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/context-budget-manager.ts#L23) |
| `ContextCompactionReason` | Reason a runtime compacted conversation context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/context-budget-manager.ts#L14) |
| `ContextCompactionSummary` | Model-generated summary used to replace compacted context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/context-budget-manager.ts#L17) |
| `ContextSummaryGenerator` | Produces a bounded summary for messages selected for compaction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/context-budget-manager.ts#L91) |
| `ConversationAgentRunUsage` | Public API contract for conversation agent run usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L445) |
| `ConversationChildLifecycleContext` | Context for conversation child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L159) |
| `ConversationControlPlaneResponseError` | Error shape for conversation control plane response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L71) |
| `ConversationHostedLifecycleFinalizeInput` | Input payload for conversation hosted lifecycle finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L22) |
| `ConversationHostedTerminalAdapter` | Public API contract for conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L138) |
| `ConversationHostedTerminalRuntimeAdapter` | Public API contract for conversation hosted terminal runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L87) |
| `ConversationHostedTerminalStateInput` | Input payload for conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L9) |
| `ConversationHostedTerminalStateResolution` | Public API contract for conversation hosted terminal state resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L45) |
| `ConversationMessageRecord` | Persisted conversation message identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L50) |
| `ConversationRecord` | Record shape for conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L17) |
| `ConversationRootRunContext` | Context for conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L17) |
| `ConversationRootRunDescriptor` | Public API contract for conversation root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L5) |
| `ConversationRootRunLifecycle` | Public API contract for conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L18) |
| `ConversationRunAppendCursorResyncResult` | Result returned from conversation run append cursor resync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L195) |
| `ConversationRunAppendExecutionOutcome` | Public API contract for conversation run append execution outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L213) |
| `ConversationRunAppendFailureOutcome` | Public API contract for conversation run append failure outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L207) |
| `ConversationRunAppendRecoveryOutcome` | Public API contract for conversation run append recovery outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L201) |
| `ConversationRunBatchFlushOutcome` | Public API contract for conversation run batch flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L219) |
| `ConversationRunChunkMirror` | Public API contract for conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L26) |
| `ConversationRunChunkMirrorApiOptions` | Options accepted by conversation run chunk mirror API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L111) |
| `ConversationRunChunkMirrorOptions` | Options accepted by conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L132) |
| `ConversationRunChunkMirrorPrepareChunkEventsInput` | Input payload for conversation run chunk mirror prepare chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L54) |
| `ConversationRunChunkMirrorPreparedChunk` | Public API contract for conversation run chunk mirror prepared chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L40) |
| `ConversationRunChunkMirrorPreparedEvents` | Public API contract for conversation run chunk mirror prepared events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L48) |
| `ConversationRunChunkMirrorPrepareExternalEventsInput` | Input payload for conversation run chunk mirror prepare external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L62) |
| `ConversationRunChunkMirrorQueueOptions` | Options accepted by conversation run chunk mirror queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L104) |
| `ConversationRunChunkMirrorSharedOptions` | Shared batching and lifecycle options for conversation run chunk mirrors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L70) |
| `ConversationRunContext` | Context for conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L4) |
| `ConversationRunEvent` | Durable event stored for a conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L22) |
| `ConversationRunEventQueueController` | Public API contract for conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L232) |
| `ConversationRunEventRecord` | Record shape accepted by conversation run event normalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L11) |
| `ConversationRunMirror` | Public API contract for conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L80) |
| `ConversationRunMirrorHighBacklogState` | Snapshot reported when a conversation run mirror reaches high backlog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L64) |
| `ConversationRunMirrorRetryScheduledState` | State for conversation run mirror retry scheduled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L46) |
| `ConversationRunMirrorSnapshot` | Public API contract for conversation run mirror snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L5) |
| `ConversationRunMirrorStoppedState` | State for conversation run mirror stopped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L25) |
| `ConversationRunProjection` | Public API contract for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L95) |
| `ConversationRunQueueFlushOutcome` | Public API contract for conversation run queue flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L226) |
| `ConversationRunRuntimeTargetKind` | Runtime target kind recorded on project-backed conversation runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L26) |
| `ConversationRunSourceTargetKind` | Source target kind recorded on project-backed conversation runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L23) |
| `ConversationRunStreamMirror` | Public API contract for conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L15) |
| `ConversationRunTargets` | Public API contract for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L29) |
| `CoreMirroredPartType` | Core stream part kinds handled by the hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L43) |
| `CreateAgentServiceRegistrationLifecycleOptions` | Options accepted by create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L201) |
| `CreateAgentServiceRuntimeOptions` | Options accepted by create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L96) |
| `CreateAgentServiceServerRuntimeOptions` | Options accepted by create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L19) |
| `CreateAgUiBrowserChunkEncoderOptions` | Options accepted by create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L24) |
| `CreateAgUiBrowserFinalizeTrackerOptions` | Options accepted by create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L19) |
| `CreateAgUiBrowserResponseStreamInput` | Input payload for create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L51) |
| `CreateAgUiChatUiChunkBrowserEncoderOptions` | Options accepted by create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L22) |
| `CreateAgUiChatUiTrackedBrowserResponseInput` | Input payload for create AG-UI chat UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L30) |
| `CreateAgUiChunkEncoderBridgeOptions` | Options accepted by create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L22) |
| `CreateAgUiRuntimeBrowserResponseInput` | Input payload for create AG-UI runtime browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L14) |
| `CreateAgUiRuntimeChatStreamEncoderOptions` | Options accepted by create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L59) |
| `CreateAgUiRuntimeEventEncoderOptions` | Options accepted by create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L23) |
| `CreateAgUiTrackedBrowserResponseInput` | Input payload for create AG-UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L11) |
| `CreateBootstrappedHostedChatExecutionRuntimeInput` | Input payload for create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L168) |
| `CreateConversationAgentRunInput` | Input payload for create conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L455) |
| `CreateConversationHostedLifecycleAdapterOptions` | Options accepted by create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L36) |
| `CreateConversationHostedTerminalAdapterOptions` | Options accepted by create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L122) |
| `CreateDefaultAgentServiceChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L97) |
| `CreateDefaultAgentServiceChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L122) |
| `CreateDefaultAgentServiceProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L41) |
| `CreateDefaultHostedChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L97) |
| `CreateDefaultHostedChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L122) |
| `CreateDefaultHostedProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L41) |
| `CreateHostedAgentRunSpanControllerInput` | Input payload for create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L66) |
| `CreateHostedAgentServiceRuntimeOptions` | Options accepted by create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L68) |
| `CreateHostedChatExecutionRuntimeBootstrapInput` | Input payload for create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L118) |
| `CreateHostedChatExecutionRuntimeInput` | Input payload for create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L142) |
| `CreateHostedChildInvokeToolOptions` | Options accepted by create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L21) |
| `CreateHostedMirroredUiStreamInput` | Input payload for create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L143) |
| `CreateHostedProjectRemoteToolSourceInput` | Input payload for create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L57) |
| `CreateHostedProjectRemoteToolSourcesInput` | Input payload for create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L213) |
| `CreateHostedRootRunLifecycleRuntimeAdapterInput` | Input payload for create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L163) |
| `CreateHostedRuntimeStateResolverOptions` | Options accepted by create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L52) |
| `CreateInputRequestRequest` | REST request body used to create a durable input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L19) |
| `CreateNodeAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L26) |
| `CreateNodeHostedAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L34) |
| `CreateRequestAuthCacheOptions` | Options accepted by create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L6) |
| `CreateRuntimeAgentSystemMessagesInput` | Input payload for create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L125) |
| `CreateVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptionsInput` | Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L65) |
| `CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput` | Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L65) |
| `CreateVeryfrontCloudRuntimeSystemMessagesInput` | Input payload for create Veryfront Cloud runtime system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L11) |
| `DefaultAgentServiceChatRuntimeConfig` | Configuration used by default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L51) |
| `DefaultAgentServiceChatRuntimeCreationOptions` | Options accepted by default hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L64) |
| `DefaultAgentServiceChatRuntimeLogger` | Public API contract for default hosted chat runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L59) |
| `DefaultAgentServiceChatRuntimeProjectSwitchInput` | Input payload for default hosted chat runtime project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L116) |
| `DefaultAgentServiceChatRuntimeSteeringMutationInput` | Input payload for default hosted chat runtime steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L110) |
| `DefaultAgentServiceChatRuntimeSystemRefreshInput` | Input payload for default hosted chat runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L103) |
| `DefaultAgentServiceChatRuntimeTaskContext` | Context for default hosted chat runtime task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L74) |
| `DefaultAgentServiceInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L82) |
| `DefaultAgentServiceInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L69) |
| `DefaultAgentServiceInvokeAgentInput` | Input accepted by the default hosted invoke-agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L179) |
| `DefaultAgentServiceInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L91) |
| `DefaultAgentServiceInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L116) |
| `DefaultAgentServiceInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L123) |
| `DefaultAgentServiceInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L111) |
| `DefaultAgentServiceInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L105) |
| `DefaultAgentServiceInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L99) |
| `DefaultAgentServiceProjectSteeringFetchers` | Public API contract for default hosted project steering fetchers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L31) |
| `DefaultAgentServiceProjectSteeringRefreshLogger` | Public API contract for default hosted project steering refresh logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L19) |
| `DefaultAgentServiceProjectSteeringRefreshLookup` | Public API contract for default hosted project steering refresh lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L24) |
| `DefaultHostedChatRuntimeConfig` | Configuration used by default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L51) |
| `DefaultHostedChatRuntimeCreationOptions` | Options accepted by default hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L64) |
| `DefaultHostedChatRuntimeLogger` | Public API contract for default hosted chat runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L59) |
| `DefaultHostedChatRuntimeProjectSwitchInput` | Input payload for default hosted chat runtime project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L116) |
| `DefaultHostedChatRuntimeSteeringMutationInput` | Input payload for default hosted chat runtime steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L110) |
| `DefaultHostedChatRuntimeSystemRefreshInput` | Input payload for default hosted chat runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L103) |
| `DefaultHostedChatRuntimeTaskContext` | Context for default hosted chat runtime task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L74) |
| `DefaultHostedChildForkRuntimeToolPreparationResult` | Result returned from default hosted child fork runtime tool preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L177) |
| `DefaultHostedChildForkToolAssemblyResult` | Result returned from default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L202) |
| `DefaultHostedChildForkToolAssemblySourceResult` | Result returned from default hosted child fork tool assembly source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L189) |
| `DefaultHostedChildForkToolSourcesResult` | Result returned from default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L62) |
| `DefaultHostedInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L82) |
| `DefaultHostedInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L69) |
| `DefaultHostedInvokeAgentInput` | Input accepted by the default hosted invoke-agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L179) |
| `DefaultHostedInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L91) |
| `DefaultHostedInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L116) |
| `DefaultHostedInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L123) |
| `DefaultHostedInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L111) |
| `DefaultHostedInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L105) |
| `DefaultHostedInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L99) |
| `DefaultHostedProjectSteeringFetchers` | Public API contract for default hosted project steering fetchers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L31) |
| `DefaultHostedProjectSteeringRefreshLogger` | Public API contract for default hosted project steering refresh logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L19) |
| `DefaultHostedProjectSteeringRefreshLookup` | Public API contract for default hosted project steering refresh lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L24) |
| `DefaultResearchArtifactContext` | Context for default research artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L16) |
| `DefaultResearchArtifactLogger` | Public API contract for default research artifact logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L28) |
| `DefaultResearchArtifactPaths` | Public API contract for default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L67) |
| `DefaultResearchArtifacts` | Public API contract for default research artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L13) |
| `DelegateAgentResolver` | Resolves a registered agent by id (defaults to the global registry). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L11) |
| `DerivedAgentServiceAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L68) |
| `DerivedHostedAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L68) |
| `DetachedFallbackMessageState` | State for detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L55) |
| `DetachedRunDrainResult` | Result returned from detached run drain. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L5) |
| `DetachedRunShutdownLifecycle` | Public API contract for detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L51) |
| `DetachedRunShutdownLifecycleOptions` | Options accepted by detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L59) |
| `DetachedRunShutdownLogger` | Public API contract for detached run shutdown logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L43) |
| `DetachedRunTracker` | Public API contract for detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L21) |
| `DetachedRunTrackerOptions` | Options accepted by detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L13) |
| `DiscoverProjectAgentRuntimeInput` | Input payload for discover project agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L37) |
| `DurableHumanInputFlowResult` | Result returned from durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L315) |
| `DurableMirrorChunkType` | Durable UI chunk kinds emitted by the hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L55) |
| `DurableRunSink` | Transport-neutral durable run lifecycle sink for agent-service adoption work. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L6) |
| `EdgeConfig` | Edge-execution settings for an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L29) |
| `EnvReader` | Reads one environment variable without mutating process state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L5) |
| `ExecuteAgUiDetachedStartInput` | Input payload for execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L207) |
| `ExecuteDurableHumanInputFlowOptions` | Options accepted by execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L321) |
| `ExecuteHostedChildForkRunContextStreamInput` | Input payload for execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L247) |
| `ExecuteHostedChildForkStreamInput` | Input payload for execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L104) |
| `ExecuteHostedChildForkToolInputOptions` | Options accepted by execute hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L205) |
| `ExecuteHostedChildForkWithPreparedToolsInput` | Input payload for execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L110) |
| `ExecuteHostedDurableChatRunInput` | Input payload for execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L54) |
| `ExecuteHostedDurableChildForkInput` | Input payload for execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L452) |
| `ExecuteHostedLocalChildInvokeInput` | Input payload for execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L149) |
| `ExpandAllowedRemoteToolNamesOptions` | Options for expanding an allowlist with provider-native tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L17) |
| `ExternalAgentWorker` | Public API contract for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L7) |
| `ExternalAgentWorkerClient` | Public API contract for external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L297) |
| `ExternalAgentWorkerClientOptions` | Options accepted by external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L225) |
| `ExternalAgentWorkerRequestSnapshot` | Public API contract for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L31) |
| `ExternalAgentWorkerRun` | Public API contract for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L75) |
| `ExternalAgentWorkerSession` | Public API contract for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L51) |
| `ExtraMirroredHostedStreamPart` | Additional source part accepted directly from hosted stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L102) |
| `FetchDefaultAgentServiceProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L52) |
| `FetchDefaultHostedProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L52) |
| `FinalizeConversationAgentRunInput` | Input payload for finalize conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L483) |
| `FinalizedMessageState` | State for finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L45) |
| `FinalizeHostedChildForkRunContextResourcesInput` | Input payload for finalize hosted child fork run context resources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L164) |
| `FinalizeHostedDetachedOptions` | Options accepted by finalize hosted detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L70) |
| `FinalizeHostedResponseOptions` | Options accepted by finalize hosted response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L36) |
| `ForkErrorPart` | Runtime error emitted by a forked execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L70) |
| `ForkPart` | Public API contract for fork part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L101) |
| `ForkRecoveredPartsState` | State for fork recovered parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L33) |
| `ForkRuntimeContinuationPromptResolver` | Public API contract for fork runtime continuation prompt resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L398) |
| `ForkRuntimeStep` | Public API contract for fork runtime step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L78) |
| `ForkRuntimeStepPreparation` | Prepared messages, instructions, and tools for a fork runtime step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L98) |
| `ForkRuntimeStepPreparationInput` | Input passed to a fork runtime step preparer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L88) |
| `ForkRuntimeStepPreparer` | Public API contract for fork runtime step preparer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L113) |
| `ForkRuntimeStreamLogger` | Public API contract for fork runtime stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L111) |
| `ForkRuntimeStreamMappingState` | State for fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L55) |
| `ForkRuntimeStreamResult` | Result returned from fork runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L69) |
| `ForkRuntimeToolCallState` | Accumulated state for one streamed fork tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L45) |
| `ForkStreamPart` | Text or reasoning delta emitted by a forked runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L2) |
| `ForkToolCallPart` | Complete tool call emitted by a forked runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L30) |
| `ForkToolErrorPart` | Failed tool result emitted by a forked runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L56) |
| `ForkToolInputDeltaPart` | Incremental tool input emitted by a forked runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L20) |
| `ForkToolInputStartPart` | Start of streamed tool input from a forked runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L10) |
| `ForkToolResultPart` | Successful tool result emitted by a forked runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L42) |
| `FormInputToolInput` | Form definition accepted by the durable form-input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L13) |
| `FrameworkStreamState` | State for framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L65) |
| `HandleHostedChildForkFailureInput` | Input payload for handle hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L172) |
| `HandleHostedChildForkRunContextErrorInput` | Input payload for handle hosted child fork run context error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L140) |
| `HostedAgentProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L67) |
| `HostedAgentProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L54) |
| `HostedAgentProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L59) |
| `HostedAgentProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L27) |
| `HostedAgentRunSpan` | Public API contract for hosted agent run span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L16) |
| `HostedAgentRunSpanController` | Public API contract for hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L54) |
| `HostedAgentRunSpanFinalState` | State for hosted agent run span final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L32) |
| `HostedAgentRunTracer` | Public API contract for hosted agent run tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L26) |
| `HostedAgentServiceActiveSpanAttributes` | Public API contract for hosted agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L47) |
| `HostedAgentServiceConfig` | Configuration used by hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L205) |
| `HostedAgentServiceConfigInput` | Input payload for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L207) |
| `HostedAgentServiceDetachedCleanupInput` | Input payload for hosted agent service detached cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L76) |
| `HostedAgentServiceDetachedExecutionInput` | Input payload for hosted agent service detached execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L66) |
| `HostedAgentServiceEnvFileLoadOptions` | Options accepted by hosted agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L21) |
| `HostedAgentServiceEnvFileLoadResult` | Result returned from hosted agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L19) |
| `HostedAgentServiceRouteSet` | Public API contract for hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L122) |
| `HostedAgentServiceRouteSetOptions` | Options accepted by hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L87) |
| `HostedAgentServiceRoutesLogger` | Public API contract for hosted agent service routes logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L30) |
| `HostedAgentServiceRoutesTrace` | Public API contract for hosted agent service routes trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L38) |
| `HostedAgentServiceRuntimeBundle` | Public API contract for hosted agent service runtime bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L102) |
| `HostedAgentServiceRuntimeConfig` | Configuration used by hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L41) |
| `HostedAgentServiceRuntimeLogger` | Public API contract for hosted agent service runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L50) |
| `HostedAgentServiceRuntimeTrace` | Public API contract for hosted agent service runtime trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L59) |
| `HostedAgentServiceStreamExecutionInput` | Input payload for hosted agent service stream execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L56) |
| `HostedAgUiChatForwardedConfig` | Forwarded hosted chat configuration parsed from AG-UI context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L22) |
| `HostedChatContextBudgetLogger` | Public API contract for hosted chat context budget logging. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L191) |
| `HostedChatContextBudgetOptions` | Options accepted by hosted chat context budget management. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L197) |
| `HostedChatExecutionLifecycleAdapter` | Public API contract for hosted chat execution lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-lifecycle-types.ts#L5) |
| `HostedChatExecutionPreparationInput` | Input payload for hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L202) |
| `HostedChatExecutionPreparationResult` | Result returned from hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L241) |
| `HostedChatExecutionPreparationRootRunOptions` | Options accepted by hosted chat execution preparation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L181) |
| `HostedChatExecutionRootStreamWatchdog` | Public API contract for hosted chat execution root stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L95) |
| `HostedChatExecutionRunContext` | Context for hosted chat execution run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L87) |
| `HostedChatExecutionRuntime` | Public API contract for hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L69) |
| `HostedChatExecutionRuntimeBootstrap` | Public API contract for hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L98) |
| `HostedChatExecutionRuntimeLogger` | Public API contract for hosted chat execution runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L79) |
| `HostedChatProjectAccessError` | Error shape for hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L31) |
| `HostedChatProjectAccessResult` | Result returned from hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L38) |
| `HostedChatRequest` | Validated request used to execute hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L79) |
| `HostedChatRequestInput` | Input payload for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L117) |
| `HostedChatRequestMessage` | Message accepted by the hosted chat request schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L67) |
| `HostedChatRequestPrincipal` | Public API contract for hosted chat request principal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L25) |
| `HostedChatRuntimeAgent` | Public API contract for hosted chat runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L84) |
| `HostedChatRuntimeAgentAdapterInput` | Input payload for hosted chat runtime agent adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L25) |
| `HostedChatRuntimeAgentAdapterRunner` | Public API contract for hosted chat runtime agent adapter runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L14) |
| `HostedChatRuntimeAgentAdapterWarning` | Public API contract for hosted chat runtime agent adapter warning. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L19) |
| `HostedChatRuntimeAllowedToolNames` | Public API contract for hosted chat runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L60) |
| `HostedChatRuntimeCreationOptions` | Options accepted by hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L116) |
| `HostedChatRuntimeCreationPreparationInput` | Input payload for hosted chat runtime creation preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L88) |
| `HostedChatRuntimeCreationPreparationResult` | Result returned from hosted chat runtime creation preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L122) |
| `HostedChatRuntimeCreationResult` | Result returned from hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L91) |
| `HostedChatRuntimeFinishPart` | Public API contract for hosted chat runtime finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L14) |
| `HostedChatRuntimeInstructionsInput` | Input payload for hosted chat runtime instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L78) |
| `HostedChatRuntimeOnFinishEvent` | Event emitted for hosted chat runtime on finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L51) |
| `HostedChatRuntimePreparationRootRunContext` | Context for hosted chat runtime preparation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L64) |
| `HostedChatRuntimePreparationSteering` | Public API contract for hosted chat runtime preparation steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L72) |
| `HostedChatRuntimeProjectSteering` | Public API contract for hosted chat runtime project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L99) |
| `HostedChatRuntimeStreamInput` | Input payload for hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L70) |
| `HostedChatRuntimeStreamResult` | Result returned from hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L76) |
| `HostedChatRuntimeTargetKind` | Runtime target kind carried by hosted project-agent runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L113) |
| `HostedChatRuntimeToolAssemblyContext` | Context for hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L46) |
| `HostedChatRuntimeToolAssemblyResult` | Result returned from hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L63) |
| `HostedChatRuntimeToUiMessageStreamOptions` | Options accepted by hosted chat runtime to UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L60) |
| `HostedChildChunkMirror` | Public API contract for hosted child chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L5) |
| `HostedChildConversationBody` | Request body used to create a durable child conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L52) |
| `HostedChildConversationBodyInput` | Input payload for hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L6) |
| `HostedChildExecutionLifecycleOptions` | Options accepted by hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L124) |
| `HostedChildExecutionLifecycleResult` | Result returned from hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L101) |
| `HostedChildExecutionLogEntry` | Entry shape for hosted child execution log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L7) |
| `HostedChildExecutionLogLevel` | Public API contract for hosted child execution log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L4) |
| `HostedChildExecutionLogWriter` | Public API contract for hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L17) |
| `HostedChildFileWriteFallbackLogger` | Public API contract for hosted child file write fallback logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L38) |
| `HostedChildFileWriteFallbackTool` | Public API contract for hosted child file write fallback tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L32) |
| `HostedChildFileWriteFallbackToolExecute` | Public API contract for hosted child file write fallback tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L26) |
| `HostedChildForkExecutionInstrumentation` | Public API contract for hosted child fork execution instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L70) |
| `HostedChildForkExecutionRunContextFactoryInput` | Input used to create a hosted child-fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L88) |
| `HostedChildForkInstructionsContext` | Context for hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L2) |
| `HostedChildForkPendingToolLifecycle` | Public API contract for hosted child fork pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L80) |
| `HostedChildForkResultMode` | Hosted child fork result return mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L17) |
| `HostedChildForkRunContext` | Context for hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L89) |
| `HostedChildForkRunContextInput` | Input payload for hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L110) |
| `HostedChildForkRuntimeConfig` | Configuration used by hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L79) |
| `HostedChildForkRuntimeStepMessages` | Public API contract for hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L42) |
| `HostedChildForkRuntimeStepSystemResolver` | Public API contract for hosted child fork runtime step system resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L16) |
| `HostedChildForkRuntimeToolSelectionResult` | Result returned from hosted child fork runtime tool selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L165) |
| `HostedChildForkStreamHandlingState` | State for hosted child fork stream handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L60) |
| `HostedChildForkStreamLogger` | Public API contract for hosted child fork stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L70) |
| `HostedChildForkStreamMirrorContext` | Context for hosted child fork stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L65) |
| `HostedChildForkStreamState` | State for hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L59) |
| `HostedChildForkStreamTraceInput` | Input payload for hosted child fork stream trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L94) |
| `HostedChildForkToolCallSnapshot` | Public API contract for hosted child fork tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L37) |
| `HostedChildForkToolInput` | Input accepted by the hosted child-fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L20) |
| `HostedChildForkToolResultSnapshot` | Public API contract for hosted child fork tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L47) |
| `HostedChildForkToolSourcesLogger` | Public API contract for hosted child fork tool sources logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L35) |
| `HostedChildInvokeFailure` | Public API contract for hosted child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L13) |
| `HostedChildLifecycleAdapter` | Public API contract for hosted child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L39) |
| `HostedChildLifecycleCompletedState` | Completed terminal state for hosted child execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L32) |
| `HostedChildLifecycleErrorState` | Failed or cancelled terminal state for hosted child execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L59) |
| `HostedChildLifecycleRunnerOptions` | Options accepted by hosted child lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L66) |
| `HostedChildLifecycleRunResult` | Result returned from hosted child lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L88) |
| `HostedChildLifecycleTerminalState` | State for hosted child lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L16) |
| `HostedChildMirrorContext` | Context for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L19) |
| `HostedChildMirrorPart` | Public API contract for hosted child mirror part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L108) |
| `HostedChildMirrorState` | State for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L11) |
| `HostedChildPendingToolCallPhase` | Public API contract for hosted child pending tool call phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L5) |
| `HostedChildPendingToolCallState` | State for hosted child pending tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L8) |
| `HostedChildPendingToolLifecycle` | Tracks incomplete tool calls while a child stream is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L108) |
| `HostedChildPendingToolLifecycleCloseLog` | Public API contract for hosted child pending tool lifecycle close log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L24) |
| `HostedChildPendingToolLifecycleCloseReason` | Public API contract for hosted child pending tool lifecycle close reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L18) |
| `HostedChildPendingToolLifecycleInput` | Input payload for hosted child pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L100) |
| `HostedChildPendingToolLifecycleLogContext` | Context for hosted child pending tool lifecycle log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L54) |
| `HostedChildPendingToolLifecycleLogger` | Public API contract for hosted child pending tool lifecycle logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L46) |
| `HostedChildPendingToolLifecycleLogWriter` | Public API contract for hosted child pending tool lifecycle log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L64) |
| `HostedChildPendingToolLifecycleUnknownToolLog` | Public API contract for hosted child pending tool lifecycle unknown tool log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L34) |
| `HostedChildProjectSwitchHandler` | Handler for hosted child project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L17) |
| `HostedChildRequestedToolsInput` | Input payload for hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L22) |
| `HostedChildRunIdentifiers` | Public API contract for hosted child run identifiers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L5) |
| `HostedChildRunStatusMonitor` | Public API contract for hosted child run status monitor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L15) |
| `HostedChildSameTurnRetryBlockSignal` | Public API contract for hosted child same turn retry block signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L48) |
| `HostedChildSteeringMutationHandler` | Handler for hosted child steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L12) |
| `HostedChildStreamWatchdogPhase` | Public API contract for hosted child stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L4) |
| `HostedChildStreamWatchdogState` | State for hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L7) |
| `HostedChildTerminalErrorCode` | Public API contract for a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L33) |
| `HostedChildTerminalStatus` | Public API contract for hosted child terminal status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L78) |
| `HostedChildWrittenArtifactPathInput` | Input payload for hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L14) |
| `HostedConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L77) |
| `HostedConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L63) |
| `HostedConversationRunChunkMirrorInstrumentation` | Public API contract for hosted conversation run chunk mirror instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L143) |
| `HostedConversationRunChunkMirrorOptions` | Options accepted by hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L157) |
| `HostedConversationRunChunkMirrorTraceAttributes` | Public API contract for hosted conversation run chunk mirror trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L137) |
| `HostedConversationRunStatus` | Status values observed while monitoring a hosted conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L19) |
| `HostedDetachedFinalizationState` | State for hosted detached finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L26) |
| `HostedDurableChildBootstrapCallbacks` | Public API contract for hosted durable child bootstrap callbacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L430) |
| `HostedDurableChildBootstrapContext` | Context for hosted durable child bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L420) |
| `HostedDurableChildExecutionOptions` | Options accepted by hosted durable child execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L36) |
| `HostedDurableChildForkRunContext` | Context for hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L105) |
| `HostedDurableChildForkRunContextInput` | Input payload for hosted durable child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L124) |
| `HostedDurableChildInvokeResult` | Result returned from hosted durable child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L41) |
| `HostedDurableChildInvokeSuccessResultOptions` | Options accepted when building hosted durable child invoke success results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L80) |
| `HostedDurableChildInvokeTraceBase` | Public API contract for hosted durable child invoke trace base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L109) |
| `HostedDurableChildInvokeTraceInput` | Input payload for hosted durable child invoke trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L104) |
| `HostedDurableChildInvokeTraceOverrides` | Public API contract for hosted durable child invoke trace overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L115) |
| `HostedDurableChildInvokeTraceRecorder` | Records trace attributes for durable child invocation outcomes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L120) |
| `HostedDurableChildRuntimeDependencies` | Public API contract for hosted durable child runtime dependencies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L444) |
| `HostedDurableChildSetupFailure` | Public API contract for hosted durable child setup failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L94) |
| `HostedDurableChildSuccess` | Public API contract for hosted durable child success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L72) |
| `HostedDurableChildTerminalFailure` | Public API contract for hosted durable child terminal failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L85) |
| `HostedDurableRunAccepted` | Public API contract for hosted durable run accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L22) |
| `HostedDurableRunAuthErrorResponse` | Response payload for hosted durable run auth error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L28) |
| `HostedDurableRunLogger` | Public API contract for hosted durable run logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L35) |
| `HostedDurableRunSetupErrorStatusCode` | Public API contract for hosted durable run setup error status code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L19) |
| `HostedDurableRunStartCleanupInput` | Input payload for hosted durable run start cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L47) |
| `HostedDurableRunStartExecutionInput` | Input payload for hosted durable run start execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L41) |
| `HostedFormInputToolContext` | Context for hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L25) |
| `HostedLifecycleAdapter` | Public API contract for hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L36) |
| `HostedLifecycleExecution` | Public API contract for hosted lifecycle execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L28) |
| `HostedLifecycleRunnerOptions` | Options accepted by hosted lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L60) |
| `HostedLifecycleRunResult` | Result returned from hosted lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L76) |
| `HostedLifecycleTerminalState` | State for hosted lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L6) |
| `HostedLocalChildInvokeTraceRecorder` | Public API contract for hosted local child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L141) |
| `HostedMirrorBasePart` | Provider-neutral stream parts accepted by the hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L91) |
| `HostedMirroredOpenToolCallLogger` | Public API contract for hosted mirrored open tool call logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L123) |
| `HostedMirroredUiStreamLogger` | Public API contract for hosted mirrored UI stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L129) |
| `HostedMirroredUiStreamWatchdog` | Public API contract for hosted mirrored UI stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L135) |
| `HostedProjectRemoteToolSourceMutationHandler` | Handler for hosted project remote tool source mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L31) |
| `HostedProjectRemoteToolSourcePrepareToolInput` | Input payload for hosted project remote tool source prepare tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L41) |
| `HostedProjectRemoteToolSourceProjectSwitchHandler` | Handler for hosted project remote tool source project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L36) |
| `HostedProjectRemoteToolSourceRetryPolicy` | Public API contract for hosted project remote tool source retry policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L48) |
| `HostedProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L61) |
| `HostedProjectSteeringAdapter` | Public API contract for hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L73) |
| `HostedProjectSteeringAdapterOptions` | Options accepted by hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L48) |
| `HostedProjectSteeringLogger` | Public API contract for hosted project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L43) |
| `HostedResponseFinalizationState` | State for hosted response finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L12) |
| `HostedResponseStreamHeartbeat` | Public API contract for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L18) |
| `HostedResponseStreamHeartbeatState` | State for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L10) |
| `HostedResponseStreamWriter` | Public API contract for hosted response stream writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L4) |
| `HostedRootRunLifecycleRuntimeAdapter` | Public API contract for hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L155) |
| `HostedRuntimeAllowedToolNames` | Public API contract for hosted runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-essential-tools.ts#L2) |
| `HostedRuntimeRequestConfigAgent` | Public API contract for hosted runtime request config agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L19) |
| `HostedRuntimeRequestConfigRequest` | Request payload for hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L13) |
| `HostedRuntimeSourceBindingError` | Stable control-plane error returned when a request cannot run on this service snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L9) |
| `HostedRuntimeSourceIdentity` | Immutable project source identity served by a standalone agent-service process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L4) |
| `HostedRuntimeStateResolverContext` | Context for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L17) |
| `HostedRuntimeStateResolverInput` | Input payload for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L27) |
| `HostedRuntimeStateResolverResult` | Result returned from hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L35) |
| `HostedRuntimeSystemRefresh` | Public API contract for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L47) |
| `HostedRuntimeSystemRefreshInput` | Input payload for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L41) |
| `HostedServiceAuth` | Public API contract for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L123) |
| `HostedServiceAuthConfig` | Configuration used by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L81) |
| `HostedServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L51) |
| `HostedServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L7) |
| `HostedServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L100) |
| `HostedServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L88) |
| `HostedServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L113) |
| `HostedServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L94) |
| `HostedServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L57) |
| `HostedServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L64) |
| `HostedServiceJwtVerifier` | JWT verification capability required by hosted service authentication. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L106) |
| `HostedServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L69) |
| `HostedServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L76) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L37) |
| `HostedStreamTerminalError` | Error shape for hosted stream terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L59) |
| `HostedSubmittedFormInputResult` | Submitted form_input result carried across hosted runtime continuations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L107) |
| `HostedTerminalError` | Error shape for hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L4) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L11) |
| `HumanInputField` | Field displayed in a durable human-input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L26) |
| `HumanInputFieldInput` | Input accepted when constructing a human-input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L167) |
| `HumanInputOption` | Selectable option for choice-based human-input fields. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L14) |
| `HumanInputPendingRequest` | Pending human-input request associated with a runtime wait. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L178) |
| `HumanInputRequest` | Durable form request presented to a human responder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L153) |
| `HumanInputRequestInput` | Input accepted when constructing a human-input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L170) |
| `HumanInputResult` | Result returned when a durable human-input request resolves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L173) |
| `HumanInputResumeValue` | Public API contract for human input resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L309) |
| `InitializeNodeAgentServiceTelemetryOptions` | Options accepted by initialize node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L88) |
| `InitializeNodeHostedAgentServiceTelemetryOptions` | Options accepted by initialize node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L78) |
| `InputRequestOutput` | Output from input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L270) |
| `InputRequestRestOutput` | Normalized durable input request returned by the REST API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L130) |
| `InputResponseRestOutput` | Normalized durable input response returned by the REST API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L80) |
| `InputResponseValues` | Scalar values accepted in one durable input response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L16) |
| `InstallAbortRejectionGuardOptions` | Options accepted by install abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L31) |
| `InstalledAbortRejectionGuard` | Public API contract for installed abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L40) |
| `InstalledProjectAgentExecutionIdentity` | Installed project agent execution identity contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L42) |
| `InstalledProjectAgentRunSnapshot` | Installed project agent run snapshot contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L64) |
| `InvokeAgentChildRunLifecycleCustomEvent` | Custom AG-UI event carrying invoke-agent child lifecycle state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L120) |
| `InvokeAgentChildRunLifecycleValue` | Lifecycle state published for an invoke-agent child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L11) |
| `InvokeAgentChildRunProgressEvent` | Event emitted for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L167) |
| `InvokeAgentChildRunProgressInput` | Input payload for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L152) |
| `InvokeAgentChildRunStateDelta` | State delta that updates invoke-agent child lifecycle state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L82) |
| `LiveStudioMcpToolsOptions` | Options accepted by live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L13) |
| `LoadRuntimeAgentMarkdownDefinitionFromFileInput` | Input payload for load runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L23) |
| `Memory` | Public API contract for memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L53) |
| `MemoryConfig` | Built-in in-memory conversation retention configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L17) |
| `MemoryConfigBase` | ************************ Memory Interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L12) |
| `MemoryPersistence` | Public API contract for memory persistence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L65) |
| `MemoryStats` | Public API contract for memory stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L29) |
| `MessagePart` | Message part accepted by the agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L90) |
| `MinimalMessage` | Minimal message contract required by memory implementations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L39) |
| `MirroredHostedStreamPart` | Hosted stream parts supported by durable child mirroring. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L77) |
| `MirroredPartType` | Stream part kinds tracked by the hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L52) |
| `MirroredToolChunkState` | State for mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L29) |
| `ModelProvider` | Model providers supported by the built-in agent schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L5) |
| `ModelString` | Model configuration string format: "provider/model-name" Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet" | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L42) |
| `ModelTransportRequest` | Request payload for model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L250) |
| `ModelTransportResolver` | Public API contract for model transport resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L283) |
| `MonitorHostedChildRunStatusInput` | Input payload for monitor hosted child run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L148) |
| `MutableAgentProjectContext` | Context for mutable agent project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L2) |
| `NodeAgentServiceInstrumentationConfig` | Configuration used by node agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L23) |
| `NodeAgentServiceRuntimeInfrastructure` | Public API contract for node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L38) |
| `NodeAgentServiceServer` | Public API contract for node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L43) |
| `NodeAgentServiceTelemetryConfig` | Configuration used by node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L51) |
| `NodeAgentServiceTelemetryEnv` | Public API contract for node agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L17) |
| `NodeAgentServiceTelemetryLogger` | Public API contract for node agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L69) |
| `NodeAgentServiceTelemetryProcessTarget` | Public API contract for node agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L75) |
| `NodeHostedAgentServiceInstrumentationConfig` | Configuration used by node hosted agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L20) |
| `NodeHostedAgentServiceRuntimeInfrastructure` | Public API contract for node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L48) |
| `NodeHostedAgentServiceTelemetryConfig` | Configuration used by node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L26) |
| `NodeHostedAgentServiceTelemetryEnv` | Public API contract for node hosted agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L14) |
| `NodeHostedAgentServiceTelemetryLogger` | Public API contract for node hosted agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L66) |
| `NodeHostedAgentServiceTelemetryProcessTarget` | Public API contract for node hosted agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L72) |
| `NodeVeryfrontCloudAgentServiceAgentSource` | Agent source accepted by the Node Veryfront Cloud service launcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L156) |
| `NodeVeryfrontCloudAgentServiceMcpServer` | Public API contract for node Veryfront Cloud agent service MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L159) |
| `NodeVeryfrontCloudAgentServiceOptions` | Options accepted by node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L179) |
| `NodeVeryfrontCloudAgentServicePreparedExecution` | Public API contract for node Veryfront Cloud agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L247) |
| `NodeVeryfrontCloudAgentServiceProcessTarget` | Public API contract for node Veryfront Cloud agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L147) |
| `NormalizeAgUiMessagesOptions` | Options for normalizing AG-UI messages into agent messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L178) |
| `NormalizedAgentServiceChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L41) |
| `NormalizedAgentServiceContract` | Public API contract for normalized agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L142) |
| `NormalizedHostedChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L41) |
| `OpenToolCalls` | Public API contract for open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L115) |
| `ParseAgentServiceChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L66) |
| `ParseAgUiSseResponseOptions` | Options for `parseAgUiSseResponse()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L62) |
| `ParsedAgentServiceAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L79) |
| `ParsedAgentServiceChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L43) |
| `ParsedAgUiSseRun` | Parsed AG-UI SSE response summary for evals, canaries, and host tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L30) |
| `ParsedHostedAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L79) |
| `ParsedHostedChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L43) |
| `ParsedRuntimeSkillDocument` | Public API contract for parsed runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L160) |
| `ParseHostedChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L66) |
| `ParseRuntimeAgentMarkdownDefinitionInput` | Input used to parse one Markdown agent definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L50) |
| `ParseRuntimeAgentRunInvocationHostedChatRequestOptions` | Options accepted when parsing a signed control-plane runtime invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L75) |
| `PersistConversationUserMessageFailure` | Public API contract for persist conversation user message failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L81) |
| `PrepareAgentRuntimeMessagesFromUiMessagesOptions` | Options accepted by prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L22) |
| `PrepareAgentServiceChatRuntimeMessagesOptions` | Options accepted by prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L48) |
| `PrepareAgentServiceConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L91) |
| `PrepareConversationRootRunLifecycleOptions` | Options accepted by prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L24) |
| `PreparedAgentServiceChatExecution` | Public API contract for prepared hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L13) |
| `PreparedAgentServiceChatExecutionDetachedInput` | Input payload for prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L64) |
| `PreparedAgentServiceChatExecutionRuntimeOptions` | Options accepted by prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L34) |
| `PreparedAgentServiceChatExecutionStreamInput` | Input payload for prepared hosted chat execution stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L56) |
| `PrepareDefaultHostedChildForkSandboxToolSourcesInput` | Input payload for prepare default hosted child fork sandbox tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L74) |
| `PrepareDefaultHostedChildForkToolSourcesInput` | Input payload for prepare default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L40) |
| `PreparedHostedChatExecution` | Public API contract for prepared hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L13) |
| `PreparedHostedChatExecutionDetachedInput` | Input payload for prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L64) |
| `PreparedHostedChatExecutionRuntimeOptions` | Options accepted by prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L34) |
| `PreparedHostedChatExecutionStreamInput` | Input payload for prepared hosted chat execution stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L56) |
| `PrepareHostedChatRuntimeMessagesOptions` | Options accepted by prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L48) |
| `PrepareHostedChatRuntimeToolAssemblyInput` | Input payload for prepare hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L77) |
| `PrepareHostedChildForkRuntimeStepMessagesInput` | Input payload for prepare hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L22) |
| `PrepareHostedConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L91) |
| `PrepareVeryfrontCloudAgentServiceChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L25) |
| `PrepareVeryfrontCloudHostedChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L25) |
| `ProjectAgentExecutionIdentity` | Project agent execution identity contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L52) |
| `ProjectAgentExecutionKind` | Project agent execution kind contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L32) |
| `ProjectAgentKind` | Project agent kind contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L26) |
| `ProjectAgentRunSnapshot` | Project agent run snapshot contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L74) |
| `ProjectAgentRuntimeAgentIdCandidates` | Public API contract for project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L31) |
| `ProjectAgentRuntimeAgentSource` | Public API contract for project agent runtime agent source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L28) |
| `ProjectAgentRuntimeDiscovery` | Project discovery plus the normalized policy owned by that exact source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L49) |
| `ProjectSteeringMutationInput` | Input payload for project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L22) |
| `ProjectSteeringMutationResult` | Result returned from project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L31) |
| `ProjectSteeringPaths` | Public API contract for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L16) |
| `ProviderNativeToolInventoryOptions` | Options accepted by provider native tool inventory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L9) |
| `ProviderToolCompatOptions` | Options accepted by provider tool compat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L23) |
| `ProviderToolCompatProvider` | Public API contract for provider tool compat provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L5) |
| `ProviderToolProfile` | Public API contract for provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L13) |
| `RecordExternalAgentWorkerSessionInput` | Input payload for record external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L259) |
| `RecoveredToolObservation` | Observed lifecycle signals for a streamed tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L19) |
| `RedisClient` | Minimal Redis client surface required by {@link RedisMemory}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L30) |
| `RedisEvalOptions` | Redis client interface (compatible with ioredis and node-redis) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L22) |
| `RedisMemoryConfig` | Configuration for one Redis-backed conversation memory store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L46) |
| `RegisterAgentPushRuntimeServiceRequest` | Request payload for register agent push runtime service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L60) |
| `RegisterExternalAgentWorkerInput` | Input payload for register external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L235) |
| `RequestAuthCache` | Public API contract for request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L16) |
| `ResolveAgentServiceRegistrationInputOptions` | Options accepted by resolve agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L184) |
| `ResolveConversationHostedTerminalStateInput` | Input payload for resolve conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L33) |
| `ResolvedAgentConfig` | Configuration used by resolved agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L247) |
| `ResolvedAgentServiceRegistrationInput` | Input payload for resolved agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L23) |
| `ResolvedHostedRuntimeRequestConfig` | Configuration used by resolved hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L35) |
| `ResolvedModelTransport` | Provider runtime and transport options selected for one invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L271) |
| `ResolvedRuntimeState` | State for resolved runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L304) |
| `ResolveHostedChildForkRuntimeConfigInput` | Input payload for resolve hosted child fork runtime config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L161) |
| `ResolveHostedRuntimeRequestConfigInput` | Input payload for resolve hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L25) |
| `ResolveNodeAgentServiceTelemetryConfigOptions` | Options accepted by resolve node agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L62) |
| `ResolveNodeHostedAgentServiceTelemetryConfigOptions` | Options accepted by resolve node hosted agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L54) |
| `ResolveRuntimeAgentDefinitionsDirInput` | Input payload for resolve runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L12) |
| `ResumeValue` | Value submitted when an AG-UI tool wait resumes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L50) |
| `RootOwnedChildResultHint` | Public API contract for root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L58) |
| `RootOwnedChildResultHinted` | Public API contract for root owned child result hinted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L66) |
| `RunAgentRuntimeForkStepInput` | Input payload for run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L267) |
| `RunAgentServiceMainOptions` | Options accepted by run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L30) |
| `RunFrameworkForkStepInput` | Input payload for run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L284) |
| `RunHostedResponseStreamWithHeartbeatOptions` | Options for streaming hosted lifecycle output with keepalive chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L30) |
| `RunResumeSessionManagerOptions` | Options accepted by run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L85) |
| `RunSessionStatus` | Public API contract for run session status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L4) |
| `RuntimeAgentContextItem` | Context item forwarded with a runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L35) |
| `RuntimeAgentControlPlaneStreamRequest` | Request payload for runtime agent control plane stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L495) |
| `RuntimeAgentMarkdownDefinition` | Agent definition loaded from a Markdown frontmatter document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L20) |
| `RuntimeAgentProjectContext` | Project context bound to a runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L50) |
| `RuntimeAgentRunContext` | Durable run context bound to a runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L76) |
| `RuntimeAgentRunInvocation` | Validated payload for invoking a runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L106) |
| `RuntimeAgentSourceContext` | Source revision used to load a runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L41) |
| `RuntimeAgentTargetKind` | Deployment target used by a runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L47) |
| `RuntimeAgentTargetSelectionInput` | Target fields validated together for one runtime invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L290) |
| `RuntimeAgentThinkingConfig` | Controls extended reasoning for a runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L12) |
| `RuntimeAgentTool` | Tool declaration forwarded with a runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L21) |
| `RuntimeAgentValidatedClaims` | Claims validated by the runtime service before invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L64) |
| `RuntimeBuiltinSkillEntriesResult` | Result returned from runtime builtin skill entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L6) |
| `RuntimeClientCapability` | Capability advertised by a runtime client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L8) |
| `RuntimeClientProfile` | Validated identity and capability profile for a runtime client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L18) |
| `RuntimeClientType` | Runtime client category used to select trusted capability defaults. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L5) |
| `RuntimeFileContentFetcher` | Public API contract for runtime file content fetcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L38) |
| `RuntimeFileContentFetcherInput` | Input payload for runtime file content fetcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L25) |
| `RuntimeFileUrlResolver` | Public API contract for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L20) |
| `RuntimeFileUrlResolverInput` | Input payload for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L13) |
| `RuntimeGetProjectFileOptions` | Options accepted by runtime get project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L76) |
| `RuntimeLoadedProjectSkill` | Public API contract for runtime loaded project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L30) |
| `RuntimeLoadedSkillResponse` | Response payload for runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L137) |
| `RuntimeLoadedSkillResponseMessages` | Public API contract for runtime loaded skill response messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L128) |
| `RuntimeLoadSkillBuiltinStore` | Public API contract for runtime load skill builtin store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L62) |
| `RuntimeLoadSkillErrorOutput` | Output from runtime load skill error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L116) |
| `RuntimeLoadSkillReferenceFileOutput` | Output from runtime load skill reference file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L109) |
| `RuntimeLoadSkillToolContext` | Context for runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L54) |
| `RuntimeLoadSkillToolInput` | Input accepted by the runtime skill-loading tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L85) |
| `RuntimeLoadSkillToolMessages` | Public API contract for runtime load skill tool messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L69) |
| `RuntimeLoadSkillToolOptions` | Options accepted by runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L72) |
| `RuntimeLoadSkillToolOutput` | Output from runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L121) |
| `RuntimeProjectFile` | Project file returned by the runtime files API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L9) |
| `RuntimeProjectFileListItem` | Project file entry returned by a runtime files listing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L17) |
| `RuntimeProjectFilesApiOptions` | Options accepted by runtime project files API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L69) |
| `RuntimeProjectFilesClient` | Public API contract for runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L97) |
| `RuntimeProjectFilesClientOptions` | Options accepted by runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L87) |
| `RuntimeProjectFilesFetch` | Public API contract for runtime project files fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L81) |
| `RuntimeProjectFilesTrace` | Public API contract for runtime project files trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L84) |
| `RuntimeProjectInstructionsOptions` | Options accepted by runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L43) |
| `RuntimeProjectSkillCatalogOptions` | Options accepted by runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L32) |
| `RuntimeProjectSkillContext` | Context for runtime project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L14) |
| `RuntimeProjectSkillLoader` | Public API contract for runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L52) |
| `RuntimeProjectSkillLoaderLogger` | Public API contract for runtime project skill loader logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L36) |
| `RuntimeProjectSkillLoaderOptions` | Options accepted by runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L41) |
| `RuntimeProjectSteeringLookup` | Public API contract for runtime project steering lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L25) |
| `RuntimePromptBlockOptions` | Options accepted by runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L2) |
| `RuntimeReasoningOption` | Provider-neutral reasoning / thinking option for model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L264) |
| `RuntimeSkillDefinition` | Definition for runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L91) |
| `RuntimeSkillFrontmatter` | Public API contract for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L21) |
| `RuntimeSkillMetadataLogger` | Public API contract for runtime skill metadata logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L155) |
| `RuntimeStateRequest` | Request payload for runtime state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L288) |
| `RuntimeStateResolver` | Public API contract for runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L312) |
| `RuntimeToolDiscoveryContext` | Per-run context bag for model-driven tool discovery and on-demand loading. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-discovery-context.ts#L15) |
| `RuntimeUploadUrlClientOptions` | Options accepted by runtime upload URL client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L24) |
| `RuntimeUploadUrlFetch` | Public API contract for runtime upload URL fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L21) |
| `RuntimeUploadUrlOptions` | Options accepted by runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L31) |
| `SharedFinalizationHooks` | Finalization hooks shared by streamed and detached hosted execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L250) |
| `SlashCommandArtifactPolicy` | Public API contract for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L15) |
| `SlashCommandArtifactPolicyInput` | Input payload for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L7) |
| `SourceProjectAgentExecutionIdentity` | Source project agent execution identity contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L35) |
| `SourceProjectAgentRunSnapshot` | Source project agent run snapshot contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L57) |
| `StartAgentRuntimeForkInput` | Input payload for start agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L126) |
| `StartAgentRuntimeForkWithHostToolsInput` | Input payload for start agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L151) |
| `StartAgentServiceRuntimeOptions` | Options accepted by start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L139) |
| `StartAgentServiceRuntimeResult` | Result returned from start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L164) |
| `StartAgentServiceServerOptions` | Options accepted by start agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L35) |
| `StartedHostedChildForkRuntime` | Public API contract for started hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L29) |
| `StarterIntentTurnPolicy` | Result of evaluating first-turn starter intent policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L151) |
| `StarterIntentTurnPolicyInput` | Input used to evaluate first-turn starter intent policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L143) |
| `StartHostedChildForkRuntimeWithHostToolsInput` | Input payload for start hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L20) |
| `StartNodeAgentServiceOptions` | Options accepted by start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L133) |
| `StartNodeAgentServiceResult` | Result returned from start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L158) |
| `StartNodeAgentServiceServerOptions` | Options accepted by start node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L27) |
| `StartNodeHostedAgentServiceOptions` | Options accepted by start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L122) |
| `StartNodeHostedAgentServiceResult` | Result returned from start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L150) |
| `StreamedMessage` | Message reconstructed from a streamed fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L31) |
| `StreamedStepState` | State reconstructed while a fork runtime step streams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L39) |
| `StreamedToolCallState` | Tool-call state accumulated while a fork step streams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L13) |
| `StreamToolCall` | Tool call emitted by a streaming provider transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L114) |
| `SubmitResumeValueOutcome` | Public API contract for submit resume value outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L52) |
| `Suggestion` | Public API contract for suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L48) |
| `Suggestions` | Suggested prompts or tasks shown before an agent conversation starts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L75) |
| `TerminalConversationRunStatus` | Public API contract for terminal conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L189) |
| `ToolCall` | Tool call tracked in a finalized agent response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L124) |
| `ToolCallLike` | Minimal tool call shape used to reconcile child-run final steps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L2) |
| `ToolCallPart` | Agent message part for a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L73) |
| `ToolCallPartWithArgs` | Tool-call message part that stores arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L41) |
| `ToolCallPartWithInput` | Tool-call message part that stores input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L57) |
| `ToolExecutionDataEventBridgeStreamInput` | Input payload for tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L8) |
| `ToolExecutionDataEventPublisher` | Public API contract for tool execution data event publisher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L5) |
| `ToolExecutionResultHandler` | Callback invoked after a configured tool finishes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L335) |
| `ToolExecutionResultRequest` | Input passed to the tool result hook after a tool finishes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L317) |
| `ToolResultLike` | Minimal tool result shape used to reconcile child-run final steps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L12) |
| `ToolResultPart` | Agent message part for a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L76) |
| `TracePrimitive` | Primitive value accepted by the tracing attribute encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L2) |
| `VeryfrontCloudAgentServiceChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L20) |
| `VeryfrontCloudAgentServiceOptions` | Options accepted by Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L223) |
| `VeryfrontCloudHostedChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L20) |
| `WaitForDurableHumanInputResolutionOptions` | Options accepted by wait for durable human input resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L352) |
| `WaitForHumanInputOptions` | Options accepted by wait for human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L364) |
| `WorkflowConfig` | Configuration used by workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L98) |
| `WorkflowResult` | Result returned from workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L106) |
| `WorkflowStep` | Public API contract for workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L86) |
| `WrapHostedChildProjectSwitchToolInput` | Input payload for wrap hosted child project switch tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L30) |
| `WrapHostedChildSteeringMutationToolInput` | Input payload for wrap hosted child steering mutation tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L20) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentServiceAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L62) |
| `agentServiceConfigSchema` | Zod schema for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L197) |
| `agentServiceRegistrationConfigSchema` | Zod schema for agent service registration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L84) |
| `agUiSseEventTypes` | AG-UI runtime event type constants normalized from browser-wire SSE events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L5) |
| `conversationRunEventTypes` | Shared conversation run event types value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L7) |
| `createNodeHostedAgentServiceRuntimeInfrastructure` | Create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L82) |
| `defaultHostedInvokeAgentInputSchema` | Schema for default hosted invoke agent input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L193) |
| `defaultHostedInvokeAgentSelectionSchema` | Schema for default hosted invoke agent selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L172) |
| `getAgentContextSchema` | Returns the agent middleware context schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L431) |
| `getAgentResponseSchema` | Returns the agent response schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L394) |
| `getAgentStatusSchema` | Returns the agent status schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L231) |
| `getAgUiContextItemSchema` | Returns the AG-UI context item schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L102) |
| `getAgUiDetachedStartAcceptedSchema` | Returns the detached AG-UI acceptance response schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L110) |
| `getAgUiDetachedStartRequestSchema` | Returns the detached AG-UI start request schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L101) |
| `getAgUiInjectedToolSchema` | Returns the AG-UI injected tool schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L90) |
| `getAgUiRequestSchema` | Returns the AG-UI request schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L149) |
| `getAgUiResumeSignalSchema` | Returns the AG-UI resume signal schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L31) |
| `getAgUiRuntimeContextItemSchema` | Zod schema for get AG-UI runtime context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L206) |
| `getAgUiRuntimeInjectedToolSchema` | Zod schema for get AG-UI runtime injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L191) |
| `getAgUiRuntimeMessageSchema` | Zod schema for get AG-UI runtime message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L294) |
| `getAgUiRuntimeRequestSchema` | Zod schema for get AG-UI runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L314) |
| `getConversationMessageRecordSchema` | Returns the conversation message record schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L56) |
| `getConversationRunEventSchema` | Returns the conversation run event schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L30) |
| `getCreateInputRequestRequestSchema` | Zod schema for get create input request request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L57) |
| `getCreateInputRequestResponseSchema` | Zod schema for get create input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L220) |
| `getDefaultHostedInvokeAgentInputSchema` | Returns the default hosted invoke-agent input schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L185) |
| `getEdgeConfigSchema` | Returns the edge configuration schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L257) |
| `getFormInputToolInputSchema` | Zod schema for get form input tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L44) |
| `getGetInputRequestResponseSchema` | Zod schema for get get input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L223) |
| `getHostedAgUiChatForwardedConfigSchema` | Returns the hosted AG-UI forwarded configuration schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L42) |
| `getHostedChatRequestSchema` | Returns the hosted chat request schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L97) |
| `getHostedChildForkToolInputSchema` | Returns the hosted child-fork tool input schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L42) |
| `getHumanInputFieldSchema` | Zod schema for get human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L210) |
| `getHumanInputOptionSchema` | Zod schema for get human input option. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L188) |
| `getHumanInputPendingRequestSchema` | Zod schema for get human input pending request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L299) |
| `getHumanInputRequestSchema` | Zod schema for get human input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L270) |
| `getHumanInputResultSchema` | Zod schema for get human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L285) |
| `getInputRequestLifecycleDataEventSchema` | Zod schema for get input request lifecycle data event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L251) |
| `getInputRequestOutputSchema` | Zod schema for get input request output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L227) |
| `getInputRequestRestSchema` | Zod schema for get input request rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L170) |
| `getInputResponseRestSchema` | Zod schema for get input response rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L100) |
| `getInputResponseValuesSchema` | Zod schema for get input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L49) |
| `getInvokeAgentChildRunLifecycleCustomEventSchema` | Returns the invoke-agent child lifecycle custom event schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L132) |
| `getInvokeAgentChildRunLifecycleValueSchema` | Returns the invoke-agent child lifecycle value schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L37) |
| `getInvokeAgentChildRunStateDeltaSchema` | Returns the invoke-agent child state delta schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L96) |
| `getMemoryConfigSchema` | Returns the memory configuration schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L245) |
| `getMessagePartSchema` | Returns the agent message part schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L331) |
| `getMessageSchema` | Returns the agent message schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L360) |
| `getModelProviderSchema` | Returns the model provider schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L226) |
| `getParseRuntimeAgentMarkdownDefinitionInputSchema` | Zod schema for get parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L106) |
| `getRuntimeAgentContextItemSchema` | Returns the runtime agent context item schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L215) |
| `getRuntimeAgentMarkdownDefinitionSchema` | Zod schema for get runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L74) |
| `getRuntimeAgentProjectContextSchema` | Returns the runtime agent project context schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L339) |
| `getRuntimeAgentRunContextSchema` | Returns the runtime agent run context schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L376) |
| `getRuntimeAgentRunInvocationSchema` | Returns the runtime agent invocation schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L456) |
| `getRuntimeAgentSourceContextSchema` | Returns the runtime agent source context schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L251) |
| `getRuntimeAgentTargetKindSchema` | Returns the runtime agent target kind schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L278) |
| `getRuntimeAgentThinkingConfigSchema` | Zod schema for get runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L58) |
| `getRuntimeAgentToolSchema` | Returns the runtime agent tool schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L194) |
| `getRuntimeAgentValidatedClaimsSchema` | Returns the validated runtime agent claims schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L358) |
| `getRuntimeClientCapabilitySchema` | Returns the schema for runtime client capabilities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L35) |
| `getRuntimeClientProfileSchema` | Returns the schema for runtime client profiles. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L51) |
| `getRuntimeClientTypeSchema` | Returns the schema for runtime client categories. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L30) |
| `getRuntimeLoadSkillToolInputSchema` | Returns the runtime skill-loading tool input schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L93) |
| `getRuntimeProjectFileListItemSchema` | Returns the runtime project file list item schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L31) |
| `getRuntimeProjectFileSchema` | Returns the runtime project file schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L23) |
| `getStreamToolCallSchema` | Returns the streaming tool-call schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L371) |
| `getToolCallPartSchema` | Returns the tool-call part schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L293) |
| `getToolCallPartWithArgsSchema` | Returns the argument-based tool-call part schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L267) |
| `getToolCallPartWithInputSchema` | Returns the input-based tool-call part schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L279) |
| `getToolCallSchema` | Returns the finalized tool-call schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L380) |
| `getToolResultPartSchema` | Returns the tool-result part schema. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L301) |
| `hostedAgentProjectSteeringOptionsSchema` | Zod schema for hosted agent project steering options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L35) |
| `hostedAgentServiceConfigSchema` | Zod schema for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L202) |
| `hostedAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L62) |
| `hostedChatRequestSchema` | Schema for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L112) |
| `hostedChatRuntimeOverridesSchema` | Schema for hosted chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L49) |
| `hostedChildForkToolInputSchema` | Schema for hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L74) |
| `hostedChildTerminalErrorCodes` | Shared hosted child terminal error codes value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L22) |
| `hostedDurableRootRunDescriptorSchema` | Schema for hosted durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L34) |
| `loadHostedAgentServiceEnvFiles` | Loads hosted agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L66) |
| `loadRuntimeAgentMarkdownDefinitionFromFileInputSchema` | Zod schema for load runtime agent markdown definition from file input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L63) |
| `parseRuntimeAgentMarkdownDefinitionInputSchema` | Schema for parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L118) |
| `resolvedAgentServiceRegistrationInputSchema` | Zod schema for resolved agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L104) |
| `resolveRuntimeAgentDefinitionsDirInputSchema` | Zod schema for resolve runtime agent definitions dir input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L42) |
| `runtimeAgentMarkdownDefinitionSchema` | Schema for runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L100) |
| `runtimeAgentThinkingConfigSchema` | Schema for runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L69) |
| `runtimeClientCapabilitySchema` | Schema for runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L69) |
| `runtimeClientProfileSchema` | Schema for runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L75) |
| `runtimeClientTypeSchema` | Schema for runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L63) |
| `runtimeProjectFileListItemSchema` | Schema for runtime project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L64) |
| `runtimeProjectFileSchema` | Schema for runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L58) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/agent/identity`

Canonical agent catalog kinds value.

```ts
import { isAgentCatalogAction, isAgentCatalogKind, isInstalledProjectAgentKind } from "veryfront/agent/identity";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AGENT_CATALOG_ACTIONS` | Canonical agent catalog actions value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L11) |
| `AGENT_CATALOG_KINDS` | Canonical agent catalog kinds value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L2) |
| `PROJECT_AGENT_EXECUTION_KINDS` | Canonical project agent execution kinds value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L29) |
| `PROJECT_AGENT_KINDS` | Canonical project agent kinds value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L20) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `isAgentCatalogAction` | Return true when a value is a supported agent catalog action. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L84) |
| `isAgentCatalogKind` | Return true when a value is a supported agent catalog kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L79) |
| `isInstalledProjectAgentKind` | Return true when a project agent kind identifies an installed agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L96) |
| `isProjectAgentExecutionKind` | Return true when a value is a supported project agent execution kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L103) |
| `isProjectAgentKind` | Return true when a value is a supported project agent kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L91) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentCatalogAction` | Agent catalog action contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L17) |
| `AgentCatalogKind` | Agent catalog kind contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L8) |
| `InstalledProjectAgentExecutionIdentity` | Installed project agent execution identity contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L42) |
| `InstalledProjectAgentRunSnapshot` | Installed project agent run snapshot contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L64) |
| `ProjectAgentExecutionIdentity` | Project agent execution identity contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L52) |
| `ProjectAgentExecutionKind` | Project agent execution kind contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L32) |
| `ProjectAgentKind` | Project agent kind contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L26) |
| `ProjectAgentRunSnapshot` | Project agent run snapshot contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L74) |
| `SourceProjectAgentExecutionIdentity` | Source project agent execution identity contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L35) |
| `SourceProjectAgentRunSnapshot` | Source project agent run snapshot contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L57) |
