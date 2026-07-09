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
    "github:list-issues": true,
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
| `description?` | `string` | Optional summary shown in registry and control-plane listings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L133) |
| `model?` | `ModelString` | Optional model string in "provider/model" format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L141) |
| `system` | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code> | System prompt: string, function, or async function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L142) |
| `tools?` | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code> | Tools available to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L143) |
| `sandbox?` | `object` | Optional sandbox selection for runtime-owned sandbox tools such as `bash`. `id` attaches to an existing sandbox session and detaches on run cleanup. When omitted, sandbox tools lazily create a request/project-scoped session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L149) |
| `providerTools?` | `string[]` | Provider-native tools executed by the selected model provider, such as Anthropic `web_search` and `web_fetch`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L159) |
| `mcpServers?` | `AgentMcpServerConfig[]` | Remote MCP servers available to this agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L161) |
| `maxSteps?` | `number` | Max tool-call iterations per request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L162) |
| `temperature?` | `number` | Sampling temperature for model generation. Defaults to 0. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L164) |
| `streaming?` | `boolean` | Enable streaming responses | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L165) |
| `memory?` | `MemoryConfig` | Conversation memory persisted across `stream()` / `generate()` calls on this instance. Omit for the stateless default: every call runs in isolation, which keeps concurrent fan-out on a shared instance correct. When set, the instance accumulates one shared conversation, so reuse it sequentially, not across concurrent independent runs (use a separate instance per run for that). Set `enabled: false` to force the stateless behavior explicitly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L174) |
| `middleware?` | `AgentMiddleware[]` | Execution middleware pipeline | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L175) |
| `edge?` | `EdgeConfig` | Edge runtime configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L176) |
| `multimodal?` | <code>&#123; vision?: boolean; audio?: boolean &#125;</code> | Enable vision and/or audio | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L177) |
| `allowedModels?` | `ModelString[]` | Restrict runtime model overrides to these "provider/model" strings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L182) |
| `resolveModelTransport?` | `ModelTransportResolver` | Optional request-aware hook for overriding the resolved model runtime and provider transport options on a per-call basis. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L187) |
| `resolveRuntimeState?` | `RuntimeStateResolver` | Optional step-boundary hook for refreshing the runtime system prompt and host-owned context during a long-lived run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L192) |
| `onToolResult?` | `ToolExecutionResultHandler` | Optional hook invoked after the runtime executes a configured local, registry, integration, or remote tool and before the tool result is persisted or streamed back to callers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L198) |
| `skills?` | `true \| string[]` | Enable skills for this agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L208) |
| `work?` | `WorkReference \| WorkReference[]` | Business process definitions this agent is expected to observe and update. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L215) |
| `suggestions?` | `Suggestions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L216) |
| `security?` | `false` | Set to false to disable the default security middleware | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L218) |

**Returns:** `Agent`

### `agent.generate(input)`

Run the agent and return a complete response. Accepts a string or message array as input.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input` | `string \| Message[]` | Prompt string or message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L335) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L336) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L338) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L340) |

**Returns:** <code>Promise&lt;AgentResponse&gt;</code>

### `agent.stream(input)`

