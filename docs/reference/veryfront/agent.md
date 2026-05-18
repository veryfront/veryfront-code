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
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ results: [] }),
});

const assistant = agent({
  system: "You are a helpful assistant.",
  tools: { search: searchTool },
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
});
```

## API

### `agent(config)`

Create an agent

| Property | Type | Description |
|----------|------|-------------|
| `id?` | `string` | Unique identifier (auto-generated if omitted) |
| `name?` | `string` | Human-readable display name for registry and control-plane listings. |
| `description?` | `string` | Optional summary shown in registry and control-plane listings. |
| `model?` | `ModelString` | Optional model string in "provider/model" format. |
| `system` | <code>string &#124; (() =&gt; string) &#124; (() =&gt; Promise&lt;string&gt;)</code> | System prompt: string, function, or async function |
| `tools?` | <code>true &#124; Record&lt;string, Tool &#124; boolean&gt;</code> | Tools available to the agent |
| `remoteTools?` | `RemoteToolSource[]` |  |
| `allowedRemoteTools?` | `string[]` | Optional remote tool name allowlist. When set, only matching tools from `remoteTools` are exposed to the model and executable at runtime. |
| `maxSteps?` | `number` | Max tool-call iterations per request |
| `streaming?` | `boolean` | Enable streaming responses |
| `memory?` | `MemoryConfig` | Conversation memory settings |
| `middleware?` | `AgentMiddleware[]` | Execution middleware pipeline |
| `edge?` | `EdgeConfig` | Edge runtime configuration |
| `multimodal?` | <code>&#123; vision?: boolean; audio?: boolean &#125;</code> | Enable vision and/or audio |
| `allowedModels?` | `ModelString[]` | Restrict runtime model overrides to these "provider/model" strings. |
| `resolveModelTransport?` | `ModelTransportResolver` | Optional request-aware hook for overriding the resolved model runtime and provider transport options on a per-call basis. |
| `resolveRuntimeState?` | `RuntimeStateResolver` | Optional step-boundary hook for refreshing the runtime system prompt and host-owned context during a long-lived run. |
| `onToolResult?` | `ToolExecutionResultHandler` | Optional hook invoked after the runtime executes a configured local, registry, integration, or remote tool and before the tool result is persisted or streamed back to callers. |
| `skills?` | `true \| string[]` | Enable skills for this agent. |
| `suggestions?` | `Suggestions` |  |
| `security?` | `false` | Set to false to disable the default security middleware |

**Returns:** `Agent`

### `agent.generate(input)`

Run the agent and return a complete response. Accepts a string or message array as input.

| Property | Type | Description |
|----------|------|-------------|
| `input` | `string \| Message[]` | Prompt string or message history |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. |

**Returns:** <code>Promise&lt;AgentResponse&gt;</code>

### `agent.stream(input)`

Run the agent and stream the response. Returns a result with `.toDataStreamResponse()` for API routes.

| Property | Type | Description |
|----------|------|-------------|
| `input?` | `string` | Prompt string |
| `messages?` | `Message[]` | Conversation message history |
| `context?` | <code>Record&lt;string, unknown&gt;</code> | Additional context passed to the agent |
| `model?` | `ModelString` | Override the agent's default model for this request. Must be in `allowedModels` if configured. |
| `maxOutputTokens?` | `number` | Override the maximum model output tokens for this request. |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback fired when a tool is invoked |
| `onChunk?` | <code>(chunk: string) =&gt; void</code> | Callback fired for each text chunk |
| `onFinish?` | <code>(response: AgentResponse) =&gt; void</code> |  |
| `abortSignal?` | `AbortSignal` |  |

**Returns:** <code>Promise&lt;AgentStreamResult&gt;</code>

### `agent.respond(request)`

Handle an incoming HTTP request and return a streaming `Response`. Reads messages from the request body.

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
| `AgUiDetachedStartAcceptedSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L92) |
| `AgUiDetachedStartRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L90) |
| `AgUiRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L116) |
| `AgUiResumeSignalSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L25) |
| `AppendConversationRunEventsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L311) |
| `CompleteConversationRunResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L251) |
| `CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L15) |
| `CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L16) |
| `CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L14) |
| `ConversationMessageRecordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L41) |
| `ConversationRecordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L32) |
| `ConversationRunEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L26) |
| `ConversationRunProjectionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L142) |
| `ConversationRunStatusSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L78) |
| `ConversationRunTargetsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L42) |
| `DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L165) |
| `DEFAULT_HOSTED_CHILD_AGENT_ID` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L5) |
| `DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L31) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L54) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L56) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L53) |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L55) |
| `DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L37) |
| `DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L44) |
| `DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L57) |
| `DEFAULT_PROJECT_STEERING_PATHS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts) |
| `DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L34) |
| `DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L6) |
| `ExternalAgentWorkerRequestSnapshotSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L109) |
| `ExternalAgentWorkerRunSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L156) |
| `ExternalAgentWorkerSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L81) |
| `ExternalAgentWorkerSessionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L128) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L107) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L105) |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L103) |
| `HOSTED_CHILD_FORK_INSTRUCTIONS_BASE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L6) |
| `HOSTED_CHILD_STREAM_TIMEOUT_TOKEN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L25) |
| `InvokeAgentChildRunLifecycleCustomEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L67) |
| `InvokeAgentChildRunLifecycleValueSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L28) |
| `InvokeAgentChildRunStateDeltaSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L50) |
| `KEEP_ROOT_ASSISTANT_VISIBLE_OWNER` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L5) |
| `LOAD_SKILL_CONTINUATION_REMINDER` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L96) |
| `LOAD_SKILL_CONTINUE_SAME_TURN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L13) |
| `LOAD_SKILL_CONTINUE_SAME_TURN_NOW` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L14) |
| `LOAD_SKILL_DELEGATION_THRESHOLD` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L18) |
| `LOAD_SKILL_OVERRIDE_FORWARDING` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L19) |
| `LOAD_SKILL_ROOT_OWNERSHIP` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L15) |
| `LOAD_SKILL_TOOL_INTERSECTION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L21) |
| `LOAD_SKILL_USE_ALLOWED_TOOLS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L16) |
| `MAX_RUNTIME_SKILL_PROMPT_ENTRIES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L10) |
| `NO_DELEGATION_NARRATION_UNLESS_ASKED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L8) |
| `PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L5) |
| `ROOT_OWNED_CHILD_RESULT_INSTRUCTION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L28) |
| `RUNTIME_LOAD_SKILL_CONTINUATION_NOTE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L30) |
| `RUNTIME_LOAD_SKILL_DESCRIPTION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L33) |
| `RuntimeAgentContextItemSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L107) |
| `RuntimeAgentIdSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L46) |
| `RuntimeAgentProjectContextSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L192) |
| `RuntimeAgentRunContextSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L271) |
| `RuntimeAgentRunIdSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L26) |
| `RuntimeAgentRunInvocationSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L291) |
| `RuntimeAgentServiceIdSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L41) |
| `RuntimeAgentSourceContextSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L128) |
| `RuntimeAgentTargetKindSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L135) |
| `RuntimeAgentToolCallIdSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L31) |
| `RuntimeAgentToolNameSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L56) |
| `RuntimeAgentToolSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L79) |
| `RuntimeAgentValidatedClaimsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L204) |
| `RuntimeSkillFrontmatterSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L54) |
| `SLASH_COMMAND_ARTIFACT_REMINDER` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L98) |
| `SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L10) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `addFirstTurnStarterIntentRootOwnershipReminder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L199) |
| `addLoadSkillContinuationReminder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L260) |
| `addSlashCommandArtifactReminder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L280) |
| `agent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/factory.ts#L55) |
| `agentAsTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L16) |
| `appendAgentServiceChildMirrorChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L172) |
| `appendConversationRunEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1227) |
| `appendHostedChildMirrorChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L172) |
| `appendMissingChildRunToolCalls` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L13) |
| `appendMissingChildRunToolResults` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L28) |
| `applyAgentProjectContextChange` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L6) |
| `applyDefaultResearchArtifactPath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L210) |
| `applyPartToStreamedStepState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L657) |
| `bootstrapAgentService` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L49) |
| `bootstrapConversationAgentRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L286) |
| `bootstrapHostedChildRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L46) |
| `buildAgentRunTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L81) |
| `buildAgUiBrowserFinalizeResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L135) |
| `buildAgUiSseTraceSignature` | Build a compact ordered event-type signature for regression checks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L74) |
| `buildChatStreamChunkMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L116) |
| `buildChildRunExecutionSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L68) |
| `buildChildRunExhaustedStepBudgetErrorMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/final-step-support.ts#L43) |
| `buildChildRunFailureResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L104) |
| `buildChildRunFailureSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L120) |
| `buildChildRunResultCommon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L84) |
| `buildChildRunResultSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L26) |
| `buildChildRunSuccessResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L88) |
| `buildChildRunSuccessSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L138) |
| `buildDefaultHostedChildForkToolSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L367) |
| `buildDefaultResearchArtifactPathReminder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L92) |
| `buildDefaultResearchArtifactPaths` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L113) |
| `buildDetachedAgUiStartRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L130) |
| `buildDetachedFallbackChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L151) |
| `buildDetachedFallbackMessageState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L93) |
| `buildExecuteToolTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L109) |
| `buildFinalizedAgentRunTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L168) |
| `buildFinalizedMessageFallbackChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L116) |
| `buildFinalizedMessageState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L62) |
| `buildForkRuntimeStepFromResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L417) |
| `buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L68) |
| `buildHostedChatRequestFromRuntimeAgentInvocation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L107) |
| `buildHostedChatRequestInputFromRuntimeAgentInvocation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L86) |
| `buildHostedChildCompletedLog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L61) |
| `buildHostedChildConversationBody` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L28) |
| `buildHostedChildErrorLog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L80) |
| `buildHostedChildExhaustedStepBudgetLog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L41) |
| `buildHostedChildForkInstructions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts#L61) |
| `buildHostedChildToolDescription` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L391) |
| `buildHostedDurableChildInvokeFailureResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L114) |
| `buildHostedDurableChildInvokeSuccessResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L147) |
| `buildHostedDurableChildInvokeTerminalFailureResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L134) |
| `buildInputRequestLifecycleDataEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L262) |
| `buildInvokeAgentChildRunLifecycleCustomEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L131) |
| `buildInvokeAgentChildRunProgressEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L141) |
| `buildInvokeAgentChildRunStateDelta` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L115) |
| `buildInvokeAgentFollowupInstruction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L84) |
| `buildInvokeAgentTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L123) |
| `buildParsedAgentServiceAgUiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L162) |
| `buildParsedAgentServiceChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L100) |
| `buildParsedHostedAgUiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L162) |
| `buildParsedHostedChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L100) |
| `buildRecoveredStepParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L904) |
| `buildRootOwnedChildResultHint` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L30) |
| `buildRootOwnedChildRunResultHint` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L44) |
| `buildRootOwnedChildRunResultText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L30) |
| `buildRootOwnedDelegatedFindingsInstruction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L24) |
| `buildRuntimeAgentControlPlaneStreamRequestFromInvocation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L329) |
| `buildRuntimeAvailableSkillsPromptBlock` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L37) |
| `buildRuntimeLoadedSkillResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L201) |
| `buildRuntimeSkillDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L158) |
| `buildStarterIntentRootOwnershipBlockMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L92) |
| `buildStarterIntentRootOwnershipReminder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L88) |
| `buildStudioMcpHeaders` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L26) |
| `buildVeryfrontCloudRuntimeInstructions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L67) |
| `cleanupAfterHostedChatExecutionFinalization` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L170) |
| `clearProjectAgentRuntimeRegistries` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L36) |
| `clientAllowsStudioMcp` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L110) |
| `cloneMirroredToolChunkState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L46) |
| `closeAgentServiceChildReasoningSegment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L184) |
| `closeAgentServiceChildTextSegment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L203) |
| `closeChildRunExecutionBuffers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L14) |
| `closeHostedChildReasoningSegment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L184) |
| `closeHostedChildTextSegment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L203) |
| `closeHostedMirroredOpenToolCalls` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L187) |
| `composeAbortSignals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L54) |
| `computeOpenToolCalls` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L158) |
| `containsExactArtifactPathValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L191) |
| `convertAgentRuntimeMessagesToProviderMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L464) |
| `convertCompactedProviderMessagesToChildForkRuntimeMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L65) |
| `convertProviderMessagesToAgentRuntimeMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L453) |
| `createAgentServiceAgUiValidationErrorResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L141) |
| `createAgentServiceAuth` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L248) |
| `createAgentServiceChildMirrorContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L222) |
| `createAgentServiceFormInputTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L22) |
| `createAgentServiceProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L73) |
| `createAgentServiceRegistrationLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L349) |
| `createAgentServiceRouteSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L174) |
| `createAgentServiceRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L177) |
| `createAgentServiceServerRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L46) |
| `createAgUiBrowserChunkEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L42) |
| `createAgUiBrowserEncoderState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L30) |
| `createAgUiBrowserFinalizeTracker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L19) |
| `createAgUiBrowserResponseStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L55) |
| `createAgUiCancelHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L126) |
| `createAgUiChatUiChunkBrowserEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L134) |
| `createAgUiChatUiTrackedBrowserResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L151) |
| `createAgUiChunkEncoderBridge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L20) |
| `createAgUiDetachedStartHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L377) |
| `createAgUiHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L325) |
| `createAgUiHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L329) |
| `createAgUiHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L333) |
| `createAgUiResumeHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L63) |
| `createAgUiRunErrorEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L274) |
| `createAgUiRuntimeBrowserResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L26) |
| `createAgUiRuntimeChatStreamEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L74) |
| `createAgUiRuntimeContextMap` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L9) |
| `createAgUiRuntimeEventEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L21) |
| `createAgUiRuntimeHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L360) |
| `createAgUiSseErrorResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L284) |
| `createAgUiSseResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L296) |
| `createAgUiTrackedBrowserResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L21) |
| `createBootstrappedHostedChatExecutionRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L290) |
| `createChatUiMessageStreamFromDataStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L494) |
| `createConversationAgentRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1295) |
| `createConversationChildLifecycleAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L162) |
| `createConversationHostedLifecycleAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L45) |
| `createConversationHostedStreamLifecycleAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L104) |
| `createConversationHostedTerminalAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L178) |
| `createConversationMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L167) |
| `createConversationRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L152) |
| `createConversationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L38) |
| `createConversationRootRunStartAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L88) |
| `createConversationRunChunkMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L138) |
| `createConversationRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L9) |
| `createConversationRunEventQueueController` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L956) |
| `createConversationRunMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L71) |
| `createConversationRunStreamMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L20) |
| `createDefaultAgentServiceChatRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L271) |
| `createDefaultAgentServiceInvokeAgentTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L556) |
| `createDefaultAgentServiceProjectSteeringRefresh` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L168) |
| `createDefaultHostedChatRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L271) |
| `createDefaultHostedInvokeAgentTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L556) |
| `createDefaultHostedProjectSteeringRefresh` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L168) |
| `createDefaultResearchRunArtifactMirrorHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L343) |
| `createDetachedRunShutdownLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L134) |
| `createDetachedRunTracker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L52) |
| `createExternalAgentWorkerClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L396) |
| `createForkRuntimeStreamMappingState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1007) |
| `createForkRuntimeUserMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L454) |
| `createFrameworkStreamState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1173) |
| `createHostedAgentProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L73) |
| `createHostedAgentRunSpanController` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L57) |
| `createHostedAgentServiceRouteSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L174) |
| `createHostedAgentServiceRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L238) |
| `createHostedAgUiValidationErrorResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L141) |
| `createHostedChatExecutionRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L573) |
| `createHostedChatExecutionRuntimeBootstrap` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L209) |
| `createHostedChatFinalizeDetachedBuildState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L394) |
| `createHostedChatFinalizeResponseBuildState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L355) |
| `createHostedChatRuntimeAgentAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L31) |
| `createHostedChatStreamFinalizationHooks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L323) |
| `createHostedChildExecutionLogWriter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L33) |
| `createHostedChildForkRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L117) |
| `createHostedChildInvokeTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L51) |
| `createHostedChildMirrorContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L222) |
| `createHostedChildPendingToolLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L78) |
| `createHostedChildPendingToolLifecycleLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L44) |
| `createHostedConversationRunChunkMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L307) |
| `createHostedDurableChildForkRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L156) |
| `createHostedDurableChildInvokeTraceRecorder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L178) |
| `createHostedFormInputTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L22) |
| `createHostedMirroredUiStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L233) |
| `createHostedProjectRemoteToolSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L70) |
| `createHostedProjectRemoteToolSources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L291) |
| `createHostedProjectSteeringAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L124) |
| `createHostedRootRunLifecycleRuntimeAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L130) |
| `createHostedRuntimeStateResolver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L66) |
| `createHostedServiceAuth` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L248) |
| `createInitialForkRuntimeMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L467) |
| `createInputRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L196) |
| `createLiveStudioMcpTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L66) |
| `createMemory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L250) |
| `createMirroredToolChunkState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L35) |
| `createNodeAgentServiceRuntimeInfrastructure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L40) |
| `createNodeVeryfrontCloudAgentServiceRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L987) |
| `createRedisMemory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L162) |
| `createRequestAuthCache` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L14) |
| `createRuntimeAgentDefinitionFromAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L71) |
| `createRuntimeAgentFromMarkdownDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L6) |
| `createRuntimeAgentSystemMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L120) |
| `createRuntimeLoadSkillTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L201) |
| `createRuntimeProjectFilesClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L88) |
| `createRuntimeProjectSkillLoader` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L206) |
| `createRuntimePromptBlock` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts#L6) |
| `createStreamedStepState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L626) |
| `createToolExecutionDataEventBridgeStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L29) |
| `createToolResultPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L323) |
| `createVeryfrontCloudAgentServiceChatExecutionRootRunOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L40) |
| `createVeryfrontCloudHostedChatExecutionRootRunOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L40) |
| `createVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L16) |
| `createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L16) |
| `createVeryfrontCloudRuntimeSystemMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L41) |
| `createWorkflow` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L67) |
| `dedupeChatUiMessageChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L164) |
| `defineAgentService` | Define an agent service and expose a policy-neutral runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L370) |
| `deriveAgentServiceAgUiChatContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L98) |
| `deriveAgUiForwardedConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L63) |
| `deriveHostedAgUiChatContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L98) |
| `describeProjectAgentRuntimeAgentIdCandidates` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L109) |
| `discoverProjectAgentRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L44) |
| `dispatchConversationHostedStreamErrorState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L90) |
| `dispatchConversationHostedTerminalState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L76) |
| `doesProjectAgentRuntimeAgentMatchSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L59) |
| `encodeConversationRunEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L229) |
| `ensureConversationProjectLink` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L127) |
| `evaluateSlashCommandArtifactPolicy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L195) |
| `evaluateStarterIntentTurnPolicy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L182) |
| `executeAgUiDetachedStart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L284) |
| `executeDefaultAgentServiceInvokeAgentTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L390) |
| `executeDefaultHostedInvokeAgentTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L390) |
| `executeDurableHumanInputFlow` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L197) |
| `executeHostedChildForkRunContextStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L208) |
| `executeHostedChildForkStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L465) |
| `executeHostedChildForkToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L216) |
| `executeHostedChildForkWithPreparedTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L258) |
| `executeHostedDurableChatRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L185) |
| `executeHostedDurableChildFork` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L548) |
| `executeHostedLocalChildInvoke` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L272) |
| `expandAllowedRemoteToolNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L52) |
| `expandHostedChildRequestedTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L76) |
| `extractChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L111) |
| `extractLatestUserText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L63) |
| `extractStarterIntentId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L165) |
| `fetchConversationRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L114) |
| `fetchDefaultAgentServiceProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L58) |
| `fetchDefaultHostedProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L58) |
| `fetchLatestConversationUserText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L106) |
| `filterAgentTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L32) |
| `filterHostedChatRuntimeLocalTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L95) |
| `finalizeAgUiBrowserEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L503) |
| `finalizeChildRunExecutionResources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L21) |
| `finalizeConversationAgentRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1358) |
| `finalizeHostedChildForkCompletion` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L146) |
| `finalizeHostedChildForkRunContextResources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L287) |
| `finalizeHostedDetached` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L141) |
| `finalizeHostedResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L84) |
| `findLatestUserConversationMessageContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L222) |
| `flattenSystemInstructions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L40) |
| `flushConversationRunEventBatches` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L746) |
| `flushConversationRunEventQueue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L854) |
| `formatChildRunStreamPartError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L26) |
| `formatRuntimeSkillMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-prompt.ts#L12) |
| `getAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L138) |
| `getAgentRuntimeTextPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L273) |
| `getAgentRuntimeToolCallPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L279) |
| `getAgentRuntimeToolResultPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L303) |
| `getAgentsAsTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L165) |
| `getAgentServiceTokenFromRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L143) |
| `getAgUiChatUiMessageChunkMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L62) |
| `getAgUiChatUiMessageMetadataFromChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L33) |
| `getAgUiChatUiMessageUsageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L47) |
| `getAgUiSseEventsOfType` | Filter parsed AG-UI SSE events by normalized event type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L66) |
| `getAgUiSseStringField` | Return a string field from a parsed AG-UI SSE event record. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L60) |
| `getAllAgentIds` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L142) |
| `getChildRunSnapshotUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L62) |
| `getConfirmedProjectContextSwitchId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts#L47) |
| `getConversationRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1153) |
| `getConversationRunEventJsonByteLength` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L17) |
| `getEmptyHostedFinalizedMessageTerminalError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L62) |
| `getForkRuntimeAllowedToolNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L63) |
| `getForwardedHostedModelId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L42) |
| `getForwardedHostedRuntimeOverrides` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L51) |
| `getHostedChildWrittenArtifactPath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L103) |
| `getHostedMirroredAbortErrorText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L148) |
| `getHostedServiceTokenFromRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L143) |
| `getHostedStreamErrorText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L58) |
| `getInputRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L237) |
| `getMaxForkRuntimeStepCount` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L483) |
| `getProjectAgentRuntimeAgentIdCandidates` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L89) |
| `getProjectSteeringMutation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L76) |
| `getProviderNativeToolNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L41) |
| `getProviderToolProfile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L41) |
| `getRuntimeAgentMarkdownDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L22) |
| `getRuntimeProjectFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L97) |
| `getRuntimeProjectFiles` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L130) |
| `getRuntimeProjectInstructions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L108) |
| `getRuntimeProjectSkillCatalog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L127) |
| `getRuntimeUploadUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L32) |
| `getTextFromParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L202) |
| `getToolArguments` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L217) |
| `handleHostedChildForkFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L265) |
| `handleHostedChildForkRunContextError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L249) |
| `handleHostedChildForkStreamPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L297) |
| `hasArgs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L209) |
| `hasInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L213) |
| `initializeNodeAgentServiceOpenTelemetry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L192) |
| `initializeNodeHostedAgentServiceOpenTelemetry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L154) |
| `installAbortRejectionGuard` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L105) |
| `isAbortRejectionReason` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L42) |
| `isActiveConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L431) |
| `isAgentServiceAuthError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L21) |
| `isAgentTraceAttributeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L24) |
| `isAlreadyMirroredAgentServiceChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L48) |
| `isAlreadyMirroredHostedChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L48) |
| `isAppendableConversationRunProjection` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L437) |
| `isChildRunAbortError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L22) |
| `isCursorMismatchConversationRunAppendError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L421) |
| `isDurableMirroredOutputChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L2) |
| `isHostedChildCreateFileAlreadyExistsResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L99) |
| `isHostedChildTerminalErrorCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L21) |
| `isHostedChildTextProjectArtifactPrompt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L94) |
| `isHostedServiceAuthError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L21) |
| `isIgnorableConversationRunAppendError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L400) |
| `isResponseLike` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/response-like.ts) |
| `isRuntimeAgentMarkdownAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-markdown-adapter.ts#L28) |
| `isStarterIntentRootOwnershipRequired` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L207) |
| `isSuccessfulProjectSteeringMutationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L114) |
| `listRuntimeBuiltinSkillReferenceFiles` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L102) |
| `listRuntimeBuiltinSkillReferences` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L117) |
| `loadAgentServiceEnvFiles` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L26) |
| `loadRuntimeAgentMarkdownDefinitionFromFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L144) |
| `loadRuntimeBuiltinSkillCatalog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L56) |
| `mapAgUiRuntimeEventToForkParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1018) |
| `mapFrameworkEventToForkParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L1180) |
| `mapHostedStreamPartToChatUiChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L213) |
| `mapRuntimeStreamEventToAgUiBrowserEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L290) |
| `mergeToolCallInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L106) |
| `mergeToolInputDelta` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L49) |
| `mirrorDefaultResearchRunArtifact` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L281) |
| `monitorConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1169) |
| `monitorHostedChildRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L130) |
| `normalizeAgUiBrowserRuntimeRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L189) |
| `normalizeAgUiMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L255) |
| `normalizeAgUiRuntimeMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-support.ts#L16) |
| `normalizeChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L87) |
| `normalizeChatUiMessageChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L134) |
| `normalizeChatUiMessageChunkToAgUiRuntimeEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L99) |
| `normalizeChatUiMessageStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L225) |
| `normalizeConversationRunEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L25) |
| `normalizeConversationRunEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-normalization.ts#L47) |
| `normalizeEncodedConversationRunEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L236) |
| `normalizeHostedChildArtifactPath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L123) |
| `normalizeParsedAgentServiceChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L161) |
| `normalizeParsedHostedChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L161) |
| `normalizeRuntimeSkillReferencePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L186) |
| `parseAgentServiceChatRequestFromRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L149) |
| `parseAgentServiceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L95) |
| `parseAgUiContextBoolean` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L49) |
| `parseAgUiContextJsonValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L23) |
| `parseAgUiContextNullableString` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L40) |
| `parseAgUiContextSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L54) |
| `parseAgUiContextString` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L35) |
| `parseAgUiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L242) |
| `parseAgUiRequestOrError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L246) |
| `parseAgUiRuntimeRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L212) |
| `parseAgUiRuntimeRequestOrError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L216) |
| `parseAgUiSseResponse` | Parse an AG-UI SSE `Response` into normalized events, text, tool starts, and terminal error state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L257) |
| `parseAppendConversationRunEventsErrorBody` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L383) |
| `parseDataStreamSseEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L147) |
| `parseHostedAgentServiceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L102) |
| `parseHostedChatRequestFromRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L149) |
| `parseRuntimeAgentMarkdownDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L82) |
| `parseRuntimeAgentRunInvocation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L346) |
| `parseRuntimeAgentRunInvocationAgentServiceChatRequestFromRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L174) |
| `parseRuntimeAgentRunInvocationHostedChatRequestFromRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L174) |
| `parseRuntimeAgentRunInvocationOrError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L352) |
| `parseRuntimeSkillDocument` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L124) |
| `parseRuntimeSkillMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L151) |
| `parseToolInputObject` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L128) |
| `persistConversationUserMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L186) |
| `persistLatestConversationUserMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L248) |
| `prepareAgentRuntimeMessagesFromUiMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L20) |
| `prepareAgentServiceChatExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L264) |
| `prepareAgentServiceChatRuntimeCreationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L195) |
| `prepareAgentServiceChatRuntimeMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L332) |
| `prepareAgentServiceConversationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L110) |
| `prepareConversationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L112) |
| `prepareConversationRootRunLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L34) |
| `prepareConversationRunChunkEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L61) |
| `prepareConversationRunExternalEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L71) |
| `prepareConversationRunStreamEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L54) |
| `prepareDefaultHostedChildForkRuntimeTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L270) |
| `prepareDefaultHostedChildForkSandboxToolSources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L174) |
| `prepareDefaultHostedChildForkToolAssembly` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L323) |
| `prepareDefaultHostedChildForkToolSources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L78) |
| `prepareHostedChatExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L264) |
| `prepareHostedChatRuntimeCreationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L195) |
| `prepareHostedChatRuntimeMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L332) |
| `prepareHostedChatRuntimeToolAssembly` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L107) |
| `prepareHostedChildForkRuntimeStepMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L76) |
| `prepareHostedConversationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L110) |
| `prepareVeryfrontCloudAgentServiceChatExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L70) |
| `prepareVeryfrontCloudHostedChatExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L70) |
| `publishInvokeAgentChildRunProgress` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L150) |
| `readRuntimeBuiltinDirectorySkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L76) |
| `readRuntimeBuiltinFlatSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L88) |
| `readRuntimeBuiltinSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L97) |
| `readRuntimeBuiltinSkillEntries` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L26) |
| `readRuntimeBuiltinSkillReferenceFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L63) |
| `recordMirroredToolChunkState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L59) |
| `recoverConversationRunAppendExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L628) |
| `recoverConversationRunAppendFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L558) |
| `recoverConversationRunCursorMismatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L487) |
| `registerAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L134) |
| `resolveAgentServiceRegistrationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L242) |
| `resolveConversationHostedStreamErrorState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L59) |
| `resolveConversationHostedTerminalState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L35) |
| `resolveConversationRunTargets` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L48) |
| `resolveForkRuntimeContinuationState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L490) |
| `resolveForkStepResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L860) |
| `resolveHostedChildForkRuntimeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L71) |
| `resolveHostedChildForkThinkingOverride` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L57) |
| `resolveHostedChildPromiseWithTimeout` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L123) |
| `resolveHostedChildStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L27) |
| `resolveHostedChildTerminalErrorCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L81) |
| `resolveHostedDurableRunSetupErrorResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L76) |
| `resolveHostedRuntimeRequestConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L89) |
| `resolveHostedRuntimeThinkingOverride` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L71) |
| `resolveNodeAgentServiceTelemetryConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L118) |
| `resolveNodeHostedAgentServiceTelemetryConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L102) |
| `resolveRuntimeAgentDefinitionsDir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L90) |
| `resolveRuntimeAgentMarkdownDefinitionFilePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L133) |
| `resolveRuntimeBuiltinSkillReferenceFilePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L42) |
| `resolveRuntimeBuiltinSkillsDir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L14) |
| `resolveRuntimeClientProfile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L78) |
| `resolveRuntimeMessageFileUrls` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L12) |
| `resolveSingleProjectAgentRuntimeAgentId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L118) |
| `resyncConversationRunAppendCursor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L448) |
| `runAgentRuntimeForkStep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L331) |
| `runAgentServiceMain` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L61) |
| `runFrameworkForkStep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L394) |
| `runHostedChildExecutionLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L271) |
| `runHostedChildLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L140) |
| `runHostedLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L124) |
| `runHostedResponseStreamWithHeartbeat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L60) |
| `runPreparedAgentServiceChatExecutionDetached` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L141) |
| `runPreparedHostedChatExecutionDetached` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L141) |
| `sanitizeDefaultHostedChildRequestedTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L236) |
| `sanitizeHostedChildRequestedTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L47) |
| `sanitizeProviderToolSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L289) |
| `selectDefaultHostedChildForkRuntimeTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L250) |
| `selectHostedChildForkRuntimeTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L190) |
| `selectProviderCompatibleToolNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L78) |
| `selectProviderCompatibleTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L105) |
| `shouldBlockHostedChildSameTurnRetry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L41) |
| `shouldContinueForkRuntimeStep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L446) |
| `shouldFailEmptyHostedFinalizedMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L75) |
| `shouldInjectDefaultResearchArtifactPath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L74) |
| `shouldPruneSandboxToolsFromHostedChildRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L110) |
| `shouldReinforceLoadSkillContinuation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L211) |
| `shouldRetryCreateResearchArtifactAsUpdate` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L247) |
| `shouldSkipHostedChildTerminalPersistence` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L91) |
| `startAgentRuntimeFork` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L518) |
| `startAgentRuntimeForkWithHostTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L224) |
| `startAgentService` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L1016) |
| `startAgentServiceRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L280) |
| `startAgentServiceServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L83) |
| `startConversationRootRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L52) |
| `startHostedChildForkRuntimeWithHostTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L33) |
| `startNodeAgentService` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L247) |
| `startNodeAgentServiceServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L67) |
| `startNodeHostedAgentService` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L271) |
| `startNodeVeryfrontCloudAgentService` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L996) |
| `streamDataStreamEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L172) |
| `streamPreparedAgentServiceChatExecutionToAgUiResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L107) |
| `streamPreparedHostedChatExecutionToAgUiResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L107) |
| `stringifyAgUiSseEvent` | Stringify an AG-UI SSE event or fallback value for diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L55) |
| `stripLeadingEmptyObjectPlaceholder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/data-stream.ts#L6) |
| `summarizeChildRunResultText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L15) |
| `summarizeChildRunResultValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/result-summary.ts#L53) |
| `throwIfChildRunAborted` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts#L16) |
| `toChildRunToolInputRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-support.ts) |
| `toConversationHostedTerminalState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L152) |
| `toConversationRunStreamEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-event-preparation.ts#L27) |
| `toHostedChatExecutionFinalState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L161) |
| `toMirroredAgentServiceStreamPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L82) |
| `toMirroredHostedStreamPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L82) |
| `updateDefaultResearchArtifacts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L159) |
| `validateRuntimeAgentTargetSelection` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L143) |
| `veryfrontMcpServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L133) |
| `waitForDurableHumanInputResolution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L280) |
| `waitForHumanInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L255) |
| `withDefaultResearchArtifactPath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L159) |
| `withHostedChildRerunnableFileWriteFallbacks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L32) |
| `withHostedChildStreamIdleTimeout` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L67) |
| `withRootOwnedChildResultHint` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L70) |
| `withRuntimeToolInventory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/tool-inventory.ts#L25) |
| `wrapHostedChildProjectSwitchTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L66) |
| `wrapHostedChildSteeringMutationTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L31) |
| `writeHostedChildExecutionLogEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L16) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AgentRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/index.ts#L478) |
| `AgentRuntimeMessageConversionError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L84) |
| `AgentServiceAuthError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L9) |
| `AppendConversationRunEventsError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L366) |
| `BufferMemory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L125) |
| `ConversationMemory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L82) |
| `ConversationRunEventEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L55) |
| `ConversationRunTerminalStateError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L354) |
| `HostedChildStreamIdleTimeoutError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L9) |
| `HostedChildTerminalStateError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L63) |
| `HostedServiceAuthError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L9) |
| `HumanInputResumeError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L181) |
| `InvalidHumanInputResultError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L190) |
| `RedisMemory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L44) |
| `RunAlreadyExistsError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L9) |
| `RunCancelledError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L2) |
| `RunNotActiveError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L16) |
| `RunResumeSessionManager` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L80) |
| `RuntimeProjectFilesApiAuthError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L76) |
| `SummaryMemory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory.ts#L152) |
| `WaitConflictError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L30) |
| `WaitNotPendingError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L23) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AbortRejectionEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L9) |
| `AbortRejectionEventTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L14) |
| `AbortRejectionGuardLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts) |
| `AbortRejectionProcessTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L4) |
| `ActiveConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L143) |
| `Agent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L236) |
| `AgentConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L77) |
| `AgentContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L180) |
| `AgentContract` | Framework-owned agent service contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L99) |
| `AgentMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L176) |
| `AgentMiddleware` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L196) |
| `AgentPushRuntimeServiceRest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L30) |
| `AgentRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L54) |
| `AgentResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L179) |
| `AgentRuntimeForkStepRunner` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L182) |
| `AgentRuntimeMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L61) |
| `AgentRuntimeMessagePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-adapter.ts#L44) |
| `AgentServiceActiveSpanAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L37) |
| `AgentServiceAgUiChatForwardedConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L38) |
| `AgentServiceAuth` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L88) |
| `AgentServiceAuthConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L56) |
| `AgentServiceAuthenticatedRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L31) |
| `AgentServiceAuthErrorCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L3) |
| `AgentServiceAuthFetch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L72) |
| `AgentServiceAuthLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L62) |
| `AgentServiceAuthOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L79) |
| `AgentServiceAuthTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L67) |
| `AgentServiceBootstrapExit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L13) |
| `AgentServiceChatProjectAccessError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L18) |
| `AgentServiceChatProjectAccessResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L24) |
| `AgentServiceChatRequestPrincipal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L13) |
| `AgentServiceChatRuntimeAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L63) |
| `AgentServiceChatRuntimeCreationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L83) |
| `AgentServiceChatRuntimeCreationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L69) |
| `AgentServiceChatRuntimeFinishPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L12) |
| `AgentServiceChatRuntimeOnFinishEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L34) |
| `AgentServiceChatRuntimeProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L76) |
| `AgentServiceChatRuntimeStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L51) |
| `AgentServiceChatRuntimeStreamResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L56) |
| `AgentServiceChatRuntimeToolAssemblyResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L43) |
| `AgentServiceChatRuntimeToUiMessageStreamOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L42) |
| `AgentServiceChildChunkMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L3) |
| `AgentServiceChildMirrorContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L12) |
| `AgentServiceChildMirrorPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L80) |
| `AgentServiceChildMirrorState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L7) |
| `AgentServiceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L14) |
| `AgentServiceConfigInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L35) |
| `AgentServiceConversationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L60) |
| `AgentServiceConversationRootRunState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L52) |
| `AgentServiceCorsConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L22) |
| `AgentServiceDefinition` | Type-preserving service definition for request-native agent service runtimes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L121) |
| `AgentServiceDetachedCleanupInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L60) |
| `AgentServiceDetachedExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L52) |
| `AgentServiceEnvFileLoadOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L10) |
| `AgentServiceEnvFileLoadResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L5) |
| `AgentServiceFormInputToolContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L15) |
| `AgentServiceJwtError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L36) |
| `AgentServiceJwtResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L42) |
| `AgentServiceOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L183) |
| `AgentServicePreparedExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L200) |
| `AgentServiceProcessTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L201) |
| `AgentServiceProjectAccessError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L46) |
| `AgentServiceProjectAccessResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L52) |
| `AgentServiceProjectSkillIdsContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L56) |
| `AgentServiceProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L58) |
| `AgentServiceProjectSteeringLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L47) |
| `AgentServiceProjectSteeringOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L51) |
| `AgentServiceProjectSteeringOptionsData` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L24) |
| `AgentServiceRegistrationConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L5) |
| `AgentServiceRegistrationLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L172) |
| `AgentServiceRegistrationLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L158) |
| `AgentServiceRegistrationMode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L4) |
| `AgentServiceRegistryContract` | Multi-agent service contract. Framework services route to `defaultAgentId` unless the host chooses another registered agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L71) |
| `AgentServiceRoute` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L36) |
| `AgentServiceRouteMethod` | Host-facing server config for the agent service runtime shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L20) |
| `AgentServiceRouteSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L101) |
| `AgentServiceRouteSetOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L69) |
| `AgentServiceRoutesLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L24) |
| `AgentServiceRoutesTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L30) |
| `AgentServiceRuntimeBundle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L101) |
| `AgentServiceRuntimeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L42) |
| `AgentServiceRuntimeLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L49) |
| `AgentServiceRuntimeTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L56) |
| `AgentServiceServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L38) |
| `AgentServiceServerConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L30) |
| `AgentServiceServerLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L11) |
| `AgentServiceSingleAgentContract` | Single-agent convenience accepted by `defineAgentService()`. Implementations must normalize this shape into the same registry path used by multi-agent services so framework users are not boxed into one-agent-per-process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L86) |
| `AgentServiceStreamExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L44) |
| `AgentServiceTraceContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L6) |
| `AgentServiceTraceContextGetter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L11) |
| `AgentStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L168) |
| `AgentStreamResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L228) |
| `AgentTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L6) |
| `AgentTraceAttributeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L1) |
| `AgentTraceUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/trace-attributes.ts#L8) |
| `AgUiBeforeStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L28) |
| `AgUiBeforeStreamContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L14) |
| `AgUiBeforeStreamMessageInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L2) |
| `AgUiBeforeStreamResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/before-stream.ts#L21) |
| `AgUiBrowserChunkEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L12) |
| `AgUiBrowserEncodedEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L25) |
| `AgUiBrowserEncoderState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L13) |
| `AgUiBrowserFinalizeTracker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L7) |
| `AgUiBrowserResponseEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L32) |
| `AgUiBrowserResponseExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L26) |
| `AgUiBrowserResponseRequestState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L19) |
| `AgUiBrowserRunFinishedMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L4) |
| `AgUiCancelHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L48) |
| `AgUiChatUiChunkBrowserEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L14) |
| `AgUiChunkEncoderBridge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L10) |
| `AgUiContextItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L119) |
| `AgUiDetachedStartAccepted` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L97) |
| `AgUiDetachedStartHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L210) |
| `AgUiDetachedStartRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L94) |
| `AgUiForwardedConfigOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/forwarded-context.ts#L4) |
| `AgUiHandlerConfigWithAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L313) |
| `AgUiHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/handler.ts#L305) |
| `AgUiInjectedTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L118) |
| `AgUiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L120) |
| `AgUiResumeHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L44) |
| `AgUiResumeSignal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/run-control.ts#L27) |
| `AgUiResumeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tool-shared.ts#L8) |
| `AgUiRuntimeChatStreamEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L13) |
| `AgUiRuntimeChatStreamEncoderState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L8) |
| `AgUiRuntimeContextItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L183) |
| `AgUiRuntimeEventEncoder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L11) |
| `AgUiRuntimeHandlerConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L356) |
| `AgUiRuntimeHandlerConfigWithAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L352) |
| `AgUiRuntimeHandlerExecute` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L318) |
| `AgUiRuntimeHandlerExecuteInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L311) |
| `AgUiRuntimeHandlerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L339) |
| `AgUiRuntimeInjectedTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L180) |
| `AgUiRuntimeLifecycleContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-handler.ts#L30) |
| `AgUiRuntimeMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L186) |
| `AgUiRuntimeRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L187) |
| `AgUiRuntimeStreamEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-encoder.ts#L2) |
| `AgUiSseEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/host-support.ts#L16) |
| `AgUiSseEventType` | Normalized AG-UI runtime event type value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L26) |
| `AgUiSseProgressSnapshot` | Progress snapshot emitted while parsing an AG-UI SSE response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L40) |
| `AppendConversationRunEventsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L255) |
| `AppendExternalAgentWorkerRunEventsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L204) |
| `BootstrapAgentServiceOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L15) |
| `BootstrapConversationAgentRunResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L280) |
| `BootstrapHostedChildRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L13) |
| `BootstrapHostedChildRunResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L24) |
| `BootstrappedHostedChatExecutionRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L145) |
| `BuildChatStreamChunkMessageMetadataInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L7) |
| `BuildDetachedFallbackChunksInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L53) |
| `BuildDetachedFallbackMessageInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L26) |
| `BuildFinalizedMessageFallbackChunksInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L44) |
| `BuildFinalizedMessageStateInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L19) |
| `BuildHostedDurableChildInvokeFailureResultInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L49) |
| `BuildParsedAgentServiceAgUiRequestOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L55) |
| `BuildParsedHostedAgUiRequestOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L55) |
| `CachedRequestAuthResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L1) |
| `ChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L108) |
| `ChatMessageMetadataUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L77) |
| `ChatUiMessageChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L297) |
| `ChatUiMessageStreamFinish` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L39) |
| `ChatUiMessageStreamFinishPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L19) |
| `ChatUiMessageStreamOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/chat-ui-message-stream.ts#L47) |
| `ChildRunAudit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L97) |
| `ChildRunAuditToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L84) |
| `ChildRunAuditToolResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L90) |
| `ChildRunExecutionBufferCleanupInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts) |
| `ChildRunExecutionResourceFinalizeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-cleanup.ts#L5) |
| `ChildRunExecutionResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L31) |
| `ChildRunExecutionSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L19) |
| `ChildRunExecutionUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts) |
| `ChildRunResultCommon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L53) |
| `ChildRunToolCallSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L6) |
| `ChildRunToolResultSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/execution-snapshot.ts#L12) |
| `ClaimExternalAgentWorkerRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L184) |
| `CloseHostedMirroredOpenToolCallsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L131) |
| `CompleteExternalAgentWorkerRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L197) |
| `ConversationAgentRunUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L324) |
| `ConversationChildLifecycleContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L116) |
| `ConversationControlPlaneResponseError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L47) |
| `ConversationHostedLifecycleFinalizeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L19) |
| `ConversationHostedTerminalAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L109) |
| `ConversationHostedTerminalRuntimeAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L69) |
| `ConversationHostedTerminalStateInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L7) |
| `ConversationHostedTerminalStateResolution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L30) |
| `ConversationMessageRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L43) |
| `ConversationRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L9) |
| `ConversationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L9) |
| `ConversationRootRunDescriptor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-context.ts#L2) |
| `ConversationRootRunLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L16) |
| `ConversationRunAppendCursorResyncResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L151) |
| `ConversationRunAppendExecutionOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L163) |
| `ConversationRunAppendFailureOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L159) |
| `ConversationRunAppendRecoveryOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L155) |
| `ConversationRunBatchFlushOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L167) |
| `ConversationRunChunkMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L23) |
| `ConversationRunChunkMirrorApiOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L76) |
| `ConversationRunChunkMirrorOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L88) |
| `ConversationRunChunkMirrorPrepareChunkEventsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L40) |
| `ConversationRunChunkMirrorPreparedChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L31) |
| `ConversationRunChunkMirrorPreparedEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L36) |
| `ConversationRunChunkMirrorPrepareExternalEventsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L45) |
| `ConversationRunChunkMirrorQueueOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L71) |
| `ConversationRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-context.ts#L2) |
| `ConversationRunEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L28) |
| `ConversationRunEventQueueController` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L177) |
| `ConversationRunMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L41) |
| `ConversationRunMirrorRetryScheduledState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L22) |
| `ConversationRunMirrorSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L2) |
| `ConversationRunMirrorStoppedState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-mirror.ts#L13) |
| `ConversationRunProjection` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L80) |
| `ConversationRunQueueFlushOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L172) |
| `ConversationRunStreamMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-stream-mirror.ts#L12) |
| `ConversationRunTargets` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L44) |
| `CreateAgentServiceRegistrationLifecycleOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L179) |
| `CreateAgentServiceRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L83) |
| `CreateAgentServiceServerRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L16) |
| `CreateAgUiBrowserChunkEncoderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-chunk-encoder.ts#L18) |
| `CreateAgUiBrowserFinalizeTrackerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-finalize-tracker.ts#L13) |
| `CreateAgUiBrowserResponseStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/browser-response-stream.ts#L37) |
| `CreateAgUiChatUiChunkBrowserEncoderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L19) |
| `CreateAgUiChatUiTrackedBrowserResponseInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chat-ui-chunk-browser-encoder.ts#L24) |
| `CreateAgUiChunkEncoderBridgeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/chunk-encoder-bridge.ts#L16) |
| `CreateAgUiRuntimeBrowserResponseInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-browser-response.ts#L12) |
| `CreateAgUiRuntimeChatStreamEncoderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-chat-stream-encoder.ts#L18) |
| `CreateAgUiRuntimeEventEncoderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/runtime-event-encoder.ts#L17) |
| `CreateAgUiTrackedBrowserResponseInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/tracked-browser-response.ts#L9) |
| `CreateBootstrappedHostedChatExecutionRuntimeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L112) |
| `CreateConversationHostedLifecycleAdapterOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-lifecycle.ts#L27) |
| `CreateConversationHostedTerminalAdapterOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L100) |
| `CreateDefaultAgentServiceChatRuntimeContextInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L78) |
| `CreateDefaultAgentServiceChatRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L99) |
| `CreateDefaultAgentServiceProjectSteeringRefreshOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L35) |
| `CreateDefaultHostedChatRuntimeContextInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L78) |
| `CreateDefaultHostedChatRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L99) |
| `CreateDefaultHostedProjectSteeringRefreshOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L35) |
| `CreateHostedAgentRunSpanControllerInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L43) |
| `CreateHostedAgentServiceRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L58) |
| `CreateHostedChatExecutionRuntimeBootstrapInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L89) |
| `CreateHostedChatExecutionRuntimeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L100) |
| `CreateHostedChildInvokeToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L16) |
| `CreateHostedMirroredUiStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L120) |
| `CreateHostedProjectRemoteToolSourceInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L49) |
| `CreateHostedProjectRemoteToolSourcesInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L189) |
| `CreateHostedRootRunLifecycleRuntimeAdapterInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L103) |
| `CreateHostedRuntimeStateResolverOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L43) |
| `CreateNodeAgentServiceRuntimeInfrastructureOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L19) |
| `CreateNodeHostedAgentServiceRuntimeInfrastructureOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L26) |
| `CreateRequestAuthCacheOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L3) |
| `CreateRuntimeAgentSystemMessagesInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L61) |
| `CreateVeryfrontCloudPreparedAgentServiceChatExecutionRuntimeOptionsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L6) |
| `CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-prepared-chat-execution-runtime.ts#L6) |
| `CreateVeryfrontCloudRuntimeSystemMessagesInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-runtime-system-messages.ts#L9) |
| `DefaultAgentServiceChatRuntimeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L43) |
| `DefaultAgentServiceChatRuntimeCreationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L54) |
| `DefaultAgentServiceChatRuntimeLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L50) |
| `DefaultAgentServiceChatRuntimeProjectSwitchInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L94) |
| `DefaultAgentServiceChatRuntimeSteeringMutationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L89) |
| `DefaultAgentServiceChatRuntimeSystemRefreshInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L83) |
| `DefaultAgentServiceChatRuntimeTaskContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L63) |
| `DefaultAgentServiceInvokeAgentConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L75) |
| `DefaultAgentServiceInvokeAgentContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L63) |
| `DefaultAgentServiceInvokeAgentInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L162) |
| `DefaultAgentServiceInvokeAgentLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L83) |
| `DefaultAgentServiceInvokeAgentProjectRefresh` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L104) |
| `DefaultAgentServiceInvokeAgentToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L110) |
| `DefaultAgentServiceInvokeAgentToolResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L100) |
| `DefaultAgentServiceInvokeAgentTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L95) |
| `DefaultAgentServiceInvokeAgentTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L90) |
| `DefaultAgentServiceProjectSteeringFetchers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L26) |
| `DefaultAgentServiceProjectSteeringRefreshLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L16) |
| `DefaultAgentServiceProjectSteeringRefreshLookup` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L20) |
| `DefaultHostedChatRuntimeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L43) |
| `DefaultHostedChatRuntimeCreationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L54) |
| `DefaultHostedChatRuntimeLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L50) |
| `DefaultHostedChatRuntimeProjectSwitchInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L94) |
| `DefaultHostedChatRuntimeSteeringMutationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L89) |
| `DefaultHostedChatRuntimeSystemRefreshInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L83) |
| `DefaultHostedChatRuntimeTaskContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-chat-runtime.ts#L63) |
| `DefaultHostedChildForkRuntimeToolPreparationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L154) |
| `DefaultHostedChildForkToolAssemblyResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L177) |
| `DefaultHostedChildForkToolAssemblySourceResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L165) |
| `DefaultHostedChildForkToolSourcesResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L57) |
| `DefaultHostedInvokeAgentConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L75) |
| `DefaultHostedInvokeAgentContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L63) |
| `DefaultHostedInvokeAgentInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L162) |
| `DefaultHostedInvokeAgentLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L83) |
| `DefaultHostedInvokeAgentProjectRefresh` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L104) |
| `DefaultHostedInvokeAgentToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L110) |
| `DefaultHostedInvokeAgentToolResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L100) |
| `DefaultHostedInvokeAgentTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L95) |
| `DefaultHostedInvokeAgentTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L90) |
| `DefaultHostedProjectSteeringFetchers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L26) |
| `DefaultHostedProjectSteeringRefreshLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L16) |
| `DefaultHostedProjectSteeringRefreshLookup` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L20) |
| `DefaultResearchArtifactContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L13) |
| `DefaultResearchArtifactLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L20) |
| `DefaultResearchArtifactPaths` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-policy.ts#L65) |
| `DefaultResearchArtifacts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/default-research-artifact-support.ts#L11) |
| `DerivedAgentServiceAgUiChatContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L42) |
| `DerivedHostedAgUiChatContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L42) |
| `DetachedFallbackMessageState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L39) |
| `DetachedRunDrainResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L2) |
| `DetachedRunShutdownLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L30) |
| `DetachedRunShutdownLifecycleOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L35) |
| `DetachedRunShutdownLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L25) |
| `DetachedRunTracker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L12) |
| `DetachedRunTrackerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/detached-run-tracker.ts#L7) |
| `DiscoverProjectAgentRuntimeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L26) |
| `DurableHumanInputFlowResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L142) |
| `DurableRunSink` | Transport-neutral durable run lifecycle sink for agent-service adoption work. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L5) |
| `EdgeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L170) |
| `ExecuteAgUiDetachedStartInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/detached-start.ts#L173) |
| `ExecuteDurableHumanInputFlowOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L147) |
| `ExecuteHostedChildForkRunContextStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L182) |
| `ExecuteHostedChildForkStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L84) |
| `ExecuteHostedChildForkToolInputOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L180) |
| `ExecuteHostedChildForkWithPreparedToolsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L89) |
| `ExecuteHostedDurableChatRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L38) |
| `ExecuteHostedDurableChildForkInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L329) |
| `ExecuteHostedLocalChildInvokeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L106) |
| `ExternalAgentWorker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L4) |
| `ExternalAgentWorkerClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L211) |
| `ExternalAgentWorkerClientOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L169) |
| `ExternalAgentWorkerRequestSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L17) |
| `ExternalAgentWorkerRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L44) |
| `ExternalAgentWorkerSession` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L31) |
| `FetchDefaultAgentServiceProjectSteeringInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L45) |
| `FetchDefaultHostedProjectSteeringInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-project-steering-refresh.ts#L45) |
| `FinalizedMessageState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/finalized-message.ts#L33) |
| `FinalizeHostedChildForkRunContextResourcesInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L108) |
| `FinalizeHostedDetachedOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L43) |
| `FinalizeHostedResponseOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L21) |
| `ForkPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L140) |
| `ForkRecoveredPartsState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L96) |
| `ForkRuntimeContinuationPromptResolver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L412) |
| `ForkRuntimeStep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L71) |
| `ForkRuntimeStepPreparer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L178) |
| `ForkRuntimeStreamLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L149) |
| `ForkRuntimeStreamMappingState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L130) |
| `ForkRuntimeStreamResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L153) |
| `FormInputToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L191) |
| `FrameworkStreamState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L138) |
| `HandleHostedChildForkFailureInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L118) |
| `HandleHostedChildForkRunContextErrorInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L95) |
| `HostedAgentProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L58) |
| `HostedAgentProjectSteeringLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L47) |
| `HostedAgentProjectSteeringOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L51) |
| `HostedAgentProjectSteeringOptionsData` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L24) |
| `HostedAgentRunSpan` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L14) |
| `HostedAgentRunSpanController` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L36) |
| `HostedAgentRunSpanFinalState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L24) |
| `HostedAgentRunTracer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L20) |
| `HostedAgentServiceActiveSpanAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L37) |
| `HostedAgentServiceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L92) |
| `HostedAgentServiceConfigInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L93) |
| `HostedAgentServiceDetachedCleanupInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L60) |
| `HostedAgentServiceDetachedExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L52) |
| `HostedAgentServiceEnvFileLoadOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L16) |
| `HostedAgentServiceEnvFileLoadResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L15) |
| `HostedAgentServiceRouteSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L101) |
| `HostedAgentServiceRouteSetOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L69) |
| `HostedAgentServiceRoutesLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L24) |
| `HostedAgentServiceRoutesTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L30) |
| `HostedAgentServiceRuntimeBundle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L88) |
| `HostedAgentServiceRuntimeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L37) |
| `HostedAgentServiceRuntimeLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L44) |
| `HostedAgentServiceRuntimeTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L51) |
| `HostedAgentServiceStreamExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/routes.ts#L44) |
| `HostedAgUiChatForwardedConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L38) |
| `HostedChatExecutionLifecycleAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-lifecycle-types.ts#L3) |
| `HostedChatExecutionPreparationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L114) |
| `HostedChatExecutionPreparationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L148) |
| `HostedChatExecutionPreparationRootRunOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L105) |
| `HostedChatExecutionRootStreamWatchdog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L76) |
| `HostedChatExecutionRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L71) |
| `HostedChatExecutionRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L60) |
| `HostedChatExecutionRuntimeBootstrap` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L78) |
| `HostedChatExecutionRuntimeLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-execution-runtime.ts#L66) |
| `HostedChatProjectAccessError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L18) |
| `HostedChatProjectAccessResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L24) |
| `HostedChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L53) |
| `HostedChatRequestInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L54) |
| `HostedChatRequestPrincipal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L13) |
| `HostedChatRuntimeAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L63) |
| `HostedChatRuntimeAgentAdapterInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L18) |
| `HostedChatRuntimeAgentAdapterRunner` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L9) |
| `HostedChatRuntimeAgentAdapterWarning` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-agent-adapter.ts#L13) |
| `HostedChatRuntimeAllowedToolNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L41) |
| `HostedChatRuntimeCreationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L83) |
| `HostedChatRuntimeCreationPreparationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L67) |
| `HostedChatRuntimeCreationPreparationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L94) |
| `HostedChatRuntimeCreationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L69) |
| `HostedChatRuntimeFinishPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L12) |
| `HostedChatRuntimeInstructionsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L58) |
| `HostedChatRuntimeOnFinishEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L34) |
| `HostedChatRuntimePreparationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L47) |
| `HostedChatRuntimePreparationSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L53) |
| `HostedChatRuntimeProjectSteering` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L76) |
| `HostedChatRuntimeStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L51) |
| `HostedChatRuntimeStreamResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L56) |
| `HostedChatRuntimeToolAssemblyContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L31) |
| `HostedChatRuntimeToolAssemblyResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L43) |
| `HostedChatRuntimeToUiMessageStreamOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-contract.ts#L42) |
| `HostedChildChunkMirror` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L3) |
| `HostedChildConversationBodyInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-bootstrap.ts#L4) |
| `HostedChildExecutionLifecycleOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L97) |
| `HostedChildExecutionLifecycleResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L76) |
| `HostedChildExecutionLogEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L4) |
| `HostedChildExecutionLogLevel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L2) |
| `HostedChildExecutionLogWriter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-execution-logging.ts#L10) |
| `HostedChildFileWriteFallbackLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L28) |
| `HostedChildFileWriteFallbackTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L24) |
| `HostedChildFileWriteFallbackToolExecute` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L19) |
| `HostedChildForkExecutionInstrumentation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-execution-runner.ts#L59) |
| `HostedChildForkInstructionsContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-instructions.ts) |
| `HostedChildForkPendingToolLifecycle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L69) |
| `HostedChildForkRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L65) |
| `HostedChildForkRunContextInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L78) |
| `HostedChildForkRuntimeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L34) |
| `HostedChildForkRuntimeStepMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L21) |
| `HostedChildForkRuntimeStepSystemResolver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L9) |
| `HostedChildForkRuntimeToolSelectionResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L144) |
| `HostedChildForkStreamHandlingState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L57) |
| `HostedChildForkStreamLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L63) |
| `HostedChildForkStreamMirrorContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L52) |
| `HostedChildForkStreamState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L48) |
| `HostedChildForkStreamTraceInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-stream-execution.ts#L78) |
| `HostedChildForkToolCallSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L35) |
| `HostedChildForkToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L30) |
| `HostedChildForkToolResultSnapshot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L41) |
| `HostedChildForkToolSourcesLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L32) |
| `HostedChildInvokeFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-invoke-tool.ts#L11) |
| `HostedChildLifecycleAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L29) |
| `HostedChildLifecycleRunnerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L48) |
| `HostedChildLifecycleRunResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L64) |
| `HostedChildLifecycleTerminalState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-lifecycle.ts#L13) |
| `HostedChildMirrorContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L12) |
| `HostedChildMirrorPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L80) |
| `HostedChildMirrorState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-mirror.ts#L7) |
| `HostedChildPendingToolCallPhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L3) |
| `HostedChildPendingToolCallState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L5) |
| `HostedChildPendingToolLifecycleCloseLog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L16) |
| `HostedChildPendingToolLifecycleCloseReason` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L11) |
| `HostedChildPendingToolLifecycleInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L73) |
| `HostedChildPendingToolLifecycleLogContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L34) |
| `HostedChildPendingToolLifecycleLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L29) |
| `HostedChildPendingToolLifecycleLogWriter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L40) |
| `HostedChildPendingToolLifecycleUnknownToolLog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-pending-tool-lifecycle.ts#L22) |
| `HostedChildProjectSwitchHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L14) |
| `HostedChildRequestedToolsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-requested-tools.ts#L17) |
| `HostedChildRunIdentifiers` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L2) |
| `HostedChildRunStatusMonitor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L13) |
| `HostedChildSameTurnRetryBlockSignal` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L31) |
| `HostedChildSteeringMutationHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L10) |
| `HostedChildStreamWatchdogPhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L2) |
| `HostedChildStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-stream-watchdog.ts#L4) |
| `HostedChildTerminalErrorCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L18) |
| `HostedChildTerminalStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L58) |
| `HostedChildWrittenArtifactPathInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-artifact-support.ts#L12) |
| `HostedConversationRootRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L60) |
| `HostedConversationRootRunState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L52) |
| `HostedConversationRunChunkMirrorInstrumentation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L97) |
| `HostedConversationRunChunkMirrorOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L105) |
| `HostedConversationRunChunkMirrorTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-chunk-mirror.ts#L92) |
| `HostedDetachedFinalizationState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L15) |
| `HostedDurableChildBootstrapCallbacks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L309) |
| `HostedDurableChildBootstrapContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L300) |
| `HostedDurableChildExecutionOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L25) |
| `HostedDurableChildForkRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L74) |
| `HostedDurableChildForkRunContextInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-run-context.ts#L86) |
| `HostedDurableChildInvokeResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L29) |
| `HostedDurableChildInvokeTraceBase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L86) |
| `HostedDurableChildInvokeTraceInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L82) |
| `HostedDurableChildInvokeTraceOverrides` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L91) |
| `HostedDurableChildInvokeTraceRecorder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L95) |
| `HostedDurableChildRuntimeDependencies` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L322) |
| `HostedDurableChildSetupFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L73) |
| `HostedDurableChildSuccess` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L58) |
| `HostedDurableChildTerminalFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L65) |
| `HostedDurableRunAccepted` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L12) |
| `HostedDurableRunAuthErrorResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L17) |
| `HostedDurableRunLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L23) |
| `HostedDurableRunSetupErrorStatusCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L10) |
| `HostedDurableRunStartCleanupInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L32) |
| `HostedDurableRunStartExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-chat-run-start.ts#L27) |
| `HostedFormInputToolContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/form-input-tool.ts#L15) |
| `HostedLifecycleAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L19) |
| `HostedLifecycleExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L14) |
| `HostedLifecycleRunnerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L35) |
| `HostedLifecycleRunResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts#L45) |
| `HostedLifecycleTerminalState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/lifecycle.ts) |
| `HostedLocalChildInvokeTraceRecorder` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/durable-child-fork-execution.ts#L99) |
| `HostedMirroredOpenToolCallLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L107) |
| `HostedMirroredUiStreamLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L111) |
| `HostedMirroredUiStreamWatchdog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L115) |
| `HostedProjectRemoteToolSourceMutationHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L27) |
| `HostedProjectRemoteToolSourcePrepareToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L35) |
| `HostedProjectRemoteToolSourceProjectSwitchHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L31) |
| `HostedProjectRemoteToolSourceRetryPolicy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-remote-tool-source.ts#L41) |
| `HostedProjectSkillIdsContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L56) |
| `HostedProjectSteeringAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L60) |
| `HostedProjectSteeringAdapterOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L44) |
| `HostedProjectSteeringLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/project-steering-adapter.ts#L40) |
| `HostedResponseFinalizationState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L7) |
| `HostedResponseStreamHeartbeat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L11) |
| `HostedResponseStreamHeartbeatState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L6) |
| `HostedResponseStreamWriter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/response-stream.ts#L2) |
| `HostedRootRunLifecycleRuntimeAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-run-lifecycle.ts#L98) |
| `HostedRuntimeRequestConfigAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L16) |
| `HostedRuntimeRequestConfigRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L11) |
| `HostedRuntimeStateResolverContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L14) |
| `HostedRuntimeStateResolverInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L22) |
| `HostedRuntimeStateResolverResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L29) |
| `HostedRuntimeSystemRefresh` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L39) |
| `HostedRuntimeSystemRefreshInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-state-resolver.ts#L34) |
| `HostedServiceAuth` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L88) |
| `HostedServiceAuthConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L56) |
| `HostedServiceAuthenticatedRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L31) |
| `HostedServiceAuthErrorCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L3) |
| `HostedServiceAuthFetch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L72) |
| `HostedServiceAuthLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L62) |
| `HostedServiceAuthOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L79) |
| `HostedServiceAuthTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L67) |
| `HostedServiceJwtError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L36) |
| `HostedServiceJwtResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L42) |
| `HostedServiceProjectAccessError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L46) |
| `HostedServiceProjectAccessResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/auth.ts#L52) |
| `HostedStreamPartForUiChunkMapping` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L27) |
| `HostedStreamTerminalError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-terminal-error.ts#L10) |
| `HostedTerminalError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/stream-finalization.ts#L2) |
| `HostedUiChunkMappingOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L2) |
| `HumanInputField` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L128) |
| `HumanInputFieldInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L129) |
| `HumanInputOption` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L127) |
| `HumanInputPendingRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L133) |
| `HumanInputRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L130) |
| `HumanInputRequestInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L131) |
| `HumanInputResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L132) |
| `HumanInputResumeValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L137) |
| `InitializeNodeAgentServiceTelemetryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L56) |
| `InitializeNodeHostedAgentServiceTelemetryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L48) |
| `InputRequestOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L194) |
| `InstallAbortRejectionGuardOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L25) |
| `InstalledAbortRejectionGuard` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/abort-rejection-guard.ts#L33) |
| `InvokeAgentChildRunLifecycleCustomEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L71) |
| `InvokeAgentChildRunLifecycleValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L32) |
| `InvokeAgentChildRunProgressEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L89) |
| `InvokeAgentChildRunProgressInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L75) |
| `InvokeAgentChildRunStateDelta` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L54) |
| `LiveStudioMcpToolsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/live-studio-mcp-tools.ts#L10) |
| `LoadRuntimeAgentMarkdownDefinitionFromFileInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L20) |
| `Memory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L31) |
| `MemoryConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L169) |
| `MemoryPersistence` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L38) |
| `MemoryStats` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/memory-interface.ts#L17) |
| `MessagePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L175) |
| `MirroredToolChunkState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L26) |
| `ModelProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L167) |
| `ModelString` | Model configuration string format: "provider/model-name" Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet" | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L41) |
| `ModelTransportRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L143) |
| `ModelTransportResolver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L157) |
| `MonitorHostedChildRunStatusInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L121) |
| `MutableAgentProjectContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/context.ts) |
| `NodeAgentServiceInstrumentationConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L16) |
| `NodeAgentServiceRuntimeInfrastructure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L29) |
| `NodeAgentServiceServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L37) |
| `NodeAgentServiceTelemetryConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L28) |
| `NodeAgentServiceTelemetryEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L12) |
| `NodeAgentServiceTelemetryLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L42) |
| `NodeAgentServiceTelemetryProcessTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L46) |
| `NodeHostedAgentServiceInstrumentationConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L14) |
| `NodeHostedAgentServiceRuntimeInfrastructure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L38) |
| `NodeHostedAgentServiceTelemetryConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L18) |
| `NodeHostedAgentServiceTelemetryEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L10) |
| `NodeHostedAgentServiceTelemetryLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L40) |
| `NodeHostedAgentServiceTelemetryProcessTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L44) |
| `NodeVeryfrontCloudAgentServiceMcpServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L131) |
| `NodeVeryfrontCloudAgentServiceOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L145) |
| `NodeVeryfrontCloudAgentServicePreparedExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L192) |
| `NodeVeryfrontCloudAgentServiceProcessTarget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L119) |
| `NormalizedAgentServiceChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L30) |
| `NormalizedAgentServiceContract` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/definition.ts#L108) |
| `NormalizedHostedChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L30) |
| `OpenToolCalls` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/mirrored-tool-chunk-state.ts#L102) |
| `ParseAgentServiceChatRequestOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L48) |
| `ParseAgUiSseResponseOptions` | Options for `parseAgUiSseResponse()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L49) |
| `ParsedAgentServiceAgUiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L51) |
| `ParsedAgentServiceChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L28) |
| `ParsedAgUiSseRun` | Parsed AG-UI SSE response summary for evals, canaries, and host tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L29) |
| `ParsedHostedAgUiRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L51) |
| `ParsedHostedChatRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L28) |
| `ParsedRuntimeSkillDocument` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L97) |
| `ParseHostedChatRequestOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request-parser.ts#L48) |
| `ParseRuntimeAgentMarkdownDefinitionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L57) |
| `PersistConversationUserMessageFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L53) |
| `PrepareAgentRuntimeMessagesFromUiMessagesOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-preparation.ts#L14) |
| `PrepareAgentServiceChatRuntimeMessagesOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L36) |
| `PrepareAgentServiceConversationRootRunContextInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L68) |
| `PrepareConversationRootRunLifecycleOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L20) |
| `PreparedAgentServiceChatExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L10) |
| `PreparedAgentServiceChatExecutionDetachedInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L56) |
| `PreparedAgentServiceChatExecutionRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L30) |
| `PreparedAgentServiceChatExecutionStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L49) |
| `PrepareDefaultHostedChildForkSandboxToolSourcesInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L68) |
| `PrepareDefaultHostedChildForkToolSourcesInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-tool-sources.ts#L36) |
| `PreparedHostedChatExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L10) |
| `PreparedHostedChatExecutionDetachedInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L56) |
| `PreparedHostedChatExecutionRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L30) |
| `PreparedHostedChatExecutionStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/prepared-chat-execution.ts#L49) |
| `PrepareHostedChatRuntimeMessagesOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-preparation.ts#L36) |
| `PrepareHostedChatRuntimeToolAssemblyInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-runtime-tool-assembly.ts#L53) |
| `PrepareHostedChildForkRuntimeStepMessagesInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-step-message-preparation.ts#L14) |
| `PrepareHostedConversationRootRunContextInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/root-run-lifecycle.ts#L68) |
| `PrepareVeryfrontCloudAgentServiceChatExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L22) |
| `PrepareVeryfrontCloudHostedChatExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L22) |
| `ProjectAgentRuntimeAgentIdCandidates` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L21) |
| `ProjectAgentRuntimeAgentSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/agent-runtime.ts#L19) |
| `ProjectSteeringMutationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L17) |
| `ProjectSteeringMutationResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L25) |
| `ProjectSteeringPaths` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/project/steering-mutation.ts#L12) |
| `ProviderNativeToolInventoryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-native-tool-inventory.ts#L7) |
| `ProviderToolCompatOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L16) |
| `ProviderToolCompatProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L3) |
| `ProviderToolProfile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/provider-tool-compat.ts#L10) |
| `RecordExternalAgentWorkerSessionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L189) |
| `RedisClient` | Redis client interface (compatible with ioredis and node-redis) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L19) |
| `RedisMemoryConfig` | Redis memory configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/memory/redis.ts#L29) |
| `RegisterAgentPushRuntimeServiceRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L50) |
| `RegisterExternalAgentWorkerInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/external-worker-client.ts#L175) |
| `RequestAuthCache` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L10) |
| `ResolveAgentServiceRegistrationInputOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L164) |
| `ResolveConversationHostedTerminalStateInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/hosted-terminal.ts#L23) |
| `ResolvedAgentConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L141) |
| `ResolvedAgentServiceRegistrationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L15) |
| `ResolvedHostedRuntimeRequestConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L30) |
| `ResolvedModelTransport` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L151) |
| `ResolvedRuntimeState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L170) |
| `ResolveHostedChildForkRuntimeConfigInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L44) |
| `ResolveHostedRuntimeRequestConfigInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/runtime-request-config.ts#L21) |
| `ResolveNodeAgentServiceTelemetryConfigOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L37) |
| `ResolveNodeHostedAgentServiceTelemetryConfigOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-telemetry.ts#L30) |
| `ResolveRuntimeAgentDefinitionsDirInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L10) |
| `RootOwnedChildResultHint` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L39) |
| `RootOwnedChildResultHinted` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/delegation-policy.ts#L44) |
| `RunAgentRuntimeForkStepInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L314) |
| `RunAgentServiceMainOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/bootstrap.ts#L24) |
| `RunFrameworkForkStepInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L327) |
| `RunResumeSessionManagerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L67) |
| `RunSessionStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts) |
| `RuntimeAgentContextItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L294) |
| `RuntimeAgentControlPlaneStreamRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L316) |
| `RuntimeAgentMarkdownDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L41) |
| `RuntimeAgentProjectContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L303) |
| `RuntimeAgentRunContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L309) |
| `RuntimeAgentRunInvocation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L312) |
| `RuntimeAgentSourceContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L297) |
| `RuntimeAgentTargetKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L300) |
| `RuntimeAgentThinkingConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L18) |
| `RuntimeAgentTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L293) |
| `RuntimeAgentValidatedClaims` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-invocation-contract.ts#L306) |
| `RuntimeBuiltinSkillEntriesResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/builtin-skill-files.ts#L4) |
| `RuntimeClientCapability` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L33) |
| `RuntimeClientProfile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L36) |
| `RuntimeClientType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L32) |
| `RuntimeFileUrlResolver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L8) |
| `RuntimeFileUrlResolverInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/message-file-url-refresh.ts#L2) |
| `RuntimeGetProjectFileOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L52) |
| `RuntimeLoadedProjectSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L18) |
| `RuntimeLoadedSkillResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L76) |
| `RuntimeLoadedSkillResponseMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L68) |
| `RuntimeLoadSkillBuiltinStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L52) |
| `RuntimeLoadSkillErrorOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L96) |
| `RuntimeLoadSkillReferenceFileOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L90) |
| `RuntimeLoadSkillToolContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L47) |
| `RuntimeLoadSkillToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L86) |
| `RuntimeLoadSkillToolMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L58) |
| `RuntimeLoadSkillToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L60) |
| `RuntimeLoadSkillToolOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/load-skill-tool.ts#L100) |
| `RuntimeProjectFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L41) |
| `RuntimeProjectFileListItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L42) |
| `RuntimeProjectFilesApiOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L46) |
| `RuntimeProjectFilesClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L69) |
| `RuntimeProjectFilesClientOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L60) |
| `RuntimeProjectFilesFetch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L56) |
| `RuntimeProjectFilesTrace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L58) |
| `RuntimeProjectInstructionsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L39) |
| `RuntimeProjectSkillCatalogOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L29) |
| `RuntimeProjectSkillContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L12) |
| `RuntimeProjectSkillLoader` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L37) |
| `RuntimeProjectSkillLoaderLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L23) |
| `RuntimeProjectSkillLoaderOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-loader.ts#L27) |
| `RuntimeProjectSteeringLookup` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-skill-catalog.ts#L23) |
| `RuntimePromptBlockOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/prompt-block.ts) |
| `RuntimeSkillDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L56) |
| `RuntimeSkillFrontmatter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L19) |
| `RuntimeSkillMetadataLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/skill-metadata.ts#L93) |
| `RuntimeStateRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L161) |
| `RuntimeStateResolver` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L175) |
| `RuntimeUploadUrlClientOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L20) |
| `RuntimeUploadUrlFetch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L18) |
| `RuntimeUploadUrlOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/upload-url-client.ts#L26) |
| `SlashCommandArtifactPolicy` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L10) |
| `SlashCommandArtifactPolicyInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/artifacts/slash-command-artifact-policy.ts#L5) |
| `StartAgentRuntimeForkInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L189) |
| `StartAgentRuntimeForkWithHostToolsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/fork-runtime-stream.ts#L210) |
| `StartAgentServiceRuntimeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L121) |
| `StartAgentServiceRuntimeResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L143) |
| `StartAgentServiceServerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L30) |
| `StartedHostedChildForkRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L25) |
| `StartHostedChildForkRuntimeWithHostToolsInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-fork-runtime-start.ts#L17) |
| `StartNodeAgentServiceOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L116) |
| `StartNodeAgentServiceResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L138) |
| `StartNodeAgentServiceServerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/server.ts#L23) |
| `StartNodeHostedAgentServiceOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L106) |
| `StartNodeHostedAgentServiceResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/runtime.ts#L131) |
| `StreamToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L177) |
| `SubmitResumeValueOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/resume-session.ts#L37) |
| `Suggestion` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L46) |
| `Suggestions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/types.ts#L72) |
| `TerminalConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L147) |
| `ToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L178) |
| `ToolCallPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L173) |
| `ToolCallPartWithArgs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L171) |
| `ToolCallPartWithInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L172) |
| `ToolExecutionDataEventBridgeStreamInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L4) |
| `ToolExecutionDataEventPublisher` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/streaming/tool-execution-data-event-bridge.ts#L2) |
| `ToolResultPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/schemas/agent.schema.ts#L174) |
| `VeryfrontCloudAgentServiceChatExecutionPreparationLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L18) |
| `VeryfrontCloudAgentServiceOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L182) |
| `VeryfrontCloudHostedChatExecutionPreparationLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/cloud-chat-execution-preparation.ts#L18) |
| `VeryfrontMcpServerKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/veryfront-cloud-agent-service.ts#L129) |
| `WaitForDurableHumanInputResolutionOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L166) |
| `WaitForHumanInputOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L173) |
| `WorkflowConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L52) |
| `WorkflowResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L57) |
| `WorkflowStep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/composition/composition.ts#L45) |
| `WrapHostedChildProjectSwitchToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L25) |
| `WrapHostedChildSteeringMutationToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-steering-tools.ts#L16) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentServiceAgUiChatForwardedConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L34) |
| `agentServiceConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L89) |
| `agentServiceRegistrationConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L73) |
| `agUiSseEventTypes` | AG-UI runtime event type constants normalized from browser-wire SSE events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/ag-ui/sse-parser.ts#L4) |
| `conversationRunEventTypes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/run-events.ts#L5) |
| `createNodeHostedAgentServiceRuntimeInfrastructure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/node-runtime-infrastructure.ts#L69) |
| `defaultHostedInvokeAgentInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L158) |
| `defaultHostedInvokeAgentSelectionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/default-invoke-agent-tool.ts#L149) |
| `getAgUiRuntimeContextItemSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L57) |
| `getAgUiRuntimeInjectedToolSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L44) |
| `getAgUiRuntimeMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L142) |
| `getAgUiRuntimeRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/ag-ui-contract.ts#L161) |
| `getCreateInputRequestRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L19) |
| `getCreateInputRequestResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L150) |
| `getFormInputToolInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L8) |
| `getGetInputRequestResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L151) |
| `getHumanInputFieldSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L33) |
| `getHumanInputOptionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L12) |
| `getHumanInputPendingRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L119) |
| `getHumanInputRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L92) |
| `getHumanInputResultSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/human-input.ts#L106) |
| `getInputRequestLifecycleDataEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L176) |
| `getInputRequestOutputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L153) |
| `getInputRequestRestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L101) |
| `getInputResponseRestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L51) |
| `getInputResponseValuesSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/input/request-protocol.ts#L12) |
| `getParseRuntimeAgentMarkdownDefinitionInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L45) |
| `getRuntimeAgentMarkdownDefinitionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L22) |
| `getRuntimeAgentThinkingConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L8) |
| `getRuntimeClientCapabilitySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L7) |
| `getRuntimeClientProfileSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L16) |
| `getRuntimeClientTypeSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L3) |
| `hostedAgentProjectSteeringOptionsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/agent-project-steering.ts#L31) |
| `hostedAgentServiceConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/config.ts#L91) |
| `hostedAgUiChatForwardedConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/ag-ui-chat-request.ts#L34) |
| `hostedChatRequestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L51) |
| `hostedChatRuntimeOverridesSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L36) |
| `hostedChildForkToolInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-tool-input.ts#L28) |
| `hostedChildTerminalErrorCodes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/child-status.ts#L12) |
| `hostedDurableRootRunDescriptorSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/hosted/chat-request.ts#L23) |
| `loadHostedAgentServiceEnvFiles` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/env-files.ts#L59) |
| `loadRuntimeAgentMarkdownDefinitionFromFileInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L56) |
| `parseRuntimeAgentMarkdownDefinitionInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L53) |
| `resolvedAgentServiceRegistrationInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/registration.ts#L88) |
| `resolveRuntimeAgentDefinitionsDirInputSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition-files.ts#L38) |
| `runtimeAgentMarkdownDefinitionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L37) |
| `runtimeAgentThinkingConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/agent-definition.ts#L16) |
| `runtimeClientCapabilitySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L28) |
| `runtimeClientProfileSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L30) |
| `runtimeClientTypeSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/client-profile.ts#L26) |
| `runtimeProjectFileListItemSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L39) |
| `runtimeProjectFileSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/runtime/project-files-client.ts#L37) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/agent/conversation-bootstrap`

