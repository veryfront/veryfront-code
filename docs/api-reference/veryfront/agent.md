---
title: "veryfront/agent"
description: "AI agents with memory, tools, and multi-agent composition."
order: 2
---

AI agents with memory, tools, and multi-agent composition.

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
import { z } from "zod";

const searchTool = tool({
  id: "search",
  description: "Search the knowledge base",
  inputSchema: z.object({
    query: z.string().describe("Knowledge base search query"),
  }),
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
| `id?` | `string` | Unique identifier (auto-generated if omitted) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L82) |
| `name?` | `string` | Human-readable display name for registry and control-plane listings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L84) |
| `description?` | `string` | Optional summary shown in registry and control-plane listings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L86) |
| `model?` | `ModelString` | Optional model string in "provider/model" format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L94) |
| `system` | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code> | System prompt: string, function, or async function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L95) |
| `tools?` | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code> | Tools available to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L96) |
| `remoteTools?` | `RemoteToolSource[]` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L97) |
| `allowedRemoteTools?` | `string[]` | Optional remote tool name allowlist. When set, only matching tools from `remoteTools` are exposed to the model and executable at runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L102) |
| `maxSteps?` | `number` | Max tool-call iterations per request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L103) |
| `streaming?` | `boolean` | Enable streaming responses | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L104) |
| `memory?` | `MemoryConfig` | Conversation memory settings | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L105) |
| `middleware?` | `AgentMiddleware[]` | Execution middleware pipeline | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L106) |
| `edge?` | `EdgeConfig` | Edge runtime configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L107) |
| `multimodal?` | <code>&#123; vision?: boolean; audio?: boolean &#125;</code> | Enable vision and/or audio | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L108) |
| `allowedModels?` | `ModelString[]` | Restrict runtime model overrides to these "provider/model" strings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L113) |
| `resolveModelTransport?` | `ModelTransportResolver` | Optional request-aware hook for overriding the resolved model runtime and provider transport options on a per-call basis. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L118) |
| `resolveRuntimeState?` | `RuntimeStateResolver` | Optional step-boundary hook for refreshing the runtime system prompt and host-owned context during a long-lived run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L123) |
| `onToolResult?` | `ToolExecutionResultHandler` | Optional hook invoked after the runtime executes a configured local, registry, integration, or remote tool and before the tool result is persisted or streamed back to callers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L129) |
| `skills?` | `true \| string[]` | Enable skills for this agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L139) |
| `suggestions?` | `Suggestions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L140) |
| `security?` | `false` | Set to false to disable the default security middleware | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L142) |

**Returns:** `Agent`

### `agent.generate(input)`

Run the agent and return a complete response. Accepts a string or message array as input.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input` | `string \| Message[]` | Prompt string or message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L259) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L260) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L262) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L264) |

**Returns:** <code>Promise&lt;AgentResponse&gt;</code>

### `agent.stream(input)`

