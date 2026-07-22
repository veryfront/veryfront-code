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
  skills: ["incident-response", "repo-maintainer"], // omit for all visible skills
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
| `id?` | `string` | Unique identifier (auto-generated if omitted) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L129) |
| `name?` | `string` | Human-readable display name for registry and control-plane listings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L131) |
| `avatarUrl?` | `string` | Absolute avatar URL for registry, Studio, and chat identity surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L133) |
| `avatar_url?` | `string` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L135) |
| `description?` | `string` | Optional summary shown in registry and control-plane listings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L137) |
| `model?` | `ModelString` | Optional model string in "provider/model" format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L145) |
| `system` | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code> | System prompt: string, function, or async function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L146) |
| `tools?` | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code> | Tools available to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L147) |
| `sandbox?` | `object` | Optional sandbox selection for runtime-owned sandbox tools such as `bash`. `id` attaches to an existing sandbox session and detaches on run cleanup. When omitted, sandbox tools lazily create a request/project-scoped session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L153) |
| `providerTools?` | `string[]` | Provider-native tools executed by the selected model provider, such as Anthropic `web_search` and `web_fetch`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L163) |
| `mcpServers?` | `AgentMcpServerConfig[]` | Remote MCP servers available to this agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L165) |
| `maxSteps?` | `number` | Max tool-call iterations per request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L166) |
| `temperature?` | `number` | Sampling temperature for model generation. Defaults to 0. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L168) |
| `streaming?` | `boolean` | Enable streaming responses | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L169) |
| `memory?` | `MemoryConfig` | Conversation memory persisted across `stream()` / `generate()` calls on this instance. Omit for the stateless default: every call runs in isolation, which keeps concurrent fan-out on a shared instance correct. When set, the instance accumulates one shared conversation, so reuse it sequentially, not across concurrent independent runs (use a separate instance per run for that). Set `enabled: false` to force the stateless behavior explicitly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L178) |
| `middleware?` | `AgentMiddleware[]` | Execution middleware pipeline | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L179) |
| `edge?` | `EdgeConfig` | Edge runtime configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L180) |
| `multimodal?` | <code>&#123; vision?: boolean; audio?: boolean &#125;</code> | Enable vision and/or audio | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L181) |
| `allowedModels?` | `ModelString[]` | Restrict runtime model overrides to these "provider/model" strings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L185) |
| `resolveModelTransport?` | `ModelTransportResolver` | Optional request-aware hook for overriding the resolved model runtime and provider transport options on a per-call basis. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L190) |
| `resolveRuntimeState?` | `RuntimeStateResolver` | Optional step-boundary hook for refreshing the runtime system prompt and host-owned context during a long-lived run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L195) |
| `onToolResult?` | `ToolExecutionResultHandler` | Optional hook invoked after the runtime executes a configured local, registry, integration, or remote tool and before the tool result is persisted or streamed back to callers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L201) |
| `skills?` | `true \| string[]` | Select the skills advertised in this agent's system prompt. Omit it or use `true` for every visible skill. Use `[]` to advertise none. Skill loading tools remain available to every agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L210) |
| `suggestions?` | `Suggestions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L211) |
| `security?` | `false` | Set to false to disable the default security middleware | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L213) |

**Returns:** `Agent`

### `agent.generate(input)`

Run the agent and return a complete response. Accepts a string or message array as input.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input` | `string \| Message[]` | Prompt string or message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L340) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L341) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L343) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L345) |
| `abortSignal?` | `AbortSignal` | Abort signal for cooperative cancellation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L347) |

**Returns:** <code>Promise&lt;AgentResponse&gt;</code>

### `agent.stream(input)`

Run the agent and stream the response. Returns a result with `.toDataStreamResponse()` for API routes.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input?` | `string` | Prompt string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L351) |
| `messages?` | `Message[]` | Conversation message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L352) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L353) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L355) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L357) |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback fired when a tool is invoked | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L358) |
| `onChunk?` | <code>(chunk: string) =&gt; void</code> | Callback fired for each text chunk | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L359) |
| `onFinish?` | <code>(response: AgentResponse) =&gt; void</code> |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L360) |
| `abortSignal?` | `AbortSignal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L361) |

**Returns:** <code>Promise&lt;AgentStreamResult&gt;</code>

### `agent.respond(request)`

Convert an HTTP request into an AG-UI streaming response for route handlers.