```ts
import { bootstrapConversationAgentRun, createConversationMessage, createConversationRecord } from "veryfront/agent/conversation-bootstrap";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ConversationMessageRecordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L41) |
| `ConversationRecordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L32) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `bootstrapConversationAgentRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L286) |
| `createConversationMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L167) |
| `createConversationRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L152) |
| `ensureConversationProjectLink` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L127) |
| `fetchConversationRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L114) |
| `findLatestUserConversationMessageContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L222) |
| `persistConversationUserMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L186) |
| `persistLatestConversationUserMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L248) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BootstrapConversationAgentRunResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L280) |
| `ConversationControlPlaneResponseError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L47) |
| `ConversationMessageRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L43) |
| `ConversationRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L9) |
| `PersistConversationUserMessageFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L53) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getConversationMessageRecordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L34) |
| `getConversationRecordSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/bootstrap.ts#L14) |

### `veryfront/agent/durable`

```ts
import { appendConversationRunEvents, createConversationAgentRun, createConversationRunEventQueueController } from "veryfront/agent/durable";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AppendConversationRunEventsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L311) |
| `CompleteConversationRunResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L251) |
| `ConversationRunProjectionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L142) |
| `ConversationRunStatusSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L78) |
| `ConversationRunTargetsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L42) |
| `CreateConversationRunAcceptedSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L235) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `appendConversationRunEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1227) |
| `createConversationAgentRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1295) |
| `createConversationRunEventQueueController` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L956) |
| `finalizeConversationAgentRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1358) |
| `flushConversationRunEventBatches` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L746) |
| `flushConversationRunEventQueue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L854) |
| `getConversationRun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1153) |
| `isActiveConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L431) |
| `isAppendableConversationRunProjection` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L437) |
| `isCursorMismatchConversationRunAppendError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L421) |
| `isIgnorableConversationRunAppendError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L400) |
| `monitorConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L1169) |
| `parseAppendConversationRunEventsErrorBody` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L383) |
| `recoverConversationRunAppendExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L628) |
| `recoverConversationRunAppendFailure` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L558) |
| `recoverConversationRunCursorMismatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L487) |
| `resolveConversationRunTargets` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L48) |
| `resyncConversationRunAppendCursor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L448) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AppendConversationRunEventsError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L366) |
| `ConversationRunTerminalStateError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L354) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L143) |
| `AppendConversationRunEventsResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L255) |
| `ConversationAgentRunUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L324) |
| `ConversationRunAppendCursorResyncResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L151) |
| `ConversationRunAppendExecutionOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L163) |
| `ConversationRunAppendFailureOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L159) |
| `ConversationRunAppendRecoveryOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L155) |
| `ConversationRunBatchFlushOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L167) |
| `ConversationRunEventQueueController` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L177) |
| `ConversationRunProjection` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L80) |
| `ConversationRunQueueFlushOutcome` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L172) |
| `ConversationRunTargets` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L44) |
| `CreateConversationAgentRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L330) |
| `FinalizeConversationAgentRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L341) |
| `TerminalConversationRunStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L147) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAppendConversationRunEventsResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L268) |
| `getCompleteConversationRunResponseSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L239) |
| `getConversationRunProjectionSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L91) |
| `getConversationRunStatusSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L73) |
| `getConversationRunTargetsSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L33) |
| `getCreateConversationRunAcceptedSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/conversation/durable.ts#L216) |