Run the agent and stream the response. Returns a result with `.toDataStreamResponse()` for API routes.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `input?` | `string` | Prompt string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L268) |
| `messages?` | `Message[]` | Conversation message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L269) |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L270) |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L272) |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L274) |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback fired when a tool is invoked | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L275) |
| `onChunk?` | <code>(chunk: string) =&gt; void</code> | Callback fired for each text chunk | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L276) |
| `onFinish?` | <code>(response: AgentResponse) =&gt; void</code> |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L277) |
| `abortSignal?` | `AbortSignal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L278) |

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
| `AgUiDetachedStartAcceptedSchema` | Schema for AG-UI detached start accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L97) |
| `AgUiDetachedStartRequestSchema` | Schema for AG-UI detached start request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L93) |
| `AgUiRequestSchema` | Schema for AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L120) |
| `AgUiResumeSignalSchema` | Schema for AG-UI resume signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L28) |
| `AppendConversationRunEventsResponseSchema` | Schema for append conversation run events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L343) |
| `CompleteConversationRunResponseSchema` | Schema for complete conversation run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L279) |
| `CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE` | Shared conversation hosted aborted terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L19) |
| `CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE` | Shared conversation hosted incomplete tool calls terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L21) |
| `CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE` | Shared conversation hosted stream error terminal error code value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L17) |
| `ConversationMessageRecordSchema` | Schema for conversation message record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L49) |
| `ConversationRecordSchema` | Schema for conversation record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L37) |
| `ConversationRunEventSchema` | Schema for conversation run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L30) |
| `ConversationRunProjectionSchema` | Schema for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L155) |
| `ConversationRunStatusSchema` | Schema for conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L87) |
| `ConversationRunTargetsSchema` | Schema for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L46) |
| `DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS` | Default value for fork response promise timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L175) |
| `DEFAULT_HOSTED_CHILD_AGENT_ID` | Default value for hosted child agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L7) |
| `DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES` | Default value for hosted child excluded tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L34) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS` | Default value for hosted child fork stream active tool timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L57) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS` | Default value for hosted child fork stream finalization timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L61) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L55) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS` | Default value for hosted child fork stream post tool idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L59) |
| `DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS` | Default value for hosted child requested tool companions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L41) |
| `DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN` | Default value for hosted child sandbox required cue pattern. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L49) |
| `DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS` | Default value for hosted child status poll interval ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L63) |
| `DEFAULT_PROJECT_STEERING_PATHS` | Default value for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L2) |
| `DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER` | Default value for runtime agent context marker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L41) |
| `DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL` | Shared delegate only when materially helpful value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L9) |
| `ExternalAgentWorkerRequestSnapshotSchema` | Zod schema for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L116) |
| `ExternalAgentWorkerRunSchema` | Zod schema for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L165) |
| `ExternalAgentWorkerSchema` | Zod schema for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L87) |
| `ExternalAgentWorkerSessionSchema` | Zod schema for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L136) |
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
| `PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES` | Shared project steering file mutation tool names value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L8) |
| `ROOT_OWNED_CHILD_RESULT_INSTRUCTION` | Shared root owned child result instruction value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L42) |
| `RUNTIME_LOAD_SKILL_CONTINUATION_NOTE` | Shared runtime load skill continuation note value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L32) |
| `RUNTIME_LOAD_SKILL_DESCRIPTION` | Shared runtime load skill description value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L36) |
| `RuntimeAgentContextItemSchema` | Schema for runtime agent context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L122) |
| `RuntimeAgentIdSchema` | Schema for runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L55) |
| `RuntimeAgentProjectContextSchema` | Schema for runtime agent project context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L214) |
| `RuntimeAgentRunContextSchema` | Schema for runtime agent run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L297) |
| `RuntimeAgentRunIdSchema` | Schema for runtime agent run ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L29) |
| `RuntimeAgentRunInvocationSchema` | Schema for runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L319) |
| `RuntimeAgentServiceIdSchema` | Schema for runtime agent service ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L48) |
| `RuntimeAgentSourceContextSchema` | Schema for runtime agent source context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L145) |
| `RuntimeAgentTargetKindSchema` | Schema for runtime agent target kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L154) |
| `RuntimeAgentToolCallIdSchema` | Schema for runtime agent tool call ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L36) |
| `RuntimeAgentToolNameSchema` | Schema for runtime agent tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L67) |
| `RuntimeAgentToolSchema` | Schema for runtime agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L92) |
| `RuntimeAgentValidatedClaimsSchema` | Schema for runtime agent validated claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L228) |
| `RuntimeSkillFrontmatterSchema` | Schema for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L58) |
| `SLASH_COMMAND_ARTIFACT_REMINDER` | Shared slash command artifact reminder value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L121) |
| `SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE` | Shared synthesize delegated findings in root voice value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L15) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addFirstTurnStarterIntentRootOwnershipReminder` | Add first turn starter intent root ownership reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L228) |
| `addLoadSkillContinuationReminder` | Add load skill continuation reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L292) |
| `addSlashCommandArtifactReminder` | Add slash command artifact reminder helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L313) |
| `agent` | Agent helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/factory.ts#L57) |
| `agentAsTool` | Agent as tool helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L18) |
| `appendAgentServiceChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L180) |
| `appendConversationRunEvents` | Append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1279) |
| `appendHostedChildMirrorChunk` | Append hosted child mirror chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L180) |
| `appendMissingChildRunToolCalls` | Append missing child run tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L15) |
| `appendMissingChildRunToolResults` | Append missing child run tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L31) |
| `applyAgentProjectContextChange` | Apply agent project context change helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L9) |
| `applyDefaultResearchArtifactPath` | Apply default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L218) |
| `applyPartToStreamedStepState` | State for apply part to streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L687) |
| `bootstrapAgentService` | Bootstrap agent service helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L56) |
| `bootstrapConversationAgentRun` | Bootstrap conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L306) |
| `bootstrapHostedChildRun` | Bootstrap hosted child run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L52) |
| `buildAgentRunTraceAttributes` | Builds agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L88) |
| `buildAgUiBrowserFinalizeResponse` | Response payload for build AG-UI browser finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L142) |
| `buildAgUiSseTraceSignature` | Build a compact ordered event-type signature for regression checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L75) |
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L121) |
| `buildChildRunExecutionSnapshot` | Builds child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L77) |
| `buildChildRunExhaustedStepBudgetErrorMessage` | Message shape for build child run exhausted step budget error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L47) |
| `buildChildRunFailureResult` | Result returned from build child run failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L116) |
| `buildChildRunFailureSnapshot` | Builds child run failure snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L133) |
| `buildChildRunResultCommon` | Builds child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L94) |
| `buildChildRunResultSummary` | Builds child run result summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L29) |
| `buildChildRunSuccessResult` | Result returned from build child run success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L99) |
| `buildChildRunSuccessSnapshot` | Builds child run success snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L152) |
| `buildDefaultHostedChildForkToolSet` | Builds default hosted child fork tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L385) |
| `buildDefaultResearchArtifactPathReminder` | Builds default research artifact path reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L96) |
| `buildDefaultResearchArtifactPaths` | Builds default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L118) |
| `buildDetachedAgUiStartRequest` | Request payload for build detached AG-UI start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L138) |
| `buildDetachedFallbackChunks` | Builds detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L162) |
| `buildDetachedFallbackMessageState` | State for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L102) |
| `buildExecuteToolTraceAttributes` | Builds execute tool trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L117) |
| `buildFinalizedAgentRunTraceAttributes` | Builds finalized agent run trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L178) |
| `buildFinalizedMessageFallbackChunks` | Builds finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L126) |
| `buildFinalizedMessageState` | State for build finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L70) |
| `buildForkRuntimeStepFromResponse` | Response payload for build fork runtime step from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L439) |
| `buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation` | Builds hosted chat request forwarded props from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L78) |
| `buildHostedChatRequestFromRuntimeAgentInvocation` | Builds hosted chat request from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L119) |
| `buildHostedChatRequestInputFromRuntimeAgentInvocation` | Builds hosted chat request input from runtime agent invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L97) |
| `buildHostedChildCompletedLog` | Builds hosted child completed log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L69) |
| `buildHostedChildConversationBody` | Builds hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L33) |
| `buildHostedChildErrorLog` | Builds hosted child error log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L89) |
| `buildHostedChildExhaustedStepBudgetLog` | Builds hosted child exhausted step budget log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L48) |
| `buildHostedChildForkInstructions` | Builds hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L65) |
| `buildHostedChildToolDescription` | Builds hosted child tool description. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L410) |
| `buildHostedDurableChildInvokeFailureResult` | Result returned from build hosted durable child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L128) |
| `buildHostedDurableChildInvokeSuccessResult` | Result returned from build hosted durable child invoke success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L163) |
| `buildHostedDurableChildInvokeTerminalFailureResult` | Result returned from build hosted durable child invoke terminal failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L149) |
| `buildInputRequestLifecycleDataEvent` | Event emitted for build input request lifecycle data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L277) |
| `buildInvokeAgentChildRunLifecycleCustomEvent` | Event emitted for build invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L148) |
| `buildInvokeAgentChildRunProgressEvents` | Builds invoke agent child run progress events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L159) |
| `buildInvokeAgentChildRunStateDelta` | Builds invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L131) |
| `buildInvokeAgentFollowupInstruction` | Builds invoke agent followup instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L103) |
| `buildInvokeAgentTraceAttributes` | Builds invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L132) |
| `buildParsedAgentServiceAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L173) |
| `buildParsedAgentServiceChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L107) |
| `buildParsedHostedAgUiRequest` | Request payload for build parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L173) |
| `buildParsedHostedChatRequest` | Request payload for build parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L107) |
| `buildRecoveredStepParts` | Builds recovered step parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L936) |
| `buildRootOwnedChildResultHint` | Builds root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L45) |
| `buildRootOwnedChildRunResultHint` | Builds root owned child run result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L49) |
| `buildRootOwnedChildRunResultText` | Builds root owned child run result text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L34) |
| `buildRootOwnedDelegatedFindingsInstruction` | Builds root owned delegated findings instruction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L37) |
| `buildRuntimeAgentControlPlaneStreamRequestFromInvocation` | Builds runtime agent control plane stream request from invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L366) |
| `buildRuntimeAvailableSkillsPromptBlock` | Builds runtime available skills prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L41) |
| `buildRuntimeLoadedSkillResponse` | Response payload for build runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L215) |
| `buildRuntimeSkillDefinition` | Definition for build runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L170) |
| `buildStarterIntentRootOwnershipBlockMessage` | Message shape for build starter intent root ownership block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L113) |
| `buildStarterIntentRootOwnershipReminder` | Builds starter intent root ownership reminder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L108) |
| `buildStudioMcpHeaders` | Builds studio MCP headers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L29) |
| `buildVeryfrontCloudRuntimeInstructions` | Builds Veryfront Cloud runtime instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L71) |
| `cleanupAfterHostedChatExecutionFinalization` | Cleanup after hosted chat execution finalization helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L182) |
| `clearProjectAgentRuntimeRegistries` | Clear project agent runtime registries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L41) |
| `clientAllowsStudioMcp` | Client allows studio MCP helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L125) |
| `cloneMirroredToolChunkState` | State for clone mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L51) |
| `closeAgentServiceChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L193) |
| `closeAgentServiceChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L213) |
| `closeChildRunExecutionBuffers` | Close child run execution buffers helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L18) |
| `closeHostedChildReasoningSegment` | Close hosted child reasoning segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L193) |
| `closeHostedChildTextSegment` | Close hosted child text segment helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L213) |
| `closeHostedMirroredOpenToolCalls` | Close hosted mirrored open tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L202) |
| `composeAbortSignals` | Compose abort signals helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L61) |
| `computeOpenToolCalls` | Compute open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L172) |
| `containsExactArtifactPathValue` | Contains exact artifact path value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L195) |
| `convertAgentRuntimeMessagesToProviderMessages` | Convert agent runtime messages to provider messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L474) |
| `convertCompactedProviderMessagesToChildForkRuntimeMessages` | Convert compacted provider messages to child fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L70) |
| `convertProviderMessagesToAgentRuntimeMessages` | Convert provider messages to agent runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L462) |
| `createAgentServiceAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L151) |
| `createAgentServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L265) |
| `createAgentServiceChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L233) |
| `createAgentServiceFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L25) |
| `createAgentServiceProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L80) |
| `createAgentServiceRegistrationLifecycle` | Create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L373) |
| `createAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L190) |
| `createAgentServiceRuntime` | Create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L195) |
| `createAgentServiceServerRuntime` | Create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L54) |
| `createAgUiBrowserChunkEncoder` | Create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L46) |
| `createAgUiBrowserEncoderState` | State for create AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L36) |
| `createAgUiBrowserFinalizeTracker` | Create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L23) |
| `createAgUiBrowserResponseStream` | Create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L61) |
| `createAgUiCancelHandler` | Handler for create AG-UI cancel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L134) |
| `createAgUiChatUiChunkBrowserEncoder` | Create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L143) |
| `createAgUiChatUiTrackedBrowserResponse` | Response payload for create AG-UI chat UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L161) |
| `createAgUiChunkEncoderBridge` | Create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L24) |
| `createAgUiDetachedStartHandler` | Handler for create AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L389) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L329) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L334) |
| `createAgUiHandler` | Handler for create AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L339) |
| `createAgUiResumeHandler` | Handler for create AG-UI resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L70) |
| `createAgUiRunErrorEvent` | Event emitted for create AG-UI run error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L285) |
| `createAgUiRuntimeBrowserResponse` | Response payload for create AG-UI runtime browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L29) |
| `createAgUiRuntimeChatStreamEncoder` | Create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L79) |
| `createAgUiRuntimeContextMap` | Create AG-UI runtime context map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L12) |
| `createAgUiRuntimeEventEncoder` | Create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L25) |
| `createAgUiRuntimeHandler` | Handler for create AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L368) |
| `createAgUiSseErrorResponse` | Response payload for create AG-UI sse error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L296) |
| `createAgUiSseResponse` | Response payload for create AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L309) |
| `createAgUiTrackedBrowserResponse` | Response payload for create AG-UI tracked browser. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L24) |
| `createBootstrappedHostedChatExecutionRuntime` | Create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L304) |
| `createChatUiMessageStreamFromDataStream` | Create chat UI message stream from data stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L499) |
| `createConversationAgentRun` | Create conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1348) |
| `createConversationChildLifecycleAdapter` | Create conversation child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L169) |
| `createConversationHostedLifecycleAdapter` | Create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L49) |
| `createConversationHostedStreamLifecycleAdapter` | Create conversation hosted stream lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L109) |
| `createConversationHostedTerminalAdapter` | Create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L194) |
| `createConversationMessage` | Message shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L182) |
| `createConversationRecord` | Record shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L166) |
| `createConversationRootRunContext` | Context for create conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L42) |
| `createConversationRootRunStartAdapter` | Create conversation root run start adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L94) |
| `createConversationRunChunkMirror` | Create conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L151) |
| `createConversationRunContext` | Context for create conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L12) |
| `createConversationRunEventQueueController` | Create conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1005) |
| `createConversationRunMirror` | Create conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L77) |
| `createConversationRunStreamMirror` | Create conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L23) |
| `createDefaultAgentServiceChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L282) |
| `createDefaultAgentServiceInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L572) |
| `createDefaultAgentServiceProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L176) |
| `createDefaultHostedChatRuntime` | Create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L282) |
| `createDefaultHostedInvokeAgentTool` | Create default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L572) |
| `createDefaultHostedProjectSteeringRefresh` | Create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L176) |
| `createDefaultResearchRunArtifactMirrorHandler` | Handler for create default research run artifact mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L354) |
| `createDetachedRunShutdownLifecycle` | Create detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L143) |
| `createDetachedRunTracker` | Create detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L60) |
| `createExternalAgentWorkerClient` | Create external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L413) |
| `createForkRuntimeStreamMappingState` | State for create fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1040) |
| `createForkRuntimeUserMessage` | Message shape for create fork runtime user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L478) |
| `createFrameworkStreamState` | State for create framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1209) |
| `createHostedAgentProjectSteering` | Create hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L80) |
| `createHostedAgentRunSpanController` | Create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L64) |
| `createHostedAgentServiceRouteSet` | Create hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L190) |
| `createHostedAgentServiceRuntime` | Create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L257) |
| `createHostedAgUiValidationErrorResponse` | Response payload for create hosted AG-UI validation error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L151) |
| `createHostedChatExecutionRuntime` | Create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L591) |
| `createHostedChatExecutionRuntimeBootstrap` | Create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L222) |
| `createHostedChatFinalizeDetachedBuildState` | State for create hosted chat finalize detached build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L411) |
| `createHostedChatFinalizeResponseBuildState` | State for create hosted chat finalize response build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L371) |
| `createHostedChatRuntimeAgentAdapter` | Create hosted chat runtime agent adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L36) |
| `createHostedChatStreamFinalizationHooks` | Create hosted chat stream finalization hooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L338) |
| `createHostedChildExecutionLogWriter` | Create hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L39) |
| `createHostedChildForkRunContext` | Context for create hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L129) |
| `createHostedChildInvokeTool` | Create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L55) |
| `createHostedChildMirrorContext` | Context for create hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L233) |
| `createHostedChildPendingToolLifecycle` | Create hosted child pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L90) |
| `createHostedChildPendingToolLifecycleLogger` | Create hosted child pending tool lifecycle logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L54) |
| `createHostedConversationRunChunkMirror` | Create hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L321) |
| `createHostedDurableChildForkRunContext` | Context for create hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L169) |
| `createHostedDurableChildInvokeTraceRecorder` | Create hosted durable child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L195) |
| `createHostedFormInputTool` | Create hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L25) |
| `createHostedMirroredUiStream` | Create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L249) |
| `createHostedProjectRemoteToolSource` | Create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L77) |
| `createHostedProjectRemoteToolSources` | Create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L255) |
| `createHostedProjectSteeringAdapter` | Create hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L130) |
| `createHostedRootRunLifecycleRuntimeAdapter` | Create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L140) |
| `createHostedRuntimeStateResolver` | Create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L70) |
| `createHostedServiceAuth` | Create hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L265) |
| `createInitialForkRuntimeMessages` | Create initial fork runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L492) |
| `createInputRequest` | Request payload for create input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L209) |
| `createLiveStudioMcpTools` | Create live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L70) |
| `createMemory` | Create memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L255) |
| `createMirroredToolChunkState` | State for create mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L39) |
| `createNodeAgentServiceRuntimeInfrastructure` | Create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L46) |
| `createNodeVeryfrontCloudAgentServiceRuntime` | Create node Veryfront Cloud agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L999) |
| `createRedisMemory` | Create redis memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L165) |
| `createRequestAuthCache` | Create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L19) |
| `createRuntimeAgentDefinitionFromAgent` | Create runtime agent definition from agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L79) |
| `createRuntimeAgentFromMarkdownDefinition` | Definition for create runtime agent from markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L8) |
| `createRuntimeAgentSystemMessages` | Create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L137) |
| `createRuntimeLoadSkillTool` | Create runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L213) |
| `createRuntimeProjectFilesClient` | Create runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L103) |
| `createRuntimeProjectSkillLoader` | Create runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L273) |
| `createRuntimePromptBlock` | Create runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L9) |
| `createStreamedStepState` | State for create streamed step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L655) |
| `createToolExecutionDataEventBridgeStream` | Create tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L33) |
| `createToolResultPart` | Create a chat tool-result part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L331) |
| `createVeryfrontCloudAgentServiceChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L44) |
| `createVeryfrontCloudHostedChatExecutionRootRunOptions` | Options accepted by create Veryfront Cloud hosted chat execution root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L44) |
| `createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L19) |
| `createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions` | Options accepted by create Veryfront Cloud prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L19) |
| `createVeryfrontCloudRuntimeSystemMessages` | Create Veryfront Cloud runtime system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L44) |
| `createWorkflow` | Create workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L73) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L171) |
| `defineAgentService` | Define an agent service and expose a policy-neutral runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L376) |
| `deriveAgentServiceAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L107) |
| `deriveAgUiForwardedConfig` | Configuration used by derive AG-UI forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L72) |
| `deriveHostedAgUiChatContext` | Context for derive hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L107) |
| `describeProjectAgentRuntimeAgentIdCandidates` | Describe project agent runtime agent ID candidates helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L119) |
| `discoverProjectAgentRuntime` | Discover project agent runtime helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L50) |
| `dispatchConversationHostedStreamErrorState` | State for dispatch conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L102) |
| `dispatchConversationHostedTerminalState` | State for dispatch conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L87) |
| `doesProjectAgentRuntimeAgentMatchSource` | Does project agent runtime agent match source helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L66) |
| `encodeConversationRunEvents` | Encode conversation run events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L236) |
| `ensureConversationProjectLink` | Ensure conversation project link helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L140) |
| `evaluateSlashCommandArtifactPolicy` | Evaluate slash command artifact policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L200) |
| `evaluateStarterIntentTurnPolicy` | Evaluate starter intent turn policy helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L210) |
| `executeAgUiDetachedStart` | Execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L295) |
| `executeDefaultAgentServiceInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L405) |
| `executeDefaultHostedInvokeAgentTool` | Execute default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L405) |
| `executeDurableHumanInputFlow` | Execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L218) |
| `executeHostedChildForkRunContextStream` | Execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L223) |
| `executeHostedChildForkStream` | Execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L476) |
| `executeHostedChildForkToolInput` | Input payload for execute hosted child fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L226) |
| `executeHostedChildForkWithPreparedTools` | Execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L269) |
| `executeHostedDurableChatRun` | Execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L195) |
| `executeHostedDurableChildFork` | Execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L571) |
| `executeHostedLocalChildInvoke` | Execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L290) |
| `expandAllowedRemoteToolNames` | Expand allowed remote tool names helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L56) |
| `expandHostedChildRequestedTools` | Expand hosted child requested tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L83) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L115) |
| `extractLatestUserText` | Extract latest user text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L68) |
| `extractStarterIntentId` | Extract starter intent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L192) |
| `fetchConversationRecord` | Record shape for fetch conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L126) |
| `fetchDefaultAgentServiceProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L65) |
| `fetchDefaultHostedProjectSteering` | Fetch default hosted project steering helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L65) |
| `fetchLatestConversationUserText` | Fetch latest conversation user text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L112) |
| `filterAgentTraceAttributes` | Filter agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L38) |
| `filterHostedChatRuntimeLocalTools` | Filter hosted chat runtime local tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L101) |
| `finalizeAgUiBrowserEvents` | Finalize AG-UI browser events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L512) |
| `finalizeChildRunExecutionResources` | Finalize child run execution resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L26) |
| `finalizeConversationAgentRun` | Finalize conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1412) |
| `finalizeHostedChildForkCompletion` | Finalize hosted child fork completion helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L154) |
| `finalizeHostedChildForkRunContextResources` | Finalize hosted child fork run context resources helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L304) |
| `finalizeHostedDetached` | Finalize hosted detached helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L149) |
| `finalizeHostedResponse` | Response payload for finalize hosted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L91) |
| `findLatestUserConversationMessageContext` | Context for find latest user conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L239) |
| `flattenSystemInstructions` | Flatten system instructions helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L43) |
| `flushConversationRunEventBatches` | Flush conversation run event batches. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L793) |
| `flushConversationRunEventQueue` | Flush conversation run event queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L902) |
| `formatChildRunStreamPartError` | Error shape for format child run stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L31) |
| `formatRuntimeSkillMetadata` | Formats runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L15) |
| `getAgent` | Return agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L146) |
| `getAgentRuntimeTextPart` | Return a runtime text part when the value carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L278) |
| `getAgentRuntimeToolCallPart` | Return a runtime tool-call part when the value carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L285) |
| `getAgentRuntimeToolResultPart` | Return a runtime tool-result part when the value carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L310) |
| `getAgentsAsTools` | Return agents as tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L175) |
| `getAgentServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L159) |
| `getAgUiChatUiMessageChunkMetadata` | Return AG-UI chat UI message chunk metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L69) |
| `getAgUiChatUiMessageMetadataFromChunk` | Return AG-UI chat UI message metadata from chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L38) |
| `getAgUiChatUiMessageUsageMetadata` | Return AG-UI chat UI message usage metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L53) |
| `getAgUiSseEventsOfType` | Filter parsed AG-UI SSE events by normalized event type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L67) |
| `getAgUiSseStringField` | Return a string field from a parsed AG-UI SSE event record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L61) |
| `getAllAgentIds` | Return all agent IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L151) |
| `getChildRunSnapshotUsage` | Return child run snapshot usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L70) |
| `getConfirmedProjectContextSwitchId` | Return confirmed project context switch ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L51) |
| `getConversationRun` | Return conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1203) |
| `getConversationRunEventJsonByteLength` | Return conversation run event JSON byte length. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L19) |
| `getEmptyHostedFinalizedMessageTerminalError` | Error shape for get empty hosted finalized message terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L66) |
| `getForkRuntimeAllowedToolNames` | Return fork runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L68) |
| `getForwardedHostedModelId` | Return forwarded hosted model ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L48) |
| `getForwardedHostedRuntimeOverrides` | Return forwarded hosted runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L58) |
| `getHostedChildWrittenArtifactPath` | Return hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L112) |
| `getHostedMirroredAbortErrorText` | Return hosted mirrored abort error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L161) |
| `getHostedServiceTokenFromRequest` | Request payload for get hosted service token from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L159) |
| `getHostedStreamErrorText` | Return hosted stream error text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L61) |
| `getInputRequest` | Request payload for get input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L251) |
| `getMaxForkRuntimeStepCount` | Return max fork runtime step count. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L509) |
| `getProjectAgentRuntimeAgentIdCandidates` | Return project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L98) |
| `getProjectSteeringMutation` | Return project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L83) |
| `getProviderNativeToolNames` | Return provider native tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L44) |
| `getProviderToolProfile` | Return provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L46) |
| `getRuntimeAgentMarkdownDefinition` | Definition for get runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L25) |
| `getRuntimeProjectFile` | Return runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L113) |
| `getRuntimeProjectFiles` | Return runtime project files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L147) |
| `getRuntimeProjectInstructions` | Return runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L114) |
| `getRuntimeProjectSkillCatalog` | Return runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L134) |
| `getRuntimeUploadUrl` | Return runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L37) |
| `getTextFromParts` | Return text from parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L215) |
| `getToolArguments` | Return tool arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L233) |
| `handleHostedChildForkFailure` | Process a hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L274) |
| `handleHostedChildForkRunContextError` | Error shape for handle hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L265) |
| `handleHostedChildForkStreamPart` | Process a hosted child fork stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L307) |
| `hasArgs` | Check whether args is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L223) |
| `hasInput` | Input payload for has. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L228) |
| `initializeNodeAgentServiceOpenTelemetry` | Initialize node agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L211) |
| `initializeNodeHostedAgentServiceOpenTelemetry` | Initialize node hosted agent service open telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L172) |
| `installAbortRejectionGuard` | Install abort rejection guard helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L114) |
| `isAbortRejectionReason` | Check whether a rejection came from an abort signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L50) |
| `isActiveConversationRunStatus` | Check whether a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L472) |
| `isAgentServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L25) |
| `isAgentTraceAttributeValue` | Check whether a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L29) |
| `isAlreadyMirroredAgentServiceChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L53) |
| `isAlreadyMirroredHostedChunk` | Check whether a hosted chunk was already mirrored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L53) |
| `isAppendableConversationRunProjection` | Check whether a conversation run projection can accept more events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L479) |
| `isChildRunAbortError` | Error shape for is child run abort. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L26) |
| `isCursorMismatchConversationRunAppendError` | Error shape for is cursor mismatch conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L461) |
| `isDurableMirroredOutputChunk` | Check whether a durable chunk mirrors tool output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L4) |
| `isHostedChildCreateFileAlreadyExistsResult` | Result returned from is hosted child create file already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L107) |
| `isHostedChildTerminalErrorCode` | Check whether a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L26) |
| `isHostedChildTextProjectArtifactPrompt` | Check whether a prompt asks for a hosted child text project artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L101) |
| `isHostedServiceAuthError` | Error shape for is hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L25) |
| `isIgnorableConversationRunAppendError` | Error shape for is ignorable conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L439) |
| `isResponseLike` | Check whether a value behaves like a Response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/response-like.ts#L2) |
| `isRuntimeAgentMarkdownAgent` | Check whether a runtime agent uses markdown configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L32) |
| `isStarterIntentRootOwnershipRequired` | Check whether starter intent root ownership is required. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L237) |
| `isSuccessfulProjectSteeringMutationResult` | Result returned from is successful project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L122) |
| `listRuntimeBuiltinSkillReferenceFiles` | List runtime builtin skill reference files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L112) |
| `listRuntimeBuiltinSkillReferences` | List runtime builtin skill references. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L128) |
| `loadAgentServiceEnvFiles` | Loads agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L32) |
| `loadRuntimeAgentMarkdownDefinitionFromFile` | Loads runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L152) |
| `loadRuntimeBuiltinSkillCatalog` | Loads runtime builtin skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L61) |
| `mapAgUiRuntimeEventToForkParts` | Map AG-UI runtime event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1052) |
| `mapFrameworkEventToForkParts` | Handles map framework event to fork parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1218) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L217) |
| `mapRuntimeStreamEventToAgUiBrowserEvents` | Map runtime stream event to AG-UI browser events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L298) |
| `mergeToolCallInput` | Input payload for merge tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L110) |
| `mergeToolInputDelta` | Merge tool input delta helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L52) |
| `mirrorDefaultResearchRunArtifact` | Mirror default research run artifact helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L291) |
| `monitorConversationRunStatus` | Monitor conversation run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1220) |
| `monitorHostedChildRunStatus` | Monitor hosted child run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L142) |
| `normalizeAgUiBrowserRuntimeRequest` | Request payload for normalize AG-UI browser runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L199) |
| `normalizeAgUiMessages` | Normalizes AG-UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L265) |
| `normalizeAgUiRuntimeMessages` | Normalizes AG-UI runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-support.ts#L18) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L90) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L140) |
| `normalizeChatUiMessageChunkToAgUiRuntimeEvent` | Event emitted for normalize chat UI message chunk to AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L107) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L233) |
| `normalizeConversationRunEvent` | Event emitted for normalize conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L28) |
| `normalizeConversationRunEvents` | Normalizes conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L51) |
| `normalizeEncodedConversationRunEvents` | Normalizes encoded conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L244) |
| `normalizeHostedChildArtifactPath` | Normalizes hosted child artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L133) |
| `normalizeParsedAgentServiceChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L173) |
| `normalizeParsedHostedChatRequest` | Request payload for normalize parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L173) |
| `normalizeRuntimeSkillReferencePath` | Normalizes runtime skill reference path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L199) |
| `parseAgentServiceChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L157) |
| `parseAgentServiceConfig` | Configuration used by parse agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L112) |
| `parseAgUiContextBoolean` | Parses AG-UI context boolean. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L56) |
| `parseAgUiContextJsonValue` | Parses AG-UI context JSON value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L27) |
| `parseAgUiContextNullableString` | Parses AG-UI context nullable string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L46) |
| `parseAgUiContextSchema` | Zod schema for parse AG-UI context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L62) |
| `parseAgUiContextString` | Parses AG-UI context string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L40) |
| `parseAgUiRequest` | Request payload for parse AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L250) |
| `parseAgUiRequestOrError` | Error shape for parse AG-UI request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L255) |
| `parseAgUiRuntimeRequest` | Request payload for parse AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L223) |
| `parseAgUiRuntimeRequestOrError` | Error shape for parse AG-UI runtime request or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L228) |
| `parseAgUiSseResponse` | Parse an AG-UI SSE `Response` into normalized events, text, tool starts, and terminal error state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L258) |
| `parseAppendConversationRunEventsErrorBody` | Parses append conversation run events error body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L421) |
| `parseDataStreamSseEvents` | Parses data stream sse events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L153) |
| `parseHostedAgentServiceConfig` | Configuration used by parse hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L120) |
| `parseHostedChatRequestFromRequest` | Request payload for parse hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L157) |
| `parseRuntimeAgentMarkdownDefinition` | Definition for parse runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L98) |
| `parseRuntimeAgentRunInvocation` | Parses runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L383) |
| `parseRuntimeAgentRunInvocationAgentServiceChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L183) |
| `parseRuntimeAgentRunInvocationHostedChatRequestFromRequest` | Request payload for parse runtime agent run invocation hosted chat request from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L183) |
| `parseRuntimeAgentRunInvocationOrError` | Error shape for parse runtime agent run invocation or. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L390) |
| `parseRuntimeSkillDocument` | Parses runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L134) |
| `parseRuntimeSkillMetadata` | Parses runtime skill metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L162) |
| `parseToolInputObject` | Parses tool input object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L133) |
| `persistConversationUserMessage` | Message shape for persist conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L202) |
| `persistLatestConversationUserMessage` | Message shape for persist latest conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L266) |
| `prepareAgentRuntimeMessagesFromUiMessages` | Prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L23) |
| `prepareAgentServiceChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L278) |
| `prepareAgentServiceChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L208) |
| `prepareAgentServiceChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L347) |
| `prepareAgentServiceConversationRootRunContext` | Context for prepare hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L118) |
| `prepareConversationRootRunContext` | Context for prepare conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L119) |
| `prepareConversationRootRunLifecycle` | Prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L38) |
| `prepareConversationRunChunkEvents` | Prepare conversation run chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L65) |
| `prepareConversationRunExternalEvents` | Prepare conversation run external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L76) |
| `prepareConversationRunStreamEvents` | Prepare conversation run stream events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L57) |
| `prepareDefaultHostedChildForkRuntimeTools` | Prepare default hosted child fork runtime tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L286) |
| `prepareDefaultHostedChildForkSandboxToolSources` | Prepare default hosted child fork sandbox tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L181) |
| `prepareDefaultHostedChildForkToolAssembly` | Prepare default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L340) |
| `prepareDefaultHostedChildForkToolSources` | Prepare default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L84) |
| `prepareHostedChatExecution` | Prepare hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L278) |
| `prepareHostedChatRuntimeCreationOptions` | Options accepted by prepare hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L208) |
| `prepareHostedChatRuntimeMessages` | Prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L347) |
| `prepareHostedChatRuntimeToolAssembly` | Prepare hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L114) |
| `prepareHostedChildForkRuntimeStepMessages` | Prepare hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L82) |
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
| `recoverConversationRunAppendExecution` | Recover conversation run append execution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L674) |
| `recoverConversationRunAppendFailure` | Recover conversation run append failure helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L603) |
| `recoverConversationRunCursorMismatch` | Recover conversation run cursor mismatch helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L531) |
| `registerAgent` | Registers agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L141) |
| `resolveAgentServiceRegistrationInput` | Input payload for resolve agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L263) |
| `resolveConversationHostedStreamErrorState` | State for resolve conversation hosted stream error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L68) |
| `resolveConversationHostedTerminalState` | State for resolve conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L43) |
| `resolveConversationRunTargets` | Resolves conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L54) |
| `resolveForkRuntimeContinuationState` | State for resolve fork runtime continuation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L517) |
| `resolveForkStepResponse` | Response payload for resolve fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L891) |
| `resolveHostedChildForkRuntimeConfig` | Configuration used by resolve hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L80) |
| `resolveHostedChildForkThinkingOverride` | Resolves hosted child fork thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L65) |
| `resolveHostedChildPromiseWithTimeout` | Resolves hosted child promise with timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L132) |
| `resolveHostedChildStreamWatchdogState` | State for resolve hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L33) |
| `resolveHostedChildTerminalErrorCode` | Resolves a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L91) |
| `resolveHostedDurableRunSetupErrorResponse` | Response payload for resolve hosted durable run setup error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L85) |
| `resolveHostedRuntimeRequestConfig` | Configuration used by resolve hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L98) |
| `resolveHostedRuntimeThinkingOverride` | Resolves hosted runtime thinking override. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L79) |
| `resolveNodeAgentServiceTelemetryConfig` | Configuration used by resolve node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L135) |
| `resolveNodeHostedAgentServiceTelemetryConfig` | Configuration used by resolve node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L118) |
| `resolveRuntimeAgentDefinitionsDir` | Resolves runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L96) |
| `resolveRuntimeAgentMarkdownDefinitionFilePath` | Resolves runtime agent markdown definition file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L140) |
| `resolveRuntimeBuiltinSkillReferenceFilePath` | Resolves runtime builtin skill reference file path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L47) |
| `resolveRuntimeBuiltinSkillsDir` | Resolves runtime builtin skills dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L17) |
| `resolveRuntimeClientProfile` | Resolves runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L92) |
| `resolveRuntimeMessageFileUrls` | Resolves runtime message file urls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L16) |
| `resolveSingleProjectAgentRuntimeAgentId` | Resolves single project agent runtime agent ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L129) |
| `resyncConversationRunAppendCursor` | Resync conversation run append cursor helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L491) |
| `runAgentRuntimeForkStep` | Run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L349) |
| `runAgentServiceMain` | Run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L69) |
| `runFrameworkForkStep` | Handles run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L414) |
| `runHostedChildExecutionLifecycle` | Run hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L281) |
| `runHostedChildLifecycle` | Run hosted child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L149) |
| `runHostedLifecycle` | Run hosted lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L131) |
| `runHostedResponseStreamWithHeartbeat` | Run hosted response stream with heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L65) |
| `runPreparedAgentServiceChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L148) |
| `runPreparedHostedChatExecutionDetached` | Run prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L148) |
| `sanitizeDefaultHostedChildRequestedTools` | Sanitize default hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L250) |
| `sanitizeHostedChildRequestedTools` | Sanitize hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L53) |
| `sanitizeProviderToolSchema` | Zod schema for sanitize provider tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L297) |
| `selectDefaultHostedChildForkRuntimeTools` | Select default hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L265) |
| `selectHostedChildForkRuntimeTools` | Select hosted child fork runtime tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L203) |
| `selectProviderCompatibleToolNames` | Select provider compatible tool names helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L84) |
| `selectProviderCompatibleTools` | Select provider compatible tools helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L112) |
| `shouldBlockHostedChildSameTurnRetry` | Should block hosted child same turn retry helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L48) |
| `shouldContinueForkRuntimeStep` | Should continue fork runtime step helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L469) |
| `shouldFailEmptyHostedFinalizedMessage` | Message shape for should fail empty hosted finalized. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L80) |
| `shouldInjectDefaultResearchArtifactPath` | Should inject default research artifact path helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L77) |
| `shouldPruneSandboxToolsFromHostedChildRequest` | Request payload for should prune sandbox tools from hosted child. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L118) |
| `shouldReinforceLoadSkillContinuation` | Should reinforce load skill continuation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L242) |
| `shouldRetryCreateResearchArtifactAsUpdate` | Should retry create research artifact as update helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L256) |
| `shouldSkipHostedChildTerminalPersistence` | Should skip hosted child terminal persistence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L98) |
| `startAgentRuntimeFork` | Starts agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L546) |
| `startAgentRuntimeForkWithHostTools` | Starts agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L239) |
| `startAgentService` | Starts agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1030) |
| `startAgentServiceRuntime` | Starts agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L302) |
| `startAgentServiceServer` | Starts agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L93) |
| `startConversationRootRun` | Starts conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L57) |
| `startHostedChildForkRuntimeWithHostTools` | Starts hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L38) |
| `startNodeAgentService` | Starts node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L267) |
| `startNodeAgentServiceServer` | Starts node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L76) |
| `startNodeHostedAgentService` | Starts node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L292) |
| `startNodeVeryfrontCloudAgentService` | Starts node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1009) |
| `streamDataStreamEvents` | Stream data stream events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L179) |
| `streamPreparedAgentServiceChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L113) |
| `streamPreparedHostedChatExecutionToAgUiResponse` | Response payload for stream prepared hosted chat execution to AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L113) |
| `stringifyAgUiSseEvent` | Stringify an AG-UI SSE event or fallback value for diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L56) |
| `stripLeadingEmptyObjectPlaceholder` | Normalize provider tool input by removing transient empty-object prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L8) |
| `summarizeChildRunResultText` | Summarize child run result text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L17) |
| `summarizeChildRunResultValue` | Summarize child run result value helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L59) |
| `throwIfChildRunAborted` | Throw if child run aborted helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L19) |
| `toChildRunToolInputRecord` | Record shape for to child run tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L2) |
| `toConversationHostedTerminalState` | State for to conversation hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L167) |
| `toConversationRunStreamEvent` | Event emitted for to conversation run stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L29) |
| `toHostedChatExecutionFinalState` | State for to hosted chat execution final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L172) |
| `toMirroredAgentServiceStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L89) |
| `toMirroredHostedStreamPart` | Converts a value to mirrored hosted stream part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L89) |
| `updateDefaultResearchArtifacts` | Update default research artifacts helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L166) |
| `validateRuntimeAgentTargetSelection` | Validates runtime agent target selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L163) |
| `veryfrontMcpServer` | Veryfront MCP server helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L138) |
| `waitForDurableHumanInputResolution` | Wait for durable human input resolution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L303) |
| `waitForHumanInput` | Input payload for wait for human. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L277) |
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
| `AgentRuntime` | Implement agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/index.ts#L480) |
| `AgentRuntimeMessageConversionError` | Error shape for agent runtime message conversion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L88) |
| `AgentServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L12) |
| `AppendConversationRunEventsError` | Error shape for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L403) |
| `BufferMemory` | Implement buffer memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L128) |
| `ConversationMemory` | Implement conversation memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L84) |
| `ConversationRunEventEncoder` | Implement conversation run event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L61) |
| `ConversationRunTerminalStateError` | Error shape for conversation run terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L390) |
| `HostedChildStreamIdleTimeoutError` | Error shape for hosted child stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L13) |
| `HostedChildTerminalStateError` | Error shape for hosted child terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L72) |
| `HostedServiceAuthError` | Error shape for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L12) |
| `HumanInputResumeError` | Error shape for human input resume. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L200) |
| `InvalidHumanInputResultError` | Error shape for invalid human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L210) |
| `RedisMemory` | Implement redis memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L46) |
| `RunAlreadyExistsError` | Error shape for run already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L13) |
| `RunCancelledError` | Error shape for run cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L5) |
| `RunNotActiveError` | Error shape for run not active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L21) |
| `RunResumeSessionManager` | Implement run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L90) |
| `RuntimeProjectFilesApiAuthError` | Error shape for runtime project files API auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L90) |
| `SummaryMemory` | Implement summary memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L156) |
| `WaitConflictError` | Error shape for wait conflict. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L37) |
| `WaitNotPendingError` | Error shape for wait not pending. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L29) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbortRejectionEvent` | Event emitted for abort rejection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L13) |
| `AbortRejectionEventTarget` | Public API contract for abort rejection event target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L19) |
| `AbortRejectionGuardLogger` | Public API contract for abort rejection guard logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L2) |
| `AbortRejectionProcessTarget` | Public API contract for abort rejection process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L7) |
| `ActiveConversationRunStatus` | Public API contract for a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L157) |
| `Agent` | Public API contract for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L254) |
| `AgentConfig` | Configuration used by agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L81) |
| `AgentContext` | Context for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L195) |
| `AgentContract` | Framework-owned agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L104) |
| `AgentMessage` | Message exchanged with an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L187) |
| `AgentMiddleware` | Public API contract for agent middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L208) |
| `AgentPushRuntimeServiceRest` | Public API contract for agent push runtime service rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L38) |
| `AgentRegistry` | Public API contract for agent registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L59) |
| `AgentResponse` | Response payload for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L193) |
| `AgentRuntimeForkStepRunner` | Public API contract for agent runtime fork step runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L194) |
| `AgentRuntimeMessage` | Message shape for agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L64) |
| `AgentRuntimeMessagePart` | Public API contract for agent runtime message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L46) |
| `AgentServiceActiveSpanAttributes` | Public API contract for hosted agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L43) |
| `AgentServiceAgUiChatForwardedConfig` | Configuration used by hosted AG-UI chat forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L43) |
| `AgentServiceAuth` | Public API contract for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L103) |
| `AgentServiceAuthConfig` | Configuration used by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L66) |
| `AgentServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L36) |
| `AgentServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L5) |
| `AgentServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L85) |
| `AgentServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L73) |
| `AgentServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L93) |
| `AgentServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L79) |
| `AgentServiceBootstrapExit` | Public API contract for agent service bootstrap exit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L17) |
| `AgentServiceChatProjectAccessError` | Error shape for hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L21) |
| `AgentServiceChatProjectAccessResult` | Result returned from hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L28) |
| `AgentServiceChatRequestPrincipal` | Public API contract for hosted chat request principal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L15) |
| `AgentServiceChatRuntimeAgent` | Public API contract for hosted chat runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L70) |
| `AgentServiceChatRuntimeCreationOptions` | Options accepted by hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L93) |
| `AgentServiceChatRuntimeCreationResult` | Result returned from hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L77) |
| `AgentServiceChatRuntimeFinishPart` | Public API contract for hosted chat runtime finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L14) |
| `AgentServiceChatRuntimeOnFinishEvent` | Event emitted for hosted chat runtime on finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L37) |
| `AgentServiceChatRuntimeProjectSteering` | Public API contract for hosted chat runtime project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L85) |
| `AgentServiceChatRuntimeStreamInput` | Input payload for hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L56) |
| `AgentServiceChatRuntimeStreamResult` | Result returned from hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L62) |
| `AgentServiceChatRuntimeToolAssemblyResult` | Result returned from hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L47) |
| `AgentServiceChatRuntimeToUiMessageStreamOptions` | Options accepted by hosted chat runtime to UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L46) |
| `AgentServiceChildChunkMirror` | Public API contract for hosted child chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L5) |
| `AgentServiceChildMirrorContext` | Context for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L16) |
| `AgentServiceChildMirrorPart` | Public API contract for hosted child mirror part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L86) |
| `AgentServiceChildMirrorState` | State for hosted child mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L10) |
| `AgentServiceConfig` | Configuration used by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L16) |
| `AgentServiceConfigInput` | Input payload for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L41) |
| `AgentServiceConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L66) |
| `AgentServiceConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L57) |
| `AgentServiceCorsConfig` | Configuration used by agent service cors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L24) |
| `AgentServiceDefinition` | Type-preserving service definition for request-native agent service runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L127) |
| `AgentServiceDetachedCleanupInput` | Input payload for hosted agent service detached cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L72) |
| `AgentServiceDetachedExecutionInput` | Input payload for hosted agent service detached execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L62) |
| `AgentServiceEnvFileLoadOptions` | Options accepted by agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L13) |
| `AgentServiceEnvFileLoadResult` | Result returned from agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L7) |
| `AgentServiceFormInputToolContext` | Context for hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L17) |
| `AgentServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L42) |
| `AgentServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L49) |
| `AgentServiceOptions` | Options accepted by agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L191) |
| `AgentServicePreparedExecution` | Public API contract for agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L210) |
| `AgentServiceProcessTarget` | Public API contract for agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L212) |
| `AgentServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L54) |
| `AgentServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L61) |
| `AgentServiceProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L60) |
| `AgentServiceProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L64) |
| `AgentServiceProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L51) |
| `AgentServiceProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L56) |
| `AgentServiceProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L26) |
| `AgentServiceRegistrationConfig` | Configuration used by agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L8) |
| `AgentServiceRegistrationLifecycle` | Public API contract for agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L189) |
| `AgentServiceRegistrationLogger` | Public API contract for agent service registration logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L173) |
| `AgentServiceRegistrationMode` | Public API contract for agent service registration mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L6) |
| `AgentServiceRegistryContract` | Multi-agent service contract. Framework services route to `defaultAgentId` unless the host chooses another registered agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L76) |
| `AgentServiceRoute` | Public API contract for agent service route. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L40) |
| `AgentServiceRouteMethod` | Host-facing server config for the agent service runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L21) |
| `AgentServiceRouteSet` | Public API contract for hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L116) |
| `AgentServiceRouteSetOptions` | Options accepted by hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L83) |
| `AgentServiceRoutesLogger` | Public API contract for hosted agent service routes logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L26) |
| `AgentServiceRoutesTrace` | Public API contract for hosted agent service routes trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L34) |
| `AgentServiceRuntimeBundle` | Public API contract for agent service runtime bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L112) |
| `AgentServiceRuntimeConfig` | Configuration used by agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L45) |
| `AgentServiceRuntimeLogger` | Public API contract for agent service runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L54) |
| `AgentServiceRuntimeTrace` | Public API contract for agent service runtime trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L63) |
| `AgentServiceServer` | Public API contract for agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L45) |
| `AgentServiceServerConfig` | Configuration used by agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L33) |
| `AgentServiceServerLifecycle` | Public API contract for agent service server lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L13) |
| `AgentServiceSingleAgentContract` | Single-agent convenience accepted by `defineAgentService()`. Implementations must normalize this shape into the same registry path used by multi-agent services so framework users are not boxed into one-agent-per-process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L91) |
| `AgentServiceStreamExecutionInput` | Input payload for hosted agent service stream execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L52) |
| `AgentServiceTraceContext` | Context for agent service trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L8) |
| `AgentServiceTraceContextGetter` | Public API contract for agent service trace context getter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L14) |
| `AgentStatus` | Public API contract for agent status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L171) |
| `AgentStreamResult` | Result returned from agent stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L245) |
| `AgentTraceAttributes` | Public API contract for agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L9) |
| `AgentTraceAttributeValue` | Public API contract for a value can be used as an agent trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L3) |
| `AgentTraceUsage` | Public API contract for agent trace usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L12) |
| `AgUiBeforeStream` | Public API contract for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L33) |
| `AgUiBeforeStreamContext` | Context for AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L17) |
| `AgUiBeforeStreamMessageInput` | Input payload for AG-UI before stream message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L4) |
| `AgUiBeforeStreamResult` | Result returned from AG-UI before stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L25) |
| `AgUiBrowserChunkEncoder` | Public API contract for AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L14) |
| `AgUiBrowserEncodedEvent` | Event emitted for AG-UI browser encoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L30) |
| `AgUiBrowserEncoderState` | State for AG-UI browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L17) |
| `AgUiBrowserFinalizeTracker` | Public API contract for AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L9) |
| `AgUiBrowserResponseEncoder` | Public API contract for AG-UI browser response encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L36) |
| `AgUiBrowserResponseExecution` | Public API contract for AG-UI browser response execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L29) |
| `AgUiBrowserResponseRequestState` | State for AG-UI browser response request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L21) |
| `AgUiBrowserRunFinishedMetadata` | Public API contract for AG-UI browser run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L7) |
| `AgUiCancelHandlerOptions` | Options accepted by AG-UI cancel handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L54) |
| `AgUiChatUiChunkBrowserEncoder` | Public API contract for AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L16) |
| `AgUiChunkEncoderBridge` | Public API contract for AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L12) |
| `AgUiContextItem` | Public API contract for AG-UI context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L125) |
| `AgUiDetachedStartAccepted` | Public API contract for AG-UI detached start accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L104) |
| `AgUiDetachedStartHandlerOptions` | Options accepted by AG-UI detached start handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L220) |
| `AgUiDetachedStartRequest` | Request payload for AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L100) |
| `AgUiForwardedConfigOptions` | Options accepted by AG-UI forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L6) |
| `AgUiHandlerConfigWithAgent` | Public API contract for AG-UI handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L316) |
| `AgUiHandlerOptions` | Options accepted by AG-UI handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L307) |
| `AgUiInjectedTool` | Public API contract for AG-UI injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L123) |
| `AgUiRequest` | Request payload for AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L127) |
| `AgUiResumeHandlerOptions` | Options accepted by AG-UI resume handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L49) |
| `AgUiResumeSignal` | Public API contract for AG-UI resume signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L31) |
| `AgUiResumeValue` | Public API contract for AG-UI resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tool-shared.ts#L10) |
| `AgUiRuntimeChatStreamEncoder` | Public API contract for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L16) |
| `AgUiRuntimeChatStreamEncoderState` | State for AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L10) |
| `AgUiRuntimeContextItem` | Public API contract for AG-UI runtime context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L190) |
| `AgUiRuntimeEventEncoder` | Public API contract for AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L13) |
| `AgUiRuntimeHandlerConfig` | Configuration used by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L363) |
| `AgUiRuntimeHandlerConfigWithAgent` | Public API contract for AG-UI runtime handler config with agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L358) |
| `AgUiRuntimeHandlerExecute` | Public API contract for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L322) |
| `AgUiRuntimeHandlerExecuteInput` | Input payload for AG-UI runtime handler execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L314) |
| `AgUiRuntimeHandlerOptions` | Options accepted by AG-UI runtime handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L344) |
| `AgUiRuntimeInjectedTool` | Public API contract for AG-UI runtime injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L186) |
| `AgUiRuntimeLifecycleContext` | Context for AG-UI runtime lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L32) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L194) |
| `AgUiRuntimeRequest` | Request payload for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L196) |
| `AgUiRuntimeStreamEvent` | Event emitted for AG-UI runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L4) |
| `AgUiSseEvent` | Event emitted for AG-UI sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L18) |
| `AgUiSseEventType` | Normalized AG-UI runtime event type value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L27) |
| `AgUiSseProgressSnapshot` | Progress snapshot emitted while parsing an AG-UI SSE response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L41) |
| `AppendConversationRunEventsResponse` | Response payload for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L284) |
| `AppendExternalAgentWorkerRunEventsInput` | Input payload for append external agent worker run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L219) |
| `BootstrapAgentServiceOptions` | Options accepted by bootstrap agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L20) |
| `BootstrapConversationAgentRunResult` | Result returned from bootstrap conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L299) |
| `BootstrapHostedChildRunInput` | Input payload for bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L16) |
| `BootstrapHostedChildRunResult` | Result returned from bootstrap hosted child run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L28) |
| `BootstrappedHostedChatExecutionRuntime` | Public API contract for bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L155) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L9) |
| `BuildDetachedFallbackChunksInput` | Input payload for build detached fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L60) |
| `BuildDetachedFallbackMessageInput` | Input payload for build detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L29) |
| `BuildFinalizedMessageFallbackChunksInput` | Input payload for build finalized message fallback chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L50) |
| `BuildFinalizedMessageStateInput` | Input payload for build finalized message state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L21) |
| `BuildHostedDurableChildInvokeFailureResultInput` | Input payload for build hosted durable child invoke failure result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L53) |
| `BuildParsedAgentServiceAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L63) |
| `BuildParsedHostedAgUiRequestOptions` | Options accepted by build parsed hosted AG-UI request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L63) |
| `CachedRequestAuthResult` | Result returned from cached request auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L3) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L123) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L88) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L323) |
| `ChatUiMessageStreamFinish` | Public API contract for chat UI message stream finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L42) |
| `ChatUiMessageStreamFinishPart` | Public API contract for chat UI message stream finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L21) |
| `ChatUiMessageStreamOptions` | Options accepted by chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L51) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L96) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L103) |
| `ChildRunExecutionBufferCleanupInput` | Input payload for child run execution buffer cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L2) |
| `ChildRunExecutionResourceFinalizeInput` | Input payload for child run execution resource finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L8) |
| `ChildRunExecutionResult` | Result returned from child run execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L37) |
| `ChildRunExecutionSnapshot` | Public API contract for child run execution snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L24) |
| `ChildRunExecutionUsage` | Public API contract for child run execution usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L2) |
| `ChildRunResultCommon` | Public API contract for child run result common. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L60) |
| `ChildRunToolCallSnapshot` | Public API contract for child run tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L9) |
| `ChildRunToolResultSnapshot` | Public API contract for child run tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L16) |
| `ClaimExternalAgentWorkerRunInput` | Input payload for claim external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L196) |
| `CloseHostedMirroredOpenToolCallsInput` | Input payload for close hosted mirrored open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L143) |
| `CompleteExternalAgentWorkerRunInput` | Input payload for complete external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L211) |
| `ConversationAgentRunUsage` | Public API contract for conversation agent run usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L357) |
| `ConversationChildLifecycleContext` | Context for conversation child lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L122) |
| `ConversationControlPlaneResponseError` | Error shape for conversation control plane response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L57) |
| `ConversationHostedLifecycleFinalizeInput` | Input payload for conversation hosted lifecycle finalize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L21) |
| `ConversationHostedTerminalAdapter` | Public API contract for conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L123) |
| `ConversationHostedTerminalRuntimeAdapter` | Public API contract for conversation hosted terminal runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L79) |
| `ConversationHostedTerminalStateInput` | Input payload for conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L9) |
| `ConversationHostedTerminalStateResolution` | Public API contract for conversation hosted terminal state resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L37) |
| `ConversationMessageRecord` | Record shape for conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L52) |
| `ConversationRecord` | Record shape for conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L11) |
| `ConversationRootRunContext` | Context for conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L12) |
| `ConversationRootRunDescriptor` | Public API contract for conversation root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L4) |
| `ConversationRootRunLifecycle` | Public API contract for conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L18) |
| `ConversationRunAppendCursorResyncResult` | Result returned from conversation run append cursor resync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L167) |
| `ConversationRunAppendExecutionOutcome` | Public API contract for conversation run append execution outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L182) |
| `ConversationRunAppendFailureOutcome` | Public API contract for conversation run append failure outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L177) |
| `ConversationRunAppendRecoveryOutcome` | Public API contract for conversation run append recovery outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L172) |
| `ConversationRunBatchFlushOutcome` | Public API contract for conversation run batch flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L187) |
| `ConversationRunChunkMirror` | Public API contract for conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L25) |
| `ConversationRunChunkMirrorApiOptions` | Options accepted by conversation run chunk mirror API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L84) |
| `ConversationRunChunkMirrorOptions` | Options accepted by conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L97) |
| `ConversationRunChunkMirrorPrepareChunkEventsInput` | Input payload for conversation run chunk mirror prepare chunk events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L45) |
| `ConversationRunChunkMirrorPreparedChunk` | Public API contract for conversation run chunk mirror prepared chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L34) |
| `ConversationRunChunkMirrorPreparedEvents` | Public API contract for conversation run chunk mirror prepared events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L40) |
| `ConversationRunChunkMirrorPrepareExternalEventsInput` | Input payload for conversation run chunk mirror prepare external events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L51) |
| `ConversationRunChunkMirrorQueueOptions` | Options accepted by conversation run chunk mirror queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L78) |
| `ConversationRunContext` | Context for conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L4) |
| `ConversationRunEvent` | Event emitted for conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L33) |
| `ConversationRunEventQueueController` | Public API contract for conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L199) |
| `ConversationRunMirror` | Public API contract for conversation run mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L46) |
| `ConversationRunMirrorRetryScheduledState` | State for conversation run mirror retry scheduled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L26) |
| `ConversationRunMirrorSnapshot` | Public API contract for conversation run mirror snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L4) |
| `ConversationRunMirrorStoppedState` | State for conversation run mirror stopped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L16) |
| `ConversationRunProjection` | Public API contract for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L90) |
| `ConversationRunQueueFlushOutcome` | Public API contract for conversation run queue flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L193) |
| `ConversationRunStreamMirror` | Public API contract for conversation run stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L14) |
| `ConversationRunTargets` | Public API contract for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L49) |
| `CreateAgentServiceRegistrationLifecycleOptions` | Options accepted by create agent service registration lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L197) |
| `CreateAgentServiceRuntimeOptions` | Options accepted by create agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L92) |
| `CreateAgentServiceServerRuntimeOptions` | Options accepted by create agent service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L19) |
| `CreateAgUiBrowserChunkEncoderOptions` | Options accepted by create AG-UI browser chunk encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L21) |
| `CreateAgUiBrowserFinalizeTrackerOptions` | Options accepted by create AG-UI browser finalize tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L16) |
| `CreateAgUiBrowserResponseStreamInput` | Input payload for create AG-UI browser response stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L42) |
| `CreateAgUiChatUiChunkBrowserEncoderOptions` | Options accepted by create AG-UI chat UI chunk browser encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L22) |
| `CreateAgUiChatUiTrackedBrowserResponseInput` | Input payload for create AG-UI chat UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L28) |
| `CreateAgUiChunkEncoderBridgeOptions` | Options accepted by create AG-UI chunk encoder bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L19) |
| `CreateAgUiRuntimeBrowserResponseInput` | Input payload for create AG-UI runtime browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L14) |
| `CreateAgUiRuntimeChatStreamEncoderOptions` | Options accepted by create AG-UI runtime chat stream encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L22) |
| `CreateAgUiRuntimeEventEncoderOptions` | Options accepted by create AG-UI runtime event encoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L20) |
| `CreateAgUiTrackedBrowserResponseInput` | Input payload for create AG-UI tracked browser response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L11) |
| `CreateBootstrappedHostedChatExecutionRuntimeInput` | Input payload for create bootstrapped hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L121) |
| `CreateConversationHostedLifecycleAdapterOptions` | Options accepted by create conversation hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L30) |
| `CreateConversationHostedTerminalAdapterOptions` | Options accepted by create conversation hosted terminal adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L113) |
| `CreateDefaultAgentServiceChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L84) |
| `CreateDefaultAgentServiceChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L109) |
| `CreateDefaultAgentServiceProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L40) |
| `CreateDefaultHostedChatRuntimeContextInput` | Input payload for create default hosted chat runtime context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L84) |
| `CreateDefaultHostedChatRuntimeOptions` | Options accepted by create default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L109) |
| `CreateDefaultHostedProjectSteeringRefreshOptions` | Options accepted by create default hosted project steering refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L40) |
| `CreateHostedAgentRunSpanControllerInput` | Input payload for create hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L49) |
| `CreateHostedAgentServiceRuntimeOptions` | Options accepted by create hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L66) |
| `CreateHostedChatExecutionRuntimeBootstrapInput` | Input payload for create hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L96) |
| `CreateHostedChatExecutionRuntimeInput` | Input payload for create hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L108) |
| `CreateHostedChildInvokeToolOptions` | Options accepted by create hosted child invoke tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L19) |
| `CreateHostedMirroredUiStreamInput` | Input payload for create hosted mirrored UI stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L131) |
| `CreateHostedProjectRemoteToolSourceInput` | Input payload for create hosted project remote tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L55) |
| `CreateHostedProjectRemoteToolSourcesInput` | Input payload for create hosted project remote tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L197) |
| `CreateHostedRootRunLifecycleRuntimeAdapterInput` | Input payload for create hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L112) |
| `CreateHostedRuntimeStateResolverOptions` | Options accepted by create hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L50) |
| `CreateNodeAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L21) |
| `CreateNodeHostedAgentServiceRuntimeInfrastructureOptions` | Options accepted by create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L29) |
| `CreateRequestAuthCacheOptions` | Options accepted by create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L6) |
| `CreateRuntimeAgentSystemMessagesInput` | Input payload for create runtime agent system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L76) |
| `CreateVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptionsInput` | Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L8) |
| `CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput` | Input payload for create Veryfront Cloud prepared hosted chat execution runtime options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L8) |
| `CreateVeryfrontCloudRuntimeSystemMessagesInput` | Input payload for create Veryfront Cloud runtime system messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L11) |
| `DefaultAgentServiceChatRuntimeConfig` | Configuration used by default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L45) |
| `DefaultAgentServiceChatRuntimeCreationOptions` | Options accepted by default hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L58) |
| `DefaultAgentServiceChatRuntimeLogger` | Public API contract for default hosted chat runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L53) |
| `DefaultAgentServiceChatRuntimeProjectSwitchInput` | Input payload for default hosted chat runtime project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L103) |
| `DefaultAgentServiceChatRuntimeSteeringMutationInput` | Input payload for default hosted chat runtime steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L97) |
| `DefaultAgentServiceChatRuntimeSystemRefreshInput` | Input payload for default hosted chat runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L90) |
| `DefaultAgentServiceChatRuntimeTaskContext` | Context for default hosted chat runtime task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L68) |
| `DefaultAgentServiceInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L78) |
| `DefaultAgentServiceInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L65) |
| `DefaultAgentServiceInvokeAgentInput` | Input payload for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L176) |
| `DefaultAgentServiceInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L87) |
| `DefaultAgentServiceInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L112) |
| `DefaultAgentServiceInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L119) |
| `DefaultAgentServiceInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L107) |
| `DefaultAgentServiceInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L101) |
| `DefaultAgentServiceInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L95) |
| `DefaultAgentServiceProjectSteeringFetchers` | Public API contract for default hosted project steering fetchers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L30) |
| `DefaultAgentServiceProjectSteeringRefreshLogger` | Public API contract for default hosted project steering refresh logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L18) |
| `DefaultAgentServiceProjectSteeringRefreshLookup` | Public API contract for default hosted project steering refresh lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L23) |
| `DefaultHostedChatRuntimeConfig` | Configuration used by default hosted chat runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L45) |
| `DefaultHostedChatRuntimeCreationOptions` | Options accepted by default hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L58) |
| `DefaultHostedChatRuntimeLogger` | Public API contract for default hosted chat runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L53) |
| `DefaultHostedChatRuntimeProjectSwitchInput` | Input payload for default hosted chat runtime project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L103) |
| `DefaultHostedChatRuntimeSteeringMutationInput` | Input payload for default hosted chat runtime steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L97) |
| `DefaultHostedChatRuntimeSystemRefreshInput` | Input payload for default hosted chat runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L90) |
| `DefaultHostedChatRuntimeTaskContext` | Context for default hosted chat runtime task. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L68) |
| `DefaultHostedChildForkRuntimeToolPreparationResult` | Result returned from default hosted child fork runtime tool preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L164) |
| `DefaultHostedChildForkToolAssemblyResult` | Result returned from default hosted child fork tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L189) |
| `DefaultHostedChildForkToolAssemblySourceResult` | Result returned from default hosted child fork tool assembly source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L176) |
| `DefaultHostedChildForkToolSourcesResult` | Result returned from default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L61) |
| `DefaultHostedInvokeAgentConfig` | Configuration used by default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L78) |
| `DefaultHostedInvokeAgentContext` | Context for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L65) |
| `DefaultHostedInvokeAgentInput` | Input payload for default hosted invoke agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L176) |
| `DefaultHostedInvokeAgentLogger` | Public API contract for default hosted invoke agent logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L87) |
| `DefaultHostedInvokeAgentProjectRefresh` | Public API contract for default hosted invoke agent project refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L112) |
| `DefaultHostedInvokeAgentToolOptions` | Options accepted by default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L119) |
| `DefaultHostedInvokeAgentToolResult` | Result returned from default hosted invoke agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L107) |
| `DefaultHostedInvokeAgentTrace` | Public API contract for default hosted invoke agent trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L101) |
| `DefaultHostedInvokeAgentTraceAttributes` | Public API contract for default hosted invoke agent trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L95) |
| `DefaultHostedProjectSteeringFetchers` | Public API contract for default hosted project steering fetchers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L30) |
| `DefaultHostedProjectSteeringRefreshLogger` | Public API contract for default hosted project steering refresh logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L18) |
| `DefaultHostedProjectSteeringRefreshLookup` | Public API contract for default hosted project steering refresh lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L23) |
| `DefaultResearchArtifactContext` | Context for default research artifact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L16) |
| `DefaultResearchArtifactLogger` | Public API contract for default research artifact logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L24) |
| `DefaultResearchArtifactPaths` | Public API contract for default research artifact paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L67) |
| `DefaultResearchArtifacts` | Public API contract for default research artifacts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L13) |
| `DerivedAgentServiceAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L48) |
| `DerivedHostedAgUiChatContext` | Context for derived hosted AG-UI chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L48) |
| `DetachedFallbackMessageState` | State for detached fallback message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L44) |
| `DetachedRunDrainResult` | Result returned from detached run drain. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L4) |
| `DetachedRunShutdownLifecycle` | Public API contract for detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L36) |
| `DetachedRunShutdownLifecycleOptions` | Options accepted by detached run shutdown lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L42) |
| `DetachedRunShutdownLogger` | Public API contract for detached run shutdown logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L30) |
| `DetachedRunTracker` | Public API contract for detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L16) |
| `DetachedRunTrackerOptions` | Options accepted by detached run tracker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L10) |
| `DiscoverProjectAgentRuntimeInput` | Input payload for discover project agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L30) |
| `DurableHumanInputFlowResult` | Result returned from durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L157) |
| `DurableRunSink` | Transport-neutral durable run lifecycle sink for agent-service adoption work. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L6) |
| `EdgeConfig` | Configuration used by edge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L175) |
| `ExecuteAgUiDetachedStartInput` | Input payload for execute AG-UI detached start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L182) |
| `ExecuteDurableHumanInputFlowOptions` | Options accepted by execute durable human input flow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L163) |
| `ExecuteHostedChildForkRunContextStreamInput` | Input payload for execute hosted child fork run context stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L196) |
| `ExecuteHostedChildForkStreamInput` | Input payload for execute hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L90) |
| `ExecuteHostedChildForkToolInputOptions` | Options accepted by execute hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L189) |
| `ExecuteHostedChildForkWithPreparedToolsInput` | Input payload for execute hosted child fork with prepared tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L97) |
| `ExecuteHostedDurableChatRunInput` | Input payload for execute hosted durable chat run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L46) |
| `ExecuteHostedDurableChildForkInput` | Input payload for execute hosted durable child fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L351) |
| `ExecuteHostedLocalChildInvokeInput` | Input payload for execute hosted local child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L119) |
| `ExternalAgentWorker` | Public API contract for external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L6) |
| `ExternalAgentWorkerClient` | Public API contract for external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L227) |
| `ExternalAgentWorkerClientOptions` | Options accepted by external agent worker client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L179) |
| `ExternalAgentWorkerRequestSnapshot` | Public API contract for external agent worker request snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L20) |
| `ExternalAgentWorkerRun` | Public API contract for external agent worker run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L49) |
| `ExternalAgentWorkerSession` | Public API contract for external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L35) |
| `FetchDefaultAgentServiceProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L51) |
| `FetchDefaultHostedProjectSteeringInput` | Input payload for fetch default hosted project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L51) |
| `FinalizedMessageState` | State for finalized message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L37) |
| `FinalizeHostedChildForkRunContextResourcesInput` | Input payload for finalize hosted child fork run context resources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L119) |
| `FinalizeHostedDetachedOptions` | Options accepted by finalize hosted detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L49) |
| `FinalizeHostedResponseOptions` | Options accepted by finalize hosted response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L26) |
| `ForkPart` | Public API contract for fork part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L147) |
| `ForkRecoveredPartsState` | State for fork recovered parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L99) |
| `ForkRuntimeContinuationPromptResolver` | Public API contract for fork runtime continuation prompt resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L433) |
| `ForkRuntimeStep` | Public API contract for fork runtime step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L73) |
| `ForkRuntimeStepPreparer` | Public API contract for fork runtime step preparer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L189) |
| `ForkRuntimeStreamLogger` | Public API contract for fork runtime stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L157) |
| `ForkRuntimeStreamMappingState` | State for fork runtime stream mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L134) |
| `ForkRuntimeStreamResult` | Result returned from fork runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L162) |
| `FormInputToolInput` | Input payload for form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L202) |
| `FrameworkStreamState` | State for framework stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L144) |
| `HandleHostedChildForkFailureInput` | Input payload for handle hosted child fork failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L125) |
| `HandleHostedChildForkRunContextErrorInput` | Input payload for handle hosted child fork run context error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L105) |
| `HostedAgentProjectSteering` | Public API contract for hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L64) |
| `HostedAgentProjectSteeringLogger` | Public API contract for hosted agent project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L51) |
| `HostedAgentProjectSteeringOptions` | Options accepted by hosted agent project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L56) |
| `HostedAgentProjectSteeringOptionsData` | Public API contract for hosted agent project steering options data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L26) |
| `HostedAgentRunSpan` | Public API contract for hosted agent run span. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L16) |
| `HostedAgentRunSpanController` | Public API contract for hosted agent run span controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L41) |
| `HostedAgentRunSpanFinalState` | State for hosted agent run span final. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L28) |
| `HostedAgentRunTracer` | Public API contract for hosted agent run tracer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L23) |
| `HostedAgentServiceActiveSpanAttributes` | Public API contract for hosted agent service active span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L43) |
| `HostedAgentServiceConfig` | Configuration used by hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L107) |
| `HostedAgentServiceConfigInput` | Input payload for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L109) |
| `HostedAgentServiceDetachedCleanupInput` | Input payload for hosted agent service detached cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L72) |
| `HostedAgentServiceDetachedExecutionInput` | Input payload for hosted agent service detached execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L62) |
| `HostedAgentServiceEnvFileLoadOptions` | Options accepted by hosted agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L21) |
| `HostedAgentServiceEnvFileLoadResult` | Result returned from hosted agent service env file load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L19) |
| `HostedAgentServiceRouteSet` | Public API contract for hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L116) |
| `HostedAgentServiceRouteSetOptions` | Options accepted by hosted agent service route set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L83) |
| `HostedAgentServiceRoutesLogger` | Public API contract for hosted agent service routes logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L26) |
| `HostedAgentServiceRoutesTrace` | Public API contract for hosted agent service routes trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L34) |
| `HostedAgentServiceRuntimeBundle` | Public API contract for hosted agent service runtime bundle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L98) |
| `HostedAgentServiceRuntimeConfig` | Configuration used by hosted agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L39) |
| `HostedAgentServiceRuntimeLogger` | Public API contract for hosted agent service runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L48) |
| `HostedAgentServiceRuntimeTrace` | Public API contract for hosted agent service runtime trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L57) |
| `HostedAgentServiceStreamExecutionInput` | Input payload for hosted agent service stream execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L52) |
| `HostedAgUiChatForwardedConfig` | Configuration used by hosted AG-UI chat forwarded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L43) |
| `HostedChatExecutionLifecycleAdapter` | Public API contract for hosted chat execution lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-lifecycle-types.ts#L5) |
| `HostedChatExecutionPreparationInput` | Input payload for hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L124) |
| `HostedChatExecutionPreparationResult` | Result returned from hosted chat execution preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L159) |
| `HostedChatExecutionPreparationRootRunOptions` | Options accepted by hosted chat execution preparation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L114) |
| `HostedChatExecutionRootStreamWatchdog` | Public API contract for hosted chat execution root stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L81) |
| `HostedChatExecutionRunContext` | Context for hosted chat execution run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L75) |
| `HostedChatExecutionRuntime` | Public API contract for hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L62) |
| `HostedChatExecutionRuntimeBootstrap` | Public API contract for hosted chat execution runtime bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L84) |
| `HostedChatExecutionRuntimeLogger` | Public API contract for hosted chat execution runtime logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L69) |
| `HostedChatProjectAccessError` | Error shape for hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L21) |
| `HostedChatProjectAccessResult` | Result returned from hosted chat project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L28) |
| `HostedChatRequest` | Request payload for hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L61) |
| `HostedChatRequestInput` | Input payload for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L63) |
| `HostedChatRequestPrincipal` | Public API contract for hosted chat request principal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L15) |
| `HostedChatRuntimeAgent` | Public API contract for hosted chat runtime agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L70) |
| `HostedChatRuntimeAgentAdapterInput` | Input payload for hosted chat runtime agent adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L22) |
| `HostedChatRuntimeAgentAdapterRunner` | Public API contract for hosted chat runtime agent adapter runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L11) |
| `HostedChatRuntimeAgentAdapterWarning` | Public API contract for hosted chat runtime agent adapter warning. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L16) |
| `HostedChatRuntimeAllowedToolNames` | Public API contract for hosted chat runtime allowed tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L44) |
| `HostedChatRuntimeCreationOptions` | Options accepted by hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L93) |
| `HostedChatRuntimeCreationPreparationInput` | Input payload for hosted chat runtime creation preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L74) |
| `HostedChatRuntimeCreationPreparationResult` | Result returned from hosted chat runtime creation preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L102) |
| `HostedChatRuntimeCreationResult` | Result returned from hosted chat runtime creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L77) |
| `HostedChatRuntimeFinishPart` | Public API contract for hosted chat runtime finish part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L14) |
| `HostedChatRuntimeInstructionsInput` | Input payload for hosted chat runtime instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L64) |
| `HostedChatRuntimeOnFinishEvent` | Event emitted for hosted chat runtime on finish. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L37) |
| `HostedChatRuntimePreparationRootRunContext` | Context for hosted chat runtime preparation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L51) |
| `HostedChatRuntimePreparationSteering` | Public API contract for hosted chat runtime preparation steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L58) |
| `HostedChatRuntimeProjectSteering` | Public API contract for hosted chat runtime project steering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L85) |
| `HostedChatRuntimeStreamInput` | Input payload for hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L56) |
| `HostedChatRuntimeStreamResult` | Result returned from hosted chat runtime stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L62) |
| `HostedChatRuntimeToolAssemblyContext` | Context for hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L33) |
| `HostedChatRuntimeToolAssemblyResult` | Result returned from hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L47) |
| `HostedChatRuntimeToUiMessageStreamOptions` | Options accepted by hosted chat runtime to UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L46) |
| `HostedChildChunkMirror` | Public API contract for hosted child chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L5) |
| `HostedChildConversationBodyInput` | Input payload for hosted child conversation body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L6) |
| `HostedChildExecutionLifecycleOptions` | Options accepted by hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L105) |
| `HostedChildExecutionLifecycleResult` | Result returned from hosted child execution lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L82) |
| `HostedChildExecutionLogEntry` | Entry shape for hosted child execution log. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L7) |
| `HostedChildExecutionLogLevel` | Public API contract for hosted child execution log level. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L4) |
| `HostedChildExecutionLogWriter` | Public API contract for hosted child execution log writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L14) |
| `HostedChildFileWriteFallbackLogger` | Public API contract for hosted child file write fallback logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L33) |
| `HostedChildFileWriteFallbackTool` | Public API contract for hosted child file write fallback tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L28) |
| `HostedChildFileWriteFallbackToolExecute` | Public API contract for hosted child file write fallback tool execute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L22) |
| `HostedChildForkExecutionInstrumentation` | Public API contract for hosted child fork execution instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L66) |
| `HostedChildForkInstructionsContext` | Context for hosted child fork instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L2) |
| `HostedChildForkPendingToolLifecycle` | Public API contract for hosted child fork pending tool lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L73) |
| `HostedChildForkRunContext` | Context for hosted child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L71) |
| `HostedChildForkRunContextInput` | Input payload for hosted child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L86) |
| `HostedChildForkRuntimeConfig` | Configuration used by hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L40) |
| `HostedChildForkRuntimeStepMessages` | Public API contract for hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L25) |
| `HostedChildForkRuntimeStepSystemResolver` | Public API contract for hosted child fork runtime step system resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L11) |
| `HostedChildForkRuntimeToolSelectionResult` | Result returned from hosted child fork runtime tool selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L153) |
| `HostedChildForkStreamHandlingState` | State for hosted child fork stream handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L59) |
| `HostedChildForkStreamLogger` | Public API contract for hosted child fork stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L66) |
| `HostedChildForkStreamMirrorContext` | Context for hosted child fork stream mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L57) |
| `HostedChildForkStreamState` | State for hosted child fork stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L52) |
| `HostedChildForkStreamTraceInput` | Input payload for hosted child fork stream trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L83) |
| `HostedChildForkToolCallSnapshot` | Public API contract for hosted child fork tool call snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L37) |
| `HostedChildForkToolInput` | Input payload for hosted child fork tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L35) |
| `HostedChildForkToolResultSnapshot` | Public API contract for hosted child fork tool result snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L44) |
| `HostedChildForkToolSourcesLogger` | Public API contract for hosted child fork tool sources logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L34) |
| `HostedChildInvokeFailure` | Public API contract for hosted child invoke failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L13) |
| `HostedChildLifecycleAdapter` | Public API contract for hosted child lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L32) |
| `HostedChildLifecycleRunnerOptions` | Options accepted by hosted child lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L52) |
| `HostedChildLifecycleRunResult` | Result returned from hosted child lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L69) |
| `HostedChildLifecycleTerminalState` | State for hosted child lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L15) |
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
| `HostedChildRequestedToolsInput` | Input payload for hosted child requested tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L19) |
| `HostedChildRunIdentifiers` | Public API contract for hosted child run identifiers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L4) |
| `HostedChildRunStatusMonitor` | Public API contract for hosted child run status monitor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L15) |
| `HostedChildSameTurnRetryBlockSignal` | Public API contract for hosted child same turn retry block signal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L37) |
| `HostedChildSteeringMutationHandler` | Handler for hosted child steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L12) |
| `HostedChildStreamWatchdogPhase` | Public API contract for hosted child stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L4) |
| `HostedChildStreamWatchdogState` | State for hosted child stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L7) |
| `HostedChildTerminalErrorCode` | Public API contract for a code is a hosted child terminal error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L22) |
| `HostedChildTerminalStatus` | Public API contract for hosted child terminal status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L66) |
| `HostedChildWrittenArtifactPathInput` | Input payload for hosted child written artifact path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L14) |
| `HostedConversationRootRunContext` | Context for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L66) |
| `HostedConversationRootRunState` | State for hosted conversation root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L57) |
| `HostedConversationRunChunkMirrorInstrumentation` | Public API contract for hosted conversation run chunk mirror instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L108) |
| `HostedConversationRunChunkMirrorOptions` | Options accepted by hosted conversation run chunk mirror. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L117) |
| `HostedConversationRunChunkMirrorTraceAttributes` | Public API contract for hosted conversation run chunk mirror trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L102) |
| `HostedDetachedFinalizationState` | State for hosted detached finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L19) |
| `HostedDurableChildBootstrapCallbacks` | Public API contract for hosted durable child bootstrap callbacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L329) |
| `HostedDurableChildBootstrapContext` | Context for hosted durable child bootstrap. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L319) |
| `HostedDurableChildExecutionOptions` | Options accepted by hosted durable child execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L27) |
| `HostedDurableChildForkRunContext` | Context for hosted durable child fork run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L81) |
| `HostedDurableChildForkRunContextInput` | Input payload for hosted durable child fork run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L95) |
| `HostedDurableChildInvokeResult` | Result returned from hosted durable child invoke. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L32) |
| `HostedDurableChildInvokeTraceBase` | Public API contract for hosted durable child invoke trace base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L95) |
| `HostedDurableChildInvokeTraceInput` | Input payload for hosted durable child invoke trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L90) |
| `HostedDurableChildInvokeTraceOverrides` | Public API contract for hosted durable child invoke trace overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L101) |
| `HostedDurableChildInvokeTraceRecorder` | Public API contract for hosted durable child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L106) |
| `HostedDurableChildRuntimeDependencies` | Public API contract for hosted durable child runtime dependencies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L343) |
| `HostedDurableChildSetupFailure` | Public API contract for hosted durable child setup failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L80) |
| `HostedDurableChildSuccess` | Public API contract for hosted durable child success. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L63) |
| `HostedDurableChildTerminalFailure` | Public API contract for hosted durable child terminal failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L71) |
| `HostedDurableRunAccepted` | Public API contract for hosted durable run accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L15) |
| `HostedDurableRunAuthErrorResponse` | Response payload for hosted durable run auth error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L21) |
| `HostedDurableRunLogger` | Public API contract for hosted durable run logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L28) |
| `HostedDurableRunSetupErrorStatusCode` | Public API contract for hosted durable run setup error status code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L12) |
| `HostedDurableRunStartCleanupInput` | Input payload for hosted durable run start cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L39) |
| `HostedDurableRunStartExecutionInput` | Input payload for hosted durable run start execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L33) |
| `HostedFormInputToolContext` | Context for hosted form input tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L17) |
| `HostedLifecycleAdapter` | Public API contract for hosted lifecycle adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L23) |
| `HostedLifecycleExecution` | Public API contract for hosted lifecycle execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L17) |
| `HostedLifecycleRunnerOptions` | Options accepted by hosted lifecycle runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L40) |
| `HostedLifecycleRunResult` | Result returned from hosted lifecycle run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L51) |
| `HostedLifecycleTerminalState` | State for hosted lifecycle terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L2) |
| `HostedLocalChildInvokeTraceRecorder` | Public API contract for hosted local child invoke trace recorder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L111) |
| `HostedMirroredOpenToolCallLogger` | Public API contract for hosted mirrored open tool call logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L115) |
| `HostedMirroredUiStreamLogger` | Public API contract for hosted mirrored UI stream logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L120) |
| `HostedMirroredUiStreamWatchdog` | Public API contract for hosted mirrored UI stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L125) |
| `HostedProjectRemoteToolSourceMutationHandler` | Handler for hosted project remote tool source mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L29) |
| `HostedProjectRemoteToolSourcePrepareToolInput` | Input payload for hosted project remote tool source prepare tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L39) |
| `HostedProjectRemoteToolSourceProjectSwitchHandler` | Handler for hosted project remote tool source project switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L34) |
| `HostedProjectRemoteToolSourceRetryPolicy` | Public API contract for hosted project remote tool source retry policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L46) |
| `HostedProjectSkillIdsContext` | Context for hosted project skill IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L60) |
| `HostedProjectSteeringAdapter` | Public API contract for hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L65) |
| `HostedProjectSteeringAdapterOptions` | Options accepted by hosted project steering adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L47) |
| `HostedProjectSteeringLogger` | Public API contract for hosted project steering logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L42) |
| `HostedResponseFinalizationState` | State for hosted response finalization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L10) |
| `HostedResponseStreamHeartbeat` | Public API contract for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L15) |
| `HostedResponseStreamHeartbeatState` | State for hosted response stream heartbeat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L9) |
| `HostedResponseStreamWriter` | Public API contract for hosted response stream writer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L4) |
| `HostedRootRunLifecycleRuntimeAdapter` | Public API contract for hosted root run lifecycle runtime adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L106) |
| `HostedRuntimeRequestConfigAgent` | Public API contract for hosted runtime request config agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L19) |
| `HostedRuntimeRequestConfigRequest` | Request payload for hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L13) |
| `HostedRuntimeStateResolverContext` | Context for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L16) |
| `HostedRuntimeStateResolverInput` | Input payload for hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L25) |
| `HostedRuntimeStateResolverResult` | Result returned from hosted runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L33) |
| `HostedRuntimeSystemRefresh` | Public API contract for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L45) |
| `HostedRuntimeSystemRefreshInput` | Input payload for hosted runtime system refresh. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L39) |
| `HostedServiceAuth` | Public API contract for hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L103) |
| `HostedServiceAuthConfig` | Configuration used by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L66) |
| `HostedServiceAuthenticatedRequest` | Request payload for hosted service authenticated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L36) |
| `HostedServiceAuthErrorCode` | Public API contract for hosted service auth error code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L5) |
| `HostedServiceAuthFetch` | Public API contract for hosted service auth fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L85) |
| `HostedServiceAuthLogger` | Public API contract for hosted service auth logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L73) |
| `HostedServiceAuthOptions` | Options accepted by hosted service auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L93) |
| `HostedServiceAuthTrace` | Public API contract for hosted service auth trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L79) |
| `HostedServiceJwtError` | Error shape for hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L42) |
| `HostedServiceJwtResult` | Result returned from hosted service jwt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L49) |
| `HostedServiceProjectAccessError` | Error shape for hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L54) |
| `HostedServiceProjectAccessResult` | Result returned from hosted service project access. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L61) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L30) |
| `HostedStreamTerminalError` | Error shape for hosted stream terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L12) |
| `HostedTerminalError` | Error shape for hosted terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L4) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L4) |
| `HumanInputField` | Public API contract for human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L136) |
| `HumanInputFieldInput` | Input payload for human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L138) |
| `HumanInputOption` | Public API contract for human input option. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L134) |
| `HumanInputPendingRequest` | Request payload for human input pending. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L146) |
| `HumanInputRequest` | Request payload for human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L140) |
| `HumanInputRequestInput` | Input payload for human input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L142) |
| `HumanInputResult` | Result returned from human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L144) |
| `HumanInputResumeValue` | Public API contract for human input resume value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L151) |
| `InitializeNodeAgentServiceTelemetryOptions` | Options accepted by initialize node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L71) |
| `InitializeNodeHostedAgentServiceTelemetryOptions` | Options accepted by initialize node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L62) |
| `InputRequestOutput` | Output from input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L206) |
| `InstallAbortRejectionGuardOptions` | Options accepted by install abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L31) |
| `InstalledAbortRejectionGuard` | Public API contract for installed abort rejection guard. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L40) |
| `InvokeAgentChildRunLifecycleCustomEvent` | Event emitted for invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L84) |
| `InvokeAgentChildRunLifecycleValue` | Public API contract for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L37) |
| `InvokeAgentChildRunProgressEvent` | Event emitted for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L104) |
| `InvokeAgentChildRunProgressInput` | Input payload for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L89) |
| `InvokeAgentChildRunStateDelta` | Public API contract for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L63) |
| `LiveStudioMcpToolsOptions` | Options accepted by live studio MCP tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L12) |
| `LoadRuntimeAgentMarkdownDefinitionFromFileInput` | Input payload for load runtime agent markdown definition from file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L23) |
| `Memory` | Public API contract for memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L34) |
| `MemoryConfig` | Configuration used by memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L173) |
| `MemoryPersistence` | Public API contract for memory persistence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L42) |
| `MemoryStats` | Public API contract for memory stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L19) |
| `MessagePart` | Public API contract for message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L185) |
| `MirroredToolChunkState` | State for mirrored tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L29) |
| `ModelProvider` | Public API contract for model provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L169) |
| `ModelString` | Model configuration string format: "provider/model-name" Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet" | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L42) |
| `ModelTransportRequest` | Request payload for model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L149) |
| `ModelTransportResolver` | Public API contract for model transport resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L165) |
| `MonitorHostedChildRunStatusInput` | Input payload for monitor hosted child run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L132) |
| `MutableAgentProjectContext` | Context for mutable agent project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L2) |
| `NodeAgentServiceInstrumentationConfig` | Configuration used by node agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L21) |
| `NodeAgentServiceRuntimeInfrastructure` | Public API contract for node agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L33) |
| `NodeAgentServiceServer` | Public API contract for node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L43) |
| `NodeAgentServiceTelemetryConfig` | Configuration used by node agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L35) |
| `NodeAgentServiceTelemetryEnv` | Public API contract for node agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L15) |
| `NodeAgentServiceTelemetryLogger` | Public API contract for node agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L53) |
| `NodeAgentServiceTelemetryProcessTarget` | Public API contract for node agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L59) |
| `NodeHostedAgentServiceInstrumentationConfig` | Configuration used by node hosted agent service instrumentation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L18) |
| `NodeHostedAgentServiceRuntimeInfrastructure` | Public API contract for node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L43) |
| `NodeHostedAgentServiceTelemetryConfig` | Configuration used by node hosted agent service telemetry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L24) |
| `NodeHostedAgentServiceTelemetryEnv` | Public API contract for node hosted agent service telemetry env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L12) |
| `NodeHostedAgentServiceTelemetryLogger` | Public API contract for node hosted agent service telemetry logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L50) |
| `NodeHostedAgentServiceTelemetryProcessTarget` | Public API contract for node hosted agent service telemetry process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L56) |
| `NodeVeryfrontCloudAgentServiceMcpServer` | Public API contract for node Veryfront Cloud agent service MCP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L135) |
| `NodeVeryfrontCloudAgentServiceOptions` | Options accepted by node Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L151) |
| `NodeVeryfrontCloudAgentServicePreparedExecution` | Public API contract for node Veryfront Cloud agent service prepared execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L201) |
| `NodeVeryfrontCloudAgentServiceProcessTarget` | Public API contract for node Veryfront Cloud agent service process target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L121) |
| `NormalizedAgentServiceChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L32) |
| `NormalizedAgentServiceContract` | Public API contract for normalized agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L114) |
| `NormalizedHostedChatRequest` | Request payload for normalized hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L32) |
| `OpenToolCalls` | Public API contract for open tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L109) |
| `ParseAgentServiceChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L54) |
| `ParseAgUiSseResponseOptions` | Options for `parseAgUiSseResponse()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L50) |
| `ParsedAgentServiceAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L58) |
| `ParsedAgentServiceChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L33) |
| `ParsedAgUiSseRun` | Parsed AG-UI SSE response summary for evals, canaries, and host tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L30) |
| `ParsedHostedAgUiRequest` | Request payload for parsed hosted AG-UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L58) |
| `ParsedHostedChatRequest` | Request payload for parsed hosted chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L33) |
| `ParsedRuntimeSkillDocument` | Public API contract for parsed runtime skill document. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L106) |
| `ParseHostedChatRequestOptions` | Options accepted by parse hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L54) |
| `ParseRuntimeAgentMarkdownDefinitionInput` | Input payload for parse runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L71) |
| `PersistConversationUserMessageFailure` | Public API contract for persist conversation user message failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L64) |
| `PrepareAgentRuntimeMessagesFromUiMessagesOptions` | Options accepted by prepare agent runtime messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L16) |
| `PrepareAgentServiceChatRuntimeMessagesOptions` | Options accepted by prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L39) |
| `PrepareAgentServiceConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L75) |
| `PrepareConversationRootRunLifecycleOptions` | Options accepted by prepare conversation root run lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L23) |
| `PreparedAgentServiceChatExecution` | Public API contract for prepared hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L12) |
| `PreparedAgentServiceChatExecutionDetachedInput` | Input payload for prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L61) |
| `PreparedAgentServiceChatExecutionRuntimeOptions` | Options accepted by prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L33) |
| `PreparedAgentServiceChatExecutionStreamInput` | Input payload for prepared hosted chat execution stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L53) |
| `PrepareDefaultHostedChildForkSandboxToolSourcesInput` | Input payload for prepare default hosted child fork sandbox tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L73) |
| `PrepareDefaultHostedChildForkToolSourcesInput` | Input payload for prepare default hosted child fork tool sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L39) |
| `PreparedHostedChatExecution` | Public API contract for prepared hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L12) |
| `PreparedHostedChatExecutionDetachedInput` | Input payload for prepared hosted chat execution detached. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L61) |
| `PreparedHostedChatExecutionRuntimeOptions` | Options accepted by prepared hosted chat execution runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L33) |
| `PreparedHostedChatExecutionStreamInput` | Input payload for prepared hosted chat execution stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L53) |
| `PrepareHostedChatRuntimeMessagesOptions` | Options accepted by prepare hosted chat runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L39) |
| `PrepareHostedChatRuntimeToolAssemblyInput` | Input payload for prepare hosted chat runtime tool assembly. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L58) |
| `PrepareHostedChildForkRuntimeStepMessagesInput` | Input payload for prepare hosted child fork runtime step messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L17) |
| `PrepareHostedConversationRootRunContextInput` | Input payload for prepare hosted conversation root run context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L75) |
| `PrepareVeryfrontCloudAgentServiceChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L25) |
| `PrepareVeryfrontCloudHostedChatExecutionInput` | Input payload for prepare Veryfront Cloud hosted chat execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L25) |
| `ProjectAgentRuntimeAgentIdCandidates` | Public API contract for project agent runtime agent ID candidates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L24) |
| `ProjectAgentRuntimeAgentSource` | Public API contract for project agent runtime agent source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L21) |
| `ProjectSteeringMutationInput` | Input payload for project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L22) |
| `ProjectSteeringMutationResult` | Result returned from project steering mutation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L31) |
| `ProjectSteeringPaths` | Public API contract for project steering paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L16) |
| `ProviderNativeToolInventoryOptions` | Options accepted by provider native tool inventory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L9) |
| `ProviderToolCompatOptions` | Options accepted by provider tool compat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L20) |
| `ProviderToolCompatProvider` | Public API contract for provider tool compat provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L5) |
| `ProviderToolProfile` | Public API contract for provider tool profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L13) |
| `RecordExternalAgentWorkerSessionInput` | Input payload for record external agent worker session. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L202) |
| `RedisClient` | Redis client interface (compatible with ioredis and node-redis) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L20) |
| `RedisMemoryConfig` | Redis memory configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L30) |
| `RegisterAgentPushRuntimeServiceRequest` | Request payload for register agent push runtime service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L59) |
| `RegisterExternalAgentWorkerInput` | Input payload for register external agent worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L186) |
| `RequestAuthCache` | Public API contract for request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L14) |
| `ResolveAgentServiceRegistrationInputOptions` | Options accepted by resolve agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L180) |
| `ResolveConversationHostedTerminalStateInput` | Input payload for resolve conversation hosted terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L29) |
| `ResolvedAgentConfig` | Configuration used by resolved agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L146) |
| `ResolvedAgentServiceRegistrationInput` | Input payload for resolved agent service registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L22) |
| `ResolvedHostedRuntimeRequestConfig` | Configuration used by resolved hosted runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L35) |
| `ResolvedModelTransport` | Public API contract for resolved model transport. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L158) |
| `ResolvedRuntimeState` | State for resolved runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L180) |
| `ResolveHostedChildForkRuntimeConfigInput` | Input payload for resolve hosted child fork runtime config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L51) |
| `ResolveHostedRuntimeRequestConfigInput` | Input payload for resolve hosted runtime request config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L25) |
| `ResolveNodeAgentServiceTelemetryConfigOptions` | Options accepted by resolve node agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L46) |
| `ResolveNodeHostedAgentServiceTelemetryConfigOptions` | Options accepted by resolve node hosted agent service telemetry config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L38) |
| `ResolveRuntimeAgentDefinitionsDirInput` | Input payload for resolve runtime agent definitions dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L12) |
| `RootOwnedChildResultHint` | Public API contract for root owned child result hint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L55) |
| `RootOwnedChildResultHinted` | Public API contract for root owned child result hinted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L61) |
| `RunAgentRuntimeForkStepInput` | Input payload for run agent runtime fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L330) |
| `RunAgentServiceMainOptions` | Options accepted by run agent service main. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L30) |
| `RunFrameworkForkStepInput` | Input payload for run framework fork step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L344) |
| `RunResumeSessionManagerOptions` | Options accepted by run resume session manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L76) |
| `RunSessionStatus` | Public API contract for run session status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L2) |
| `RuntimeAgentContextItem` | Public API contract for runtime agent context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L324) |
| `RuntimeAgentControlPlaneStreamRequest` | Request payload for runtime agent control plane stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L353) |
| `RuntimeAgentMarkdownDefinition` | Definition for runtime agent markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L51) |
| `RuntimeAgentProjectContext` | Context for runtime agent project. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L336) |
| `RuntimeAgentRunContext` | Context for runtime agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L344) |
| `RuntimeAgentRunInvocation` | Public API contract for runtime agent run invocation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L348) |
| `RuntimeAgentSourceContext` | Context for runtime agent source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L328) |
| `RuntimeAgentTargetKind` | Public API contract for runtime agent target kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L332) |
| `RuntimeAgentThinkingConfig` | Configuration used by runtime agent thinking. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L23) |
| `RuntimeAgentTool` | Public API contract for runtime agent tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L322) |
| `RuntimeAgentValidatedClaims` | Public API contract for runtime agent validated claims. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L340) |
| `RuntimeBuiltinSkillEntriesResult` | Result returned from runtime builtin skill entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L6) |
| `RuntimeClientCapability` | Public API contract for runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L45) |
| `RuntimeClientProfile` | Public API contract for runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L49) |
| `RuntimeClientType` | Public API contract for runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L43) |
| `RuntimeFileUrlResolver` | Public API contract for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L11) |
| `RuntimeFileUrlResolverInput` | Input payload for runtime file URL resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L4) |
| `RuntimeGetProjectFileOptions` | Options accepted by runtime get project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L61) |
| `RuntimeLoadedProjectSkill` | Public API contract for runtime loaded project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L21) |
| `RuntimeLoadedSkillResponse` | Response payload for runtime loaded skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L83) |
| `RuntimeLoadedSkillResponseMessages` | Public API contract for runtime loaded skill response messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L74) |
| `RuntimeLoadSkillBuiltinStore` | Public API contract for runtime load skill builtin store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L57) |
| `RuntimeLoadSkillErrorOutput` | Output from runtime load skill error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L106) |
| `RuntimeLoadSkillReferenceFileOutput` | Output from runtime load skill reference file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L99) |
| `RuntimeLoadSkillToolContext` | Context for runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L51) |
| `RuntimeLoadSkillToolInput` | Input payload for runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L94) |
| `RuntimeLoadSkillToolMessages` | Public API contract for runtime load skill tool messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L64) |
| `RuntimeLoadSkillToolOptions` | Options accepted by runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L67) |
| `RuntimeLoadSkillToolOutput` | Output from runtime load skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L111) |
| `RuntimeProjectFile` | Public API contract for runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L47) |
| `RuntimeProjectFileListItem` | Public API contract for runtime project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L49) |
| `RuntimeProjectFilesApiOptions` | Options accepted by runtime project files API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L54) |
| `RuntimeProjectFilesClient` | Public API contract for runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L82) |
| `RuntimeProjectFilesClientOptions` | Options accepted by runtime project files client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L72) |
| `RuntimeProjectFilesFetch` | Public API contract for runtime project files fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L66) |
| `RuntimeProjectFilesTrace` | Public API contract for runtime project files trace. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L69) |
| `RuntimeProjectInstructionsOptions` | Options accepted by runtime project instructions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L43) |
| `RuntimeProjectSkillCatalogOptions` | Options accepted by runtime project skill catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L32) |
| `RuntimeProjectSkillContext` | Context for runtime project skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L14) |
| `RuntimeProjectSkillLoader` | Public API contract for runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L43) |
| `RuntimeProjectSkillLoaderLogger` | Public API contract for runtime project skill loader logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L27) |
| `RuntimeProjectSkillLoaderOptions` | Options accepted by runtime project skill loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L32) |
| `RuntimeProjectSteeringLookup` | Public API contract for runtime project steering lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L25) |
| `RuntimePromptBlockOptions` | Options accepted by runtime prompt block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L2) |
| `RuntimeSkillDefinition` | Definition for runtime skill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L61) |
| `RuntimeSkillFrontmatter` | Public API contract for runtime skill frontmatter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L21) |
| `RuntimeSkillMetadataLogger` | Public API contract for runtime skill metadata logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L101) |
| `RuntimeStateRequest` | Request payload for runtime state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L170) |
| `RuntimeStateResolver` | Public API contract for runtime state resolver. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L186) |
| `RuntimeUploadUrlClientOptions` | Options accepted by runtime upload URL client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L23) |
| `RuntimeUploadUrlFetch` | Public API contract for runtime upload URL fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L20) |
| `RuntimeUploadUrlOptions` | Options accepted by runtime upload URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L30) |
| `SlashCommandArtifactPolicy` | Public API contract for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L13) |
| `SlashCommandArtifactPolicyInput` | Input payload for slash command artifact policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L7) |
| `StartAgentRuntimeForkInput` | Input payload for start agent runtime fork. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L202) |
| `StartAgentRuntimeForkWithHostToolsInput` | Input payload for start agent runtime fork with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L224) |
| `StartAgentServiceRuntimeOptions` | Options accepted by start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L135) |
| `StartAgentServiceRuntimeResult` | Result returned from start agent service runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L160) |
| `StartAgentServiceServerOptions` | Options accepted by start agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L35) |
| `StartedHostedChildForkRuntime` | Public API contract for started hosted child fork runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L29) |
| `StartHostedChildForkRuntimeWithHostToolsInput` | Input payload for start hosted child fork runtime with host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L20) |
| `StartNodeAgentServiceOptions` | Options accepted by start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L129) |
| `StartNodeAgentServiceResult` | Result returned from start node agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L154) |
| `StartNodeAgentServiceServerOptions` | Options accepted by start node agent service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L27) |
| `StartNodeHostedAgentServiceOptions` | Options accepted by start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L118) |
| `StartNodeHostedAgentServiceResult` | Result returned from start node hosted agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L146) |
| `StreamToolCall` | Public API contract for stream tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L189) |
| `SubmitResumeValueOutcome` | Public API contract for submit resume value outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L45) |
| `Suggestion` | Public API contract for suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L48) |
| `Suggestions` | Public API contract for suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L75) |
| `TerminalConversationRunStatus` | Public API contract for terminal conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L162) |
| `ToolCall` | Public API contract for tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L191) |
| `ToolCallPart` | Agent message part for a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L181) |
| `ToolCallPartWithArgs` | Tool-call message part that stores arguments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L177) |
| `ToolCallPartWithInput` | Tool-call message part that stores input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L179) |
| `ToolExecutionDataEventBridgeStreamInput` | Input payload for tool execution data event bridge stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L7) |
| `ToolExecutionDataEventPublisher` | Public API contract for tool execution data event publisher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L4) |
| `ToolResultPart` | Agent message part for a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L183) |
| `VeryfrontCloudAgentServiceChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L20) |
| `VeryfrontCloudAgentServiceOptions` | Options accepted by Veryfront Cloud agent service. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L189) |
| `VeryfrontCloudHostedChatExecutionPreparationLogger` | Public API contract for Veryfront Cloud hosted chat execution preparation logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L20) |
| `VeryfrontMcpServerKind` | Public API contract for veryfront MCP server kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L132) |
| `WaitForDurableHumanInputResolutionOptions` | Options accepted by wait for durable human input resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L183) |
| `WaitForHumanInputOptions` | Options accepted by wait for human input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L191) |
| `WorkflowConfig` | Configuration used by workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L56) |
| `WorkflowResult` | Result returned from workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L62) |
| `WorkflowStep` | Public API contract for workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L48) |
| `WrapHostedChildProjectSwitchToolInput` | Input payload for wrap hosted child project switch tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L30) |
| `WrapHostedChildSteeringMutationToolInput` | Input payload for wrap hosted child steering mutation tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L20) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentServiceAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L38) |
| `agentServiceConfigSchema` | Zod schema for agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L102) |
| `agentServiceRegistrationConfigSchema` | Zod schema for agent service registration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L83) |
| `agUiSseEventTypes` | AG-UI runtime event type constants normalized from browser-wire SSE events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L5) |
| `conversationRunEventTypes` | Shared conversation run event types value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L7) |
| `createNodeHostedAgentServiceRuntimeInfrastructure` | Create node hosted agent service runtime infrastructure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L76) |
| `defaultHostedInvokeAgentInputSchema` | Schema for default hosted invoke agent input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L171) |
| `defaultHostedInvokeAgentSelectionSchema` | Schema for default hosted invoke agent selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L160) |
| `getAgUiRuntimeContextItemSchema` | Zod schema for get AG-UI runtime context item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L60) |
| `getAgUiRuntimeInjectedToolSchema` | Zod schema for get AG-UI runtime injected tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L46) |
| `getAgUiRuntimeMessageSchema` | Zod schema for get AG-UI runtime message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L146) |
| `getAgUiRuntimeRequestSchema` | Zod schema for get AG-UI runtime request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L166) |
| `getCreateInputRequestRequestSchema` | Zod schema for get create input request request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L23) |
| `getCreateInputRequestResponseSchema` | Zod schema for get create input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L157) |
| `getFormInputToolInputSchema` | Zod schema for get form input tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L10) |
| `getGetInputRequestResponseSchema` | Zod schema for get get input request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L159) |
| `getHumanInputFieldSchema` | Zod schema for get human input field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L36) |
| `getHumanInputOptionSchema` | Zod schema for get human input option. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L14) |
| `getHumanInputPendingRequestSchema` | Zod schema for get human input pending request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L125) |
| `getHumanInputRequestSchema` | Zod schema for get human input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L96) |
| `getHumanInputResultSchema` | Zod schema for get human input result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L111) |
| `getInputRequestLifecycleDataEventSchema` | Zod schema for get input request lifecycle data event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L186) |
| `getInputRequestOutputSchema` | Zod schema for get input request output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L162) |
| `getInputRequestRestSchema` | Zod schema for get input request rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L107) |
| `getInputResponseRestSchema` | Zod schema for get input response rest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L56) |
| `getInputResponseValuesSchema` | Zod schema for get input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L15) |
| `getParseRuntimeAgentMarkdownDefinitionInputSchema` | Zod schema for get parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L56) |
| `getRuntimeAgentMarkdownDefinitionSchema` | Zod schema for get runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L28) |
| `getRuntimeAgentThinkingConfigSchema` | Zod schema for get runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L10) |
| `getRuntimeClientCapabilitySchema` | Zod schema for get runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L10) |
| `getRuntimeClientProfileSchema` | Zod schema for get runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L20) |
| `getRuntimeClientTypeSchema` | Zod schema for get runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L5) |
| `hostedAgentProjectSteeringOptionsSchema` | Zod schema for hosted agent project steering options. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L34) |
| `hostedAgentServiceConfigSchema` | Zod schema for hosted agent service config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L105) |
| `hostedAgUiChatForwardedConfigSchema` | Schema for agent service AG-UI chat forwarded config. Schema for hosted AG-UI chat forwarded config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L38) |
| `hostedChatRequestSchema` | Schema for hosted chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L58) |
| `hostedChatRuntimeOverridesSchema` | Schema for hosted chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L41) |
| `hostedChildForkToolInputSchema` | Schema for hosted child fork tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L32) |
| `hostedChildTerminalErrorCodes` | Shared hosted child terminal error codes value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L15) |
| `hostedDurableRootRunDescriptorSchema` | Schema for hosted durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L26) |
| `loadHostedAgentServiceEnvFiles` | Loads hosted agent service env files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L66) |
| `loadRuntimeAgentMarkdownDefinitionFromFileInputSchema` | Zod schema for load runtime agent markdown definition from file input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L61) |
| `parseRuntimeAgentMarkdownDefinitionInputSchema` | Schema for parse runtime agent markdown definition input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L66) |
| `resolvedAgentServiceRegistrationInputSchema` | Zod schema for resolved agent service registration input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L102) |
| `resolveRuntimeAgentDefinitionsDirInputSchema` | Zod schema for resolve runtime agent definitions dir input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L42) |
| `runtimeAgentMarkdownDefinitionSchema` | Schema for runtime agent markdown definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L46) |
| `runtimeAgentThinkingConfigSchema` | Schema for runtime agent thinking config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L20) |
| `runtimeClientCapabilitySchema` | Schema for runtime client capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L36) |
| `runtimeClientProfileSchema` | Schema for runtime client profile. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L40) |
| `runtimeClientTypeSchema` | Schema for runtime client type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L32) |
| `runtimeProjectFileListItemSchema` | Schema for runtime project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L44) |
| `runtimeProjectFileSchema` | Schema for runtime project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L40) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/agent/conversation-bootstrap`

```ts
import { bootstrapConversationAgentRun, createConversationMessage, createConversationRecord } from "veryfront/agent/conversation-bootstrap";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ConversationMessageRecordSchema` | Schema for conversation message record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L49) |
| `ConversationRecordSchema` | Schema for conversation record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L37) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `bootstrapConversationAgentRun` | Bootstrap conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L306) |
| `createConversationMessage` | Message shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L182) |
| `createConversationRecord` | Record shape for create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L166) |
| `ensureConversationProjectLink` | Ensure conversation project link helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L140) |
| `fetchConversationRecord` | Record shape for fetch conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L126) |
| `findLatestUserConversationMessageContext` | Context for find latest user conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L239) |
| `persistConversationUserMessage` | Message shape for persist conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L202) |
| `persistLatestConversationUserMessage` | Message shape for persist latest conversation user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L266) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BootstrapConversationAgentRunResult` | Result returned from bootstrap conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L299) |
| `ConversationControlPlaneResponseError` | Error shape for conversation control plane response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L57) |
| `ConversationMessageRecord` | Record shape for conversation message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L52) |
| `ConversationRecord` | Record shape for conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L11) |
| `PersistConversationUserMessageFailure` | Public API contract for persist conversation user message failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L64) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getConversationMessageRecordSchema` | Zod schema for get conversation message record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L40) |
| `getConversationRecordSchema` | Zod schema for get conversation record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L17) |

### `veryfront/agent/durable`

```ts
import { appendConversationRunEvents, createConversationAgentRun, createConversationRunEventQueueController } from "veryfront/agent/durable";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AppendConversationRunEventsResponseSchema` | Schema for append conversation run events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L343) |
| `CompleteConversationRunResponseSchema` | Schema for complete conversation run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L279) |
| `ConversationRunProjectionSchema` | Schema for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L155) |
| `ConversationRunStatusSchema` | Schema for conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L87) |
| `ConversationRunTargetsSchema` | Schema for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L46) |
| `CreateConversationRunAcceptedSchema` | Schema for create conversation run accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L260) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `appendConversationRunEvents` | Append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1279) |
| `createConversationAgentRun` | Create conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1348) |
| `createConversationRunEventQueueController` | Create conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1005) |
| `finalizeConversationAgentRun` | Finalize conversation agent run helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1412) |
| `flushConversationRunEventBatches` | Flush conversation run event batches. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L793) |
| `flushConversationRunEventQueue` | Flush conversation run event queue. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L902) |
| `getConversationRun` | Return conversation run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1203) |
| `isActiveConversationRunStatus` | Check whether a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L472) |
| `isAppendableConversationRunProjection` | Check whether a conversation run projection can accept more events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L479) |
| `isCursorMismatchConversationRunAppendError` | Error shape for is cursor mismatch conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L461) |
| `isIgnorableConversationRunAppendError` | Error shape for is ignorable conversation run append. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L439) |
| `monitorConversationRunStatus` | Monitor conversation run status helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1220) |
| `parseAppendConversationRunEventsErrorBody` | Parses append conversation run events error body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L421) |
| `recoverConversationRunAppendExecution` | Recover conversation run append execution helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L674) |
| `recoverConversationRunAppendFailure` | Recover conversation run append failure helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L603) |
| `recoverConversationRunCursorMismatch` | Recover conversation run cursor mismatch helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L531) |
| `resolveConversationRunTargets` | Resolves conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L54) |
| `resyncConversationRunAppendCursor` | Resync conversation run append cursor helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L491) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AppendConversationRunEventsError` | Error shape for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L403) |
| `ConversationRunTerminalStateError` | Error shape for conversation run terminal state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L390) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveConversationRunStatus` | Public API contract for a conversation run status is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L157) |
| `AppendConversationRunEventsResponse` | Response payload for append conversation run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L284) |
| `ConversationAgentRunUsage` | Public API contract for conversation agent run usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L357) |
| `ConversationRunAppendCursorResyncResult` | Result returned from conversation run append cursor resync. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L167) |
| `ConversationRunAppendExecutionOutcome` | Public API contract for conversation run append execution outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L182) |
| `ConversationRunAppendFailureOutcome` | Public API contract for conversation run append failure outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L177) |
| `ConversationRunAppendRecoveryOutcome` | Public API contract for conversation run append recovery outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L172) |
| `ConversationRunBatchFlushOutcome` | Public API contract for conversation run batch flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L187) |
| `ConversationRunEventQueueController` | Public API contract for conversation run event queue controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L199) |
| `ConversationRunProjection` | Public API contract for conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L90) |
| `ConversationRunQueueFlushOutcome` | Public API contract for conversation run queue flush outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L193) |
| `ConversationRunTargets` | Public API contract for conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L49) |
| `CreateConversationAgentRunInput` | Input payload for create conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L364) |
| `FinalizeConversationAgentRunInput` | Input payload for finalize conversation agent run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L376) |
| `TerminalConversationRunStatus` | Public API contract for terminal conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L162) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAppendConversationRunEventsResponseSchema` | Zod schema for get append conversation run events response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L298) |
| `getCompleteConversationRunResponseSchema` | Zod schema for get complete conversation run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L265) |
| `getConversationRunProjectionSchema` | Zod schema for get conversation run projection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L102) |
| `getConversationRunStatusSchema` | Zod schema for get conversation run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L80) |
| `getConversationRunTargetsSchema` | Zod schema for get conversation run targets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L35) |
| `getCreateConversationRunAcceptedSchema` | Zod schema for get create conversation run accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L239) |