**Returns:** <code>Promise&lt;Response&gt;</code>

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

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AGENT_CATALOG_ACTIONS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L8) |
| `AGENT_CATALOG_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L1) |
| `AGENT_DELEGATE_TOOL_PREFIX` | Prefix used for the delegate tool exposed to the coordinator agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation-names.ts#L2) |
| `AgUiDetachedStartAcceptedSchema` | Schema for AG-UI detached start accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L102) |
| `AgUiDetachedStartRequestSchema` | Schema for AG-UI detached start request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L98) |
| `AgUiRequestSchema` | Schema for AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L120) |
| `AgUiResumeSignalSchema` | Schema for AG-UI resume signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L32) |
| `AppendConversationRunEventsResponseSchema` | Schema for append conversation run events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L375) |
| `CompleteConversationRunResponseSchema` | Schema for complete conversation run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L311) |
| `CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE` | Shared conversation hosted aborted terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L19) |
| `CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE` | Shared conversation hosted incomplete tool calls terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L21) |
| `CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE` | Shared conversation hosted stream error terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L17) |
| `ConversationMessageRecordSchema` | Schema for conversation message record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L55) |
| `ConversationRecordSchema` | Schema for conversation record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L43) |
| `ConversationRunEventSchema` | Schema for conversation run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L30) |
| `ConversationRunProjectionSchema` | Schema for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L161) |
| `ConversationRunStatusSchema` | Schema for conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L83) |
| `ConversationRunTargetsSchema` | Schema for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L17) |
| `DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS` | Default value for fork response promise timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L82) |
| `DEFAULT_HOSTED_CHILD_AGENT_ID` | Default value for hosted child agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L8) |
| `DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES` | Default value for hosted child excluded tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L37) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS` | Default value for hosted child fork stream active tool timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L61) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS` | Default value for hosted child fork stream finalization timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L65) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L59) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream post tool idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L63) |
| `DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS` | Default value for hosted child requested tool companions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L45) |
| `DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN` | Default value for hosted child sandbox required cue pattern. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L53) |
| `DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS` | Default value for hosted child status poll interval ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L67) |
| `DEFAULT_PROJECT_STEERING_PATHS` | Default value for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L2) |
| `DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER` | Default value for runtime agent context marker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L49) |
| `DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL` | Shared delegate only when materially helpful value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L9) |
| `ExternalAgentWorkerRequestSnapshotSchema` | Zod schema for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L117) |
| `ExternalAgentWorkerRunSchema` | Zod schema for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L166) |
| `ExternalAgentWorkerSchema` | Zod schema for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L88) |
| `ExternalAgentWorkerSessionSchema` | Zod schema for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L137) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE` | Shared first turn starter intent root ownership block message value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L133) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY` | Shared first turn starter intent root ownership context key value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L130) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER` | Shared first turn starter intent root ownership reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L127) |
| `HOSTED_CHILD_FORK_INSTRUCTIONS_BASE` | Shared hosted child fork instructions base value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L9) |
| `HOSTED_CHILD_STREAM_TIMEOUT_TOKEN` | Shared hosted child stream timeout token value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L30) |
| `InvokeAgentChildRunLifecycleCustomEventSchema` | Schema for invoke agent child run lifecycle custom event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L79) |
| `InvokeAgentChildRunLifecycleValueSchema` | Schema for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L32) |
| `InvokeAgentChildRunStateDeltaSchema` | Schema for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L58) |
| `KEEP_ROOT_ASSISTANT_VISIBLE_OWNER` | Shared keep root assistant visible owner value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L7) |
| `LOAD_SKILL_CONTINUATION_REMINDER` | Shared load skill continuation reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L118) |
| `LOAD_SKILL_CONTINUE_SAME_TURN` | Shared load skill continue same turn value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L19) |
| `LOAD_SKILL_CONTINUE_SAME_TURN_NOW` | Shared load skill continue same turn now value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L21) |
| `LOAD_SKILL_DELEGATION_THRESHOLD` | Shared load skill delegation threshold value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L28) |
| `LOAD_SKILL_OVERRIDE_FORWARDING` | Shared load skill override forwarding value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L30) |
| `LOAD_SKILL_ROOT_OWNERSHIP` | Shared load skill root ownership value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L23) |
| `LOAD_SKILL_TOOL_INTERSECTION` | Shared load skill tool intersection value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L33) |
| `LOAD_SKILL_USE_ALLOWED_TOOLS` | Shared load skill use allowed tools value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L25) |
| `MAX_RUNTIME_SKILL_PROMPT_ENTRIES` | Maximum value for runtime skill prompt entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L12) |
| `NO_DELEGATION_NARRATION_UNLESS_ASKED` | Shared no delegation narration unless asked value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L12) |
| `PROJECT_AGENT_EXECUTION_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L22) |
| `PROJECT_AGENT_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L15) |
| `PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES` | Shared project steering file mutation tool names value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L8) |
| `ROOT_OWNED_CHILD_RESULT_INSTRUCTION` | Shared root owned child result instruction value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L42) |
| `RUNTIME_LOAD_SKILL_CONTINUATION_NOTE` | Shared runtime load skill continuation note value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L34) |
| `RUNTIME_LOAD_SKILL_DESCRIPTION` | Shared runtime load skill description value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L38) |
| `RuntimeAgentContextItemSchema` | Schema for runtime agent context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L125) |
| `RuntimeAgentIdSchema` | Schema for runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L58) |
| `RuntimeAgentProjectContextSchema` | Schema for runtime agent project context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L217) |
| `RuntimeAgentRunContextSchema` | Schema for runtime agent run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L300) |
| `RuntimeAgentRunIdSchema` | Schema for runtime agent run ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L32) |
| `RuntimeAgentRunInvocationSchema` | Schema for runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L341) |
| `RuntimeAgentServiceIdSchema` | Schema for runtime agent service ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L51) |
| `RuntimeAgentSourceContextSchema` | Schema for runtime agent source context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L148) |
| `RuntimeAgentTargetKindSchema` | Schema for runtime agent target kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L157) |
| `RuntimeAgentToolCallIdSchema` | Schema for runtime agent tool call ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L39) |
| `RuntimeAgentToolNameSchema` | Schema for runtime agent tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L70) |
| `RuntimeAgentToolSchema` | Schema for runtime agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L95) |
| `RuntimeAgentValidatedClaimsSchema` | Schema for runtime agent validated claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L231) |
| `RuntimeSkillFrontmatterSchema` | Schema for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L61) |
| `SLASH_COMMAND_ARTIFACT_REMINDER` | Shared slash command artifact reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L121) |
| `SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE` | Shared synthesize delegated findings in root voice value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L15) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addFirstTurnStarterIntentRootOwnershipReminder` | Add first turn starter intent root ownership reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L228) |
| `addLoadSkillContinuationReminder` | Add load skill continuation reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L292) |
| `addSlashCommandArtifactReminder` | Add slash command artifact reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L315) |
| `agent` | Agent helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/factory.ts#L95) |
| `agentAsTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L51) |
| `appendAgentServiceChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L180) |
| `appendConversationRunEvents` | Append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L988) |
| `appendHostedChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L180) |
| `appendMissingChildRunToolCalls` | Append missing child run tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L15) |
| `appendMissingChildRunToolResults` | Append missing child run tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L31) |
| `applyAgentProjectContextChange` | Apply agent project context change helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L13) |
| `applyDefaultResearchArtifactPath` | Apply default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L218) |
| `applyPartToStreamedStepState` | State for apply part to streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L75) |
| `bootstrapAgentService` | Bootstrap agent service helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L56) |
| `bootstrapConversationAgentRun` | Bootstrap conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L319) |
| `bootstrapHostedChildRun` | Bootstrap hosted child run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L54) |
| `buildAgentDelegateTools` | Builds the opt-in delegate tools for a coordinator agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L63) |
| `buildAgentRunTraceAttributes` | Builds agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L181) |
| `buildAgUiBrowserFinalizeResponse` | Response payload for build AG-UI browser finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L364) |
| `buildAgUiSseTraceSignature` | Build a compact ordered event-type signature for regression checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L75) |
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L233) |
| `buildChildRunExecutionSnapshot` | Builds child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L79) |
| `buildChildRunExhaustedStepBudgetErrorMessage` | Message shape for build child run exhausted step budget error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L47) |
| `buildChildRunFailureResult` | Result returned from build child run failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L118) |
| `buildChildRunFailureSnapshot` | Builds child run failure snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L135) |
| `buildChildRunResultCommon` | Builds child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L96) |
| `buildChildRunResultSummary` | Builds child run result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L321) |
| `buildChildRunSuccessResult` | Result returned from build child run success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L101) |
| `buildChildRunSuccessSnapshot` | Builds child run success snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L154) |
| `buildDefaultHostedChildForkToolSet` | Builds default hosted child fork tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L404) |
| `buildDefaultResearchArtifactPathReminder` | Builds default research artifact path reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L96) |
| `buildDefaultResearchArtifactPaths` | Builds default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L118) |
| `buildDetachedAgUiStartRequest` | Request payload for build detached AG-UI start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L143) |
| `buildDetachedFallbackChunks` | Builds detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L162) |
| `buildDetachedFallbackMessageState` | State for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L102) |
| `buildExecuteToolTraceAttributes` | Builds execute tool trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L220) |
| `buildFinalizedAgentRunTraceAttributes` | Builds finalized agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L281) |
| `buildFinalizedMessageFallbackChunks` | Builds finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L126) |
| `buildFinalizedMessageState` | State for build finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L70) |
| `buildForkRuntimeStepFromResponse` | Build a fork runtime step from an agent response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-progress.ts#L12) |
| `buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation` | Builds hosted chat request forwarded props from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L116) |
| `buildHostedChatRequestFromRuntimeAgentInvocation` | Builds hosted chat request from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L166) |
| `buildHostedChatRequestInputFromRuntimeAgentInvocation` | Builds hosted chat request input from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L135) |
| `buildHostedChildCompletedLog` | Builds hosted child completed log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L69) |
| `buildHostedChildConversationBody` | Builds hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L35) |
| `buildHostedChildErrorLog` | Builds hosted child error log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L89) |
| `buildHostedChildExhaustedStepBudgetLog` | Builds hosted child exhausted step budget log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L48) |
| `buildHostedChildForkInstructions` | Builds hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L65) |
| `buildHostedChildToolDescription` | Builds hosted child tool description. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L429) |
| `buildHostedDurableChildInvokeFailureResult` | Result returned from build hosted durable child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L160) |
| `buildHostedDurableChildInvokeSuccessResult` | Result returned from build hosted durable child invoke success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L217) |
| `buildHostedDurableChildInvokeTerminalFailureResult` | Result returned from build hosted durable child invoke terminal failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L185) |
| `buildInputRequestLifecycleDataEvent` | Event emitted for build input request lifecycle data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L282) |
| `buildInvokeAgentChildRunLifecycleCustomEvent` | Event emitted for build invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L148) |
| `buildInvokeAgentChildRunProgressEvents` | Builds invoke agent child run progress events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L159) |
| `buildInvokeAgentChildRunStateDelta` | Builds invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L131) |
| `buildInvokeAgentFollowupInstruction` | Builds invoke agent followup instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L103) |
| `buildInvokeAgentTraceAttributes` | Builds invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L235) |
| `buildParsedAgentServiceAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L178) |
| `buildParsedAgentServiceChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L145) |
| `buildParsedHostedAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L178) |
| `buildParsedHostedChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L145) |
| `buildProjectServiceTraceAttributes` | Builds Datadog unified service trace attributes for a hosted project run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L93) |
| `buildRecoveredStepParts` | Builds recovered step parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L59) |
| `buildRootOwnedChildResultHint` | Builds root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L45) |
| `buildRootOwnedChildRunResultHint` | Builds root owned child run result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L348) |
| `buildRootOwnedChildRunResultText` | Builds root owned child run result text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L333) |
| `buildRootOwnedDelegatedFindingsInstruction` | Builds root owned delegated findings instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L37) |
| `buildRuntimeAgentControlPlaneStreamRequestFromInvocation` | Builds runtime agent control plane stream request from invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L390) |
| `buildRuntimeAvailableSkillsPromptBlock` | Builds runtime available skills prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L41) |
| `buildRuntimeLoadedSkillResponse` | Response payload for build runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L248) |
| `buildRuntimeSkillDefinition` | Definition for build runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L197) |
| `buildScheduleTraceAttributes` | Builds schedule trigger trace attributes from schedule forwarded props. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L76) |
| `buildStarterIntentRootOwnershipBlockMessage` | Message shape for build starter intent root ownership block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L113) |
| `buildStarterIntentRootOwnershipReminder` | Builds starter intent root ownership reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L108) |
| `buildStudioMcpHeaders` | Builds studio MCP headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L30) |
| `buildVeryfrontCloudRuntimeInstructions` | Builds Veryfront Cloud runtime instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L71) |
| `cleanupAfterHostedChatExecutionFinalization` | Cleanup after hosted chat execution finalization helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L202) |
| `clearProjectAgentRuntimeRegistries` | Clear project agent runtime registries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L83) |
| `clientAllowsStudioMcp` | Client allows studio MCP helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L136) |
| `cloneMirroredToolChunkState` | State for clone mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L51) |
| `closeAgentServiceChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L193) |
| `closeAgentServiceChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L213) |
| `closeChildRunExecutionBuffers` | Close child run execution buffers helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L20) |
| `closeHostedChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L193) |
| `closeHostedChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L213) |
| `closeHostedMirroredOpenToolCalls` | Close hosted mirrored open tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L202) |
| `composeAbortSignals` | Compose abort signals helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L61) |
| `computeOpenToolCalls` | Compute open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L172) |
| `containsExactArtifactPathValue` | Contains exact artifact path value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L195) |
| `convertAgentRuntimeMessagesToProviderMessages` | Convert agent runtime messages to provider messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L668) |
| `convertCompactedProviderMessagesToChildForkRuntimeMessages` | Convert compacted provider messages to child fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L101) |
| `convertProviderMessagesToAgentRuntimeMessages` | Convert provider messages to agent runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L656) |
| `createAgentServiceAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L156) |
| `createAgentServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L273) |
| `createAgentServiceChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L233) |
| `createAgentServiceFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L34) |
| `createAgentServiceProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L80) |
| `createAgentServiceRegistrationLifecycle` | Create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L378) |
| `createAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L196) |
| `createAgentServiceRuntime` | Create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L209) |
| `createAgentServiceServerRuntime` | Create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L54) |
| `createAgUiBrowserChunkEncoder` | Create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L94) |
| `createAgUiBrowserEncoderState` | State for create AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L56) |
| `createAgUiBrowserFinalizeTracker` | Create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L23) |
| `createAgUiBrowserResponseStream` | Create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L61) |
| `createAgUiCancelHandler` | Handler for create AG-UI cancel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L144) |
| `createAgUiChatUiChunkBrowserEncoder` | Create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L253) |
| `createAgUiChatUiTrackedBrowserResponse` | Response payload for create AG-UI chat UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L271) |
| `createAgUiChunkEncoderBridge` | Create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L24) |
| `createAgUiDetachedStartHandler` | Handler for create AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L402) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L510) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L515) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L520) |
| `createAgUiResumeHandler` | Handler for create AG-UI resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L74) |
| `createAgUiRunErrorEvent` | Event emitted for create AG-UI run error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L428) |
| `createAgUiRuntimeBrowserResponse` | Response payload for create AG-UI runtime browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L29) |
| `createAgUiRuntimeChatStreamEncoder` | Create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L248) |
| `createAgUiRuntimeContextMap` | Create AG-UI runtime context map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L12) |
| `createAgUiRuntimeEventEncoder` | Create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L25) |
| `createAgUiRuntimeHandler` | Handler for create AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L402) |
| `createAgUiSseErrorResponse` | Response payload for create AG-UI sse error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L439) |
| `createAgUiSseResponse` | Response payload for create AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L452) |
| `createAgUiTrackedBrowserResponse` | Response payload for create AG-UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L24) |
| `createBootstrappedHostedChatExecutionRuntime` | Create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L409) |
| `createChatUiMessageStreamFromDataStream` | Create chat UI message stream from data stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L522) |
| `createConversationAgentRun` | Create conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1065) |
| `createConversationChildLifecycleAdapter` | Create conversation child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L216) |
| `createConversationHostedLifecycleAdapter` | Create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L50) |
| `createConversationHostedStreamLifecycleAdapter` | Create conversation hosted stream lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L136) |
| `createConversationHostedTerminalAdapter` | Create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L194) |
| `createConversationMessage` | Message shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L191) |
| `createConversationRecord` | Record shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L175) |
| `createConversationRootRunContext` | Context for create conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L47) |
| `createConversationRootRunStartAdapter` | Create conversation root run start adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L101) |
| `createConversationRunChunkMirror` | Create conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L152) |
| `createConversationRunContext` | Context for create conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L12) |
| `createConversationRunEventQueueController` | Create conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L693) |
| `createConversationRunMirror` | Create conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L83) |
| `createConversationRunStreamMirror` | Create conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L24) |
| `createDefaultAgentServiceChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L324) |
| `createDefaultAgentServiceInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L599) |
| `createDefaultAgentServiceProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L177) |
| `createDefaultHostedChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L324) |
| `createDefaultHostedInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L599) |
| `createDefaultHostedProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L177) |
| `createDefaultResearchRunArtifactMirrorHandler` | Handler for create default research run artifact mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L362) |
| `createDetachedRunShutdownLifecycle` | Create detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L144) |
| `createDetachedRunTracker` | Create detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L61) |
| `createExternalAgentWorkerClient` | Create external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L416) |
| `createForkRuntimeStreamMappingState` | State for create fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L163) |
| `createForkRuntimeUserMessage` | Message shape for create fork runtime user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L394) |
| `createFrameworkStreamState` | State for create framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L332) |
| `createHostedAgentProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L80) |
| `createHostedAgentRunSpanController` | Create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L71) |
| `createHostedAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L196) |
| `createHostedAgentServiceRuntime` | Create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L276) |
| `createHostedAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L156) |
| `createHostedChatExecutionRuntime` | Create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L705) |
| `createHostedChatExecutionRuntimeBootstrap` | Create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L296) |
| `createHostedChatFinalizeDetachedBuildState` | State for create hosted chat finalize detached build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L521) |
| `createHostedChatFinalizeResponseBuildState` | State for create hosted chat finalize response build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L481) |
| `createHostedChatRuntimeAgentAdapter` | Create hosted chat runtime agent adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L43) |
| `createHostedChatStreamFinalizationHooks` | Create hosted chat stream finalization hooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L446) |
| `createHostedChildExecutionLogWriter` | Create hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L39) |
| `createHostedChildForkRunContext` | Context for create hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L129) |
| `createHostedChildInvokeTool` | Create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L55) |
| `createHostedChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L233) |
| `createHostedChildPendingToolLifecycle` | Create hosted child pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L90) |
| `createHostedChildPendingToolLifecycleLogger` | Create hosted child pending tool lifecycle logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L54) |
| `createHostedConversationRunChunkMirror` | Create hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L349) |
| `createHostedDurableChildForkRunContext` | Context for create hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L169) |
| `createHostedDurableChildInvokeTraceRecorder` | Create hosted durable child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L260) |
| `createHostedFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L34) |
| `createHostedMirroredUiStream` | Create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L249) |
| `createHostedProjectRemoteToolSource` | Create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L87) |
| `createHostedProjectRemoteToolSources` | Create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L336) |
| `createHostedProjectSteeringAdapter` | Create hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L138) |
| `createHostedRootRunLifecycleRuntimeAdapter` | Create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L162) |
| `createHostedRuntimeStateResolver` | Create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L72) |
| `createHostedServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L273) |
| `createInitialForkRuntimeMessages` | Create initial fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L408) |
| `createInputRequest` | Request payload for create input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L210) |
| `createLiveStudioMcpTools` | Create live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L71) |
| `createMemory` | Create memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L352) |
| `createMirroredToolChunkState` | State for create mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L39) |
| `createNodeAgentServiceRuntimeInfrastructure` | Create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L46) |
| `createNodeVeryfrontCloudAgentServiceRuntime` | Create node Veryfront Cloud agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1206) |
| `createRedisMemory` | Create redis memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L249) |
| `createRequestAuthCache` | Create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L19) |
| `createRuntimeAgentDefinitionFromAgent` | Create runtime agent definition from agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L141) |
| `createRuntimeAgentFromMarkdownDefinition` | Definition for create runtime agent from markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L9) |
| `createRuntimeAgentSystemMessages` | Create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L213) |
| `createRuntimeLoadSkillTool` | Create runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L426) |
| `createRuntimeProjectFilesClient` | Create runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L104) |
| `createRuntimeProjectSkillLoader` | Create runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L327) |
| `createRuntimePromptBlock` | Create runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L9) |
| `createStreamedStepState` | State for create streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L43) |
| `createToolExecutionDataEventBridgeStream` | Create tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L41) |
| `createToolResultPart` | Create a chat tool-result part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L408) |
| `createVeryfrontCloudAgentServiceChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L44) |
| `createVeryfrontCloudHostedChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L44) |
| `createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L82) |
| `createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L82) |
| `createVeryfrontCloudRuntimeSystemMessages` | Create Veryfront Cloud runtime system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L44) |
| `createWorkflow` | Create workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L110) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L288) |
| `defineAgentService` | Define an agent service and expose a policy-neutral runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L376) |
| `deriveAgentServiceAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L109) |
| `deriveAgUiForwardedConfig` | Configuration used by derive AG-UI forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L72) |
| `deriveHostedAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L109) |
| `describeProjectAgentRuntimeAgentIdCandidates` | Describe project agent runtime agent ID candidates helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L193) |
| `discoverProjectAgentRuntime` | Discover project agent runtime helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L92) |
| `dispatchConversationHostedStreamErrorState` | State for dispatch conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L102) |
| `dispatchConversationHostedTerminalState` | State for dispatch conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L87) |
| `doesProjectAgentRuntimeAgentMatchSource` | Does project agent runtime agent match source helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L128) |
| `encodeConversationRunEvents` | Encode conversation run events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L278) |
| `ensureConversationProjectLink` | Ensure conversation project link helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L148) |
| `evaluateSlashCommandArtifactPolicy` | Evaluate slash command artifact policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L200) |
| `evaluateStarterIntentTurnPolicy` | Evaluate starter intent turn policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L210) |
| `executeAgUiDetachedStart` | Execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L300) |
| `executeDefaultAgentServiceInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L420) |
| `executeDefaultHostedInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L420) |
| `executeDurableHumanInputFlow` | Execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L219) |
| `executeHostedChildForkRunContextStream` | Execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L224) |
| `executeHostedChildForkStream` | Execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L487) |
| `executeHostedChildForkToolInput` | Input payload for execute hosted child fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L239) |
| `executeHostedChildForkWithPreparedTools` | Execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L293) |
| `executeHostedDurableChatRun` | Execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L229) |
| `executeHostedDurableChildFork` | Execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L685) |
| `executeHostedLocalChildInvoke` | Execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L362) |
| `expandAllowedRemoteToolNames` | Normalize allowed remote tool names without adding undeclared provider-native tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L56) |
| `expandHostedChildRequestedTools` | Expand hosted child requested tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L87) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L227) |
| `extractLatestUserText` | Extract latest user text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L68) |
| `extractStarterIntentId` | Extract starter intent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L192) |
| `fetchConversationRecord` | Record shape for fetch conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L134) |
| `fetchDefaultAgentServiceProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L66) |
| `fetchDefaultHostedProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L66) |
| `fetchLatestConversationUserText` | Fetch latest conversation user text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L112) |
| `filterAgentTraceAttributes` | Filter agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L61) |
| `filterHostedChatRuntimeLocalTools` | Filter hosted chat runtime local tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L187) |
| `finalizeAgUiBrowserEvents` | Finalize AG-UI browser events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L855) |
| `finalizeChildRunExecutionResources` | Finalize child run execution resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L28) |
| `finalizeConversationAgentRun` | Finalize conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1146) |
| `finalizeHostedChildForkCompletion` | Finalize hosted child fork completion helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L156) |
| `finalizeHostedChildForkRunContextResources` | Finalize hosted child fork run context resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L306) |
| `finalizeHostedDetached` | Finalize hosted detached helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L214) |
| `finalizeHostedResponse` | Response payload for finalize hosted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L149) |
| `findLatestUserConversationMessageContext` | Context for find latest user conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L250) |
| `findSubmittedFormInputResult` | Find the latest submitted form_input result persisted after the latest user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L204) |
| `flattenSystemInstructions` | Flatten system instructions helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L43) |
| `flushConversationRunEventBatches` | Flush conversation run event batches. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L471) |
| `flushConversationRunEventQueue` | Flush conversation run event queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L585) |
| `formatChildRunStreamPartError` | Error shape for format child run stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L31) |
| `formatRuntimeSkillMetadata` | Formats runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L15) |
| `getAgent` | Return agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L204) |
| `getAgentRuntimeTextPart` | Return a runtime text part when the value carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L314) |
| `getAgentRuntimeToolCallPart` | Return a runtime tool-call part when the value carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L340) |
| `getAgentRuntimeToolResultPart` | Return a runtime tool-result part when the value carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L370) |
| `getAgentsAsTools` | Return agents as tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L253) |
| `getAgentServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L167) |
| `getAgUiChatUiMessageChunkMetadata` | Return AG-UI chat UI message chunk metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L129) |
| `getAgUiChatUiMessageMetadataFromChunk` | Return AG-UI chat UI message metadata from chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L38) |
| `getAgUiChatUiMessageUsageMetadata` | Return AG-UI chat UI message usage metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L53) |
| `getAgUiSseEventsOfType` | Filter parsed AG-UI SSE events by normalized event type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L67) |
| `getAgUiSseStringField` | Return a string field from a parsed AG-UI SSE event record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L61) |
| `getAllAgentIds` | Return all agent IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L214) |
| `getChildRunSnapshotUsage` | Return child run snapshot usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L72) |
| `getConfirmedProjectContextSwitchId` | Return confirmed project context switch ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L58) |
| `getConversationRun` | Return conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L912) |
| `getConversationRunEventJsonByteLength` | Return conversation run event JSON byte length. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L20) |
| `getEmptyHostedFinalizedMessageTerminalError` | Error shape for get empty hosted finalized message terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L118) |
| `getForkRuntimeAllowedToolNames` | Return fork runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L63) |
| `getForwardedHostedModelId` | Return forwarded hosted model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L52) |
| `getForwardedHostedRuntimeOverrides` | Return forwarded hosted runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L62) |
| `getHostedChildWrittenArtifactPath` | Return hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L112) |
| `getHostedMirroredAbortErrorText` | Return hosted mirrored abort error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L161) |
| `getHostedServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L167) |
| `getHostedStreamErrorText` | Return hosted stream error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L113) |
| `getInputRequest` | Request payload for get input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L254) |
| `getMaxForkRuntimeStepCount` | Return max fork runtime step count. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L425) |
| `getProjectAgentRuntimeAgentIdCandidates` | Return project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L172) |
| `getProjectSteeringMutation` | Return project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L92) |
| `getProviderNativeToolNames` | Return provider native tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L44) |
| `getProviderToolProfile` | Return provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L51) |
| `getRuntimeAgentMarkdownDefinition` | Definition for get runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L54) |
| `getRuntimeProjectFile` | Return runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L114) |
| `getRuntimeProjectFiles` | Return runtime project files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L150) |
| `getRuntimeProjectInstructions` | Return runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L114) |
| `getRuntimeProjectSkillCatalog` | Return runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L134) |
| `getRuntimeUploadUrl` | Return runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L38) |
| `getTextFromParts` | Return text from parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L296) |
| `getToolArguments` | Return tool arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L314) |
| `handleHostedChildForkFailure` | Process a hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L280) |
| `handleHostedChildForkRunContextError` | Error shape for handle hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L267) |
| `handleHostedChildForkStreamPart` | Process a hosted child fork stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L318) |
| `hasArgs` | Check whether args is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L304) |
| `hasInput` | Input payload for has. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L309) |
| `initializeNodeAgentServiceOpenTelemetry` | Initialize node agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L470) |
| `initializeNodeHostedAgentServiceOpenTelemetry` | Initialize node hosted agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L416) |
| `installAbortRejectionGuard` | Install abort rejection guard helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L114) |
| `isAbortRejectionReason` | Check whether a rejection came from an abort signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L50) |
| `isActiveConversationRunStatus` | Check whether a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L118) |
| `isAgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L68) |
| `isAgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L64) |
| `isAgentServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L27) |
| `isAgentTraceAttributeValue` | Check whether a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L52) |
| `isAlreadyMirroredAgentServiceChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L53) |
| `isAlreadyMirroredHostedChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L53) |
| `isAppendableConversationRunProjection` | Check whether a conversation run projection can accept more events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L125) |
| `isChildRunAbortError` | Error shape for is child run abort. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L26) |
| `isCursorMismatchConversationRunAppendError` | Error shape for is cursor mismatch conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L89) |
| `isDurableMirroredOutputChunk` | Check whether a durable chunk mirrors tool output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L4) |
| `isHostedChildCreateFileAlreadyExistsResult` | Result returned from is hosted child create file already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L107) |
| `isHostedChildTerminalErrorCode` | Check whether a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L27) |
| `isHostedChildTextProjectArtifactPrompt` | Check whether a prompt asks for a hosted child text project artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L101) |
| `isHostedServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L27) |
| `isIgnorableConversationRunAppendError` | Error shape for is ignorable conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L40) |
| `isInstalledProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L78) |
| `isProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L84) |
| `isProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L74) |
| `isProviderSafeDelegateId` | Whether a delegate id produces a provider-safe `agent_{id}` tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation-names.ts#L8) |
| `isResponseLike` | Check whether a value behaves like a Response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/response-like.ts#L2) |
| `isRuntimeAgentMarkdownAgent` | Check whether a runtime agent uses markdown configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L61) |
| `isStarterIntentRootOwnershipRequired` | Check whether starter intent root ownership is required. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L237) |
| `isSuccessfulProjectSteeringMutationResult` | Result returned from is successful project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L131) |
| `listRuntimeBuiltinSkillReferenceFiles` | List runtime builtin skill reference files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L112) |
| `listRuntimeBuiltinSkillReferences` | List runtime builtin skill references. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L128) |
| `loadAgentServiceEnvFiles` | Loads agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L32) |
| `loadRuntimeAgentMarkdownDefinitionFromFile` | Loads runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L152) |
| `loadRuntimeBuiltinSkillCatalog` | Loads runtime builtin skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L61) |
| `mapAgUiRuntimeEventToForkParts` | Map AG-UI runtime event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L175) |
| `mapFrameworkEventToForkParts` | Handles map framework event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L341) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L219) |
| `mapRuntimeStreamEventToAgUiBrowserEvents` | Map runtime stream event to AG-UI browser events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L626) |
| `mergeToolCallInput` | Input payload for merge tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L112) |
| `mergeToolInputDelta` | Merge tool input delta helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L54) |
| `mirrorDefaultResearchRunArtifact` | Mirror default research run artifact helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L299) |
| `monitorConversationRunStatus` | Monitor conversation run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L929) |
| `monitorHostedChildRunStatus` | Monitor hosted child run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L149) |
| `normalizeAgUiBrowserRuntimeRequest` | Request payload for normalize AG-UI browser runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L199) |
| `normalizeAgUiMessages` | Normalizes AG-UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L384) |
| `normalizeAgUiRuntimeMessages` | Normalizes AG-UI runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-support.ts#L18) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L192) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L257) |
| `normalizeChatUiMessageChunkToAgUiRuntimeEvent` | Event emitted for normalize chat UI message chunk to AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L217) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L350) |
| `normalizeConversationRunEvent` | Event emitted for normalize conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L29) |
| `normalizeConversationRunEvents` | Normalizes conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L82) |
| `normalizeEncodedConversationRunEvents` | Normalizes encoded conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L286) |
| `normalizeHostedChildArtifactPath` | Normalizes hosted child artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L133) |
| `normalizeParsedAgentServiceChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L257) |
| `normalizeParsedHostedChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L257) |
| `normalizeRuntimeSkillReferencePath` | Normalizes runtime skill reference path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L232) |
| `parseAgentServiceChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L206) |
| `parseAgentServiceConfig` | Configuration used by parse agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L150) |
| `parseAgUiContextBoolean` | Parses AG-UI context boolean. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L56) |
| `parseAgUiContextJsonValue` | Parses AG-UI context JSON value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L27) |
| `parseAgUiContextNullableString` | Parses AG-UI context nullable string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L46) |
| `parseAgUiContextSchema` | Zod schema for parse AG-UI context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L62) |
| `parseAgUiContextString` | Parses AG-UI context string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L40) |
| `parseAgUiRequest` | Request payload for parse AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L369) |
| `parseAgUiRequestOrError` | Error shape for parse AG-UI request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L374) |
| `parseAgUiRuntimeRequest` | Request payload for parse AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L223) |
| `parseAgUiRuntimeRequestOrError` | Error shape for parse AG-UI runtime request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L228) |
| `parseAgUiSseResponse` | Parse an AG-UI SSE `Response` into normalized events, text, tool starts, and terminal error state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L258) |
| `parseAppendConversationRunEventsErrorBody` | Parses append conversation run events error body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L22) |
| `parseDataStreamSseEvents` | Parses data stream sse events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L14) |
| `parseHostedAgentServiceConfig` | Configuration used by parse hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L158) |
| `parseHostedChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L206) |
| `parseRuntimeAgentMarkdownDefinition` | Definition for parse runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L155) |
| `parseRuntimeAgentRunInvocation` | Parses runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L409) |
| `parseRuntimeAgentRunInvocationAgentServiceChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L235) |
| `parseRuntimeAgentRunInvocationHostedChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L235) |
| `parseRuntimeAgentRunInvocationOrError` | Error shape for parse runtime agent run invocation or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L416) |
| `parseRuntimeSkillDocument` | Parses runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L161) |
| `parseRuntimeSkillMetadata` | Parses runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L189) |
| `parseToolInputObject` | Parses tool input object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L135) |
| `persistConversationUserMessage` | Message shape for persist conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L211) |
| `persistLatestConversationUserMessage` | Message shape for persist latest conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L277) |
| `prepareAgentRuntimeMessagesFromUiMessages` | Prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L34) |
| `prepareAgentServiceChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L394) |
| `prepareAgentServiceChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L292) |
| `prepareAgentServiceChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L511) |
| `prepareAgentServiceConversationRootRunContext` | Context for prepare hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L118) |
| `prepareConversationRootRunContext` | Context for prepare conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L127) |
| `prepareConversationRootRunLifecycle` | Prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L38) |
| `prepareConversationRunChunkEvents` | Prepare conversation run chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L65) |
| `prepareConversationRunExternalEvents` | Prepare conversation run external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L76) |
| `prepareConversationRunStreamEvents` | Prepare conversation run stream events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L57) |
| `prepareDefaultHostedChildForkRuntimeTools` | Prepare default hosted child fork runtime tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L304) |
| `prepareDefaultHostedChildForkSandboxToolSources` | Prepare default hosted child fork sandbox tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L182) |
| `prepareDefaultHostedChildForkToolAssembly` | Prepare default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L358) |
| `prepareDefaultHostedChildForkToolSources` | Prepare default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L85) |
| `prepareHostedChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L394) |
| `prepareHostedChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L292) |
| `prepareHostedChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L511) |
| `prepareHostedChatRuntimeToolAssembly` | Prepare hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L201) |
| `prepareHostedChildForkRuntimeStepMessages` | Prepare hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L113) |
| `prepareHostedConversationRootRunContext` | Context for prepare hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L118) |
| `prepareVeryfrontCloudAgentServiceChatExecution` | Prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L75) |
| `prepareVeryfrontCloudHostedChatExecution` | Prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L75) |
| `publishInvokeAgentChildRunProgress` | Publish invoke agent child run progress helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L169) |
| `readRuntimeBuiltinDirectorySkill` | Read runtime builtin directory skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L83) |
| `readRuntimeBuiltinFlatSkill` | Read runtime builtin flat skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L96) |
| `readRuntimeBuiltinSkill` | Read runtime builtin skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L106) |
| `readRuntimeBuiltinSkillEntries` | Read runtime builtin skill entries helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L30) |
| `readRuntimeBuiltinSkillReferenceFile` | Read runtime builtin skill reference file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L69) |
| `recordMirroredToolChunkState` | State for record mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L65) |
| `recoverConversationRunAppendExecution` | Recover conversation run append execution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L347) |
| `recoverConversationRunAppendFailure` | Recover conversation run append failure helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L249) |
| `recoverConversationRunCursorMismatch` | Recover conversation run cursor mismatch helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L177) |
| `registerAgent` | Registers agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L191) |
| `resolveAgentServiceRegistrationInput` | Input payload for resolve agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L266) |
| `resolveConversationHostedStreamErrorState` | State for resolve conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L68) |
| `resolveConversationHostedTerminalState` | State for resolve conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L43) |
| `resolveConversationRunTargets` | Resolves conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L34) |
| `resolveForkRuntimeContinuationState` | State for resolve fork runtime continuation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L433) |
| `resolveForkStepResponse` | Response payload for resolve fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L283) |
| `resolveHostedChildForkRuntimeConfig` | Configuration used by resolve hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L196) |
| `resolveHostedChildForkThinkingOverride` | Resolves hosted child fork thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L156) |
| `resolveHostedChildPromiseWithTimeout` | Resolves hosted child promise with timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L149) |
| `resolveHostedChildStreamWatchdogState` | State for resolve hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L33) |
| `resolveHostedChildTerminalErrorCode` | Resolves a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L91) |
| `resolveHostedDurableRunSetupErrorResponse` | Response payload for resolve hosted durable run setup error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L85) |
| `resolveHostedRuntimeRequestConfig` | Configuration used by resolve hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L128) |
| `resolveHostedRuntimeThinkingOverride` | Resolves hosted runtime thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L83) |
| `resolveNodeAgentServiceTelemetryConfig` | Configuration used by resolve node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L379) |
| `resolveNodeHostedAgentServiceTelemetryConfig` | Configuration used by resolve node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L315) |
| `resolveRuntimeAgentDefinitionsDir` | Resolves runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L96) |
| `resolveRuntimeAgentMarkdownDefinitionFilePath` | Resolves runtime agent markdown definition file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L140) |
| `resolveRuntimeBuiltinSkillReferenceFilePath` | Resolves runtime builtin skill reference file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L47) |
| `resolveRuntimeBuiltinSkillsDir` | Resolves runtime builtin skills dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L17) |
| `resolveRuntimeClientProfile` | Resolves runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L103) |
| `resolveRuntimeMessageFileUrls` | Resolves runtime message file urls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L67) |
| `resolveSingleProjectAgentRuntimeAgentId` | Resolves single project agent runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L203) |
| `resyncConversationRunAppendCursor` | Resync conversation run append cursor helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L137) |
| `runAgentRuntimeForkStep` | Run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L279) |
| `runAgentServiceMain` | Run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L69) |
| `runFrameworkForkStep` | Handles run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L364) |
| `runHostedChildExecutionLifecycle` | Run hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L301) |
| `runHostedChildLifecycle` | Run hosted child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L168) |
| `runHostedLifecycle` | Run hosted lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L138) |
| `runHostedResponseStreamWithHeartbeat` | Run hosted response stream with heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L67) |
| `runPreparedAgentServiceChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L158) |
| `runPreparedHostedChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L158) |
| `runWithProjectAgentRuntime` | Execute a project-runtime lifetime without allowing an outer policy to widen. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L54) |
| `sanitizeDefaultHostedChildRequestedTools` | Sanitize default hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L268) |
| `sanitizeHostedChildRequestedTools` | Sanitize hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L57) |
| `sanitizeProviderToolSchema` | Zod schema for sanitize provider tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L409) |
| `selectDefaultHostedChildForkRuntimeTools` | Select default hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L283) |
| `selectHostedChildForkRuntimeTools` | Select hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L208) |
| `selectProviderCompatibleToolNames` | Select provider compatible tool names helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L90) |
| `selectProviderCompatibleTools` | Select provider compatible tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L118) |
| `shouldBlockHostedChildSameTurnRetry` | Should block hosted child same turn retry helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L49) |
| `shouldContinueForkRuntimeStep` | Should continue fork runtime step helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-progress.ts#L42) |
| `shouldFailEmptyHostedFinalizedMessage` | Message shape for should fail empty hosted finalized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L132) |
| `shouldInjectDefaultResearchArtifactPath` | Should inject default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L77) |
| `shouldPruneSandboxToolsFromHostedChildRequest` | Request payload for should prune sandbox tools from hosted child. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L122) |
| `shouldReinforceLoadSkillContinuation` | Should reinforce load skill continuation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L242) |
| `shouldRetryCreateResearchArtifactAsUpdate` | Should retry create research artifact as update helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L264) |
| `shouldSkipHostedChildTerminalPersistence` | Should skip hosted child terminal persistence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L99) |
| `snapshotHostedRuntimeSourceIdentity` | Capture a service-owned immutable copy of a declared runtime source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L18) |
| `startAgentRuntimeFork` | Starts agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L462) |
| `startAgentRuntimeForkWithHostTools` | Starts agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L157) |
| `startAgentService` | Starts agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1237) |
| `startAgentServiceRuntime` | Starts agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L321) |
| `startAgentServiceServer` | Starts agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L93) |
| `startConversationRootRun` | Starts conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L62) |
| `startHostedChildForkRuntimeWithHostTools` | Starts hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L38) |
| `startNodeAgentService` | Starts node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L286) |
| `startNodeAgentServiceServer` | Starts node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L76) |
| `startNodeHostedAgentService` | Starts node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L311) |
| `startNodeVeryfrontCloudAgentService` | Starts node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1216) |
| `streamDataStreamEvents` | Stream data stream events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L49) |
| `streamPreparedAgentServiceChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L123) |
| `streamPreparedHostedChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L123) |
| `stringifyAgUiSseEvent` | Stringify an AG-UI SSE event or fallback value for diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L56) |
| `stripLeadingEmptyObjectPlaceholder` | Normalize provider tool input by removing transient empty-object prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L10) |
| `summarizeChildRunResultText` | Summarize child run result text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L304) |
| `summarizeChildRunResultValue` | Summarize child run result value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L358) |
| `throwIfChildRunAborted` | Throw if child run aborted helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L19) |
| `toChildRunToolInputRecord` | Record shape for to child run tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L2) |
| `toConversationHostedTerminalState` | State for to conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L167) |
| `toConversationRunStreamEvent` | Event emitted for to conversation run stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L29) |
| `toHostedChatExecutionFinalState` | State for to hosted chat execution final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L192) |
| `toMirroredAgentServiceStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L89) |
| `toMirroredHostedStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L89) |
| `updateDefaultResearchArtifacts` | Update default research artifacts helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L166) |
| `validateRuntimeAgentTargetSelection` | Validates runtime agent target selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L166) |
| `verifyHostedRuntimeSourceBinding` | Verify that a control-plane request addresses the exact source snapshot served here. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L25) |
| `veryfrontApiMcpServer` | Veryfront API MCP server helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L161) |
| `veryfrontStudioMcpServer` | Veryfront Studio MCP server helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L168) |
| `waitForDurableHumanInputResolution` | Wait for durable human input resolution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L306) |
| `waitForHumanInput` | Input payload for wait for human. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L280) |
| `withDefaultResearchArtifactPath` | Applies default research artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L165) |
| `withHostedChildRerunnableFileWriteFallbacks` | Applies hosted child rerunnable file write fallbacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L38) |
| `withHostedChildStreamIdleTimeout` | Applies hosted child stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L75) |
| `withRootOwnedChildResultHint` | Applies root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L88) |
| `withRuntimeToolInventory` | Applies runtime tool inventory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L27) |
| `wrapHostedChildProjectSwitchTool` | Wrap hosted child project switch tool helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L73) |
| `wrapHostedChildSteeringMutationTool` | Wrap hosted child steering mutation tool helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L37) |
| `writeHostedChildExecutionLogEntry` | Entry shape for write hosted child execution log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L21) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AgentRuntime` | Implement agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/index.ts#L513) |
| `AgentRuntimeMessageConversionError` | Error shape for agent runtime message conversion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L117) |
| `AgentServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L14) |
| `AppendConversationRunEventsError` | Error shape for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L4) |
| `BufferMemory` | Implement buffer memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L128) |
| `ConversationMemory` | Implement conversation memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L84) |
| `ConversationRunEventEncoder` | Implement conversation run event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L61) |
| `ConversationRunTerminalStateError` | Error shape for conversation run terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L105) |
| `HostedChildStreamIdleTimeoutError` | Error shape for hosted child stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L13) |
| `HostedChildTerminalStateError` | Error shape for hosted child terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L72) |
| `HostedServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L14) |
| `HumanInputResumeError` | Error shape for human input resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L201) |
| `InvalidHumanInputResultError` | Error shape for invalid human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L211) |
| `RedisMemory` | Implement redis memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L126) |
| `RunAlreadyExistsError` | Error shape for run already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L15) |
| `RunCancelledError` | Error shape for run cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L7) |
| `RunNotActiveError` | Error shape for run not active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L23) |
| `RunResumeSessionManager` | Implement run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L92) |
| `RuntimeProjectFilesApiAuthError` | Error shape for runtime project files API auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L91) |
| `SummaryMemory` | Implement summary memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L160) |
| `WaitConflictError` | Error shape for wait conflict. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L39) |
| `WaitNotPendingError` | Error shape for wait not pending. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L31) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbortRejectionEvent` | Event emitted for abort rejection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L13) |
| `AbortRejectionEventTarget` | Public API contract for abort rejection event target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L19) |
| `AbortRejectionGuardLogger` | Public API contract for abort rejection guard logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L2) |
| `AbortRejectionProcessTarget` | Public API contract for abort rejection process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L7) |
| `ActiveConversationRunStatus` | Public API contract for a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L164) |
| `Agent` | Public API contract for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L335) |
| `AgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L13) |
| `AgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L6) |
| `AgentConfig` | Configuration used by agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L128) |
| `AgentContext` | Context for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L233) |
| `AgentContract` | Framework-owned agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L104) |
| `AgentMcpHttpTransport` | HTTP transport configuration for one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L88) |
| `AgentMcpServerAuth` | Authentication configuration for one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L94) |
| `AgentMcpServerConfig` | MCP server available to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L125) |
| `AgentMcpToolPolicy` | Policy for tools exposed by one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L81) |
| `AgentMessage` | Message exchanged with an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L225) |
| `AgentMiddleware` | Public API contract for agent middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L289) |
| `AgentPushRuntimeServiceRest` | Public API contract for agent push runtime service rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L39) |
| `AgentRegistry` | Public API contract for agent registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L59) |
| `AgentResponse` | Response payload for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L231) |
| `AgentRuntimeForkStepRunner` | Public API contract for agent runtime fork step runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L108) |
| `AgentRuntimeMessage` | Message shape for agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L86) |
| `AgentRuntimeMessagePart` | Public API contract for agent runtime message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L67) |
| `AgentServiceActiveSpanAttributes` | Public API contract for hosted agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L47) |
| `AgentServiceAgUiChatForwardedConfig` | Configuration used by hosted AG-UI chat forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L44) |
| `AgentServiceAuth` | Public API contract for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L109) |
| `AgentServiceAuthConfig` | Configuration used by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L68) |
| `AgentServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L38) |
| `AgentServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L7) |
| `AgentServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L87) |
| `AgentServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L75) |
| `AgentServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L99) |
| `AgentServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L81) |
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
| `AgentServiceChildMirrorContext` | Context for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L16) |
| `AgentServiceChildMirrorPart` | Public API contract for hosted child mirror part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L86) |
| `AgentServiceChildMirrorState` | State for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L10) |
| `AgentServiceConfig` | Configuration used by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L16) |
| `AgentServiceConfigInput` | Input payload for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L49) |
| `AgentServiceConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L66) |
| `AgentServiceConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L57) |
| `AgentServiceCorsConfig` | Configuration used by agent service cors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L24) |
| `AgentServiceDefinition` | Type-preserving service definition for request-native agent service runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L127) |
| `AgentServiceDetachedCleanupInput` | Input payload for hosted agent service detached cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L76) |
| `AgentServiceDetachedExecutionInput` | Input payload for hosted agent service detached execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L66) |
| `AgentServiceEnvFileLoadOptions` | Options accepted by agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L13) |
| `AgentServiceEnvFileLoadResult` | Result returned from agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L7) |
| `AgentServiceFormInputToolContext` | Context for hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L25) |
| `AgentServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L44) |
| `AgentServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L51) |
| `AgentServiceOptions` | Options accepted by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L223) |
| `AgentServicePreparedExecution` | Public API contract for agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L254) |
| `AgentServiceProcessTarget` | Public API contract for agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L256) |
| `AgentServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L56) |
| `AgentServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L63) |
| `AgentServiceProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L61) |
| `AgentServiceProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L64) |
| `AgentServiceProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L51) |
| `AgentServiceProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L56) |
| `AgentServiceProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L26) |
| `AgentServiceRegistrationConfig` | Configuration used by agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L9) |
| `AgentServiceRegistrationLifecycle` | Public API contract for agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L190) |
| `AgentServiceRegistrationLogger` | Public API contract for agent service registration logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L174) |
| `AgentServiceRegistrationMode` | Public API contract for agent service registration mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L7) |
| `AgentServiceRegistryContract` | Multi-agent service contract. Framework services route to `defaultAgentId` unless the host chooses another registered agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L76) |
| `AgentServiceRoute` | Public API contract for agent service route. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L40) |
| `AgentServiceRouteMethod` | Host-facing server config for the agent service runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L21) |
| `AgentServiceRouteSet` | Public API contract for hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L122) |
| `AgentServiceRouteSetOptions` | Options accepted by hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L87) |
| `AgentServiceRoutesLogger` | Public API contract for hosted agent service routes logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L30) |
| `AgentServiceRoutesTrace` | Public API contract for hosted agent service routes trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L38) |
| `AgentServiceRuntimeBundle` | Public API contract for agent service runtime bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L116) |
| `AgentServiceRuntimeConfig` | Configuration used by agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L47) |
| `AgentServiceRuntimeLogger` | Public API contract for agent service runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L56) |
| `AgentServiceRuntimeTrace` | Public API contract for agent service runtime trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L65) |
| `AgentServiceServer` | Public API contract for agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L45) |
| `AgentServiceServerConfig` | Configuration used by agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L33) |
| `AgentServiceServerLifecycle` | Public API contract for agent service server lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L13) |
| `AgentServiceSingleAgentContract` | Single-agent convenience accepted by `defineAgentService()`. Implementations must normalize this shape into the same registry path used by multi-agent services so framework users are not boxed into one-agent-per-process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L91) |
| `AgentServiceStreamExecutionInput` | Input payload for hosted agent service stream execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L56) |
| `AgentServiceTraceContext` | Context for agent service trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L8) |
| `AgentServiceTraceContextGetter` | Public API contract for agent service trace context getter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L14) |
| `AgentStatus` | Public API contract for agent status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L209) |
| `AgentStreamResult` | Result returned from agent stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L326) |
| `AgentTraceAttributes` | Public API contract for agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L10) |
| `AgentTraceAttributeValue` | Public API contract for a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L4) |
| `AgentTraceUsage` | Public API contract for agent trace usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L13) |
| `AgUiBeforeStream` | Public API contract for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L33) |
| `AgUiBeforeStreamContext` | Context for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L17) |
| `AgUiBeforeStreamMessageInput` | Input payload for AG-UI before stream message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L4) |
| `AgUiBeforeStreamResult` | Result returned from AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L25) |
| `AgUiBrowserChunkEncoder` | Public API contract for AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L14) |
| `AgUiBrowserEncodedEvent` | Event emitted for AG-UI browser encoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L50) |
| `AgUiBrowserEncoderState` | State for AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L35) |
| `AgUiBrowserFinalizeTracker` | Public API contract for AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L9) |
| `AgUiBrowserResponseEncoder` | Public API contract for AG-UI browser response encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L36) |
| `AgUiBrowserResponseExecution` | Public API contract for AG-UI browser response execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L29) |
| `AgUiBrowserResponseRequestState` | State for AG-UI browser response request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L21) |
| `AgUiBrowserRunFinishedMetadata` | Public API contract for AG-UI browser run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L7) |
| `AgUiCancelHandlerOptions` | Options accepted by AG-UI cancel handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L58) |
| `AgUiChatUiChunkBrowserEncoder` | Public API contract for AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L16) |
| `AgUiChunkEncoderBridge` | Public API contract for AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L12) |
| `AgUiCompletion` | Payload handed to {@link AgUiHandlerOptions.onComplete} after an AG-UI run streams to completion successfully - the server-side counterpart to the client's `useConversationChat` persistence path. Lets an application persist the finalized conversation without reconstructing it from the SSE stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L56) |
| `AgUiContextItem` | Public API contract for AG-UI context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L125) |
| `AgUiDetachedStartAccepted` | Public API contract for AG-UI detached start accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L109) |
| `AgUiDetachedStartHandlerOptions` | Options accepted by AG-UI detached start handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L225) |
| `AgUiDetachedStartRequest` | Request payload for AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L105) |
| `AgUiForwardedConfigOptions` | Options accepted by AG-UI forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L6) |
| `AgUiHandlerConfigWithAgent` | Public API contract for AG-UI handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L497) |
| `AgUiHandlerOptions` | Options accepted by AG-UI handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L482) |
| `AgUiInjectedTool` | Public API contract for AG-UI injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L123) |
| `AgUiOnComplete` | Called once after a successful AG-UI run with the finalized conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L83) |
| `AgUiRequest` | Request payload for AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L127) |
| `AgUiResumeHandlerOptions` | Options accepted by AG-UI resume handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L53) |
| `AgUiResumeSignal` | Public API contract for AG-UI resume signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L35) |
| `AgUiResumeValue` | Public API contract for AG-UI resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tool-shared.ts#L12) |
| `AgUiRuntimeChatStreamEncoder` | Public API contract for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L48) |
| `AgUiRuntimeChatStreamEncoderState` | State for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L41) |
| `AgUiRuntimeContextItem` | Public API contract for AG-UI runtime context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L190) |
| `AgUiRuntimeEventEncoder` | Public API contract for AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L13) |
| `AgUiRuntimeHandlerConfig` | Configuration used by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L397) |
| `AgUiRuntimeHandlerConfigWithAgent` | Public API contract for AG-UI runtime handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L392) |
| `AgUiRuntimeHandlerExecute` | Public API contract for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L356) |
| `AgUiRuntimeHandlerExecuteInput` | Input payload for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L348) |
| `AgUiRuntimeHandlerOptions` | Options accepted by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L378) |
| `AgUiRuntimeInjectedTool` | Public API contract for AG-UI runtime injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L186) |
| `AgUiRuntimeLifecycleContext` | Context for AG-UI runtime lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L34) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L194) |
| `AgUiRuntimeRequest` | Request payload for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L196) |
| `AgUiRuntimeStreamEvent` | Event emitted for AG-UI runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L4) |
| `AgUiSseEvent` | Event emitted for AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L18) |
| `AgUiSseEventType` | Normalized AG-UI runtime event type value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L27) |
| `AgUiSseProgressSnapshot` | Progress snapshot emitted while parsing an AG-UI SSE response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L41) |
| `AppendConversationRunEventsResponse` | Response payload for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L316) |
| `AppendExternalAgentWorkerRunEventsInput` | Input payload for append external agent worker run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L220) |
| `BootstrapAgentServiceOptions` | Options accepted by bootstrap agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L20) |
| `BootstrapConversationAgentRunResult` | Result returned from bootstrap conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L312) |
| `BootstrapHostedChildRunInput` | Input payload for bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L16) |
| `BootstrapHostedChildRunResult` | Result returned from bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L30) |
| `BootstrappedHostedChatExecutionRuntime` | Public API contract for bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L175) |
| `BuildAgentDelegateToolsInput` | Input payload for build agent delegate tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L14) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L9) |
| `BuildDetachedFallbackChunksInput` | Input payload for build detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L60) |
| `BuildDetachedFallbackMessageInput` | Input payload for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L29) |
| `BuildFinalizedMessageFallbackChunksInput` | Input payload for build finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L50) |
| `BuildFinalizedMessageStateInput` | Input payload for build finalized message state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L21) |
| `BuildHostedDurableChildInvokeFailureResultInput` | Input payload for build hosted durable child invoke failure result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L62) |
| `BuildParsedAgentServiceAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L65) |
| `BuildParsedHostedAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L65) |
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
| `ChildRunExecutionBufferCleanupInput` | Input payload for child run execution buffer cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L4) |
| `ChildRunExecutionResourceFinalizeInput` | Input payload for child run execution resource finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L10) |
| `ChildRunExecutionResult` | Result returned from child run execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L39) |
| `ChildRunExecutionSnapshot` | Public API contract for child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L26) |
| `ChildRunExecutionUsage` | Public API contract for child run execution usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L4) |
| `ChildRunResultCommon` | Public API contract for child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L62) |
| `ChildRunToolCallSnapshot` | Public API contract for child run tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L11) |
| `ChildRunToolResultSnapshot` | Public API contract for child run tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L18) |
| `ClaimExternalAgentWorkerRunInput` | Input payload for claim external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L197) |
| `CloseHostedMirroredOpenToolCallsInput` | Input payload for close hosted mirrored open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L143) |
| `CompleteExternalAgentWorkerRunInput` | Input payload for complete external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L212) |
| `ConversationAgentRunUsage` | Public API contract for conversation agent run usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L388) |
| `ConversationChildLifecycleContext` | Context for conversation child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L149) |
| `ConversationControlPlaneResponseError` | Error shape for conversation control plane response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L63) |
| `ConversationHostedLifecycleFinalizeInput` | Input payload for conversation hosted lifecycle finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L22) |
| `ConversationHostedTerminalAdapter` | Public API contract for conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L123) |
| `ConversationHostedTerminalRuntimeAdapter` | Public API contract for conversation hosted terminal runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L79) |
| `ConversationHostedTerminalStateInput` | Input payload for conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L9) |
| `ConversationHostedTerminalStateResolution` | Public API contract for conversation hosted terminal state resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L37) |
| `ConversationMessageRecord` | Record shape for conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L58) |
| `ConversationRecord` | Record shape for conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L17) |
| `ConversationRootRunContext` | Context for conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L13) |
| `ConversationRootRunDescriptor` | Public API contract for conversation root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L5) |
| `ConversationRootRunLifecycle` | Public API contract for conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L18) |
| `ConversationRunAppendCursorResyncResult` | Result returned from conversation run append cursor resync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L176) |
| `ConversationRunAppendExecutionOutcome` | Public API contract for conversation run append execution outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L194) |
| `ConversationRunAppendFailureOutcome` | Public API contract for conversation run append failure outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L188) |
| `ConversationRunAppendRecoveryOutcome` | Public API contract for conversation run append recovery outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L182) |
| `ConversationRunBatchFlushOutcome` | Public API contract for conversation run batch flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L200) |
| `ConversationRunChunkMirror` | Public API contract for conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L26) |
| `ConversationRunChunkMirrorApiOptions` | Options accepted by conversation run chunk mirror API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L85) |
| `ConversationRunChunkMirrorOptions` | Options accepted by conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L98) |
| `ConversationRunChunkMirrorPrepareChunkEventsInput` | Input payload for conversation run chunk mirror prepare chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L46) |
| `ConversationRunChunkMirrorPreparedChunk` | Public API contract for conversation run chunk mirror prepared chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L35) |
| `ConversationRunChunkMirrorPreparedEvents` | Public API contract for conversation run chunk mirror prepared events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L41) |
| `ConversationRunChunkMirrorPrepareExternalEventsInput` | Input payload for conversation run chunk mirror prepare external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L52) |
| `ConversationRunChunkMirrorQueueOptions` | Options accepted by conversation run chunk mirror queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L79) |
| `ConversationRunContext` | Context for conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L4) |
| `ConversationRunEvent` | Event emitted for conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L33) |
| `ConversationRunEventQueueController` | Public API contract for conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L213) |
| `ConversationRunMirror` | Public API contract for conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L52) |
| `ConversationRunMirrorRetryScheduledState` | State for conversation run mirror retry scheduled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L32) |
| `ConversationRunMirrorSnapshot` | Public API contract for conversation run mirror snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L5) |
| `ConversationRunMirrorStoppedState` | State for conversation run mirror stopped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L17) |
| `ConversationRunProjection` | Public API contract for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L86) |
| `ConversationRunQueueFlushOutcome` | Public API contract for conversation run queue flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L207) |
| `ConversationRunStreamMirror` | Public API contract for conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L15) |
| `ConversationRunTargets` | Public API contract for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L26) |
| `CreateAgentServiceRegistrationLifecycleOptions` | Options accepted by create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L198) |
| `CreateAgentServiceRuntimeOptions` | Options accepted by create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L96) |
| `CreateAgentServiceServerRuntimeOptions` | Options accepted by create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L19) |
| `CreateAgUiBrowserChunkEncoderOptions` | Options accepted by create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L21) |
| `CreateAgUiBrowserFinalizeTrackerOptions` | Options accepted by create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L16) |
| `CreateAgUiBrowserResponseStreamInput` | Input payload for create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L42) |
| `CreateAgUiChatUiChunkBrowserEncoderOptions` | Options accepted by create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L22) |
| `CreateAgUiChatUiTrackedBrowserResponseInput` | Input payload for create AG-UI chat UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L28) |
| `CreateAgUiChunkEncoderBridgeOptions` | Options accepted by create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L19) |
| `CreateAgUiRuntimeBrowserResponseInput` | Input payload for create AG-UI runtime browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L14) |
| `CreateAgUiRuntimeChatStreamEncoderOptions` | Options accepted by create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L54) |
| `CreateAgUiRuntimeEventEncoderOptions` | Options accepted by create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L20) |
| `CreateAgUiTrackedBrowserResponseInput` | Input payload for create AG-UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L11) |
| `CreateBootstrappedHostedChatExecutionRuntimeInput` | Input payload for create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L132) |
| `CreateConversationHostedLifecycleAdapterOptions` | Options accepted by create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L31) |
| `CreateConversationHostedTerminalAdapterOptions` | Options accepted by create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L113) |
| `CreateDefaultAgentServiceChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L97) |
| `CreateDefaultAgentServiceChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L122) |
| `CreateDefaultAgentServiceProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L41) |
| `CreateDefaultHostedChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L97) |
| `CreateDefaultHostedChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L122) |
| `CreateDefaultHostedProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L41) |
| `CreateHostedAgentRunSpanControllerInput` | Input payload for create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L53) |
| `CreateHostedAgentServiceRuntimeOptions` | Options accepted by create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L68) |
| `CreateHostedChatExecutionRuntimeBootstrapInput` | Input payload for create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L103) |
| `CreateHostedChatExecutionRuntimeInput` | Input payload for create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L117) |
| `CreateHostedChildInvokeToolOptions` | Options accepted by create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L19) |
| `CreateHostedMirroredUiStreamInput` | Input payload for create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L131) |
| `CreateHostedProjectRemoteToolSourceInput` | Input payload for create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L57) |
| `CreateHostedProjectRemoteToolSourcesInput` | Input payload for create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L213) |
| `CreateHostedRootRunLifecycleRuntimeAdapterInput` | Input payload for create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L134) |
| `CreateHostedRuntimeStateResolverOptions` | Options accepted by create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L52) |
| `CreateNodeAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L21) |
| `CreateNodeHostedAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L29) |
| `CreateRequestAuthCacheOptions` | Options accepted by create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L6) |
| `CreateRuntimeAgentSystemMessagesInput` | Input payload for create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L84) |
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
| `DefaultAgentServiceInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L81) |
| `DefaultAgentServiceInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L68) |
| `DefaultAgentServiceInvokeAgentInput` | Input payload for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L187) |
| `DefaultAgentServiceInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L90) |
| `DefaultAgentServiceInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L115) |
| `DefaultAgentServiceInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L122) |
| `DefaultAgentServiceInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L110) |
| `DefaultAgentServiceInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L104) |
| `DefaultAgentServiceInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L98) |
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
| `DefaultHostedChildForkRuntimeToolPreparationResult` | Result returned from default hosted child fork runtime tool preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L169) |
| `DefaultHostedChildForkToolAssemblyResult` | Result returned from default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L194) |
| `DefaultHostedChildForkToolAssemblySourceResult` | Result returned from default hosted child fork tool assembly source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L181) |
| `DefaultHostedChildForkToolSourcesResult` | Result returned from default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L62) |
| `DefaultHostedInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L81) |
| `DefaultHostedInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L68) |
| `DefaultHostedInvokeAgentInput` | Input payload for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L187) |
| `DefaultHostedInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L90) |
| `DefaultHostedInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L115) |
| `DefaultHostedInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L122) |
| `DefaultHostedInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L110) |
| `DefaultHostedInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L104) |
| `DefaultHostedInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L98) |
| `DefaultHostedProjectSteeringFetchers` | Public API contract for default hosted project steering fetchers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L31) |
| `DefaultHostedProjectSteeringRefreshLogger` | Public API contract for default hosted project steering refresh logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L19) |
| `DefaultHostedProjectSteeringRefreshLookup` | Public API contract for default hosted project steering refresh lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L24) |
| `DefaultResearchArtifactContext` | Context for default research artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L16) |
| `DefaultResearchArtifactLogger` | Public API contract for default research artifact logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L24) |
| `DefaultResearchArtifactPaths` | Public API contract for default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L67) |
| `DefaultResearchArtifacts` | Public API contract for default research artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L13) |
| `DelegateAgentResolver` | Resolves a registered agent by id (defaults to the global registry). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L11) |
| `DerivedAgentServiceAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L49) |
| `DerivedHostedAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L49) |
| `DetachedFallbackMessageState` | State for detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L44) |
| `DetachedRunDrainResult` | Result returned from detached run drain. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L5) |
| `DetachedRunShutdownLifecycle` | Public API contract for detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L37) |
| `DetachedRunShutdownLifecycleOptions` | Options accepted by detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L43) |
| `DetachedRunShutdownLogger` | Public API contract for detached run shutdown logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L31) |
| `DetachedRunTracker` | Public API contract for detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L17) |
| `DetachedRunTrackerOptions` | Options accepted by detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L11) |
| `DiscoverProjectAgentRuntimeInput` | Input payload for discover project agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L37) |
| `DurableHumanInputFlowResult` | Result returned from durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L158) |
| `DurableRunSink` | Transport-neutral durable run lifecycle sink for agent-service adoption work. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L6) |
| `EdgeConfig` | Configuration used by edge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L213) |
| `ExecuteAgUiDetachedStartInput` | Input payload for execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L187) |
| `ExecuteDurableHumanInputFlowOptions` | Options accepted by execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L164) |
| `ExecuteHostedChildForkRunContextStreamInput` | Input payload for execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L196) |
| `ExecuteHostedChildForkStreamInput` | Input payload for execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L91) |
| `ExecuteHostedChildForkToolInputOptions` | Options accepted by execute hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L196) |
| `ExecuteHostedChildForkWithPreparedToolsInput` | Input payload for execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L101) |
| `ExecuteHostedDurableChatRunInput` | Input payload for execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L54) |
| `ExecuteHostedDurableChildForkInput` | Input payload for execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L436) |
| `ExecuteHostedLocalChildInvokeInput` | Input payload for execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L133) |
| `ExternalAgentWorker` | Public API contract for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L7) |
| `ExternalAgentWorkerClient` | Public API contract for external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L228) |
| `ExternalAgentWorkerClientOptions` | Options accepted by external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L180) |
| `ExternalAgentWorkerRequestSnapshot` | Public API contract for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L21) |
| `ExternalAgentWorkerRun` | Public API contract for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L50) |
| `ExternalAgentWorkerSession` | Public API contract for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L36) |
| `FetchDefaultAgentServiceProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L52) |
| `FetchDefaultHostedProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L52) |
| `FinalizedMessageState` | State for finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L37) |
| `FinalizeHostedChildForkRunContextResourcesInput` | Input payload for finalize hosted child fork run context resources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L119) |
| `FinalizeHostedDetachedOptions` | Options accepted by finalize hosted detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L49) |
| `FinalizeHostedResponseOptions` | Options accepted by finalize hosted response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L26) |
| `ForkPart` | Public API contract for fork part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L65) |
| `ForkRecoveredPartsState` | State for fork recovered parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L24) |
| `ForkRuntimeContinuationPromptResolver` | Public API contract for fork runtime continuation prompt resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L388) |
| `ForkRuntimeStep` | Public API contract for fork runtime step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L47) |
| `ForkRuntimeStepPreparer` | Public API contract for fork runtime step preparer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L103) |
| `ForkRuntimeStreamLogger` | Public API contract for fork runtime stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-types.ts#L75) |
| `ForkRuntimeStreamMappingState` | State for fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L38) |
| `ForkRuntimeStreamResult` | Result returned from fork runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L69) |
| `FormInputToolInput` | Input payload for form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L203) |
| `FrameworkStreamState` | State for framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L48) |
| `HandleHostedChildForkFailureInput` | Input payload for handle hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L127) |
| `HandleHostedChildForkRunContextErrorInput` | Input payload for handle hosted child fork run context error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L105) |
| `HostedAgentProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L64) |
| `HostedAgentProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L51) |
| `HostedAgentProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L56) |
| `HostedAgentProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L26) |
| `HostedAgentRunSpan` | Public API contract for hosted agent run span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L16) |
| `HostedAgentRunSpanController` | Public API contract for hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L45) |
| `HostedAgentRunSpanFinalState` | State for hosted agent run span final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L28) |
| `HostedAgentRunTracer` | Public API contract for hosted agent run tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L23) |
| `HostedAgentServiceActiveSpanAttributes` | Public API contract for hosted agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L47) |
| `HostedAgentServiceConfig` | Configuration used by hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L145) |
| `HostedAgentServiceConfigInput` | Input payload for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L147) |
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
| `HostedAgUiChatForwardedConfig` | Configuration used by hosted AG-UI chat forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L44) |
| `HostedChatExecutionLifecycleAdapter` | Public API contract for hosted chat execution lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-lifecycle-types.ts#L5) |
| `HostedChatExecutionPreparationInput` | Input payload for hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L202) |
| `HostedChatExecutionPreparationResult` | Result returned from hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L241) |
| `HostedChatExecutionPreparationRootRunOptions` | Options accepted by hosted chat execution preparation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L181) |
| `HostedChatExecutionRootStreamWatchdog` | Public API contract for hosted chat execution root stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L88) |
| `HostedChatExecutionRunContext` | Context for hosted chat execution run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L82) |
| `HostedChatExecutionRuntime` | Public API contract for hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L69) |
| `HostedChatExecutionRuntimeBootstrap` | Public API contract for hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L91) |
| `HostedChatExecutionRuntimeLogger` | Public API contract for hosted chat execution runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L76) |
| `HostedChatProjectAccessError` | Error shape for hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L31) |
| `HostedChatProjectAccessResult` | Result returned from hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L38) |
| `HostedChatRequest` | Request payload for hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L78) |
| `HostedChatRequestInput` | Input payload for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L80) |
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
| `HostedChatRuntimeToolAssemblyContext` | Context for hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L46) |
| `HostedChatRuntimeToolAssemblyResult` | Result returned from hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L63) |
| `HostedChatRuntimeToUiMessageStreamOptions` | Options accepted by hosted chat runtime to UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L60) |
| `HostedChildChunkMirror` | Public API contract for hosted child chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L5) |
| `HostedChildConversationBodyInput` | Input payload for hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L6) |
| `HostedChildExecutionLifecycleOptions` | Options accepted by hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L106) |
| `HostedChildExecutionLifecycleResult` | Result returned from hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L83) |
| `HostedChildExecutionLogEntry` | Entry shape for hosted child execution log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L7) |
| `HostedChildExecutionLogLevel` | Public API contract for hosted child execution log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L4) |
| `HostedChildExecutionLogWriter` | Public API contract for hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L14) |
| `HostedChildFileWriteFallbackLogger` | Public API contract for hosted child file write fallback logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L33) |
| `HostedChildFileWriteFallbackTool` | Public API contract for hosted child file write fallback tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L28) |
| `HostedChildFileWriteFallbackToolExecute` | Public API contract for hosted child file write fallback tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L22) |
| `HostedChildForkExecutionInstrumentation` | Public API contract for hosted child fork execution instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L70) |
| `HostedChildForkInstructionsContext` | Context for hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L2) |
| `HostedChildForkPendingToolLifecycle` | Public API contract for hosted child fork pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L74) |
| `HostedChildForkRunContext` | Context for hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L71) |
| `HostedChildForkRunContextInput` | Input payload for hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L86) |
| `HostedChildForkRuntimeConfig` | Configuration used by hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L53) |
| `HostedChildForkRuntimeStepMessages` | Public API contract for hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L42) |
| `HostedChildForkRuntimeStepSystemResolver` | Public API contract for hosted child fork runtime step system resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L16) |
| `HostedChildForkRuntimeToolSelectionResult` | Result returned from hosted child fork runtime tool selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L157) |
| `HostedChildForkStreamHandlingState` | State for hosted child fork stream handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L60) |
| `HostedChildForkStreamLogger` | Public API contract for hosted child fork stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L67) |
| `HostedChildForkStreamMirrorContext` | Context for hosted child fork stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L57) |
| `HostedChildForkStreamState` | State for hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L52) |
| `HostedChildForkStreamTraceInput` | Input payload for hosted child fork stream trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L84) |
| `HostedChildForkToolCallSnapshot` | Public API contract for hosted child fork tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L37) |
| `HostedChildForkToolInput` | Input payload for hosted child fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L48) |
| `HostedChildForkToolResultSnapshot` | Public API contract for hosted child fork tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L44) |
| `HostedChildForkToolSourcesLogger` | Public API contract for hosted child fork tool sources logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L35) |
| `HostedChildInvokeFailure` | Public API contract for hosted child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L13) |
| `HostedChildLifecycleAdapter` | Public API contract for hosted child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L33) |
| `HostedChildLifecycleRunnerOptions` | Options accepted by hosted child lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L53) |
| `HostedChildLifecycleRunResult` | Result returned from hosted child lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L70) |
| `HostedChildLifecycleTerminalState` | State for hosted child lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L16) |
| `HostedChildMirrorContext` | Context for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L16) |
| `HostedChildMirrorPart` | Public API contract for hosted child mirror part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L86) |
| `HostedChildMirrorState` | State for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L10) |
| `HostedChildPendingToolCallPhase` | Public API contract for hosted child pending tool call phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L5) |
| `HostedChildPendingToolCallState` | State for hosted child pending tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L8) |
| `HostedChildPendingToolLifecycleCloseLog` | Public API contract for hosted child pending tool lifecycle close log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L21) |
| `HostedChildPendingToolLifecycleCloseReason` | Public API contract for hosted child pending tool lifecycle close reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L15) |
| `HostedChildPendingToolLifecycleInput` | Input payload for hosted child pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L84) |
| `HostedChildPendingToolLifecycleLogContext` | Context for hosted child pending tool lifecycle log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L42) |
| `HostedChildPendingToolLifecycleLogger` | Public API contract for hosted child pending tool lifecycle logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L36) |
| `HostedChildPendingToolLifecycleLogWriter` | Public API contract for hosted child pending tool lifecycle log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L49) |
| `HostedChildPendingToolLifecycleUnknownToolLog` | Public API contract for hosted child pending tool lifecycle unknown tool log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L28) |
| `HostedChildProjectSwitchHandler` | Handler for hosted child project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L17) |
| `HostedChildRequestedToolsInput` | Input payload for hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L22) |
| `HostedChildRunIdentifiers` | Public API contract for hosted child run identifiers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L5) |
| `HostedChildRunStatusMonitor` | Public API contract for hosted child run status monitor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L15) |
| `HostedChildSameTurnRetryBlockSignal` | Public API contract for hosted child same turn retry block signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L38) |
| `HostedChildSteeringMutationHandler` | Handler for hosted child steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L12) |
| `HostedChildStreamWatchdogPhase` | Public API contract for hosted child stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L4) |
| `HostedChildStreamWatchdogState` | State for hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L7) |
| `HostedChildTerminalErrorCode` | Public API contract for a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L23) |
| `HostedChildTerminalStatus` | Public API contract for hosted child terminal status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L66) |
| `HostedChildWrittenArtifactPathInput` | Input payload for hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L14) |
| `HostedConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L66) |
| `HostedConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L57) |
| `HostedConversationRunChunkMirrorInstrumentation` | Public API contract for hosted conversation run chunk mirror instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L109) |
| `HostedConversationRunChunkMirrorOptions` | Options accepted by hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L118) |
| `HostedConversationRunChunkMirrorTraceAttributes` | Public API contract for hosted conversation run chunk mirror trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L103) |
| `HostedDetachedFinalizationState` | State for hosted detached finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L19) |
| `HostedDurableChildBootstrapCallbacks` | Public API contract for hosted durable child bootstrap callbacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L414) |
| `HostedDurableChildBootstrapContext` | Context for hosted durable child bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L404) |
| `HostedDurableChildExecutionOptions` | Options accepted by hosted durable child execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L36) |
| `HostedDurableChildForkRunContext` | Context for hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L81) |
| `HostedDurableChildForkRunContextInput` | Input payload for hosted durable child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L95) |
| `HostedDurableChildInvokeResult` | Result returned from hosted durable child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L41) |
| `HostedDurableChildInvokeTraceBase` | Public API contract for hosted durable child invoke trace base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L109) |
| `HostedDurableChildInvokeTraceInput` | Input payload for hosted durable child invoke trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L104) |
| `HostedDurableChildInvokeTraceOverrides` | Public API contract for hosted durable child invoke trace overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L115) |
| `HostedDurableChildInvokeTraceRecorder` | Public API contract for hosted durable child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L120) |
| `HostedDurableChildRuntimeDependencies` | Public API contract for hosted durable child runtime dependencies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L428) |
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
| `HostedLifecycleAdapter` | Public API contract for hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L30) |
| `HostedLifecycleExecution` | Public API contract for hosted lifecycle execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L24) |
| `HostedLifecycleRunnerOptions` | Options accepted by hosted lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L47) |
| `HostedLifecycleRunResult` | Result returned from hosted lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L58) |
| `HostedLifecycleTerminalState` | State for hosted lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L6) |
| `HostedLocalChildInvokeTraceRecorder` | Public API contract for hosted local child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L125) |
| `HostedMirroredOpenToolCallLogger` | Public API contract for hosted mirrored open tool call logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L115) |
| `HostedMirroredUiStreamLogger` | Public API contract for hosted mirrored UI stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L120) |
| `HostedMirroredUiStreamWatchdog` | Public API contract for hosted mirrored UI stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L125) |
| `HostedProjectRemoteToolSourceMutationHandler` | Handler for hosted project remote tool source mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L31) |
| `HostedProjectRemoteToolSourcePrepareToolInput` | Input payload for hosted project remote tool source prepare tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L41) |
| `HostedProjectRemoteToolSourceProjectSwitchHandler` | Handler for hosted project remote tool source project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L36) |
| `HostedProjectRemoteToolSourceRetryPolicy` | Public API contract for hosted project remote tool source retry policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L48) |
| `HostedProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L61) |
| `HostedProjectSteeringAdapter` | Public API contract for hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L73) |
| `HostedProjectSteeringAdapterOptions` | Options accepted by hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L48) |
| `HostedProjectSteeringLogger` | Public API contract for hosted project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L43) |
| `HostedResponseFinalizationState` | State for hosted response finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L10) |
| `HostedResponseStreamHeartbeat` | Public API contract for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L15) |
| `HostedResponseStreamHeartbeatState` | State for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L9) |
| `HostedResponseStreamWriter` | Public API contract for hosted response stream writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L4) |
| `HostedRootRunLifecycleRuntimeAdapter` | Public API contract for hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L128) |
| `HostedRuntimeRequestConfigAgent` | Public API contract for hosted runtime request config agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L19) |
| `HostedRuntimeRequestConfigRequest` | Request payload for hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L13) |
| `HostedRuntimeSourceBindingError` | Stable control-plane error returned when a request cannot run on this service snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L9) |
| `HostedRuntimeSourceIdentity` | Immutable project source identity served by a standalone agent-service process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-source-binding.ts#L4) |
| `HostedRuntimeStateResolverContext` | Context for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L17) |
| `HostedRuntimeStateResolverInput` | Input payload for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L27) |
| `HostedRuntimeStateResolverResult` | Result returned from hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L35) |
| `HostedRuntimeSystemRefresh` | Public API contract for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L47) |
| `HostedRuntimeSystemRefreshInput` | Input payload for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L41) |
| `HostedServiceAuth` | Public API contract for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L109) |
| `HostedServiceAuthConfig` | Configuration used by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L68) |
| `HostedServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L38) |
| `HostedServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L7) |
| `HostedServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L87) |
| `HostedServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L75) |
| `HostedServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L99) |
| `HostedServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L81) |
| `HostedServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L44) |
| `HostedServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L51) |
| `HostedServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L56) |
| `HostedServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L63) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L30) |
| `HostedStreamTerminalError` | Error shape for hosted stream terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L59) |
| `HostedTerminalError` | Error shape for hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L4) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L4) |
| `HumanInputField` | Public API contract for human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L137) |
| `HumanInputFieldInput` | Input payload for human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L139) |
| `HumanInputOption` | Public API contract for human input option. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L135) |
| `HumanInputPendingRequest` | Request payload for human input pending. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L147) |
| `HumanInputRequest` | Request payload for human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L141) |
| `HumanInputRequestInput` | Input payload for human input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L143) |
| `HumanInputResult` | Result returned from human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L145) |
| `HumanInputResumeValue` | Public API contract for human input resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L152) |
| `InitializeNodeAgentServiceTelemetryOptions` | Options accepted by initialize node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L88) |
| `InitializeNodeHostedAgentServiceTelemetryOptions` | Options accepted by initialize node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L78) |
| `InputRequestOutput` | Output from input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L207) |
| `InstallAbortRejectionGuardOptions` | Options accepted by install abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L31) |
| `InstalledAbortRejectionGuard` | Public API contract for installed abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L40) |
| `InstalledProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L32) |
| `InstalledProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L51) |
| `InvokeAgentChildRunLifecycleCustomEvent` | Event emitted for invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L84) |
| `InvokeAgentChildRunLifecycleValue` | Public API contract for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L37) |
| `InvokeAgentChildRunProgressEvent` | Event emitted for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L104) |
| `InvokeAgentChildRunProgressInput` | Input payload for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L89) |
| `InvokeAgentChildRunStateDelta` | Public API contract for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L63) |
| `LiveStudioMcpToolsOptions` | Options accepted by live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L13) |
| `LoadRuntimeAgentMarkdownDefinitionFromFileInput` | Input payload for load runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L23) |
| `Memory` | Public API contract for memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L41) |
| `MemoryConfig` | Configuration used by memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L211) |
| `MemoryPersistence` | Public API contract for memory persistence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L49) |
| `MemoryStats` | Public API contract for memory stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L26) |
| `MessagePart` | Public API contract for message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L223) |
| `MirroredToolChunkState` | State for mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L29) |
| `ModelProvider` | Public API contract for model provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L207) |
| `ModelString` | Model configuration string format: "provider/model-name" Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet" | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L42) |
| `ModelTransportRequest` | Request payload for model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L222) |
| `ModelTransportResolver` | Public API contract for model transport resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L246) |
| `MonitorHostedChildRunStatusInput` | Input payload for monitor hosted child run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L135) |
| `MutableAgentProjectContext` | Context for mutable agent project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L2) |
| `NodeAgentServiceInstrumentationConfig` | Configuration used by node agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L23) |
| `NodeAgentServiceRuntimeInfrastructure` | Public API contract for node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L33) |
| `NodeAgentServiceServer` | Public API contract for node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L43) |
| `NodeAgentServiceTelemetryConfig` | Configuration used by node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L51) |
| `NodeAgentServiceTelemetryEnv` | Public API contract for node agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L17) |
| `NodeAgentServiceTelemetryLogger` | Public API contract for node agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L69) |
| `NodeAgentServiceTelemetryProcessTarget` | Public API contract for node agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L75) |
| `NodeHostedAgentServiceInstrumentationConfig` | Configuration used by node hosted agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L20) |
| `NodeHostedAgentServiceRuntimeInfrastructure` | Public API contract for node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L43) |
| `NodeHostedAgentServiceTelemetryConfig` | Configuration used by node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L26) |
| `NodeHostedAgentServiceTelemetryEnv` | Public API contract for node hosted agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L14) |
| `NodeHostedAgentServiceTelemetryLogger` | Public API contract for node hosted agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L66) |
| `NodeHostedAgentServiceTelemetryProcessTarget` | Public API contract for node hosted agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L72) |
| `NodeVeryfrontCloudAgentServiceMcpServer` | Public API contract for node Veryfront Cloud agent service MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L158) |
| `NodeVeryfrontCloudAgentServiceOptions` | Options accepted by node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L177) |
| `NodeVeryfrontCloudAgentServicePreparedExecution` | Public API contract for node Veryfront Cloud agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L245) |
| `NodeVeryfrontCloudAgentServiceProcessTarget` | Public API contract for node Veryfront Cloud agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L147) |
| `NormalizedAgentServiceChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L41) |
| `NormalizedAgentServiceContract` | Public API contract for normalized agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L114) |
| `NormalizedHostedChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L41) |
| `OpenToolCalls` | Public API contract for open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L109) |
| `ParseAgentServiceChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L66) |
| `ParseAgUiSseResponseOptions` | Options for `parseAgUiSseResponse()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L50) |
| `ParsedAgentServiceAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L60) |
| `ParsedAgentServiceChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L43) |
| `ParsedAgUiSseRun` | Parsed AG-UI SSE response summary for evals, canaries, and host tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L30) |
| `ParsedHostedAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L60) |
| `ParsedHostedChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L43) |
| `ParsedRuntimeSkillDocument` | Public API contract for parsed runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L133) |
| `ParseHostedChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L66) |
| `ParseRuntimeAgentMarkdownDefinitionInput` | Input payload for parse runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L79) |
| `ParseRuntimeAgentRunInvocationHostedChatRequestOptions` | Options accepted when parsing a signed control-plane runtime invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L75) |
| `PersistConversationUserMessageFailure` | Public API contract for persist conversation user message failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L70) |
| `PrepareAgentRuntimeMessagesFromUiMessagesOptions` | Options accepted by prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L22) |
| `PrepareAgentServiceChatRuntimeMessagesOptions` | Options accepted by prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L48) |
| `PrepareAgentServiceConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L75) |
| `PrepareConversationRootRunLifecycleOptions` | Options accepted by prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L23) |
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
| `PrepareHostedConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L75) |
| `PrepareVeryfrontCloudAgentServiceChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L25) |
| `PrepareVeryfrontCloudHostedChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L25) |
| `ProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L41) |
| `ProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L24) |
| `ProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L20) |
| `ProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L60) |
| `ProjectAgentRuntimeAgentIdCandidates` | Public API contract for project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L31) |
| `ProjectAgentRuntimeAgentSource` | Public API contract for project agent runtime agent source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L28) |
| `ProjectAgentRuntimeDiscovery` | Project discovery plus the normalized policy owned by that exact source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L49) |
| `ProjectSteeringMutationInput` | Input payload for project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L22) |
| `ProjectSteeringMutationResult` | Result returned from project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L31) |
| `ProjectSteeringPaths` | Public API contract for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L16) |
| `ProviderNativeToolInventoryOptions` | Options accepted by provider native tool inventory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L9) |
| `ProviderToolCompatOptions` | Options accepted by provider tool compat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L20) |
| `ProviderToolCompatProvider` | Public API contract for provider tool compat provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L5) |
| `ProviderToolProfile` | Public API contract for provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L13) |
| `RecordExternalAgentWorkerSessionInput` | Input payload for record external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L203) |
| `RedisClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L26) |
| `RedisMemoryConfig` | Redis memory configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L39) |
| `RegisterAgentPushRuntimeServiceRequest` | Request payload for register agent push runtime service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L60) |
| `RegisterExternalAgentWorkerInput` | Input payload for register external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L187) |
| `RequestAuthCache` | Public API contract for request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L14) |
| `ResolveAgentServiceRegistrationInputOptions` | Options accepted by resolve agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L181) |
| `ResolveConversationHostedTerminalStateInput` | Input payload for resolve conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L29) |
| `ResolvedAgentConfig` | Configuration used by resolved agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L219) |
| `ResolvedAgentServiceRegistrationInput` | Input payload for resolved agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L23) |
| `ResolvedHostedRuntimeRequestConfig` | Configuration used by resolved hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L35) |
| `ResolvedModelTransport` | Public API contract for resolved model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L238) |
| `ResolvedRuntimeState` | State for resolved runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L261) |
| `ResolveHostedChildForkRuntimeConfigInput` | Input payload for resolve hosted child fork runtime config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L135) |
| `ResolveHostedRuntimeRequestConfigInput` | Input payload for resolve hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L25) |
| `ResolveNodeAgentServiceTelemetryConfigOptions` | Options accepted by resolve node agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L62) |
| `ResolveNodeHostedAgentServiceTelemetryConfigOptions` | Options accepted by resolve node hosted agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L54) |
| `ResolveRuntimeAgentDefinitionsDirInput` | Input payload for resolve runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L12) |
| `RootOwnedChildResultHint` | Public API contract for root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L55) |
| `RootOwnedChildResultHinted` | Public API contract for root owned child result hinted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L61) |
| `RunAgentRuntimeForkStepInput` | Input payload for run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L257) |
| `RunAgentServiceMainOptions` | Options accepted by run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L30) |
| `RunFrameworkForkStepInput` | Input payload for run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L274) |
| `RunResumeSessionManagerOptions` | Options accepted by run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L78) |
| `RunSessionStatus` | Public API contract for run session status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L4) |
| `RuntimeAgentContextItem` | Public API contract for runtime agent context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L346) |
| `RuntimeAgentControlPlaneStreamRequest` | Request payload for runtime agent control plane stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L375) |
| `RuntimeAgentMarkdownDefinition` | Definition for runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L59) |
| `RuntimeAgentProjectContext` | Context for runtime agent project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L358) |
| `RuntimeAgentRunContext` | Context for runtime agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L366) |
| `RuntimeAgentRunInvocation` | Public API contract for runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L370) |
| `RuntimeAgentSourceContext` | Context for runtime agent source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L350) |
| `RuntimeAgentTargetKind` | Public API contract for runtime agent target kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L354) |
| `RuntimeAgentThinkingConfig` | Configuration used by runtime agent thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L25) |
| `RuntimeAgentTool` | Public API contract for runtime agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L344) |
| `RuntimeAgentValidatedClaims` | Public API contract for runtime agent validated claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L362) |
| `RuntimeBuiltinSkillEntriesResult` | Result returned from runtime builtin skill entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L6) |
| `RuntimeClientCapability` | Public API contract for runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L48) |
| `RuntimeClientProfile` | Public API contract for runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L52) |
| `RuntimeClientType` | Public API contract for runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L46) |
| `RuntimeFileUrlResolver` | Public API contract for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L20) |
| `RuntimeFileUrlResolverInput` | Input payload for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L13) |
| `RuntimeGetProjectFileOptions` | Options accepted by runtime get project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L62) |
| `RuntimeLoadedProjectSkill` | Public API contract for runtime loaded project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L30) |
| `RuntimeLoadedSkillResponse` | Response payload for runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L110) |
| `RuntimeLoadedSkillResponseMessages` | Public API contract for runtime loaded skill response messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L101) |
| `RuntimeLoadSkillBuiltinStore` | Public API contract for runtime load skill builtin store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L62) |
| `RuntimeLoadSkillErrorOutput` | Output from runtime load skill error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L111) |
| `RuntimeLoadSkillReferenceFileOutput` | Output from runtime load skill reference file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L104) |
| `RuntimeLoadSkillToolContext` | Context for runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L54) |
| `RuntimeLoadSkillToolInput` | Input payload for runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L99) |
| `RuntimeLoadSkillToolMessages` | Public API contract for runtime load skill tool messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L69) |
| `RuntimeLoadSkillToolOptions` | Options accepted by runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L72) |
| `RuntimeLoadSkillToolOutput` | Output from runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L116) |
| `RuntimeProjectFile` | Public API contract for runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L48) |
| `RuntimeProjectFileListItem` | Public API contract for runtime project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L50) |
| `RuntimeProjectFilesApiOptions` | Options accepted by runtime project files API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L55) |
| `RuntimeProjectFilesClient` | Public API contract for runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L83) |
| `RuntimeProjectFilesClientOptions` | Options accepted by runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L73) |
| `RuntimeProjectFilesFetch` | Public API contract for runtime project files fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L67) |
| `RuntimeProjectFilesTrace` | Public API contract for runtime project files trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L70) |
| `RuntimeProjectInstructionsOptions` | Options accepted by runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L43) |
| `RuntimeProjectSkillCatalogOptions` | Options accepted by runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L32) |
| `RuntimeProjectSkillContext` | Context for runtime project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L14) |
| `RuntimeProjectSkillLoader` | Public API contract for runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L52) |
| `RuntimeProjectSkillLoaderLogger` | Public API contract for runtime project skill loader logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L36) |
| `RuntimeProjectSkillLoaderOptions` | Options accepted by runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L41) |
| `RuntimeProjectSteeringLookup` | Public API contract for runtime project steering lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L25) |
| `RuntimePromptBlockOptions` | Options accepted by runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L2) |
| `RuntimeSkillDefinition` | Definition for runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L64) |
| `RuntimeSkillFrontmatter` | Public API contract for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L21) |
| `RuntimeSkillMetadataLogger` | Public API contract for runtime skill metadata logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L128) |
| `RuntimeStateRequest` | Request payload for runtime state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L251) |
| `RuntimeStateResolver` | Public API contract for runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L267) |
| `RuntimeUploadUrlClientOptions` | Options accepted by runtime upload URL client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L24) |
| `RuntimeUploadUrlFetch` | Public API contract for runtime upload URL fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L21) |
| `RuntimeUploadUrlOptions` | Options accepted by runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L31) |
| `SlashCommandArtifactPolicy` | Public API contract for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L13) |
| `SlashCommandArtifactPolicyInput` | Input payload for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L7) |
| `SourceProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L26) |
| `SourceProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L45) |
| `StartAgentRuntimeForkInput` | Input payload for start agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L116) |
| `StartAgentRuntimeForkWithHostToolsInput` | Input payload for start agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L141) |
| `StartAgentServiceRuntimeOptions` | Options accepted by start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L139) |
| `StartAgentServiceRuntimeResult` | Result returned from start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L164) |
| `StartAgentServiceServerOptions` | Options accepted by start agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L35) |
| `StartedHostedChildForkRuntime` | Public API contract for started hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L29) |
| `StartHostedChildForkRuntimeWithHostToolsInput` | Input payload for start hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L20) |
| `StartNodeAgentServiceOptions` | Options accepted by start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L133) |
| `StartNodeAgentServiceResult` | Result returned from start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L158) |
| `StartNodeAgentServiceServerOptions` | Options accepted by start node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L27) |
| `StartNodeHostedAgentServiceOptions` | Options accepted by start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L122) |
| `StartNodeHostedAgentServiceResult` | Result returned from start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L150) |
| `StreamToolCall` | Public API contract for stream tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L227) |
| `SubmitResumeValueOutcome` | Public API contract for submit resume value outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L47) |
| `Suggestion` | Public API contract for suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L48) |
| `Suggestions` | Public API contract for suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L75) |
| `TerminalConversationRunStatus` | Public API contract for terminal conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L170) |
| `ToolCall` | Public API contract for tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L229) |
| `ToolCallPart` | Agent message part for a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L219) |
| `ToolCallPartWithArgs` | Tool-call message part that stores arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L215) |
| `ToolCallPartWithInput` | Tool-call message part that stores input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L217) |
| `ToolExecutionDataEventBridgeStreamInput` | Input payload for tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L8) |
| `ToolExecutionDataEventPublisher` | Public API contract for tool execution data event publisher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L5) |
| `ToolResultPart` | Agent message part for a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L221) |
| `VeryfrontCloudAgentServiceChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L20) |
| `VeryfrontCloudAgentServiceOptions` | Options accepted by Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L221) |
| `VeryfrontCloudHostedChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L20) |
| `WaitForDurableHumanInputResolutionOptions` | Options accepted by wait for durable human input resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L184) |
| `WaitForHumanInputOptions` | Options accepted by wait for human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L192) |
| `WorkflowConfig` | Configuration used by workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L93) |
| `WorkflowResult` | Result returned from workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L99) |
| `WorkflowStep` | Public API contract for workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L85) |
| `WrapHostedChildProjectSwitchToolInput` | Input payload for wrap hosted child project switch tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L30) |
| `WrapHostedChildSteeringMutationToolInput` | Input payload for wrap hosted child steering mutation tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L20) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentServiceAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L39) |
| `agentServiceConfigSchema` | Zod schema for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L140) |
| `agentServiceRegistrationConfigSchema` | Zod schema for agent service registration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L84) |
| `agUiSseEventTypes` | AG-UI runtime event type constants normalized from browser-wire SSE events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L5) |
| `conversationRunEventTypes` | Shared conversation run event types value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L7) |
| `createNodeHostedAgentServiceRuntimeInfrastructure` | Create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L77) |
| `defaultHostedInvokeAgentInputSchema` | Schema for default hosted invoke agent input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L182) |
| `defaultHostedInvokeAgentSelectionSchema` | Schema for default hosted invoke agent selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L171) |
| `getAgUiRuntimeContextItemSchema` | Zod schema for get AG-UI runtime context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L60) |
| `getAgUiRuntimeInjectedToolSchema` | Zod schema for get AG-UI runtime injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L46) |
| `getAgUiRuntimeMessageSchema` | Zod schema for get AG-UI runtime message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L146) |
| `getAgUiRuntimeRequestSchema` | Zod schema for get AG-UI runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L166) |
| `getCreateInputRequestRequestSchema` | Zod schema for get create input request request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L24) |
| `getCreateInputRequestResponseSchema` | Zod schema for get create input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L158) |
| `getFormInputToolInputSchema` | Zod schema for get form input tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L11) |
| `getGetInputRequestResponseSchema` | Zod schema for get get input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L160) |
| `getHumanInputFieldSchema` | Zod schema for get human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L37) |
| `getHumanInputOptionSchema` | Zod schema for get human input option. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L15) |
| `getHumanInputPendingRequestSchema` | Zod schema for get human input pending request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L126) |
| `getHumanInputRequestSchema` | Zod schema for get human input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L97) |
| `getHumanInputResultSchema` | Zod schema for get human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L112) |
| `getInputRequestLifecycleDataEventSchema` | Zod schema for get input request lifecycle data event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L187) |
| `getInputRequestOutputSchema` | Zod schema for get input request output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L163) |
| `getInputRequestRestSchema` | Zod schema for get input request rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L108) |
| `getInputResponseRestSchema` | Zod schema for get input response rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L57) |
| `getInputResponseValuesSchema` | Zod schema for get input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L16) |
| `getParseRuntimeAgentMarkdownDefinitionInputSchema` | Zod schema for get parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L64) |
| `getRuntimeAgentMarkdownDefinitionSchema` | Zod schema for get runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L30) |
| `getRuntimeAgentThinkingConfigSchema` | Zod schema for get runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L12) |
| `getRuntimeClientCapabilitySchema` | Zod schema for get runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L10) |
| `getRuntimeClientProfileSchema` | Zod schema for get runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L23) |
| `getRuntimeClientTypeSchema` | Zod schema for get runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L5) |
| `hostedAgentProjectSteeringOptionsSchema` | Zod schema for hosted agent project steering options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L34) |
| `hostedAgentServiceConfigSchema` | Zod schema for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L143) |
| `hostedAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L39) |
| `hostedChatRequestSchema` | Schema for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L75) |
| `hostedChatRuntimeOverridesSchema` | Schema for hosted chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L45) |
| `hostedChildForkToolInputSchema` | Schema for hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L45) |
| `hostedChildTerminalErrorCodes` | Shared hosted child terminal error codes value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L16) |
| `hostedDurableRootRunDescriptorSchema` | Schema for hosted durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L30) |
| `loadHostedAgentServiceEnvFiles` | Loads hosted agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L66) |
| `loadRuntimeAgentMarkdownDefinitionFromFileInputSchema` | Zod schema for load runtime agent markdown definition from file input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L61) |
| `parseRuntimeAgentMarkdownDefinitionInputSchema` | Schema for parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L74) |
| `resolvedAgentServiceRegistrationInputSchema` | Zod schema for resolved agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L103) |
| `resolveRuntimeAgentDefinitionsDirInputSchema` | Zod schema for resolve runtime agent definitions dir input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L42) |
| `runtimeAgentMarkdownDefinitionSchema` | Schema for runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L54) |
| `runtimeAgentThinkingConfigSchema` | Schema for runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L22) |
| `runtimeClientCapabilitySchema` | Schema for runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L39) |
| `runtimeClientProfileSchema` | Schema for runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L43) |
| `runtimeClientTypeSchema` | Schema for runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L35) |
| `runtimeProjectFileListItemSchema` | Schema for runtime project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L45) |
| `runtimeProjectFileSchema` | Schema for runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L41) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/agent/identity`

```ts
import { isAgentCatalogAction, isAgentCatalogKind, isInstalledProjectAgentKind } from "veryfront/agent/identity";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AGENT_CATALOG_ACTIONS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L8) |
| `AGENT_CATALOG_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L1) |
| `PROJECT_AGENT_EXECUTION_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L22) |
| `PROJECT_AGENT_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L15) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `isAgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L68) |
| `isAgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L64) |
| `isInstalledProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L78) |
| `isProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L84) |
| `isProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L74) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L13) |
| `AgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L6) |
| `InstalledProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L32) |
| `InstalledProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L51) |
| `ProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L41) |
| `ProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L24) |
| `ProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L20) |
| `ProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L60) |
| `SourceProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L26) |
| `SourceProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L45) |