### `veryfront/agent/invoke-agent-child-runs`

```ts
import { buildInvokeAgentChildRunLifecycleCustomEvent, buildInvokeAgentChildRunProgressEvents, buildInvokeAgentChildRunStateDelta } from "veryfront/agent/invoke-agent-child-runs";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `InvokeAgentChildRunLifecycleCustomEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L67) |
| `InvokeAgentChildRunLifecycleValueSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L28) |
| `InvokeAgentChildRunStateDeltaSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L50) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildInvokeAgentChildRunLifecycleCustomEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L131) |
| `buildInvokeAgentChildRunProgressEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L141) |
| `buildInvokeAgentChildRunStateDelta` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L115) |
| `publishInvokeAgentChildRunProgress` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L150) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `InvokeAgentChildRunLifecycleCustomEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L71) |
| `InvokeAgentChildRunLifecycleValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L32) |
| `InvokeAgentChildRunProgressEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L89) |
| `InvokeAgentChildRunProgressInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L75) |
| `InvokeAgentChildRunStateDelta` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L54) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getInvokeAgentChildRunLifecycleCustomEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L58) |
| `getInvokeAgentChildRunLifecycleValueSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L9) |
| `getInvokeAgentChildRunStateDeltaSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/child-run/invoke-agent-child-runs.ts#L36) |

### `veryfront/agent/request-auth-cache`

```ts
import { createRequestAuthCache } from "veryfront/agent/request-auth-cache";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createRequestAuthCache` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L14) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CachedRequestAuthResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L1) |
| `CreateRequestAuthCacheOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L3) |
| `RequestAuthCache` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/service/request-auth-cache.ts#L10) |