### `veryfront/agent/invoke-agent-child-runs`

```ts
import { buildInvokeAgentChildRunLifecycleCustomEvent, buildInvokeAgentChildRunProgressEvents, buildInvokeAgentChildRunStateDelta } from "veryfront/agent/invoke-agent-child-runs";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `InvokeAgentChildRunLifecycleCustomEventSchema` | Schema for invoke agent child run lifecycle custom event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L79) |
| `InvokeAgentChildRunLifecycleValueSchema` | Schema for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L32) |
| `InvokeAgentChildRunStateDeltaSchema` | Schema for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L58) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildInvokeAgentChildRunLifecycleCustomEvent` | Event emitted for build invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L148) |
| `buildInvokeAgentChildRunProgressEvents` | Builds invoke agent child run progress events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L159) |
| `buildInvokeAgentChildRunStateDelta` | Builds invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L131) |
| `publishInvokeAgentChildRunProgress` | Publish invoke agent child run progress helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L169) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `InvokeAgentChildRunLifecycleCustomEvent` | Event emitted for invoke agent child run lifecycle custom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L84) |
| `InvokeAgentChildRunLifecycleValue` | Public API contract for invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L37) |
| `InvokeAgentChildRunProgressEvent` | Event emitted for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L104) |
| `InvokeAgentChildRunProgressInput` | Input payload for invoke agent child run progress. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L89) |
| `InvokeAgentChildRunStateDelta` | Public API contract for invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L63) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getInvokeAgentChildRunLifecycleCustomEventSchema` | Zod schema for get invoke agent child run lifecycle custom event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L68) |
| `getInvokeAgentChildRunLifecycleValueSchema` | Zod schema for get invoke agent child run lifecycle value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L11) |
| `getInvokeAgentChildRunStateDeltaSchema` | Zod schema for get invoke agent child run state delta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L42) |

### `veryfront/agent/request-auth-cache`

```ts
import { createRequestAuthCache } from "veryfront/agent/request-auth-cache";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createRequestAuthCache` | Create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L19) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CachedRequestAuthResult` | Result returned from cached request auth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L3) |
| `CreateRequestAuthCacheOptions` | Options accepted by create request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L6) |
| `RequestAuthCache` | Public API contract for request auth cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L14) |