Run the agent and stream the response. Returns a result with `.toDataStreamResponse()` for API routes.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input?` | `string` | Prompt string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L344) |
| `messages?` | `Message[]` | Conversation message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L345) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L346) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L348) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L350) |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback fired when a tool is invoked | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L351) |
| `onChunk?` | <code>(chunk: string) =&gt; void</code> | Callback fired for each text chunk | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L352) |
| `onFinish?` | <code>(response: AgentResponse) =&gt; void</code> |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L353) |
| `abortSignal?` | `AbortSignal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L354) |

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
| `AGENT_CATALOG_ACTIONS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L7) |
| `AGENT_CATALOG_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts) |
| `AGENT_DELEGATE_TOOL_PREFIX` | Prefix used for the delegate tool exposed to the coordinator agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation-names.ts#L1) |
| `AgUiDetachedStartAcceptedSchema` | Schema for AG-UI detached start accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L96) |
| `AgUiDetachedStartRequestSchema` | Schema for AG-UI detached start request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L92) |
| `AgUiRequestSchema` | Schema for AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L119) |
| `AgUiResumeSignalSchema` | Schema for AG-UI resume signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L27) |
| `AppendConversationRunEventsResponseSchema` | Schema for append conversation run events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L320) |
| `CompleteConversationRunResponseSchema` | Schema for complete conversation run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L256) |
| `CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE` | Shared conversation hosted aborted terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L18) |
| `CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE` | Shared conversation hosted incomplete tool calls terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L20) |
| `CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE` | Shared conversation hosted stream error terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L16) |
| `ConversationMessageRecordSchema` | Schema for conversation message record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L48) |
| `ConversationRecordSchema` | Schema for conversation record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L36) |
| `ConversationRunEventSchema` | Schema for conversation run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L29) |
| `ConversationRunProjectionSchema` | Schema for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L124) |
| `ConversationRunStatusSchema` | Schema for conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L56) |
| `ConversationRunTargetsSchema` | Schema for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L15) |
| `DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS` | Default value for fork response promise timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L150) |
| `DEFAULT_HOSTED_CHILD_AGENT_ID` | Default value for hosted child agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L6) |
| `DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES` | Default value for hosted child excluded tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L36) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS` | Default value for hosted child fork stream active tool timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L57) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS` | Default value for hosted child fork stream finalization timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L61) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L55) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream post tool idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L59) |
| `DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS` | Default value for hosted child requested tool companions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L44) |
| `DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN` | Default value for hosted child sandbox required cue pattern. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L52) |
| `DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS` | Default value for hosted child status poll interval ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L63) |
| `DEFAULT_PROJECT_STEERING_PATHS` | Default value for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L1) |
| `DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER` | Default value for runtime agent context marker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L46) |
| `DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL` | Shared delegate only when materially helpful value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L8) |
| `ExternalAgentWorkerRequestSnapshotSchema` | Zod schema for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L115) |
| `ExternalAgentWorkerRunSchema` | Zod schema for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L164) |
| `ExternalAgentWorkerSchema` | Zod schema for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L86) |
| `ExternalAgentWorkerSessionSchema` | Zod schema for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L135) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE` | Shared first turn starter intent root ownership block message value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L132) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY` | Shared first turn starter intent root ownership context key value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L129) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER` | Shared first turn starter intent root ownership reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L126) |
| `HOSTED_CHILD_FORK_INSTRUCTIONS_BASE` | Shared hosted child fork instructions base value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L8) |
| `HOSTED_CHILD_STREAM_TIMEOUT_TOKEN` | Shared hosted child stream timeout token value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L29) |
| `InvokeAgentChildRunLifecycleCustomEventSchema` | Schema for invoke agent child run lifecycle custom event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L78) |
| `InvokeAgentChildRunLifecycleValueSchema` | Schema for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L31) |
| `InvokeAgentChildRunStateDeltaSchema` | Schema for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L57) |
| `KEEP_ROOT_ASSISTANT_VISIBLE_OWNER` | Shared keep root assistant visible owner value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L6) |
| `LOAD_SKILL_CONTINUATION_REMINDER` | Shared load skill continuation reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L117) |
| `LOAD_SKILL_CONTINUE_SAME_TURN` | Shared load skill continue same turn value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L18) |
| `LOAD_SKILL_CONTINUE_SAME_TURN_NOW` | Shared load skill continue same turn now value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L20) |
| `LOAD_SKILL_DELEGATION_THRESHOLD` | Shared load skill delegation threshold value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L27) |
| `LOAD_SKILL_OVERRIDE_FORWARDING` | Shared load skill override forwarding value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L29) |
| `LOAD_SKILL_ROOT_OWNERSHIP` | Shared load skill root ownership value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L22) |
| `LOAD_SKILL_TOOL_INTERSECTION` | Shared load skill tool intersection value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L32) |
| `LOAD_SKILL_USE_ALLOWED_TOOLS` | Shared load skill use allowed tools value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L24) |
| `MAX_RUNTIME_SKILL_PROMPT_ENTRIES` | Maximum value for runtime skill prompt entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L11) |
| `NO_DELEGATION_NARRATION_UNLESS_ASKED` | Shared no delegation narration unless asked value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L11) |
| `PROJECT_AGENT_EXECUTION_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L21) |
| `PROJECT_AGENT_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L14) |
| `PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES` | Shared project steering file mutation tool names value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L7) |
| `ROOT_OWNED_CHILD_RESULT_INSTRUCTION` | Shared root owned child result instruction value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L41) |
| `RUNTIME_LOAD_SKILL_CONTINUATION_NOTE` | Shared runtime load skill continuation note value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L32) |
| `RUNTIME_LOAD_SKILL_DESCRIPTION` | Shared runtime load skill description value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L36) |
| `RuntimeAgentContextItemSchema` | Schema for runtime agent context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L122) |
| `RuntimeAgentIdSchema` | Schema for runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L55) |
| `RuntimeAgentProjectContextSchema` | Schema for runtime agent project context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L214) |
| `RuntimeAgentRunContextSchema` | Schema for runtime agent run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L297) |
| `RuntimeAgentRunIdSchema` | Schema for runtime agent run ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L29) |
| `RuntimeAgentRunInvocationSchema` | Schema for runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L326) |
| `RuntimeAgentServiceIdSchema` | Schema for runtime agent service ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L48) |
| `RuntimeAgentSourceContextSchema` | Schema for runtime agent source context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L145) |
| `RuntimeAgentTargetKindSchema` | Schema for runtime agent target kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L154) |
| `RuntimeAgentToolCallIdSchema` | Schema for runtime agent tool call ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L36) |
| `RuntimeAgentToolNameSchema` | Schema for runtime agent tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L67) |
| `RuntimeAgentToolSchema` | Schema for runtime agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L92) |
| `RuntimeAgentValidatedClaimsSchema` | Schema for runtime agent validated claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L228) |
| `RuntimeSkillFrontmatterSchema` | Schema for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L60) |
| `SLASH_COMMAND_ARTIFACT_REMINDER` | Shared slash command artifact reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L120) |
| `SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE` | Shared synthesize delegated findings in root voice value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L14) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addFirstTurnStarterIntentRootOwnershipReminder` | Add first turn starter intent root ownership reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L227) |
| `addLoadSkillContinuationReminder` | Add load skill continuation reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L291) |
| `addSlashCommandArtifactReminder` | Add slash command artifact reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L312) |
| `agent` | Agent helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/factory.ts#L61) |
| `agentAsTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L35) |
| `appendAgentServiceChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L179) |
| `appendConversationRunEvents` | Append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L919) |
| `appendHostedChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L179) |
| `appendMissingChildRunToolCalls` | Append missing child run tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L14) |
| `appendMissingChildRunToolResults` | Append missing child run tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L30) |
| `applyAgentProjectContextChange` | Apply agent project context change helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L10) |
| `applyDefaultResearchArtifactPath` | Apply default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L217) |
| `applyPartToStreamedStepState` | State for apply part to streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L73) |
| `bootstrapAgentService` | Bootstrap agent service helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L55) |
| `bootstrapConversationAgentRun` | Bootstrap conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L305) |
| `bootstrapHostedChildRun` | Bootstrap hosted child run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L51) |
| `buildAgentDelegateTools` | Builds the opt-in delegate tools for a coordinator agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L62) |
| `buildAgentRunTraceAttributes` | Builds agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L98) |
| `buildAgUiBrowserFinalizeResponse` | Response payload for build AG-UI browser finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L234) |
| `buildAgUiSseTraceSignature` | Build a compact ordered event-type signature for regression checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L74) |
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L141) |
| `buildChildRunExecutionSnapshot` | Builds child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L76) |
| `buildChildRunExhaustedStepBudgetErrorMessage` | Message shape for build child run exhausted step budget error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L46) |
| `buildChildRunFailureResult` | Result returned from build child run failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L115) |
| `buildChildRunFailureSnapshot` | Builds child run failure snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L132) |
| `buildChildRunResultCommon` | Builds child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L93) |
| `buildChildRunResultSummary` | Builds child run result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L51) |
| `buildChildRunSuccessResult` | Result returned from build child run success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L98) |
| `buildChildRunSuccessSnapshot` | Builds child run success snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L151) |
| `buildDefaultHostedChildForkToolSet` | Builds default hosted child fork tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L402) |
| `buildDefaultResearchArtifactPathReminder` | Builds default research artifact path reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L95) |
| `buildDefaultResearchArtifactPaths` | Builds default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L117) |
| `buildDetachedAgUiStartRequest` | Request payload for build detached AG-UI start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L137) |
| `buildDetachedFallbackChunks` | Builds detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L161) |
| `buildDetachedFallbackMessageState` | State for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L101) |
| `buildExecuteToolTraceAttributes` | Builds execute tool trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L127) |
| `buildFinalizedAgentRunTraceAttributes` | Builds finalized agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L188) |
| `buildFinalizedMessageFallbackChunks` | Builds finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L125) |
| `buildFinalizedMessageState` | State for build finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L69) |
| `buildForkRuntimeStepFromResponse` | Build a fork runtime step from an agent response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-progress.ts#L11) |
| `buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation` | Builds hosted chat request forwarded props from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L107) |
| `buildHostedChatRequestFromRuntimeAgentInvocation` | Builds hosted chat request from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L152) |
| `buildHostedChatRequestInputFromRuntimeAgentInvocation` | Builds hosted chat request input from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L126) |
| `buildHostedChildCompletedLog` | Builds hosted child completed log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L68) |
| `buildHostedChildConversationBody` | Builds hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L32) |
| `buildHostedChildErrorLog` | Builds hosted child error log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L88) |
| `buildHostedChildExhaustedStepBudgetLog` | Builds hosted child exhausted step budget log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L47) |
| `buildHostedChildForkInstructions` | Builds hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L64) |
| `buildHostedChildToolDescription` | Builds hosted child tool description. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L427) |
| `buildHostedDurableChildInvokeFailureResult` | Result returned from build hosted durable child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L132) |
| `buildHostedDurableChildInvokeSuccessResult` | Result returned from build hosted durable child invoke success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L189) |
| `buildHostedDurableChildInvokeTerminalFailureResult` | Result returned from build hosted durable child invoke terminal failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L157) |
| `buildInputRequestLifecycleDataEvent` | Event emitted for build input request lifecycle data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L276) |
| `buildInvokeAgentChildRunLifecycleCustomEvent` | Event emitted for build invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L147) |
| `buildInvokeAgentChildRunProgressEvents` | Builds invoke agent child run progress events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L158) |
| `buildInvokeAgentChildRunStateDelta` | Builds invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L130) |
| `buildInvokeAgentFollowupInstruction` | Builds invoke agent followup instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L102) |
| `buildInvokeAgentTraceAttributes` | Builds invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L142) |
| `buildParsedAgentServiceAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L177) |
| `buildParsedAgentServiceChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L107) |
| `buildParsedHostedAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L177) |
| `buildParsedHostedChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L107) |
| `buildRecoveredStepParts` | Builds recovered step parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L58) |
| `buildRootOwnedChildResultHint` | Builds root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L44) |
| `buildRootOwnedChildRunResultHint` | Builds root owned child run result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L71) |
| `buildRootOwnedChildRunResultText` | Builds root owned child run result text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L56) |
| `buildRootOwnedDelegatedFindingsInstruction` | Builds root owned delegated findings instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L36) |
| `buildRuntimeAgentControlPlaneStreamRequestFromInvocation` | Builds runtime agent control plane stream request from invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L374) |
| `buildRuntimeAvailableSkillsPromptBlock` | Builds runtime available skills prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L40) |
| `buildRuntimeLoadedSkillResponse` | Response payload for build runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L247) |
| `buildRuntimeSkillDefinition` | Definition for build runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L196) |
| `buildStarterIntentRootOwnershipBlockMessage` | Message shape for build starter intent root ownership block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L112) |
| `buildStarterIntentRootOwnershipReminder` | Builds starter intent root ownership reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L107) |
| `buildStudioMcpHeaders` | Builds studio MCP headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L28) |
| `buildVeryfrontCloudRuntimeInstructions` | Builds Veryfront Cloud runtime instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L70) |
| `cleanupAfterHostedChatExecutionFinalization` | Cleanup after hosted chat execution finalization helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L181) |
| `clearProjectAgentRuntimeRegistries` | Clear project agent runtime registries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L57) |
| `clientAllowsStudioMcp` | Client allows studio MCP helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L135) |
| `cloneMirroredToolChunkState` | State for clone mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L50) |
| `closeAgentServiceChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L192) |
| `closeAgentServiceChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L212) |
| `closeChildRunExecutionBuffers` | Close child run execution buffers helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L17) |
| `closeHostedChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L192) |
| `closeHostedChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L212) |
| `closeHostedMirroredOpenToolCalls` | Close hosted mirrored open tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L201) |
| `composeAbortSignals` | Compose abort signals helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L60) |
| `computeOpenToolCalls` | Compute open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L171) |
| `containsExactArtifactPathValue` | Contains exact artifact path value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L194) |
| `convertAgentRuntimeMessagesToProviderMessages` | Convert agent runtime messages to provider messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L665) |
| `convertCompactedProviderMessagesToChildForkRuntimeMessages` | Convert compacted provider messages to child fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L79) |
| `convertProviderMessagesToAgentRuntimeMessages` | Convert provider messages to agent runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L653) |
| `createAgentServiceAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L155) |
| `createAgentServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L264) |
| `createAgentServiceChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L232) |
| `createAgentServiceFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L32) |
| `createAgentServiceProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L79) |
| `createAgentServiceRegistrationLifecycle` | Create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L372) |
| `createAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L189) |
| `createAgentServiceRuntime` | Create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L194) |
| `createAgentServiceServerRuntime` | Create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L53) |
| `createAgUiBrowserChunkEncoder` | Create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L45) |
| `createAgUiBrowserEncoderState` | State for create AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L43) |
| `createAgUiBrowserFinalizeTracker` | Create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L22) |
| `createAgUiBrowserResponseStream` | Create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L60) |
| `createAgUiCancelHandler` | Handler for create AG-UI cancel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L133) |
| `createAgUiChatUiChunkBrowserEncoder` | Create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L171) |
| `createAgUiChatUiTrackedBrowserResponse` | Response payload for create AG-UI chat UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L189) |
| `createAgUiChunkEncoderBridge` | Create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L23) |
| `createAgUiDetachedStartHandler` | Handler for create AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L388) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L404) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L409) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L414) |
| `createAgUiResumeHandler` | Handler for create AG-UI resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L69) |
| `createAgUiRunErrorEvent` | Event emitted for create AG-UI run error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L412) |
| `createAgUiRuntimeBrowserResponse` | Response payload for create AG-UI runtime browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L28) |
| `createAgUiRuntimeChatStreamEncoder` | Create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L103) |
| `createAgUiRuntimeContextMap` | Create AG-UI runtime context map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L11) |
| `createAgUiRuntimeEventEncoder` | Create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L24) |
| `createAgUiRuntimeHandler` | Handler for create AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L379) |
| `createAgUiSseErrorResponse` | Response payload for create AG-UI sse error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L423) |
| `createAgUiSseResponse` | Response payload for create AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L436) |
| `createAgUiTrackedBrowserResponse` | Response payload for create AG-UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L23) |
| `createBootstrappedHostedChatExecutionRuntime` | Create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L319) |
| `createChatUiMessageStreamFromDataStream` | Create chat UI message stream from data stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L498) |
| `createConversationAgentRun` | Create conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L988) |
| `createConversationChildLifecycleAdapter` | Create conversation child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L168) |
| `createConversationHostedLifecycleAdapter` | Create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L48) |
| `createConversationHostedStreamLifecycleAdapter` | Create conversation hosted stream lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L108) |
| `createConversationHostedTerminalAdapter` | Create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L193) |
| `createConversationMessage` | Message shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L181) |
| `createConversationRecord` | Record shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L165) |
| `createConversationRootRunContext` | Context for create conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L41) |
| `createConversationRootRunStartAdapter` | Create conversation root run start adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L93) |
| `createConversationRunChunkMirror` | Create conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L151) |
| `createConversationRunContext` | Context for create conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L11) |
| `createConversationRunEventQueueController` | Create conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L645) |
| `createConversationRunMirror` | Create conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L76) |
| `createConversationRunStreamMirror` | Create conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L23) |
| `createDefaultAgentServiceChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L303) |
| `createDefaultAgentServiceInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L579) |
| `createDefaultAgentServiceProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L175) |
| `createDefaultHostedChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L303) |
| `createDefaultHostedInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L579) |
| `createDefaultHostedProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L175) |
| `createDefaultResearchRunArtifactMirrorHandler` | Handler for create default research run artifact mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L361) |
| `createDetachedRunShutdownLifecycle` | Create detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L142) |
| `createDetachedRunTracker` | Create detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L59) |
| `createExternalAgentWorkerClient` | Create external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L412) |
| `createForkRuntimeStreamMappingState` | State for create fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L162) |
| `createForkRuntimeUserMessage` | Message shape for create fork runtime user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L423) |
| `createFrameworkStreamState` | State for create framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L331) |
| `createHostedAgentProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L79) |
| `createHostedAgentRunSpanController` | Create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L66) |
| `createHostedAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L189) |
| `createHostedAgentServiceRuntime` | Create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L257) |
| `createHostedAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L155) |
| `createHostedChatExecutionRuntime` | Create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L608) |
| `createHostedChatExecutionRuntimeBootstrap` | Create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L221) |
| `createHostedChatFinalizeDetachedBuildState` | State for create hosted chat finalize detached build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L428) |
| `createHostedChatFinalizeResponseBuildState` | State for create hosted chat finalize response build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L388) |
| `createHostedChatRuntimeAgentAdapter` | Create hosted chat runtime agent adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L38) |
| `createHostedChatStreamFinalizationHooks` | Create hosted chat stream finalization hooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L353) |
| `createHostedChildExecutionLogWriter` | Create hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L38) |
| `createHostedChildForkRunContext` | Context for create hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L128) |
| `createHostedChildInvokeTool` | Create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L54) |
| `createHostedChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L232) |
| `createHostedChildPendingToolLifecycle` | Create hosted child pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L89) |
| `createHostedChildPendingToolLifecycleLogger` | Create hosted child pending tool lifecycle logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L53) |
| `createHostedConversationRunChunkMirror` | Create hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L321) |
| `createHostedDurableChildForkRunContext` | Context for create hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L168) |
| `createHostedDurableChildInvokeTraceRecorder` | Create hosted durable child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L227) |
| `createHostedFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L32) |
| `createHostedMirroredUiStream` | Create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L248) |
| `createHostedProjectRemoteToolSource` | Create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L77) |
| `createHostedProjectRemoteToolSources` | Create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L315) |
| `createHostedProjectSteeringAdapter` | Create hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L137) |
| `createHostedRootRunLifecycleRuntimeAdapter` | Create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L142) |
| `createHostedRuntimeStateResolver` | Create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L71) |
| `createHostedServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L264) |
| `createInitialForkRuntimeMessages` | Create initial fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L437) |
| `createInputRequest` | Request payload for create input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L208) |
| `createLiveStudioMcpTools` | Create live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L69) |
| `createMemory` | Create memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L283) |
| `createMirroredToolChunkState` | State for create mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L38) |
| `createNodeAgentServiceRuntimeInfrastructure` | Create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L45) |
| `createNodeVeryfrontCloudAgentServiceRuntime` | Create node Veryfront Cloud agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1070) |
| `createRedisMemory` | Create redis memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L164) |
| `createRequestAuthCache` | Create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L18) |
| `createRuntimeAgentDefinitionFromAgent` | Create runtime agent definition from agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L95) |
| `createRuntimeAgentFromMarkdownDefinition` | Definition for create runtime agent from markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L8) |
| `createRuntimeAgentSystemMessages` | Create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L201) |
| `createRuntimeLoadSkillTool` | Create runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L424) |
| `createRuntimeProjectFilesClient` | Create runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L102) |
| `createRuntimeProjectSkillLoader` | Create runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L326) |
| `createRuntimePromptBlock` | Create runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L8) |
| `createStreamedStepState` | State for create streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L41) |
| `createToolExecutionDataEventBridgeStream` | Create tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L39) |
| `createToolResultPart` | Create a chat tool-result part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L405) |
| `createVeryfrontCloudAgentServiceChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L43) |
| `createVeryfrontCloudHostedChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L43) |
| `createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L54) |
| `createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L54) |
| `createVeryfrontCloudRuntimeSystemMessages` | Create Veryfront Cloud runtime system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L43) |
| `createWorkflow` | Create workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L90) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L191) |
| `defineAgentService` | Define an agent service and expose a policy-neutral runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L375) |
| `deriveAgentServiceAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L108) |
| `deriveAgUiForwardedConfig` | Configuration used by derive AG-UI forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L71) |
| `deriveHostedAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L108) |
| `describeProjectAgentRuntimeAgentIdCandidates` | Describe project agent runtime agent ID candidates helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L144) |
| `discoverProjectAgentRuntime` | Discover project agent runtime helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L66) |
| `dispatchConversationHostedStreamErrorState` | State for dispatch conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L101) |
| `dispatchConversationHostedTerminalState` | State for dispatch conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L86) |
| `doesProjectAgentRuntimeAgentMatchSource` | Does project agent runtime agent match source helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L82) |
| `encodeConversationRunEvents` | Encode conversation run events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L261) |
| `ensureConversationProjectLink` | Ensure conversation project link helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L139) |
| `evaluateSlashCommandArtifactPolicy` | Evaluate slash command artifact policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L199) |
| `evaluateStarterIntentTurnPolicy` | Evaluate starter intent turn policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L209) |
| `executeAgUiDetachedStart` | Execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L294) |
| `executeDefaultAgentServiceInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L407) |
| `executeDefaultHostedInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L407) |
| `executeDurableHumanInputFlow` | Execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L217) |
| `executeHostedChildForkRunContextStream` | Execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L222) |
| `executeHostedChildForkStream` | Execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L475) |
| `executeHostedChildForkToolInput` | Input payload for execute hosted child fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L226) |
| `executeHostedChildForkWithPreparedTools` | Execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L274) |
| `executeHostedDurableChatRun` | Execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L194) |
| `executeHostedDurableChildFork` | Execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L613) |
| `executeHostedLocalChildInvoke` | Execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L322) |
| `expandAllowedRemoteToolNames` | Normalize allowed remote tool names without adding undeclared provider-native tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L55) |
| `expandHostedChildRequestedTools` | Expand hosted child requested tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L86) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L135) |
| `extractLatestUserText` | Extract latest user text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L67) |
| `extractStarterIntentId` | Extract starter intent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L191) |
| `fetchConversationRecord` | Record shape for fetch conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L125) |
| `fetchDefaultAgentServiceProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L64) |
| `fetchDefaultHostedProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L64) |
| `fetchLatestConversationUserText` | Fetch latest conversation user text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L111) |
| `filterAgentTraceAttributes` | Filter agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L40) |
| `filterHostedChatRuntimeLocalTools` | Filter hosted chat runtime local tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L121) |
| `finalizeAgUiBrowserEvents` | Finalize AG-UI browser events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L657) |
| `finalizeChildRunExecutionResources` | Finalize child run execution resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L25) |
| `finalizeConversationAgentRun` | Finalize conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1053) |
| `finalizeHostedChildForkCompletion` | Finalize hosted child fork completion helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L153) |
| `finalizeHostedChildForkRunContextResources` | Finalize hosted child fork run context resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L303) |
| `finalizeHostedDetached` | Finalize hosted detached helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L213) |
| `finalizeHostedResponse` | Response payload for finalize hosted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L148) |
| `findLatestUserConversationMessageContext` | Context for find latest user conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L238) |
| `findSubmittedFormInputResult` | Find the latest submitted form_input result persisted after the latest user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L202) |
| `flattenSystemInstructions` | Flatten system instructions helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L42) |
| `flushConversationRunEventBatches` | Flush conversation run event batches. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L433) |
| `flushConversationRunEventQueue` | Flush conversation run event queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L542) |
| `formatChildRunStreamPartError` | Error shape for format child run stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L30) |
| `formatRuntimeSkillMetadata` | Formats runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L14) |
| `getAgent` | Return agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L184) |
| `getAgentRuntimeTextPart` | Return a runtime text part when the value carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L311) |
| `getAgentRuntimeToolCallPart` | Return a runtime tool-call part when the value carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L337) |
| `getAgentRuntimeToolResultPart` | Return a runtime tool-result part when the value carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L367) |
| `getAgentsAsTools` | Return agents as tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L233) |
| `getAgentServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L158) |
| `getAgUiChatUiMessageChunkMetadata` | Return AG-UI chat UI message chunk metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L85) |
| `getAgUiChatUiMessageMetadataFromChunk` | Return AG-UI chat UI message metadata from chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L37) |
| `getAgUiChatUiMessageUsageMetadata` | Return AG-UI chat UI message usage metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L52) |
| `getAgUiSseEventsOfType` | Filter parsed AG-UI SSE events by normalized event type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L66) |
| `getAgUiSseStringField` | Return a string field from a parsed AG-UI SSE event record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L60) |
| `getAllAgentIds` | Return all agent IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L194) |
| `getChildRunSnapshotUsage` | Return child run snapshot usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L69) |
| `getConfirmedProjectContextSwitchId` | Return confirmed project context switch ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L53) |
| `getConversationRun` | Return conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L843) |
| `getConversationRunEventJsonByteLength` | Return conversation run event JSON byte length. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L18) |
| `getEmptyHostedFinalizedMessageTerminalError` | Error shape for get empty hosted finalized message terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L116) |
| `getForkRuntimeAllowedToolNames` | Return fork runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L62) |
| `getForwardedHostedModelId` | Return forwarded hosted model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L48) |
| `getForwardedHostedRuntimeOverrides` | Return forwarded hosted runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L58) |
| `getHostedChildWrittenArtifactPath` | Return hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L111) |
| `getHostedMirroredAbortErrorText` | Return hosted mirrored abort error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L160) |
| `getHostedServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L158) |
| `getHostedStreamErrorText` | Return hosted stream error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L111) |
| `getInputRequest` | Request payload for get input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L250) |
| `getMaxForkRuntimeStepCount` | Return max fork runtime step count. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L454) |
| `getProjectAgentRuntimeAgentIdCandidates` | Return project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L123) |
| `getProjectSteeringMutation` | Return project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L91) |
| `getProviderNativeToolNames` | Return provider native tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L43) |
| `getProviderToolProfile` | Return provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L50) |
| `getRuntimeAgentMarkdownDefinition` | Definition for get runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L52) |
| `getRuntimeProjectFile` | Return runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L112) |
| `getRuntimeProjectFiles` | Return runtime project files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L146) |
| `getRuntimeProjectInstructions` | Return runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L113) |
| `getRuntimeProjectSkillCatalog` | Return runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L133) |
| `getRuntimeUploadUrl` | Return runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L36) |
| `getTextFromParts` | Return text from parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L291) |
| `getToolArguments` | Return tool arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L309) |
| `handleHostedChildForkFailure` | Process a hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L273) |
| `handleHostedChildForkRunContextError` | Error shape for handle hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L264) |
| `handleHostedChildForkStreamPart` | Process a hosted child fork stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L306) |
| `hasArgs` | Check whether args is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L299) |
| `hasInput` | Input payload for has. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L304) |
| `initializeNodeAgentServiceOpenTelemetry` | Initialize node agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L218) |
| `initializeNodeHostedAgentServiceOpenTelemetry` | Initialize node hosted agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L179) |
| `installAbortRejectionGuard` | Install abort rejection guard helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L113) |
| `isAbortRejectionReason` | Check whether a rejection came from an abort signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L49) |
| `isActiveConversationRunStatus` | Check whether a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L112) |
| `isAgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L67) |
| `isAgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L63) |
| `isAgentServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L24) |
| `isAgentTraceAttributeValue` | Check whether a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L31) |
| `isAlreadyMirroredAgentServiceChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L52) |
| `isAlreadyMirroredHostedChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L52) |
| `isAppendableConversationRunProjection` | Check whether a conversation run projection can accept more events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L119) |
| `isChildRunAbortError` | Error shape for is child run abort. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L25) |
| `isCursorMismatchConversationRunAppendError` | Error shape for is cursor mismatch conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L61) |
| `isDurableMirroredOutputChunk` | Check whether a durable chunk mirrors tool output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L3) |
| `isHostedChildCreateFileAlreadyExistsResult` | Result returned from is hosted child create file already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L106) |
| `isHostedChildTerminalErrorCode` | Check whether a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L25) |
| `isHostedChildTextProjectArtifactPrompt` | Check whether a prompt asks for a hosted child text project artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L100) |
| `isHostedServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L24) |
| `isIgnorableConversationRunAppendError` | Error shape for is ignorable conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L39) |
| `isInstalledProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L77) |
| `isProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L83) |
| `isProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L73) |
| `isProviderSafeDelegateId` | Whether a delegate id produces a provider-safe `agent_{id}` tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation-names.ts#L7) |
| `isResponseLike` | Check whether a value behaves like a Response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/response-like.ts#L1) |
| `isRuntimeAgentMarkdownAgent` | Check whether a runtime agent uses markdown configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L59) |
| `isStarterIntentRootOwnershipRequired` | Check whether starter intent root ownership is required. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L236) |
| `isSuccessfulProjectSteeringMutationResult` | Result returned from is successful project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L130) |
| `listRuntimeBuiltinSkillReferenceFiles` | List runtime builtin skill reference files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L111) |
| `listRuntimeBuiltinSkillReferences` | List runtime builtin skill references. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L127) |
| `loadAgentServiceEnvFiles` | Loads agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L31) |
| `loadRuntimeAgentMarkdownDefinitionFromFile` | Loads runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L151) |
| `loadRuntimeBuiltinSkillCatalog` | Loads runtime builtin skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L60) |
| `mapAgUiRuntimeEventToForkParts` | Map AG-UI runtime event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L174) |
| `mapFrameworkEventToForkParts` | Handles map framework event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L340) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L218) |
| `mapRuntimeStreamEventToAgUiBrowserEvents` | Map runtime stream event to AG-UI browser events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L428) |
| `mergeToolCallInput` | Input payload for merge tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L107) |
| `mergeToolInputDelta` | Merge tool input delta helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L49) |
| `mirrorDefaultResearchRunArtifact` | Mirror default research run artifact helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L298) |
| `monitorConversationRunStatus` | Monitor conversation run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L860) |
| `monitorHostedChildRunStatus` | Monitor hosted child run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L141) |
| `normalizeAgUiBrowserRuntimeRequest` | Request payload for normalize AG-UI browser runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L198) |
| `normalizeAgUiMessages` | Normalizes AG-UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L368) |
| `normalizeAgUiRuntimeMessages` | Normalizes AG-UI runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-support.ts#L17) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L110) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L160) |
| `normalizeChatUiMessageChunkToAgUiRuntimeEvent` | Event emitted for normalize chat UI message chunk to AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L135) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L253) |
| `normalizeConversationRunEvent` | Event emitted for normalize conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L27) |
| `normalizeConversationRunEvents` | Normalizes conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L50) |
| `normalizeEncodedConversationRunEvents` | Normalizes encoded conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L269) |
| `normalizeHostedChildArtifactPath` | Normalizes hosted child artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L132) |
| `normalizeParsedAgentServiceChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L226) |
| `normalizeParsedHostedChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L226) |
| `normalizeRuntimeSkillReferencePath` | Normalizes runtime skill reference path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L231) |
| `parseAgentServiceChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L159) |
| `parseAgentServiceConfig` | Configuration used by parse agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L149) |
| `parseAgUiContextBoolean` | Parses AG-UI context boolean. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L55) |
| `parseAgUiContextJsonValue` | Parses AG-UI context JSON value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L26) |
| `parseAgUiContextNullableString` | Parses AG-UI context nullable string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L45) |
| `parseAgUiContextSchema` | Zod schema for parse AG-UI context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L61) |
| `parseAgUiContextString` | Parses AG-UI context string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L39) |
| `parseAgUiRequest` | Request payload for parse AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L353) |
| `parseAgUiRequestOrError` | Error shape for parse AG-UI request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L358) |
| `parseAgUiRuntimeRequest` | Request payload for parse AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L222) |
| `parseAgUiRuntimeRequestOrError` | Error shape for parse AG-UI runtime request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L227) |
| `parseAgUiSseResponse` | Parse an AG-UI SSE `Response` into normalized events, text, tool starts, and terminal error state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L257) |
| `parseAppendConversationRunEventsErrorBody` | Parses append conversation run events error body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L21) |
| `parseDataStreamSseEvents` | Parses data stream sse events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L13) |
| `parseHostedAgentServiceConfig` | Configuration used by parse hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L157) |
| `parseHostedChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L159) |
| `parseRuntimeAgentMarkdownDefinition` | Definition for parse runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L151) |
| `parseRuntimeAgentRunInvocation` | Parses runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L392) |
| `parseRuntimeAgentRunInvocationAgentServiceChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L185) |
| `parseRuntimeAgentRunInvocationHostedChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L185) |
| `parseRuntimeAgentRunInvocationOrError` | Error shape for parse runtime agent run invocation or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L399) |
| `parseRuntimeSkillDocument` | Parses runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L160) |
| `parseRuntimeSkillMetadata` | Parses runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L188) |
| `parseToolInputObject` | Parses tool input object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L130) |
| `persistConversationUserMessage` | Message shape for persist conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L201) |
| `persistLatestConversationUserMessage` | Message shape for persist latest conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L265) |
| `prepareAgentRuntimeMessagesFromUiMessages` | Prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L23) |
| `prepareAgentServiceChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L355) |
| `prepareAgentServiceChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L261) |
| `prepareAgentServiceChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L455) |
| `prepareAgentServiceConversationRootRunContext` | Context for prepare hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L117) |
| `prepareConversationRootRunContext` | Context for prepare conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L118) |
| `prepareConversationRootRunLifecycle` | Prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L37) |
| `prepareConversationRunChunkEvents` | Prepare conversation run chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L64) |
| `prepareConversationRunExternalEvents` | Prepare conversation run external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L75) |
| `prepareConversationRunStreamEvents` | Prepare conversation run stream events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L56) |
| `prepareDefaultHostedChildForkRuntimeTools` | Prepare default hosted child fork runtime tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L303) |
| `prepareDefaultHostedChildForkSandboxToolSources` | Prepare default hosted child fork sandbox tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L180) |
| `prepareDefaultHostedChildForkToolAssembly` | Prepare default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L357) |
| `prepareDefaultHostedChildForkToolSources` | Prepare default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L83) |
| `prepareHostedChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L355) |
| `prepareHostedChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L261) |
| `prepareHostedChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L455) |
| `prepareHostedChatRuntimeToolAssembly` | Prepare hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L135) |
| `prepareHostedChildForkRuntimeStepMessages` | Prepare hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L91) |
| `prepareHostedConversationRootRunContext` | Context for prepare hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L117) |
| `prepareVeryfrontCloudAgentServiceChatExecution` | Prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L74) |
| `prepareVeryfrontCloudHostedChatExecution` | Prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L74) |
| `publishInvokeAgentChildRunProgress` | Publish invoke agent child run progress helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L168) |
| `readRuntimeBuiltinDirectorySkill` | Read runtime builtin directory skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L82) |
| `readRuntimeBuiltinFlatSkill` | Read runtime builtin flat skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L95) |
| `readRuntimeBuiltinSkill` | Read runtime builtin skill helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L105) |
| `readRuntimeBuiltinSkillEntries` | Read runtime builtin skill entries helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L29) |
| `readRuntimeBuiltinSkillReferenceFile` | Read runtime builtin skill reference file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L68) |
| `recordMirroredToolChunkState` | State for record mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L64) |
| `recoverConversationRunAppendExecution` | Recover conversation run append execution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L314) |
| `recoverConversationRunAppendFailure` | Recover conversation run append failure helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L243) |
| `recoverConversationRunCursorMismatch` | Recover conversation run cursor mismatch helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L171) |
| `registerAgent` | Registers agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L171) |
| `resolveAgentServiceRegistrationInput` | Input payload for resolve agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L262) |
| `resolveConversationHostedStreamErrorState` | State for resolve conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L67) |
| `resolveConversationHostedTerminalState` | State for resolve conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L42) |
| `resolveConversationRunTargets` | Resolves conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L23) |
| `resolveForkRuntimeContinuationState` | State for resolve fork runtime continuation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L462) |
| `resolveForkStepResponse` | Response payload for resolve fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-state.ts#L281) |
| `resolveHostedChildForkRuntimeConfig` | Configuration used by resolve hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L186) |
| `resolveHostedChildForkThinkingOverride` | Resolves hosted child fork thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L146) |
| `resolveHostedChildPromiseWithTimeout` | Resolves hosted child promise with timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L148) |
| `resolveHostedChildStreamWatchdogState` | State for resolve hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L32) |
| `resolveHostedChildTerminalErrorCode` | Resolves a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L90) |
| `resolveHostedDurableRunSetupErrorResponse` | Response payload for resolve hosted durable run setup error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L84) |
| `resolveHostedRuntimeRequestConfig` | Configuration used by resolve hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L98) |
| `resolveHostedRuntimeThinkingOverride` | Resolves hosted runtime thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L79) |
| `resolveNodeAgentServiceTelemetryConfig` | Configuration used by resolve node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L142) |
| `resolveNodeHostedAgentServiceTelemetryConfig` | Configuration used by resolve node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L125) |
| `resolveRuntimeAgentDefinitionsDir` | Resolves runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L95) |
| `resolveRuntimeAgentMarkdownDefinitionFilePath` | Resolves runtime agent markdown definition file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L139) |
| `resolveRuntimeBuiltinSkillReferenceFilePath` | Resolves runtime builtin skill reference file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L46) |
| `resolveRuntimeBuiltinSkillsDir` | Resolves runtime builtin skills dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L16) |
| `resolveRuntimeClientProfile` | Resolves runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L102) |
| `resolveRuntimeMessageFileUrls` | Resolves runtime message file urls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L15) |
| `resolveSingleProjectAgentRuntimeAgentId` | Resolves single project agent runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L154) |
| `resyncConversationRunAppendCursor` | Resync conversation run append cursor helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L131) |
| `runAgentRuntimeForkStep` | Run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L331) |
| `runAgentServiceMain` | Run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L68) |
| `runFrameworkForkStep` | Handles run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L397) |
| `runHostedChildExecutionLifecycle` | Run hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L300) |
| `runHostedChildLifecycle` | Run hosted child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L167) |
| `runHostedLifecycle` | Run hosted lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L137) |
| `runHostedResponseStreamWithHeartbeat` | Run hosted response stream with heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L64) |
| `runPreparedAgentServiceChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L147) |
| `runPreparedHostedChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L147) |
| `sanitizeDefaultHostedChildRequestedTools` | Sanitize default hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L267) |
| `sanitizeHostedChildRequestedTools` | Sanitize hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L56) |
| `sanitizeProviderToolSchema` | Zod schema for sanitize provider tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L321) |
| `selectDefaultHostedChildForkRuntimeTools` | Select default hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L282) |
| `selectHostedChildForkRuntimeTools` | Select hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L207) |
| `selectProviderCompatibleToolNames` | Select provider compatible tool names helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L88) |
| `selectProviderCompatibleTools` | Select provider compatible tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L116) |
| `shouldBlockHostedChildSameTurnRetry` | Should block hosted child same turn retry helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L47) |
| `shouldContinueForkRuntimeStep` | Should continue fork runtime step helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-step-progress.ts#L41) |
| `shouldFailEmptyHostedFinalizedMessage` | Message shape for should fail empty hosted finalized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L130) |
| `shouldInjectDefaultResearchArtifactPath` | Should inject default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L76) |
| `shouldPruneSandboxToolsFromHostedChildRequest` | Request payload for should prune sandbox tools from hosted child. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L121) |
| `shouldReinforceLoadSkillContinuation` | Should reinforce load skill continuation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L241) |
| `shouldRetryCreateResearchArtifactAsUpdate` | Should retry create research artifact as update helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L263) |
| `shouldSkipHostedChildTerminalPersistence` | Should skip hosted child terminal persistence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L98) |
| `startAgentRuntimeFork` | Starts agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L491) |
| `startAgentRuntimeForkWithHostTools` | Starts agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L216) |
| `startAgentService` | Starts agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1101) |
| `startAgentServiceRuntime` | Starts agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L302) |
| `startAgentServiceServer` | Starts agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L92) |
| `startConversationRootRun` | Starts conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L56) |
| `startHostedChildForkRuntimeWithHostTools` | Starts hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L37) |
| `startNodeAgentService` | Starts node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L267) |
| `startNodeAgentServiceServer` | Starts node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L75) |
| `startNodeHostedAgentService` | Starts node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L292) |
| `startNodeVeryfrontCloudAgentService` | Starts node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1080) |
| `streamDataStreamEvents` | Stream data stream events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L39) |
| `streamPreparedAgentServiceChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L112) |
| `streamPreparedHostedChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L112) |
| `stringifyAgUiSseEvent` | Stringify an AG-UI SSE event or fallback value for diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L55) |
| `stripLeadingEmptyObjectPlaceholder` | Normalize provider tool input by removing transient empty-object prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-input.ts#L5) |
| `summarizeChildRunResultText` | Summarize child run result text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L37) |
| `summarizeChildRunResultValue` | Summarize child run result value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L81) |
| `throwIfChildRunAborted` | Throw if child run aborted helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L18) |
| `toChildRunToolInputRecord` | Record shape for to child run tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L1) |
| `toConversationHostedTerminalState` | State for to conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L166) |
| `toConversationRunStreamEvent` | Event emitted for to conversation run stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L28) |
| `toHostedChatExecutionFinalState` | State for to hosted chat execution final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L171) |
| `toMirroredAgentServiceStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L88) |
| `toMirroredHostedStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L88) |
| `updateDefaultResearchArtifacts` | Update default research artifacts helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L165) |
| `validateRuntimeAgentTargetSelection` | Validates runtime agent target selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L163) |
| `veryfrontApiMcpServer` | Veryfront API MCP server helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L144) |
| `veryfrontStudioMcpServer` | Veryfront Studio MCP server helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L151) |
| `waitForDurableHumanInputResolution` | Wait for durable human input resolution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L302) |
| `waitForHumanInput` | Input payload for wait for human. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L276) |
| `withDefaultResearchArtifactPath` | Applies default research artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L164) |
| `withHostedChildRerunnableFileWriteFallbacks` | Applies hosted child rerunnable file write fallbacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L37) |
| `withHostedChildStreamIdleTimeout` | Applies hosted child stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L74) |
| `withRootOwnedChildResultHint` | Applies root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L87) |
| `withRuntimeToolInventory` | Applies runtime tool inventory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L26) |
| `wrapHostedChildProjectSwitchTool` | Wrap hosted child project switch tool helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L72) |
| `wrapHostedChildSteeringMutationTool` | Wrap hosted child steering mutation tool helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L36) |
| `writeHostedChildExecutionLogEntry` | Entry shape for write hosted child execution log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L20) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AgentRuntime` | Implement agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/index.ts#L220) |
| `AgentRuntimeMessageConversionError` | Error shape for agent runtime message conversion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L116) |
| `AgentServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L11) |
| `AppendConversationRunEventsError` | Error shape for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-append-errors.ts#L3) |
| `BufferMemory` | Implement buffer memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L127) |
| `ConversationMemory` | Implement conversation memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L83) |
| `ConversationRunEventEncoder` | Implement conversation run event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L60) |
| `ConversationRunTerminalStateError` | Error shape for conversation run terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L99) |
| `HostedChildStreamIdleTimeoutError` | Error shape for hosted child stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L12) |
| `HostedChildTerminalStateError` | Error shape for hosted child terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L71) |
| `HostedServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L11) |
| `HumanInputResumeError` | Error shape for human input resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L199) |
| `InvalidHumanInputResultError` | Error shape for invalid human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L209) |
| `RedisMemory` | Implement redis memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L45) |
| `RunAlreadyExistsError` | Error shape for run already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L12) |
| `RunCancelledError` | Error shape for run cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L4) |
| `RunNotActiveError` | Error shape for run not active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L20) |
| `RunResumeSessionManager` | Implement run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L89) |
| `RuntimeProjectFilesApiAuthError` | Error shape for runtime project files API auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L89) |
| `SummaryMemory` | Implement summary memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L155) |
| `WaitConflictError` | Error shape for wait conflict. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L36) |
| `WaitNotPendingError` | Error shape for wait not pending. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L28) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbortRejectionEvent` | Event emitted for abort rejection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L12) |
| `AbortRejectionEventTarget` | Public API contract for abort rejection event target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L18) |
| `AbortRejectionGuardLogger` | Public API contract for abort rejection guard logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L1) |
| `AbortRejectionProcessTarget` | Public API contract for abort rejection process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L6) |
| `ActiveConversationRunStatus` | Public API contract for a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L127) |
| `Agent` | Public API contract for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L330) |
| `AgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L12) |
| `AgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L5) |
| `AgentConfig` | Configuration used by agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L128) |
| `AgentContext` | Context for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L218) |
| `AgentContract` | Framework-owned agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L103) |
| `AgentMcpHttpTransport` | HTTP transport configuration for one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L88) |
| `AgentMcpServerAuth` | Authentication configuration for one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L94) |
| `AgentMcpServerConfig` | MCP server available to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L125) |
| `AgentMcpToolPolicy` | Policy for tools exposed by one MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L81) |
| `AgentMessage` | Message exchanged with an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L210) |
| `AgentMiddleware` | Public API contract for agent middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L284) |
| `AgentPushRuntimeServiceRest` | Public API contract for agent push runtime service rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L37) |
| `AgentRegistry` | Public API contract for agent registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L58) |
| `AgentResponse` | Response payload for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L216) |
| `AgentRuntimeForkStepRunner` | Public API contract for agent runtime fork step runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L169) |
| `AgentRuntimeMessage` | Message shape for agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L85) |
| `AgentRuntimeMessagePart` | Public API contract for agent runtime message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L66) |
| `AgentServiceActiveSpanAttributes` | Public API contract for hosted agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L42) |
| `AgentServiceAgUiChatForwardedConfig` | Configuration used by hosted AG-UI chat forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L43) |
| `AgentServiceAuth` | Public API contract for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L102) |
| `AgentServiceAuthConfig` | Configuration used by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L65) |
| `AgentServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L35) |
| `AgentServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L4) |
| `AgentServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L84) |
| `AgentServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L72) |
| `AgentServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L92) |
| `AgentServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L78) |
| `AgentServiceBootstrapExit` | Public API contract for agent service bootstrap exit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L16) |
| `AgentServiceChatProjectAccessError` | Error shape for hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L20) |
| `AgentServiceChatProjectAccessResult` | Result returned from hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L27) |
| `AgentServiceChatRequestPrincipal` | Public API contract for hosted chat request principal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L14) |
| `AgentServiceChatRuntimeAgent` | Public API contract for hosted chat runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L69) |
| `AgentServiceChatRuntimeCreationOptions` | Options accepted by hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L98) |
| `AgentServiceChatRuntimeCreationResult` | Result returned from hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L76) |
| `AgentServiceChatRuntimeFinishPart` | Public API contract for hosted chat runtime finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L13) |
| `AgentServiceChatRuntimeOnFinishEvent` | Event emitted for hosted chat runtime on finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L36) |
| `AgentServiceChatRuntimeProjectSteering` | Public API contract for hosted chat runtime project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L84) |
| `AgentServiceChatRuntimeStreamInput` | Input payload for hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L55) |
| `AgentServiceChatRuntimeStreamResult` | Result returned from hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L61) |
| `AgentServiceChatRuntimeToolAssemblyResult` | Result returned from hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L55) |
| `AgentServiceChatRuntimeToUiMessageStreamOptions` | Options accepted by hosted chat runtime to UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L45) |
| `AgentServiceChildChunkMirror` | Public API contract for hosted child chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L4) |
| `AgentServiceChildMirrorContext` | Context for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L15) |
| `AgentServiceChildMirrorPart` | Public API contract for hosted child mirror part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L85) |
| `AgentServiceChildMirrorState` | State for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L9) |
| `AgentServiceConfig` | Configuration used by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L15) |
| `AgentServiceConfigInput` | Input payload for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L48) |
| `AgentServiceConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L65) |
| `AgentServiceConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L56) |
| `AgentServiceCorsConfig` | Configuration used by agent service cors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L23) |
| `AgentServiceDefinition` | Type-preserving service definition for request-native agent service runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L126) |
| `AgentServiceDetachedCleanupInput` | Input payload for hosted agent service detached cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L71) |
| `AgentServiceDetachedExecutionInput` | Input payload for hosted agent service detached execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L61) |
| `AgentServiceEnvFileLoadOptions` | Options accepted by agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L12) |
| `AgentServiceEnvFileLoadResult` | Result returned from agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L6) |
| `AgentServiceFormInputToolContext` | Context for hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L23) |
| `AgentServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L41) |
| `AgentServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L48) |
| `AgentServiceOptions` | Options accepted by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L200) |
| `AgentServicePreparedExecution` | Public API contract for agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L219) |
| `AgentServiceProcessTarget` | Public API contract for agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L221) |
| `AgentServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L53) |
| `AgentServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L60) |
| `AgentServiceProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L60) |
| `AgentServiceProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L63) |
| `AgentServiceProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L50) |
| `AgentServiceProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L55) |
| `AgentServiceProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L25) |
| `AgentServiceRegistrationConfig` | Configuration used by agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L7) |
| `AgentServiceRegistrationLifecycle` | Public API contract for agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L188) |
| `AgentServiceRegistrationLogger` | Public API contract for agent service registration logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L172) |
| `AgentServiceRegistrationMode` | Public API contract for agent service registration mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L5) |
| `AgentServiceRegistryContract` | Multi-agent service contract. Framework services route to `defaultAgentId` unless the host chooses another registered agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L75) |
| `AgentServiceRoute` | Public API contract for agent service route. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L39) |
| `AgentServiceRouteMethod` | Host-facing server config for the agent service runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L20) |
| `AgentServiceRouteSet` | Public API contract for hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L115) |
| `AgentServiceRouteSetOptions` | Options accepted by hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L82) |
| `AgentServiceRoutesLogger` | Public API contract for hosted agent service routes logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L25) |
| `AgentServiceRoutesTrace` | Public API contract for hosted agent service routes trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L33) |
| `AgentServiceRuntimeBundle` | Public API contract for agent service runtime bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L111) |
| `AgentServiceRuntimeConfig` | Configuration used by agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L44) |
| `AgentServiceRuntimeLogger` | Public API contract for agent service runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L53) |
| `AgentServiceRuntimeTrace` | Public API contract for agent service runtime trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L62) |
| `AgentServiceServer` | Public API contract for agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L44) |
| `AgentServiceServerConfig` | Configuration used by agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L32) |
| `AgentServiceServerLifecycle` | Public API contract for agent service server lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L12) |
| `AgentServiceSingleAgentContract` | Single-agent convenience accepted by `defineAgentService()`. Implementations must normalize this shape into the same registry path used by multi-agent services so framework users are not boxed into one-agent-per-process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L90) |
| `AgentServiceStreamExecutionInput` | Input payload for hosted agent service stream execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L51) |
| `AgentServiceTraceContext` | Context for agent service trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L7) |
| `AgentServiceTraceContextGetter` | Public API contract for agent service trace context getter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L13) |
| `AgentStatus` | Public API contract for agent status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L194) |
| `AgentStreamResult` | Result returned from agent stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L321) |
| `AgentTraceAttributes` | Public API contract for agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L8) |
| `AgentTraceAttributeValue` | Public API contract for a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L2) |
| `AgentTraceUsage` | Public API contract for agent trace usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L11) |
| `AgUiBeforeStream` | Public API contract for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L32) |
| `AgUiBeforeStreamContext` | Context for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L16) |
| `AgUiBeforeStreamMessageInput` | Input payload for AG-UI before stream message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L3) |
| `AgUiBeforeStreamResult` | Result returned from AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L24) |
| `AgUiBrowserChunkEncoder` | Public API contract for AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L13) |
| `AgUiBrowserEncodedEvent` | Event emitted for AG-UI browser encoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L37) |
| `AgUiBrowserEncoderState` | State for AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L22) |
| `AgUiBrowserFinalizeTracker` | Public API contract for AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L8) |
| `AgUiBrowserResponseEncoder` | Public API contract for AG-UI browser response encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L35) |
| `AgUiBrowserResponseExecution` | Public API contract for AG-UI browser response execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L28) |
| `AgUiBrowserResponseRequestState` | State for AG-UI browser response request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L20) |
| `AgUiBrowserRunFinishedMetadata` | Public API contract for AG-UI browser run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L6) |
| `AgUiCancelHandlerOptions` | Options accepted by AG-UI cancel handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L53) |
| `AgUiChatUiChunkBrowserEncoder` | Public API contract for AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L15) |
| `AgUiChunkEncoderBridge` | Public API contract for AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L11) |
| `AgUiContextItem` | Public API contract for AG-UI context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L124) |
| `AgUiDetachedStartAccepted` | Public API contract for AG-UI detached start accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L103) |
| `AgUiDetachedStartHandlerOptions` | Options accepted by AG-UI detached start handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L219) |
| `AgUiDetachedStartRequest` | Request payload for AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L99) |
| `AgUiForwardedConfigOptions` | Options accepted by AG-UI forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L5) |
| `AgUiHandlerConfigWithAgent` | Public API contract for AG-UI handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L391) |
| `AgUiHandlerOptions` | Options accepted by AG-UI handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L382) |
| `AgUiInjectedTool` | Public API contract for AG-UI injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L122) |
| `AgUiRequest` | Request payload for AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L126) |
| `AgUiResumeHandlerOptions` | Options accepted by AG-UI resume handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L48) |
| `AgUiResumeSignal` | Public API contract for AG-UI resume signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L30) |
| `AgUiResumeValue` | Public API contract for AG-UI resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tool-shared.ts#L10) |
| `AgUiRuntimeChatStreamEncoder` | Public API contract for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L15) |
| `AgUiRuntimeChatStreamEncoderState` | State for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L9) |
| `AgUiRuntimeContextItem` | Public API contract for AG-UI runtime context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L189) |
| `AgUiRuntimeEventEncoder` | Public API contract for AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L12) |
| `AgUiRuntimeHandlerConfig` | Configuration used by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L374) |
| `AgUiRuntimeHandlerConfigWithAgent` | Public API contract for AG-UI runtime handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L369) |
| `AgUiRuntimeHandlerExecute` | Public API contract for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L333) |
| `AgUiRuntimeHandlerExecuteInput` | Input payload for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L325) |
| `AgUiRuntimeHandlerOptions` | Options accepted by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L355) |
| `AgUiRuntimeInjectedTool` | Public API contract for AG-UI runtime injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L185) |
| `AgUiRuntimeLifecycleContext` | Context for AG-UI runtime lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L31) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L193) |
| `AgUiRuntimeRequest` | Request payload for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L195) |
| `AgUiRuntimeStreamEvent` | Event emitted for AG-UI runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L3) |
| `AgUiSseEvent` | Event emitted for AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L17) |
| `AgUiSseEventType` | Normalized AG-UI runtime event type value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L26) |
| `AgUiSseProgressSnapshot` | Progress snapshot emitted while parsing an AG-UI SSE response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L40) |
| `AppendConversationRunEventsResponse` | Response payload for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L261) |
| `AppendExternalAgentWorkerRunEventsInput` | Input payload for append external agent worker run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L218) |
| `BootstrapAgentServiceOptions` | Options accepted by bootstrap agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L19) |
| `BootstrapConversationAgentRunResult` | Result returned from bootstrap conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L298) |
| `BootstrapHostedChildRunInput` | Input payload for bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L15) |
| `BootstrapHostedChildRunResult` | Result returned from bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L27) |
| `BootstrappedHostedChatExecutionRuntime` | Public API contract for bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L154) |
| `BuildAgentDelegateToolsInput` | Input payload for build agent delegate tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L13) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L8) |
| `BuildDetachedFallbackChunksInput` | Input payload for build detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L59) |
| `BuildDetachedFallbackMessageInput` | Input payload for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L28) |
| `BuildFinalizedMessageFallbackChunksInput` | Input payload for build finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L49) |
| `BuildFinalizedMessageStateInput` | Input payload for build finalized message state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L20) |
| `BuildHostedDurableChildInvokeFailureResultInput` | Input payload for build hosted durable child invoke failure result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L57) |
| `BuildParsedAgentServiceAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L64) |
| `BuildParsedHostedAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L64) |
| `CachedRequestAuthResult` | Result returned from cached request auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L2) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L133) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L96) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L341) |
| `ChatUiMessageStreamFinish` | Public API contract for chat UI message stream finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L41) |
| `ChatUiMessageStreamFinishPart` | Public API contract for chat UI message stream finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L20) |
| `ChatUiMessageStreamOptions` | Options accepted by chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L50) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L121) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L106) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L113) |
| `ChildRunExecutionBufferCleanupInput` | Input payload for child run execution buffer cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L1) |
| `ChildRunExecutionResourceFinalizeInput` | Input payload for child run execution resource finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L7) |
| `ChildRunExecutionResult` | Result returned from child run execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L36) |
| `ChildRunExecutionSnapshot` | Public API contract for child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L23) |
| `ChildRunExecutionUsage` | Public API contract for child run execution usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L1) |
| `ChildRunResultCommon` | Public API contract for child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L59) |
| `ChildRunToolCallSnapshot` | Public API contract for child run tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L8) |
| `ChildRunToolResultSnapshot` | Public API contract for child run tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L15) |
| `ClaimExternalAgentWorkerRunInput` | Input payload for claim external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L195) |
| `CloseHostedMirroredOpenToolCallsInput` | Input payload for close hosted mirrored open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L142) |
| `CompleteExternalAgentWorkerRunInput` | Input payload for complete external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L210) |
| `ConversationAgentRunUsage` | Public API contract for conversation agent run usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L333) |
| `ConversationChildLifecycleContext` | Context for conversation child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L121) |
| `ConversationControlPlaneResponseError` | Error shape for conversation control plane response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L56) |
| `ConversationHostedLifecycleFinalizeInput` | Input payload for conversation hosted lifecycle finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L20) |
| `ConversationHostedTerminalAdapter` | Public API contract for conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L122) |
| `ConversationHostedTerminalRuntimeAdapter` | Public API contract for conversation hosted terminal runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L78) |
| `ConversationHostedTerminalStateInput` | Input payload for conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L8) |
| `ConversationHostedTerminalStateResolution` | Public API contract for conversation hosted terminal state resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L36) |
| `ConversationMessageRecord` | Record shape for conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L51) |
| `ConversationRecord` | Record shape for conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L10) |
| `ConversationRootRunContext` | Context for conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L11) |
| `ConversationRootRunDescriptor` | Public API contract for conversation root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L3) |
| `ConversationRootRunLifecycle` | Public API contract for conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L17) |
| `ConversationRunAppendCursorResyncResult` | Result returned from conversation run append cursor resync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L139) |
| `ConversationRunAppendExecutionOutcome` | Public API contract for conversation run append execution outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L157) |
| `ConversationRunAppendFailureOutcome` | Public API contract for conversation run append failure outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L151) |
| `ConversationRunAppendRecoveryOutcome` | Public API contract for conversation run append recovery outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L145) |
| `ConversationRunBatchFlushOutcome` | Public API contract for conversation run batch flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L163) |
| `ConversationRunChunkMirror` | Public API contract for conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L25) |
| `ConversationRunChunkMirrorApiOptions` | Options accepted by conversation run chunk mirror API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L84) |
| `ConversationRunChunkMirrorOptions` | Options accepted by conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L97) |
| `ConversationRunChunkMirrorPrepareChunkEventsInput` | Input payload for conversation run chunk mirror prepare chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L45) |
| `ConversationRunChunkMirrorPreparedChunk` | Public API contract for conversation run chunk mirror prepared chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L34) |
| `ConversationRunChunkMirrorPreparedEvents` | Public API contract for conversation run chunk mirror prepared events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L40) |
| `ConversationRunChunkMirrorPrepareExternalEventsInput` | Input payload for conversation run chunk mirror prepare external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L51) |
| `ConversationRunChunkMirrorQueueOptions` | Options accepted by conversation run chunk mirror queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L78) |
| `ConversationRunContext` | Context for conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L3) |
| `ConversationRunEvent` | Event emitted for conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L32) |
| `ConversationRunEventQueueController` | Public API contract for conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L176) |
| `ConversationRunMirror` | Public API contract for conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L45) |
| `ConversationRunMirrorRetryScheduledState` | State for conversation run mirror retry scheduled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L25) |
| `ConversationRunMirrorSnapshot` | Public API contract for conversation run mirror snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L3) |
| `ConversationRunMirrorStoppedState` | State for conversation run mirror stopped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L15) |
| `ConversationRunProjection` | Public API contract for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L59) |
| `ConversationRunQueueFlushOutcome` | Public API contract for conversation run queue flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L170) |
| `ConversationRunStreamMirror` | Public API contract for conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L14) |
| `ConversationRunTargets` | Public API contract for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L18) |
| `CreateAgentServiceRegistrationLifecycleOptions` | Options accepted by create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L196) |
| `CreateAgentServiceRuntimeOptions` | Options accepted by create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L91) |
| `CreateAgentServiceServerRuntimeOptions` | Options accepted by create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L18) |
| `CreateAgUiBrowserChunkEncoderOptions` | Options accepted by create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L20) |
| `CreateAgUiBrowserFinalizeTrackerOptions` | Options accepted by create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L15) |
| `CreateAgUiBrowserResponseStreamInput` | Input payload for create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L41) |
| `CreateAgUiChatUiChunkBrowserEncoderOptions` | Options accepted by create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L21) |
| `CreateAgUiChatUiTrackedBrowserResponseInput` | Input payload for create AG-UI chat UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L27) |
| `CreateAgUiChunkEncoderBridgeOptions` | Options accepted by create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L18) |
| `CreateAgUiRuntimeBrowserResponseInput` | Input payload for create AG-UI runtime browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L13) |
| `CreateAgUiRuntimeChatStreamEncoderOptions` | Options accepted by create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L21) |
| `CreateAgUiRuntimeEventEncoderOptions` | Options accepted by create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L19) |
| `CreateAgUiTrackedBrowserResponseInput` | Input payload for create AG-UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L10) |
| `CreateBootstrappedHostedChatExecutionRuntimeInput` | Input payload for create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L120) |
| `CreateConversationHostedLifecycleAdapterOptions` | Options accepted by create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L29) |
| `CreateConversationHostedTerminalAdapterOptions` | Options accepted by create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L112) |
| `CreateDefaultAgentServiceChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L90) |
| `CreateDefaultAgentServiceChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L115) |
| `CreateDefaultAgentServiceProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L39) |
| `CreateDefaultHostedChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L90) |
| `CreateDefaultHostedChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L115) |
| `CreateDefaultHostedProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L39) |
| `CreateHostedAgentRunSpanControllerInput` | Input payload for create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L51) |
| `CreateHostedAgentServiceRuntimeOptions` | Options accepted by create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L65) |
| `CreateHostedChatExecutionRuntimeBootstrapInput` | Input payload for create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L95) |
| `CreateHostedChatExecutionRuntimeInput` | Input payload for create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L107) |
| `CreateHostedChildInvokeToolOptions` | Options accepted by create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L18) |
| `CreateHostedMirroredUiStreamInput` | Input payload for create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L130) |
| `CreateHostedProjectRemoteToolSourceInput` | Input payload for create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L55) |
| `CreateHostedProjectRemoteToolSourcesInput` | Input payload for create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L197) |
| `CreateHostedRootRunLifecycleRuntimeAdapterInput` | Input payload for create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L114) |
| `CreateHostedRuntimeStateResolverOptions` | Options accepted by create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L51) |
| `CreateNodeAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L20) |
| `CreateNodeHostedAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L28) |
| `CreateRequestAuthCacheOptions` | Options accepted by create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L5) |
| `CreateRuntimeAgentSystemMessagesInput` | Input payload for create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L81) |
| `CreateVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptionsInput` | Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L43) |
| `CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput` | Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L43) |
| `CreateVeryfrontCloudRuntimeSystemMessagesInput` | Input payload for create Veryfront Cloud runtime system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L10) |
| `DefaultAgentServiceChatRuntimeConfig` | Configuration used by default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L46) |
| `DefaultAgentServiceChatRuntimeCreationOptions` | Options accepted by default hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L59) |
| `DefaultAgentServiceChatRuntimeLogger` | Public API contract for default hosted chat runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L54) |
| `DefaultAgentServiceChatRuntimeProjectSwitchInput` | Input payload for default hosted chat runtime project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L109) |
| `DefaultAgentServiceChatRuntimeSteeringMutationInput` | Input payload for default hosted chat runtime steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L103) |
| `DefaultAgentServiceChatRuntimeSystemRefreshInput` | Input payload for default hosted chat runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L96) |
| `DefaultAgentServiceChatRuntimeTaskContext` | Context for default hosted chat runtime task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L69) |
| `DefaultAgentServiceInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L77) |
| `DefaultAgentServiceInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L64) |
| `DefaultAgentServiceInvokeAgentInput` | Input payload for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L178) |
| `DefaultAgentServiceInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L86) |
| `DefaultAgentServiceInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L111) |
| `DefaultAgentServiceInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L118) |
| `DefaultAgentServiceInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L106) |
| `DefaultAgentServiceInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L100) |
| `DefaultAgentServiceInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L94) |
| `DefaultAgentServiceProjectSteeringFetchers` | Public API contract for default hosted project steering fetchers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L29) |
| `DefaultAgentServiceProjectSteeringRefreshLogger` | Public API contract for default hosted project steering refresh logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L17) |
| `DefaultAgentServiceProjectSteeringRefreshLookup` | Public API contract for default hosted project steering refresh lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L22) |
| `DefaultHostedChatRuntimeConfig` | Configuration used by default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L46) |
| `DefaultHostedChatRuntimeCreationOptions` | Options accepted by default hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L59) |
| `DefaultHostedChatRuntimeLogger` | Public API contract for default hosted chat runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L54) |
| `DefaultHostedChatRuntimeProjectSwitchInput` | Input payload for default hosted chat runtime project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L109) |
| `DefaultHostedChatRuntimeSteeringMutationInput` | Input payload for default hosted chat runtime steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L103) |
| `DefaultHostedChatRuntimeSystemRefreshInput` | Input payload for default hosted chat runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L96) |
| `DefaultHostedChatRuntimeTaskContext` | Context for default hosted chat runtime task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L69) |
| `DefaultHostedChildForkRuntimeToolPreparationResult` | Result returned from default hosted child fork runtime tool preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L168) |
| `DefaultHostedChildForkToolAssemblyResult` | Result returned from default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L193) |
| `DefaultHostedChildForkToolAssemblySourceResult` | Result returned from default hosted child fork tool assembly source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L180) |
| `DefaultHostedChildForkToolSourcesResult` | Result returned from default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L60) |
| `DefaultHostedInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L77) |
| `DefaultHostedInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L64) |
| `DefaultHostedInvokeAgentInput` | Input payload for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L178) |
| `DefaultHostedInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L86) |
| `DefaultHostedInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L111) |
| `DefaultHostedInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L118) |
| `DefaultHostedInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L106) |
| `DefaultHostedInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L100) |
| `DefaultHostedInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L94) |
| `DefaultHostedProjectSteeringFetchers` | Public API contract for default hosted project steering fetchers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L29) |
| `DefaultHostedProjectSteeringRefreshLogger` | Public API contract for default hosted project steering refresh logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L17) |
| `DefaultHostedProjectSteeringRefreshLookup` | Public API contract for default hosted project steering refresh lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L22) |
| `DefaultResearchArtifactContext` | Context for default research artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L15) |
| `DefaultResearchArtifactLogger` | Public API contract for default research artifact logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L23) |
| `DefaultResearchArtifactPaths` | Public API contract for default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L66) |
| `DefaultResearchArtifacts` | Public API contract for default research artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L12) |
| `DelegateAgentResolver` | Resolves a registered agent by id (defaults to the global registry). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-delegation.ts#L10) |
| `DerivedAgentServiceAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L48) |
| `DerivedHostedAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L48) |
| `DetachedFallbackMessageState` | State for detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L43) |
| `DetachedRunDrainResult` | Result returned from detached run drain. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L3) |
| `DetachedRunShutdownLifecycle` | Public API contract for detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L35) |
| `DetachedRunShutdownLifecycleOptions` | Options accepted by detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L41) |
| `DetachedRunShutdownLogger` | Public API contract for detached run shutdown logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L29) |
| `DetachedRunTracker` | Public API contract for detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L15) |
| `DetachedRunTrackerOptions` | Options accepted by detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L9) |
| `DiscoverProjectAgentRuntimeInput` | Input payload for discover project agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L29) |
| `DurableHumanInputFlowResult` | Result returned from durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L156) |
| `DurableRunSink` | Transport-neutral durable run lifecycle sink for agent-service adoption work. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L5) |
| `EdgeConfig` | Configuration used by edge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L198) |
| `ExecuteAgUiDetachedStartInput` | Input payload for execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L181) |
| `ExecuteDurableHumanInputFlowOptions` | Options accepted by execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L162) |
| `ExecuteHostedChildForkRunContextStreamInput` | Input payload for execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L195) |
| `ExecuteHostedChildForkStreamInput` | Input payload for execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L89) |
| `ExecuteHostedChildForkToolInputOptions` | Options accepted by execute hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L189) |
| `ExecuteHostedChildForkWithPreparedToolsInput` | Input payload for execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L97) |
| `ExecuteHostedDurableChatRunInput` | Input payload for execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L45) |
| `ExecuteHostedDurableChildForkInput` | Input payload for execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L383) |
| `ExecuteHostedLocalChildInvokeInput` | Input payload for execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L123) |
| `ExternalAgentWorker` | Public API contract for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L5) |
| `ExternalAgentWorkerClient` | Public API contract for external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L226) |
| `ExternalAgentWorkerClientOptions` | Options accepted by external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L178) |
| `ExternalAgentWorkerRequestSnapshot` | Public API contract for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L19) |
| `ExternalAgentWorkerRun` | Public API contract for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L48) |
| `ExternalAgentWorkerSession` | Public API contract for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L34) |
| `FetchDefaultAgentServiceProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L50) |
| `FetchDefaultHostedProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L50) |
| `FinalizedMessageState` | State for finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L36) |
| `FinalizeHostedChildForkRunContextResourcesInput` | Input payload for finalize hosted child fork run context resources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L118) |
| `FinalizeHostedDetachedOptions` | Options accepted by finalize hosted detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L48) |
| `FinalizeHostedResponseOptions` | Options accepted by finalize hosted response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L25) |
| `ForkPart` | Public API contract for fork part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L122) |
| `ForkRecoveredPartsState` | State for fork recovered parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L23) |
| `ForkRuntimeContinuationPromptResolver` | Public API contract for fork runtime continuation prompt resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L417) |
| `ForkRuntimeStep` | Public API contract for fork runtime step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L104) |
| `ForkRuntimeStepPreparer` | Public API contract for fork runtime step preparer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L164) |
| `ForkRuntimeStreamLogger` | Public API contract for fork runtime stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L132) |
| `ForkRuntimeStreamMappingState` | State for fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L37) |
| `ForkRuntimeStreamResult` | Result returned from fork runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L137) |
| `FormInputToolInput` | Input payload for form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L201) |
| `FrameworkStreamState` | State for framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-part-mapper.ts#L47) |
| `HandleHostedChildForkFailureInput` | Input payload for handle hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L124) |
| `HandleHostedChildForkRunContextErrorInput` | Input payload for handle hosted child fork run context error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L104) |
| `HostedAgentProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L63) |
| `HostedAgentProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L50) |
| `HostedAgentProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L55) |
| `HostedAgentProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L25) |
| `HostedAgentRunSpan` | Public API contract for hosted agent run span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L15) |
| `HostedAgentRunSpanController` | Public API contract for hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L43) |
| `HostedAgentRunSpanFinalState` | State for hosted agent run span final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L27) |
| `HostedAgentRunTracer` | Public API contract for hosted agent run tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L22) |
| `HostedAgentServiceActiveSpanAttributes` | Public API contract for hosted agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L42) |
| `HostedAgentServiceConfig` | Configuration used by hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L144) |
| `HostedAgentServiceConfigInput` | Input payload for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L146) |
| `HostedAgentServiceDetachedCleanupInput` | Input payload for hosted agent service detached cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L71) |
| `HostedAgentServiceDetachedExecutionInput` | Input payload for hosted agent service detached execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L61) |
| `HostedAgentServiceEnvFileLoadOptions` | Options accepted by hosted agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L20) |
| `HostedAgentServiceEnvFileLoadResult` | Result returned from hosted agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L18) |
| `HostedAgentServiceRouteSet` | Public API contract for hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L115) |
| `HostedAgentServiceRouteSetOptions` | Options accepted by hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L82) |
| `HostedAgentServiceRoutesLogger` | Public API contract for hosted agent service routes logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L25) |
| `HostedAgentServiceRoutesTrace` | Public API contract for hosted agent service routes trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L33) |
| `HostedAgentServiceRuntimeBundle` | Public API contract for hosted agent service runtime bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L97) |
| `HostedAgentServiceRuntimeConfig` | Configuration used by hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L38) |
| `HostedAgentServiceRuntimeLogger` | Public API contract for hosted agent service runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L47) |
| `HostedAgentServiceRuntimeTrace` | Public API contract for hosted agent service runtime trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L56) |
| `HostedAgentServiceStreamExecutionInput` | Input payload for hosted agent service stream execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L51) |
| `HostedAgUiChatForwardedConfig` | Configuration used by hosted AG-UI chat forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L43) |
| `HostedChatExecutionLifecycleAdapter` | Public API contract for hosted chat execution lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-lifecycle-types.ts#L4) |
| `HostedChatExecutionPreparationInput` | Input payload for hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L173) |
| `HostedChatExecutionPreparationResult` | Result returned from hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L211) |
| `HostedChatExecutionPreparationRootRunOptions` | Options accepted by hosted chat execution preparation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L152) |
| `HostedChatExecutionRootStreamWatchdog` | Public API contract for hosted chat execution root stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L80) |
| `HostedChatExecutionRunContext` | Context for hosted chat execution run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L74) |
| `HostedChatExecutionRuntime` | Public API contract for hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L61) |
| `HostedChatExecutionRuntimeBootstrap` | Public API contract for hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L83) |
| `HostedChatExecutionRuntimeLogger` | Public API contract for hosted chat execution runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L68) |
| `HostedChatProjectAccessError` | Error shape for hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L20) |
| `HostedChatProjectAccessResult` | Result returned from hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L27) |
| `HostedChatRequest` | Request payload for hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L77) |
| `HostedChatRequestInput` | Input payload for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L79) |
| `HostedChatRequestPrincipal` | Public API contract for hosted chat request principal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L14) |
| `HostedChatRuntimeAgent` | Public API contract for hosted chat runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L69) |
| `HostedChatRuntimeAgentAdapterInput` | Input payload for hosted chat runtime agent adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L21) |
| `HostedChatRuntimeAgentAdapterRunner` | Public API contract for hosted chat runtime agent adapter runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L10) |
| `HostedChatRuntimeAgentAdapterWarning` | Public API contract for hosted chat runtime agent adapter warning. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L15) |
| `HostedChatRuntimeAllowedToolNames` | Public API contract for hosted chat runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L52) |
| `HostedChatRuntimeCreationOptions` | Options accepted by hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L98) |
| `HostedChatRuntimeCreationPreparationInput` | Input payload for hosted chat runtime creation preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L81) |
| `HostedChatRuntimeCreationPreparationResult` | Result returned from hosted chat runtime creation preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L112) |
| `HostedChatRuntimeCreationResult` | Result returned from hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L76) |
| `HostedChatRuntimeFinishPart` | Public API contract for hosted chat runtime finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L13) |
| `HostedChatRuntimeInstructionsInput` | Input payload for hosted chat runtime instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L71) |
| `HostedChatRuntimeOnFinishEvent` | Event emitted for hosted chat runtime on finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L36) |
| `HostedChatRuntimePreparationRootRunContext` | Context for hosted chat runtime preparation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L57) |
| `HostedChatRuntimePreparationSteering` | Public API contract for hosted chat runtime preparation steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L65) |
| `HostedChatRuntimeProjectSteering` | Public API contract for hosted chat runtime project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L84) |
| `HostedChatRuntimeStreamInput` | Input payload for hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L55) |
| `HostedChatRuntimeStreamResult` | Result returned from hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L61) |
| `HostedChatRuntimeToolAssemblyContext` | Context for hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L39) |
| `HostedChatRuntimeToolAssemblyResult` | Result returned from hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L55) |
| `HostedChatRuntimeToUiMessageStreamOptions` | Options accepted by hosted chat runtime to UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L45) |
| `HostedChildChunkMirror` | Public API contract for hosted child chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L4) |
| `HostedChildConversationBodyInput` | Input payload for hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L5) |
| `HostedChildExecutionLifecycleOptions` | Options accepted by hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L105) |
| `HostedChildExecutionLifecycleResult` | Result returned from hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L82) |
| `HostedChildExecutionLogEntry` | Entry shape for hosted child execution log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L6) |
| `HostedChildExecutionLogLevel` | Public API contract for hosted child execution log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L3) |
| `HostedChildExecutionLogWriter` | Public API contract for hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L13) |
| `HostedChildFileWriteFallbackLogger` | Public API contract for hosted child file write fallback logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L32) |
| `HostedChildFileWriteFallbackTool` | Public API contract for hosted child file write fallback tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L27) |
| `HostedChildFileWriteFallbackToolExecute` | Public API contract for hosted child file write fallback tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L21) |
| `HostedChildForkExecutionInstrumentation` | Public API contract for hosted child fork execution instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L66) |
| `HostedChildForkInstructionsContext` | Context for hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L1) |
| `HostedChildForkPendingToolLifecycle` | Public API contract for hosted child fork pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L72) |
| `HostedChildForkRunContext` | Context for hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L70) |
| `HostedChildForkRunContextInput` | Input payload for hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L85) |
| `HostedChildForkRuntimeConfig` | Configuration used by hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L44) |
| `HostedChildForkRuntimeStepMessages` | Public API contract for hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L28) |
| `HostedChildForkRuntimeStepSystemResolver` | Public API contract for hosted child fork runtime step system resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L14) |
| `HostedChildForkRuntimeToolSelectionResult` | Result returned from hosted child fork runtime tool selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L156) |
| `HostedChildForkStreamHandlingState` | State for hosted child fork stream handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L58) |
| `HostedChildForkStreamLogger` | Public API contract for hosted child fork stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L65) |
| `HostedChildForkStreamMirrorContext` | Context for hosted child fork stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L56) |
| `HostedChildForkStreamState` | State for hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L51) |
| `HostedChildForkStreamTraceInput` | Input payload for hosted child fork stream trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L82) |
| `HostedChildForkToolCallSnapshot` | Public API contract for hosted child fork tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L36) |
| `HostedChildForkToolInput` | Input payload for hosted child fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L39) |
| `HostedChildForkToolResultSnapshot` | Public API contract for hosted child fork tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L43) |
| `HostedChildForkToolSourcesLogger` | Public API contract for hosted child fork tool sources logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L33) |
| `HostedChildInvokeFailure` | Public API contract for hosted child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L12) |
| `HostedChildLifecycleAdapter` | Public API contract for hosted child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L32) |
| `HostedChildLifecycleRunnerOptions` | Options accepted by hosted child lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L52) |
| `HostedChildLifecycleRunResult` | Result returned from hosted child lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L69) |
| `HostedChildLifecycleTerminalState` | State for hosted child lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L15) |
| `HostedChildMirrorContext` | Context for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L15) |
| `HostedChildMirrorPart` | Public API contract for hosted child mirror part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L85) |
| `HostedChildMirrorState` | State for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L9) |
| `HostedChildPendingToolCallPhase` | Public API contract for hosted child pending tool call phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L4) |
| `HostedChildPendingToolCallState` | State for hosted child pending tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L7) |
| `HostedChildPendingToolLifecycleCloseLog` | Public API contract for hosted child pending tool lifecycle close log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L20) |
| `HostedChildPendingToolLifecycleCloseReason` | Public API contract for hosted child pending tool lifecycle close reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L14) |
| `HostedChildPendingToolLifecycleInput` | Input payload for hosted child pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L83) |
| `HostedChildPendingToolLifecycleLogContext` | Context for hosted child pending tool lifecycle log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L41) |
| `HostedChildPendingToolLifecycleLogger` | Public API contract for hosted child pending tool lifecycle logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L35) |
| `HostedChildPendingToolLifecycleLogWriter` | Public API contract for hosted child pending tool lifecycle log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L48) |
| `HostedChildPendingToolLifecycleUnknownToolLog` | Public API contract for hosted child pending tool lifecycle unknown tool log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L27) |
| `HostedChildProjectSwitchHandler` | Handler for hosted child project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L16) |
| `HostedChildRequestedToolsInput` | Input payload for hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L21) |
| `HostedChildRunIdentifiers` | Public API contract for hosted child run identifiers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L3) |
| `HostedChildRunStatusMonitor` | Public API contract for hosted child run status monitor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L14) |
| `HostedChildSameTurnRetryBlockSignal` | Public API contract for hosted child same turn retry block signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L36) |
| `HostedChildSteeringMutationHandler` | Handler for hosted child steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L11) |
| `HostedChildStreamWatchdogPhase` | Public API contract for hosted child stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L3) |
| `HostedChildStreamWatchdogState` | State for hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L6) |
| `HostedChildTerminalErrorCode` | Public API contract for a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L21) |
| `HostedChildTerminalStatus` | Public API contract for hosted child terminal status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L65) |
| `HostedChildWrittenArtifactPathInput` | Input payload for hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L13) |
| `HostedConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L65) |
| `HostedConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L56) |
| `HostedConversationRunChunkMirrorInstrumentation` | Public API contract for hosted conversation run chunk mirror instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L108) |
| `HostedConversationRunChunkMirrorOptions` | Options accepted by hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L117) |
| `HostedConversationRunChunkMirrorTraceAttributes` | Public API contract for hosted conversation run chunk mirror trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L102) |
| `HostedDetachedFinalizationState` | State for hosted detached finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L18) |
| `HostedDurableChildBootstrapCallbacks` | Public API contract for hosted durable child bootstrap callbacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L361) |
| `HostedDurableChildBootstrapContext` | Context for hosted durable child bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L351) |
| `HostedDurableChildExecutionOptions` | Options accepted by hosted durable child execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L31) |
| `HostedDurableChildForkRunContext` | Context for hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L80) |
| `HostedDurableChildForkRunContextInput` | Input payload for hosted durable child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L94) |
| `HostedDurableChildInvokeResult` | Result returned from hosted durable child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L36) |
| `HostedDurableChildInvokeTraceBase` | Public API contract for hosted durable child invoke trace base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L99) |
| `HostedDurableChildInvokeTraceInput` | Input payload for hosted durable child invoke trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L94) |
| `HostedDurableChildInvokeTraceOverrides` | Public API contract for hosted durable child invoke trace overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L105) |
| `HostedDurableChildInvokeTraceRecorder` | Public API contract for hosted durable child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L110) |
| `HostedDurableChildRuntimeDependencies` | Public API contract for hosted durable child runtime dependencies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L375) |
| `HostedDurableChildSetupFailure` | Public API contract for hosted durable child setup failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L84) |
| `HostedDurableChildSuccess` | Public API contract for hosted durable child success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L67) |
| `HostedDurableChildTerminalFailure` | Public API contract for hosted durable child terminal failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L75) |
| `HostedDurableRunAccepted` | Public API contract for hosted durable run accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L14) |
| `HostedDurableRunAuthErrorResponse` | Response payload for hosted durable run auth error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L20) |
| `HostedDurableRunLogger` | Public API contract for hosted durable run logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L27) |
| `HostedDurableRunSetupErrorStatusCode` | Public API contract for hosted durable run setup error status code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L11) |
| `HostedDurableRunStartCleanupInput` | Input payload for hosted durable run start cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L38) |
| `HostedDurableRunStartExecutionInput` | Input payload for hosted durable run start execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L32) |
| `HostedFormInputToolContext` | Context for hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L23) |
| `HostedLifecycleAdapter` | Public API contract for hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L29) |
| `HostedLifecycleExecution` | Public API contract for hosted lifecycle execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L23) |
| `HostedLifecycleRunnerOptions` | Options accepted by hosted lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L46) |
| `HostedLifecycleRunResult` | Result returned from hosted lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L57) |
| `HostedLifecycleTerminalState` | State for hosted lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L5) |
| `HostedLocalChildInvokeTraceRecorder` | Public API contract for hosted local child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L115) |
| `HostedMirroredOpenToolCallLogger` | Public API contract for hosted mirrored open tool call logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L114) |
| `HostedMirroredUiStreamLogger` | Public API contract for hosted mirrored UI stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L119) |
| `HostedMirroredUiStreamWatchdog` | Public API contract for hosted mirrored UI stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L124) |
| `HostedProjectRemoteToolSourceMutationHandler` | Handler for hosted project remote tool source mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L29) |
| `HostedProjectRemoteToolSourcePrepareToolInput` | Input payload for hosted project remote tool source prepare tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L39) |
| `HostedProjectRemoteToolSourceProjectSwitchHandler` | Handler for hosted project remote tool source project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L34) |
| `HostedProjectRemoteToolSourceRetryPolicy` | Public API contract for hosted project remote tool source retry policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L46) |
| `HostedProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L60) |
| `HostedProjectSteeringAdapter` | Public API contract for hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L72) |
| `HostedProjectSteeringAdapterOptions` | Options accepted by hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L47) |
| `HostedProjectSteeringLogger` | Public API contract for hosted project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L42) |
| `HostedResponseFinalizationState` | State for hosted response finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L9) |
| `HostedResponseStreamHeartbeat` | Public API contract for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L14) |
| `HostedResponseStreamHeartbeatState` | State for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L8) |
| `HostedResponseStreamWriter` | Public API contract for hosted response stream writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L3) |
| `HostedRootRunLifecycleRuntimeAdapter` | Public API contract for hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L108) |
| `HostedRuntimeRequestConfigAgent` | Public API contract for hosted runtime request config agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L18) |
| `HostedRuntimeRequestConfigRequest` | Request payload for hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L12) |
| `HostedRuntimeStateResolverContext` | Context for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L16) |
| `HostedRuntimeStateResolverInput` | Input payload for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L26) |
| `HostedRuntimeStateResolverResult` | Result returned from hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L34) |
| `HostedRuntimeSystemRefresh` | Public API contract for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L46) |
| `HostedRuntimeSystemRefreshInput` | Input payload for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L40) |
| `HostedServiceAuth` | Public API contract for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L102) |
| `HostedServiceAuthConfig` | Configuration used by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L65) |
| `HostedServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L35) |
| `HostedServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L4) |
| `HostedServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L84) |
| `HostedServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L72) |
| `HostedServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L92) |
| `HostedServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L78) |
| `HostedServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L41) |
| `HostedServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L48) |
| `HostedServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L53) |
| `HostedServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L60) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L29) |
| `HostedStreamTerminalError` | Error shape for hosted stream terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L57) |
| `HostedTerminalError` | Error shape for hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L3) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L3) |
| `HumanInputField` | Public API contract for human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L135) |
| `HumanInputFieldInput` | Input payload for human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L137) |
| `HumanInputOption` | Public API contract for human input option. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L133) |
| `HumanInputPendingRequest` | Request payload for human input pending. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L145) |
| `HumanInputRequest` | Request payload for human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L139) |
| `HumanInputRequestInput` | Input payload for human input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L141) |
| `HumanInputResult` | Result returned from human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L143) |
| `HumanInputResumeValue` | Public API contract for human input resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L150) |
| `InitializeNodeAgentServiceTelemetryOptions` | Options accepted by initialize node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L70) |
| `InitializeNodeHostedAgentServiceTelemetryOptions` | Options accepted by initialize node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L61) |
| `InputRequestOutput` | Output from input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L205) |
| `InstallAbortRejectionGuardOptions` | Options accepted by install abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L30) |
| `InstalledAbortRejectionGuard` | Public API contract for installed abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L39) |
| `InstalledProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L31) |
| `InstalledProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L50) |
| `InvokeAgentChildRunLifecycleCustomEvent` | Event emitted for invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L83) |
| `InvokeAgentChildRunLifecycleValue` | Public API contract for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L36) |
| `InvokeAgentChildRunProgressEvent` | Event emitted for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L103) |
| `InvokeAgentChildRunProgressInput` | Input payload for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L88) |
| `InvokeAgentChildRunStateDelta` | Public API contract for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L62) |
| `LiveStudioMcpToolsOptions` | Options accepted by live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L11) |
| `LoadRuntimeAgentMarkdownDefinitionFromFileInput` | Input payload for load runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L22) |
| `Memory` | Public API contract for memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L40) |
| `MemoryConfig` | Configuration used by memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L196) |
| `MemoryPersistence` | Public API contract for memory persistence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L48) |
| `MemoryStats` | Public API contract for memory stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L25) |
| `MessagePart` | Public API contract for message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L208) |
| `MirroredToolChunkState` | State for mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L28) |
| `ModelProvider` | Public API contract for model provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L192) |
| `ModelString` | Model configuration string format: "provider/model-name" Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet" | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L42) |
| `ModelTransportRequest` | Request payload for model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L225) |
| `ModelTransportResolver` | Public API contract for model transport resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L241) |
| `MonitorHostedChildRunStatusInput` | Input payload for monitor hosted child run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L131) |
| `MutableAgentProjectContext` | Context for mutable agent project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L1) |
| `NodeAgentServiceInstrumentationConfig` | Configuration used by node agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L20) |
| `NodeAgentServiceRuntimeInfrastructure` | Public API contract for node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L32) |
| `NodeAgentServiceServer` | Public API contract for node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L42) |
| `NodeAgentServiceTelemetryConfig` | Configuration used by node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L34) |
| `NodeAgentServiceTelemetryEnv` | Public API contract for node agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L14) |
| `NodeAgentServiceTelemetryLogger` | Public API contract for node agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L52) |
| `NodeAgentServiceTelemetryProcessTarget` | Public API contract for node agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L58) |
| `NodeHostedAgentServiceInstrumentationConfig` | Configuration used by node hosted agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L17) |
| `NodeHostedAgentServiceRuntimeInfrastructure` | Public API contract for node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L42) |
| `NodeHostedAgentServiceTelemetryConfig` | Configuration used by node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L23) |
| `NodeHostedAgentServiceTelemetryEnv` | Public API contract for node hosted agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L11) |
| `NodeHostedAgentServiceTelemetryLogger` | Public API contract for node hosted agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L49) |
| `NodeHostedAgentServiceTelemetryProcessTarget` | Public API contract for node hosted agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L55) |
| `NodeVeryfrontCloudAgentServiceMcpServer` | Public API contract for node Veryfront Cloud agent service MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L141) |
| `NodeVeryfrontCloudAgentServiceOptions` | Options accepted by node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L160) |
| `NodeVeryfrontCloudAgentServicePreparedExecution` | Public API contract for node Veryfront Cloud agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L210) |
| `NodeVeryfrontCloudAgentServiceProcessTarget` | Public API contract for node Veryfront Cloud agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L130) |
| `NormalizedAgentServiceChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L38) |
| `NormalizedAgentServiceContract` | Public API contract for normalized agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L113) |
| `NormalizedHostedChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L38) |
| `OpenToolCalls` | Public API contract for open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L108) |
| `ParseAgentServiceChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L54) |
| `ParseAgUiSseResponseOptions` | Options for `parseAgUiSseResponse()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L49) |
| `ParsedAgentServiceAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L59) |
| `ParsedAgentServiceChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L32) |
| `ParsedAgUiSseRun` | Parsed AG-UI SSE response summary for evals, canaries, and host tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L29) |
| `ParsedHostedAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L59) |
| `ParsedHostedChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L32) |
| `ParsedRuntimeSkillDocument` | Public API contract for parsed runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L132) |
| `ParseHostedChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L54) |
| `ParseRuntimeAgentMarkdownDefinitionInput` | Input payload for parse runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L76) |
| `PersistConversationUserMessageFailure` | Public API contract for persist conversation user message failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L63) |
| `PrepareAgentRuntimeMessagesFromUiMessagesOptions` | Options accepted by prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L15) |
| `PrepareAgentServiceChatRuntimeMessagesOptions` | Options accepted by prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L45) |
| `PrepareAgentServiceConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L74) |
| `PrepareConversationRootRunLifecycleOptions` | Options accepted by prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L22) |
| `PreparedAgentServiceChatExecution` | Public API contract for prepared hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L11) |
| `PreparedAgentServiceChatExecutionDetachedInput` | Input payload for prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L60) |
| `PreparedAgentServiceChatExecutionRuntimeOptions` | Options accepted by prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L32) |
| `PreparedAgentServiceChatExecutionStreamInput` | Input payload for prepared hosted chat execution stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L52) |
| `PrepareDefaultHostedChildForkSandboxToolSourcesInput` | Input payload for prepare default hosted child fork sandbox tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L72) |
| `PrepareDefaultHostedChildForkToolSourcesInput` | Input payload for prepare default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L38) |
| `PreparedHostedChatExecution` | Public API contract for prepared hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L11) |
| `PreparedHostedChatExecutionDetachedInput` | Input payload for prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L60) |
| `PreparedHostedChatExecutionRuntimeOptions` | Options accepted by prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L32) |
| `PreparedHostedChatExecutionStreamInput` | Input payload for prepared hosted chat execution stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L52) |
| `PrepareHostedChatRuntimeMessagesOptions` | Options accepted by prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L45) |
| `PrepareHostedChatRuntimeToolAssemblyInput` | Input payload for prepare hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L67) |
| `PrepareHostedChildForkRuntimeStepMessagesInput` | Input payload for prepare hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L20) |
| `PrepareHostedConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L74) |
| `PrepareVeryfrontCloudAgentServiceChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L24) |
| `PrepareVeryfrontCloudHostedChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L24) |
| `ProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L40) |
| `ProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L23) |
| `ProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L19) |
| `ProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L59) |
| `ProjectAgentRuntimeAgentIdCandidates` | Public API contract for project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L23) |
| `ProjectAgentRuntimeAgentSource` | Public API contract for project agent runtime agent source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L20) |
| `ProjectSteeringMutationInput` | Input payload for project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L21) |
| `ProjectSteeringMutationResult` | Result returned from project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L30) |
| `ProjectSteeringPaths` | Public API contract for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L15) |
| `ProviderNativeToolInventoryOptions` | Options accepted by provider native tool inventory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L8) |
| `ProviderToolCompatOptions` | Options accepted by provider tool compat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L19) |
| `ProviderToolCompatProvider` | Public API contract for provider tool compat provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L4) |
| `ProviderToolProfile` | Public API contract for provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L12) |
| `RecordExternalAgentWorkerSessionInput` | Input payload for record external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L201) |
| `RedisClient` | Redis client interface (compatible with ioredis and node-redis) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L19) |
| `RedisMemoryConfig` | Redis memory configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L29) |
| `RegisterAgentPushRuntimeServiceRequest` | Request payload for register agent push runtime service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L58) |
| `RegisterExternalAgentWorkerInput` | Input payload for register external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L185) |
| `RequestAuthCache` | Public API contract for request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L13) |
| `ResolveAgentServiceRegistrationInputOptions` | Options accepted by resolve agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L179) |
| `ResolveConversationHostedTerminalStateInput` | Input payload for resolve conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L28) |
| `ResolvedAgentConfig` | Configuration used by resolved agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L222) |
| `ResolvedAgentServiceRegistrationInput` | Input payload for resolved agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L21) |
| `ResolvedHostedRuntimeRequestConfig` | Configuration used by resolved hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L34) |
| `ResolvedModelTransport` | Public API contract for resolved model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L234) |
| `ResolvedRuntimeState` | State for resolved runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L256) |
| `ResolveHostedChildForkRuntimeConfigInput` | Input payload for resolve hosted child fork runtime config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L126) |
| `ResolveHostedRuntimeRequestConfigInput` | Input payload for resolve hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L24) |
| `ResolveNodeAgentServiceTelemetryConfigOptions` | Options accepted by resolve node agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L45) |
| `ResolveNodeHostedAgentServiceTelemetryConfigOptions` | Options accepted by resolve node hosted agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L37) |
| `ResolveRuntimeAgentDefinitionsDirInput` | Input payload for resolve runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L11) |
| `RootOwnedChildResultHint` | Public API contract for root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L54) |
| `RootOwnedChildResultHinted` | Public API contract for root owned child result hinted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L60) |
| `RunAgentRuntimeForkStepInput` | Input payload for run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L311) |
| `RunAgentServiceMainOptions` | Options accepted by run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L29) |
| `RunFrameworkForkStepInput` | Input payload for run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L326) |
| `RunResumeSessionManagerOptions` | Options accepted by run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L75) |
| `RunSessionStatus` | Public API contract for run session status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L1) |
| `RuntimeAgentContextItem` | Public API contract for runtime agent context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L331) |
| `RuntimeAgentControlPlaneStreamRequest` | Request payload for runtime agent control plane stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L360) |
| `RuntimeAgentMarkdownDefinition` | Definition for runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L56) |
| `RuntimeAgentProjectContext` | Context for runtime agent project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L343) |
| `RuntimeAgentRunContext` | Context for runtime agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L351) |
| `RuntimeAgentRunInvocation` | Public API contract for runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L355) |
| `RuntimeAgentSourceContext` | Context for runtime agent source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L335) |
| `RuntimeAgentTargetKind` | Public API contract for runtime agent target kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L339) |
| `RuntimeAgentThinkingConfig` | Configuration used by runtime agent thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L23) |
| `RuntimeAgentTool` | Public API contract for runtime agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L329) |
| `RuntimeAgentValidatedClaims` | Public API contract for runtime agent validated claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L347) |
| `RuntimeBuiltinSkillEntriesResult` | Result returned from runtime builtin skill entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L5) |
| `RuntimeClientCapability` | Public API contract for runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L47) |
| `RuntimeClientProfile` | Public API contract for runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L51) |
| `RuntimeClientType` | Public API contract for runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L45) |
| `RuntimeFileUrlResolver` | Public API contract for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L10) |
| `RuntimeFileUrlResolverInput` | Input payload for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L3) |
| `RuntimeGetProjectFileOptions` | Options accepted by runtime get project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L60) |
| `RuntimeLoadedProjectSkill` | Public API contract for runtime loaded project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L29) |
| `RuntimeLoadedSkillResponse` | Response payload for runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L109) |
| `RuntimeLoadedSkillResponseMessages` | Public API contract for runtime loaded skill response messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L100) |
| `RuntimeLoadSkillBuiltinStore` | Public API contract for runtime load skill builtin store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L60) |
| `RuntimeLoadSkillErrorOutput` | Output from runtime load skill error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L109) |
| `RuntimeLoadSkillReferenceFileOutput` | Output from runtime load skill reference file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L102) |
| `RuntimeLoadSkillToolContext` | Context for runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L52) |
| `RuntimeLoadSkillToolInput` | Input payload for runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L97) |
| `RuntimeLoadSkillToolMessages` | Public API contract for runtime load skill tool messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L67) |
| `RuntimeLoadSkillToolOptions` | Options accepted by runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L70) |
| `RuntimeLoadSkillToolOutput` | Output from runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L114) |
| `RuntimeProjectFile` | Public API contract for runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L46) |
| `RuntimeProjectFileListItem` | Public API contract for runtime project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L48) |
| `RuntimeProjectFilesApiOptions` | Options accepted by runtime project files API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L53) |
| `RuntimeProjectFilesClient` | Public API contract for runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L81) |
| `RuntimeProjectFilesClientOptions` | Options accepted by runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L71) |
| `RuntimeProjectFilesFetch` | Public API contract for runtime project files fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L65) |
| `RuntimeProjectFilesTrace` | Public API contract for runtime project files trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L68) |
| `RuntimeProjectInstructionsOptions` | Options accepted by runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L42) |
| `RuntimeProjectSkillCatalogOptions` | Options accepted by runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L31) |
| `RuntimeProjectSkillContext` | Context for runtime project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L13) |
| `RuntimeProjectSkillLoader` | Public API contract for runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L51) |
| `RuntimeProjectSkillLoaderLogger` | Public API contract for runtime project skill loader logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L35) |
| `RuntimeProjectSkillLoaderOptions` | Options accepted by runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L40) |
| `RuntimeProjectSteeringLookup` | Public API contract for runtime project steering lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L24) |
| `RuntimePromptBlockOptions` | Options accepted by runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L1) |
| `RuntimeSkillDefinition` | Definition for runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L63) |
| `RuntimeSkillFrontmatter` | Public API contract for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L20) |
| `RuntimeSkillMetadataLogger` | Public API contract for runtime skill metadata logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L127) |
| `RuntimeStateRequest` | Request payload for runtime state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L246) |
| `RuntimeStateResolver` | Public API contract for runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L262) |
| `RuntimeUploadUrlClientOptions` | Options accepted by runtime upload URL client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L22) |
| `RuntimeUploadUrlFetch` | Public API contract for runtime upload URL fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L19) |
| `RuntimeUploadUrlOptions` | Options accepted by runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L29) |
| `SlashCommandArtifactPolicy` | Public API contract for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L12) |
| `SlashCommandArtifactPolicyInput` | Input payload for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L6) |
| `SourceProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L25) |
| `SourceProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L44) |
| `StartAgentRuntimeForkInput` | Input payload for start agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L177) |
| `StartAgentRuntimeForkWithHostToolsInput` | Input payload for start agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L200) |
| `StartAgentServiceRuntimeOptions` | Options accepted by start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L134) |
| `StartAgentServiceRuntimeResult` | Result returned from start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L159) |
| `StartAgentServiceServerOptions` | Options accepted by start agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L34) |
| `StartedHostedChildForkRuntime` | Public API contract for started hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L28) |
| `StartHostedChildForkRuntimeWithHostToolsInput` | Input payload for start hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L19) |
| `StartNodeAgentServiceOptions` | Options accepted by start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L128) |
| `StartNodeAgentServiceResult` | Result returned from start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L153) |
| `StartNodeAgentServiceServerOptions` | Options accepted by start node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L26) |
| `StartNodeHostedAgentServiceOptions` | Options accepted by start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L117) |
| `StartNodeHostedAgentServiceResult` | Result returned from start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L145) |
| `StreamToolCall` | Public API contract for stream tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L212) |
| `SubmitResumeValueOutcome` | Public API contract for submit resume value outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L44) |
| `Suggestion` | Public API contract for suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L48) |
| `Suggestions` | Public API contract for suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L75) |
| `TerminalConversationRunStatus` | Public API contract for terminal conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable-contracts.ts#L133) |
| `ToolCall` | Public API contract for tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L214) |
| `ToolCallPart` | Agent message part for a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L204) |
| `ToolCallPartWithArgs` | Tool-call message part that stores arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L200) |
| `ToolCallPartWithInput` | Tool-call message part that stores input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L202) |
| `ToolExecutionDataEventBridgeStreamInput` | Input payload for tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L6) |
| `ToolExecutionDataEventPublisher` | Public API contract for tool execution data event publisher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L3) |
| `ToolResultPart` | Agent message part for a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L206) |
| `VeryfrontCloudAgentServiceChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L19) |
| `VeryfrontCloudAgentServiceOptions` | Options accepted by Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L198) |
| `VeryfrontCloudHostedChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L19) |
| `WaitForDurableHumanInputResolutionOptions` | Options accepted by wait for durable human input resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L182) |
| `WaitForHumanInputOptions` | Options accepted by wait for human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L190) |
| `WorkflowConfig` | Configuration used by workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L73) |
| `WorkflowResult` | Result returned from workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L79) |
| `WorkflowStep` | Public API contract for workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L65) |
| `WrapHostedChildProjectSwitchToolInput` | Input payload for wrap hosted child project switch tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L29) |
| `WrapHostedChildSteeringMutationToolInput` | Input payload for wrap hosted child steering mutation tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L19) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentServiceAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L38) |
| `agentServiceConfigSchema` | Zod schema for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L139) |
| `agentServiceRegistrationConfigSchema` | Zod schema for agent service registration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L82) |
| `agUiSseEventTypes` | AG-UI runtime event type constants normalized from browser-wire SSE events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L4) |
| `conversationRunEventTypes` | Shared conversation run event types value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L6) |
| `createNodeHostedAgentServiceRuntimeInfrastructure` | Create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L75) |
| `defaultHostedInvokeAgentInputSchema` | Schema for default hosted invoke agent input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L173) |
| `defaultHostedInvokeAgentSelectionSchema` | Schema for default hosted invoke agent selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L162) |
| `getAgUiRuntimeContextItemSchema` | Zod schema for get AG-UI runtime context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L59) |
| `getAgUiRuntimeInjectedToolSchema` | Zod schema for get AG-UI runtime injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L45) |
| `getAgUiRuntimeMessageSchema` | Zod schema for get AG-UI runtime message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L145) |
| `getAgUiRuntimeRequestSchema` | Zod schema for get AG-UI runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L165) |
| `getCreateInputRequestRequestSchema` | Zod schema for get create input request request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L22) |
| `getCreateInputRequestResponseSchema` | Zod schema for get create input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L156) |
| `getFormInputToolInputSchema` | Zod schema for get form input tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L9) |
| `getGetInputRequestResponseSchema` | Zod schema for get get input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L158) |
| `getHumanInputFieldSchema` | Zod schema for get human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L35) |
| `getHumanInputOptionSchema` | Zod schema for get human input option. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L13) |
| `getHumanInputPendingRequestSchema` | Zod schema for get human input pending request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L124) |
| `getHumanInputRequestSchema` | Zod schema for get human input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L95) |
| `getHumanInputResultSchema` | Zod schema for get human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L110) |
| `getInputRequestLifecycleDataEventSchema` | Zod schema for get input request lifecycle data event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L185) |
| `getInputRequestOutputSchema` | Zod schema for get input request output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L161) |
| `getInputRequestRestSchema` | Zod schema for get input request rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L106) |
| `getInputResponseRestSchema` | Zod schema for get input response rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L55) |
| `getInputResponseValuesSchema` | Zod schema for get input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L14) |
| `getParseRuntimeAgentMarkdownDefinitionInputSchema` | Zod schema for get parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L61) |
| `getRuntimeAgentMarkdownDefinitionSchema` | Zod schema for get runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L28) |
| `getRuntimeAgentThinkingConfigSchema` | Zod schema for get runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L10) |
| `getRuntimeClientCapabilitySchema` | Zod schema for get runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L9) |
| `getRuntimeClientProfileSchema` | Zod schema for get runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L22) |
| `getRuntimeClientTypeSchema` | Zod schema for get runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L4) |
| `hostedAgentProjectSteeringOptionsSchema` | Zod schema for hosted agent project steering options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L33) |
| `hostedAgentServiceConfigSchema` | Zod schema for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L142) |
| `hostedAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L38) |
| `hostedChatRequestSchema` | Schema for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L74) |
| `hostedChatRuntimeOverridesSchema` | Schema for hosted chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L44) |
| `hostedChildForkToolInputSchema` | Schema for hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L36) |
| `hostedChildTerminalErrorCodes` | Shared hosted child terminal error codes value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L14) |
| `hostedDurableRootRunDescriptorSchema` | Schema for hosted durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L29) |
| `loadHostedAgentServiceEnvFiles` | Loads hosted agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L65) |
| `loadRuntimeAgentMarkdownDefinitionFromFileInputSchema` | Zod schema for load runtime agent markdown definition from file input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L60) |
| `parseRuntimeAgentMarkdownDefinitionInputSchema` | Schema for parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L71) |
| `resolvedAgentServiceRegistrationInputSchema` | Zod schema for resolved agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L101) |
| `resolveRuntimeAgentDefinitionsDirInputSchema` | Zod schema for resolve runtime agent definitions dir input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L41) |
| `runtimeAgentMarkdownDefinitionSchema` | Schema for runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L51) |
| `runtimeAgentThinkingConfigSchema` | Schema for runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L20) |
| `runtimeClientCapabilitySchema` | Schema for runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L38) |
| `runtimeClientProfileSchema` | Schema for runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L42) |
| `runtimeClientTypeSchema` | Schema for runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L34) |
| `runtimeProjectFileListItemSchema` | Schema for runtime project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L43) |
| `runtimeProjectFileSchema` | Schema for runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L39) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/agent/identity`

```ts
import { isAgentCatalogAction, isAgentCatalogKind, isInstalledProjectAgentKind } from "veryfront/agent/identity";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AGENT_CATALOG_ACTIONS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L7) |
| `AGENT_CATALOG_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts) |
| `PROJECT_AGENT_EXECUTION_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L21) |
| `PROJECT_AGENT_KINDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L14) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `isAgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L67) |
| `isAgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L63) |
| `isInstalledProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L77) |
| `isProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L83) |
| `isProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L73) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentCatalogAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L12) |
| `AgentCatalogKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L5) |
| `InstalledProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L31) |
| `InstalledProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L50) |
| `ProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L40) |
| `ProjectAgentExecutionKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L23) |
| `ProjectAgentKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L19) |
| `ProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L59) |
| `SourceProjectAgentExecutionIdentity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L25) |
| `SourceProjectAgentRunSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/identity-contracts.ts#L44) |