### `veryfront/agent/testing`

Agent Testing Utilities

```ts
import { assertCompleted, assertContains, assertDurableRunCanaryCompleted } from "veryfront/agent/testing";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/environment.ts#L10) |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L30) |
| `DEFAULT_LIVE_EVAL_ENDPOINT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/environment.ts#L11) |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L24) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertCompleted` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L197) |
| `assertContains` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L189) |
| `assertDurableRunCanaryCompleted` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L31) |
| `assertNoMalformedCreateFileToolCalls` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L74) |
| `assertToolCalled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L193) |
| `buildFailureSuffix` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L76) |
| `buildLiveEvalCaseMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L114) |
| `buildLiveEvalCaseTagSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L35) |
| `buildLiveEvalRequestBody` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/request.ts#L29) |
| `buildLiveEvalRuntimeSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L128) |
| `buildLiveEvalStatusSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L142) |
| `buildProgressLine` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L56) |
| `buildRuntimePerformanceSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts#L32) |
| `cancelLiveEvalInputRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L545) |
| `collectAssistantText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L67) |
| `containsOrderedSubsequence` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L88) |
| `containsSkillLoad` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L470) |
| `countStepStartedEvents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L474) |
| `createDurableRunCanaryApiClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L247) |
| `createDurableRunCanaryRunner` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L488) |
| `createFailedEvalResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L76) |
| `createLiveEvalApiClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L252) |
| `createLiveEvalCaseSupport` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L478) |
| `createLiveEvalConversation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L267) |
| `createLiveEvalProjectUploadFixture` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L317) |
| `createLiveEvalRelease` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L410) |
| `createPassedEvalResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L93) |
| `createPlainTextPdf` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/formatting.ts#L10) |
| `createSkippedEvalResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L59) |
| `deleteLiveEvalConversation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L295) |
| `deleteLiveEvalProjectFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L444) |
| `evaluateRuntimeConfidenceEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/preflight.ts#L8) |
| `findAssistantMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L41) |
| `getLiveEvalProjectFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L377) |
| `hasEveryLiveEvalTag` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L22) |
| `hasFinished` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L466) |
| `listOpenLiveEvalInputRequests` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L469) |
| `parseDurableRunCanaryRunSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L103) |
| `printRuntimeConfidencePreflight` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/preflight.ts#L33) |
| `printTestResults` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L168) |
| `resolveDurableRunCanaryEnvironment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/environment.ts#L12) |
| `resolveLiveEvalEnvironment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/environment.ts#L13) |
| `resolveLiveEvalRequestedCaseIds` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L80) |
| `runDurableRunCanaryCli` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/cli-runner.ts#L42) |
| `runLiveEvalCli` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L81) |
| `selectLiveEvalCases` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L54) |
| `stringifyUnknown` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/validation.ts#L55) |
| `submitLiveEvalInputResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L521) |
| `testAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L64) |
| `waitForOpenLiveEvalInputRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L494) |
| `withLiveEvalMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L152) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BuildLiveEvalCaseMetadataInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L18) |
| `BuildLiveEvalRequestBodyInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/request.ts#L16) |
| `DurableRunCanaryApiClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L237) |
| `DurableRunCanaryApiConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L6) |
| `DurableRunCanaryCase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L355) |
| `DurableRunCanaryCliCaseFactoryInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/cli-runner.ts#L14) |
| `DurableRunCanaryCreateRootRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L16) |
| `DurableRunCanaryEnvironment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/environment.ts#L2) |
| `DurableRunCanaryMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L41) |
| `DurableRunCanaryPreparedCase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L342) |
| `DurableRunCanaryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L331) |
| `DurableRunCanaryRunnerConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L361) |
| `DurableRunCanaryRunSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L45) |
| `DurableRunCanarySendUserMessageInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L21) |
| `DurableRunCanaryStartRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L26) |
| `LiveEvalApiClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L107) |
| `LiveEvalApiContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L7) |
| `LiveEvalCase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L33) |
| `LiveEvalCaseMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L2) |
| `LiveEvalCaseMetadataOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L12) |
| `LiveEvalCaseSelectionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L11) |
| `LiveEvalCaseSurface` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L3) |
| `LiveEvalCaseTagRule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/metadata.ts#L5) |
| `LiveEvalCliCaseFactoryInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L31) |
| `LiveEvalCliCaseGroups` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L25) |
| `LiveEvalContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L27) |
| `LiveEvalConversationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L22) |
| `LiveEvalCreateConversationInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L18) |
| `LiveEvalCreateReleaseInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L39) |
| `LiveEvalEnvironment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/environment.ts#L2) |
| `LiveEvalInputRequestInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L59) |
| `LiveEvalInputRequestRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L103) |
| `LiveEvalInputResponseValues` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L49) |
| `LiveEvalProjectFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L56) |
| `LiveEvalProjectFileInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L35) |
| `LiveEvalProjectFileReaderInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L61) |
| `LiveEvalProjectUploadFixtureInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L26) |
| `LiveEvalRequestBody` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/request.ts) |
| `LiveEvalRequestTimeoutInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L14) |
| `LiveEvalResultForPerformance` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts#L2) |
| `LiveEvalResultForReport` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/report.ts#L6) |
| `LiveEvalResultRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/result.ts#L2) |
| `LiveEvalRunnerConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L66) |
| `LiveEvalRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts) |
| `LiveEvalSubmitInputResponseInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L53) |
| `LiveEvalWaitForOpenInputRequestInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/api-client.ts#L43) |
| `PreparedLiveEvalInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L19) |
| `RunDurableRunCanaryCliInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/cli-runner.ts#L19) |
| `RunLiveEvalCliInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/cli-runner.ts#L47) |
| `RuntimeConfidencePreflightResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/preflight.ts#L2) |
| `RuntimePerformanceSummary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/performance.ts#L7) |
| `TestCase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L10) |
| `TestResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L30) |
| `TestSuite` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/agent-tester.ts#L50) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `durableRunCanaryRunnerInternals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L595) |
| `getDurableRunCanaryMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/durable-run-canaries/runner.ts#L32) |
| `liveEvalRunnerInternals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/testing/live-evals/runner.ts#L620) |

## Related

Reference modules:

- [`veryfront/chat`](./chat.md): Client-side chat UI for agents
- [`veryfront/tool`](./tool.md): Define tools for agents
- [`veryfront/provider`](./provider.md): Configure AI model providers
- [`veryfront/workflow`](./workflow.md): Orchestrate multi-agent workflows

User guides:

- [agents](../../guides/agents.md): Define and run agents
- [multi-agent](../../guides/multi-agent.md): Compose multi-agent systems
- [memory-and-streaming](../../guides/memory-and-streaming.md): Memory, streaming, and lifecycle
- [agent-service-runtime](../../guides/agent-service-runtime.md): Deploy agents as standalone services

Architecture:

- [05-agent-runtime](../../architecture/05-agent-runtime.md): Agent runtime, hosted runs, AI primitives, and skills
- [06-ag-ui-transport](../../architecture/06-ag-ui-transport.md): AG-UI transport contract
- [11-control-plane-channels](../../architecture/11-control-plane-channels.md): Control-plane channels