### `veryfront/agent/testing`

Agent Testing Utilities

```ts
import { assertCompleted, assertContains, assertDurableRunCanaryCompleted } from "veryfront/agent/testing";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS` | Default value for durable run canary timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/environment.ts#L13) |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES` | Default value for live eval area tag rules. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L37) |
| `DEFAULT_LIVE_EVAL_ENDPOINT` | Default value for live eval endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/environment.ts#L14) |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` | Default value for live eval optional judge case prefixes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L30) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCompleted` | Assert completed helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L206) |
| `assertContains` | Assert contains helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L196) |
| `assertDurableRunCanaryCompleted` | Assert that a durable run canary completed successfully. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L32) |
| `assertNoMalformedCreateFileToolCalls` | Assert no malformed create file tool calls helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L79) |
| `assertToolCalled` | Assert tool called helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L201) |
| `buildFailureSuffix` | Builds failure suffix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L80) |
| `buildLiveEvalCaseMetadata` | Builds live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L122) |
| `buildLiveEvalCaseTagSummary` | Builds live eval case tag summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L41) |
| `buildLiveEvalRequestBody` | Builds live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/request.ts#L33) |
| `buildLiveEvalRuntimeSummary` | Builds live eval runtime summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L137) |
| `buildLiveEvalStatusSummary` | Builds live eval status summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L152) |
| `buildProgressLine` | Builds progress line. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L59) |
| `buildRuntimePerformanceSummary` | Builds runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts#L37) |
| `cancelLiveEvalInputRequest` | Request payload for cancel live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L570) |
| `collectAssistantText` | Collect assistant text helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L71) |
| `containsOrderedSubsequence` | Contains ordered subsequence helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L93) |
| `containsSkillLoad` | Contains skill load helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L479) |
| `countStepStartedEvents` | Count step started events helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L484) |
| `createDurableRunCanaryApiClient` | Create durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L258) |
| `createDurableRunCanaryRunner` | Create durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L504) |
| `createFailedEvalResult` | Result returned from create failed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L80) |
| `createLiveEvalApiClient` | Create live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L267) |
| `createLiveEvalCaseSupport` | Create live eval case support. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L489) |
| `createLiveEvalConversation` | Create live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L283) |
| `createLiveEvalProjectUploadFixture` | Create live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L335) |
| `createLiveEvalRelease` | Create live eval release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L430) |
| `createPassedEvalResult` | Result returned from create passed eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L98) |
| `createPlainTextPdf` | Create plain text pdf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L12) |
| `createSkippedEvalResult` | Result returned from create skipped eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L62) |
| `deleteLiveEvalConversation` | Delete live eval conversation helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L312) |
| `deleteLiveEvalProjectFile` | Delete live eval project file helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L465) |
| `evaluateRuntimeConfidenceEnv` | Evaluate runtime confidence env helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/preflight.ts#L11) |
| `findAssistantMessage` | Message shape for find assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L43) |
| `getLiveEvalProjectFile` | Return live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L396) |
| `hasEveryLiveEvalTag` | Check whether every live eval tag is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L27) |
| `hasFinished` | Check whether finished is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L474) |
| `listOpenLiveEvalInputRequests` | List open live eval input requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L491) |
| `parseDurableRunCanaryRunSummary` | Parses durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L112) |
| `printRuntimeConfidencePreflight` | Print runtime confidence preflight helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/preflight.ts#L37) |
| `printTestResults` | Print test results helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L174) |
| `resolveDurableRunCanaryEnvironment` | Resolves durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/environment.ts#L16) |
| `resolveLiveEvalEnvironment` | Resolves live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/environment.ts#L17) |
| `resolveLiveEvalRequestedCaseIds` | Resolves live eval requested case IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L88) |
| `runDurableRunCanaryCli` | Run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/cli-runner.ts#L46) |
| `runLiveEvalCli` | Run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L86) |
| `selectLiveEvalCases` | Select live eval cases helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L61) |
| `stringifyUnknown` | Stringify unknown helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L58) |
| `submitLiveEvalInputResponse` | Response payload for submit live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L545) |
| `testAgent` | Test agent helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L69) |
| `waitForOpenLiveEvalInputRequest` | Request payload for wait for open live eval input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L517) |
| `withLiveEvalMetadata` | Applies live eval metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L161) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BuildLiveEvalCaseMetadataInput` | Input payload for build live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L23) |
| `BuildLiveEvalRequestBodyInput` | Input payload for build live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/request.ts#L19) |
| `DurableRunCanaryApiClient` | Public API contract for durable run canary API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L247) |
| `DurableRunCanaryApiConfig` | Configuration used by durable run canary API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L8) |
| `DurableRunCanaryCase` | Public API contract for durable run canary case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L369) |
| `DurableRunCanaryCliCaseFactoryInput` | Input payload for durable run canary cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/cli-runner.ts#L16) |
| `DurableRunCanaryCreateRootRunInput` | Input payload for durable run canary create root run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L19) |
| `DurableRunCanaryEnvironment` | Public API contract for durable run canary environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/environment.ts#L4) |
| `DurableRunCanaryMessage` | Message shape for durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L48) |
| `DurableRunCanaryPreparedCase` | Public API contract for durable run canary prepared case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L355) |
| `DurableRunCanaryResult` | Result returned from durable run canary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L343) |
| `DurableRunCanaryRunnerConfig` | Configuration used by durable run canary runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L376) |
| `DurableRunCanaryRunSummary` | Public API contract for durable run canary run summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L53) |
| `DurableRunCanarySendUserMessageInput` | Input payload for durable run canary send user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L25) |
| `DurableRunCanaryStartRunInput` | Input payload for durable run canary start run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L31) |
| `LiveEvalApiClient` | Public API contract for live eval API client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L121) |
| `LiveEvalApiContext` | Context for live eval API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L9) |
| `LiveEvalCase` | Public API contract for live eval case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L37) |
| `LiveEvalCaseMetadata` | Public API contract for live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L4) |
| `LiveEvalCaseMetadataOptions` | Options accepted by live eval case metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L16) |
| `LiveEvalCaseSelectionInput` | Input payload for live eval case selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L15) |
| `LiveEvalCaseSurface` | Public API contract for live eval case surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L5) |
| `LiveEvalCaseTagRule` | Public API contract for live eval case tag rule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L8) |
| `LiveEvalCliCaseFactoryInput` | Input payload for live eval cli case factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L34) |
| `LiveEvalCliCaseGroups` | Public API contract for live eval cli case groups. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L27) |
| `LiveEvalContext` | Context for live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L30) |
| `LiveEvalConversationInput` | Input payload for live eval conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L27) |
| `LiveEvalCreateConversationInput` | Input payload for live eval create conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L22) |
| `LiveEvalCreateReleaseInput` | Input payload for live eval create release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L47) |
| `LiveEvalEnvironment` | Public API contract for live eval environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/environment.ts#L4) |
| `LiveEvalInputRequestInput` | Input payload for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L71) |
| `LiveEvalInputRequestRecord` | Record shape for live eval input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L116) |
| `LiveEvalInputResponseValues` | Public API contract for live eval input response values. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L59) |
| `LiveEvalProjectFile` | Public API contract for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L61) |
| `LiveEvalProjectFileInput` | Input payload for live eval project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L42) |
| `LiveEvalProjectFileReaderInput` | Input payload for live eval project file reader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L67) |
| `LiveEvalProjectUploadFixtureInput` | Input payload for live eval project upload fixture. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L32) |
| `LiveEvalRequestBody` | Public API contract for live eval request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/request.ts#L2) |
| `LiveEvalRequestTimeoutInput` | Input payload for live eval request timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L17) |
| `LiveEvalResultForPerformance` | Public API contract for live eval result for performance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts#L5) |
| `LiveEvalResultForReport` | Public API contract for live eval result for report. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L9) |
| `LiveEvalResultRecord` | Record shape for live eval result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L4) |
| `LiveEvalRunnerConfig` | Configuration used by live eval runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L73) |
| `LiveEvalRuntime` | Public API contract for live eval runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts#L2) |
| `LiveEvalSubmitInputResponseInput` | Input payload for live eval submit input response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L64) |
| `LiveEvalWaitForOpenInputRequestInput` | Input payload for live eval wait for open input request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L52) |
| `PreparedLiveEvalInput` | Input payload for prepared live eval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L21) |
| `RunDurableRunCanaryCliInput` | Input payload for run durable run canary cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/cli-runner.ts#L22) |
| `RunLiveEvalCliInput` | Input payload for run live eval cli. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L51) |
| `RuntimeConfidencePreflightResult` | Result returned from runtime confidence preflight. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/preflight.ts#L4) |
| `RuntimePerformanceSummary` | Public API contract for runtime performance summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts#L11) |
| `TestCase` | Public API contract for test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L12) |
| `TestResult` | Result returned from test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L33) |
| `TestSuite` | Public API contract for test suite. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L54) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `durableRunCanaryRunnerInternals` | White-box helpers used by durable run canary tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L612) |
| `getDurableRunCanaryMessageSchema` | Zod schema for get durable run canary message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L38) |
| `liveEvalRunnerInternals` | White-box helpers used by live eval runner tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L632) |
