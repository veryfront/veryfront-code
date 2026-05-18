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
| `allowedRemoteTools?` | `string[]` | Optional remote tool name allowlist. When set, only matching tools from |
| `maxSteps?` | `number` | Max tool-call iterations per request |
| `streaming?` | `boolean` | Enable streaming responses |
| `memory?` | `MemoryConfig` | Conversation memory settings |
| `middleware?` | `AgentMiddleware[]` | Execution middleware pipeline |
| `edge?` | `EdgeConfig` | Edge runtime configuration |
| `multimodal?` | <code>&#123; vision?: boolean; audio?: boolean &#125;</code> | Enable vision and/or audio |
| `allowedModels?` | `ModelString[]` | Restrict runtime model overrides to these "provider/model" strings. |
| `resolveModelTransport?` | `ModelTransportResolver` | Optional request-aware hook for overriding the resolved model runtime and |
| `resolveRuntimeState?` | `RuntimeStateResolver` | Optional step-boundary hook for refreshing the runtime system prompt and |
| `onToolResult?` | `ToolExecutionResultHandler` | Optional hook invoked after the runtime executes a configured local, |
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

| Name | Description |
|------|-------------|
| `AgUiDetachedStartAcceptedSchema` |  |
| `AgUiDetachedStartRequestSchema` |  |
| `AgUiRequestSchema` |  |
| `AgUiResumeSignalSchema` |  |
| `AppendConversationRunEventsResponseSchema` |  |
| `CompleteConversationRunResponseSchema` |  |
| `CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE` |  |
| `CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE` |  |
| `CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE` |  |
| `ConversationMessageRecordSchema` |  |
| `ConversationRecordSchema` |  |
| `ConversationRunEventSchema` |  |
| `ConversationRunProjectionSchema` |  |
| `ConversationRunStatusSchema` |  |
| `ConversationRunTargetsSchema` |  |
| `DEFAULT_FORK_RESPONSE_PROMISE_TIMEOUT_MS` |  |
| `DEFAULT_HOSTED_CHILD_AGENT_ID` |  |
| `DEFAULT_HOSTED_CHILD_EXCLUDED_TOOL_NAMES` |  |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS` |  |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS` |  |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS` |  |
| `DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS` |  |
| `DEFAULT_HOSTED_CHILD_REQUESTED_TOOL_COMPANIONS` |  |
| `DEFAULT_HOSTED_CHILD_SANDBOX_REQUIRED_CUE_PATTERN` |  |
| `DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS` |  |
| `DEFAULT_PROJECT_STEERING_PATHS` |  |
| `DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER` |  |
| `DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL` |  |
| `ExternalAgentWorkerRequestSnapshotSchema` |  |
| `ExternalAgentWorkerRunSchema` |  |
| `ExternalAgentWorkerSchema` |  |
| `ExternalAgentWorkerSessionSchema` |  |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE` |  |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY` |  |
| `FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER` |  |
| `HOSTED_CHILD_FORK_INSTRUCTIONS_BASE` |  |
| `HOSTED_CHILD_STREAM_TIMEOUT_TOKEN` |  |
| `InvokeAgentChildRunLifecycleCustomEventSchema` |  |
| `InvokeAgentChildRunLifecycleValueSchema` |  |
| `InvokeAgentChildRunStateDeltaSchema` |  |
| `KEEP_ROOT_ASSISTANT_VISIBLE_OWNER` |  |
| `LOAD_SKILL_CONTINUATION_REMINDER` |  |
| `LOAD_SKILL_CONTINUE_SAME_TURN` |  |
| `LOAD_SKILL_CONTINUE_SAME_TURN_NOW` |  |
| `LOAD_SKILL_DELEGATION_THRESHOLD` |  |
| `LOAD_SKILL_OVERRIDE_FORWARDING` |  |
| `LOAD_SKILL_ROOT_OWNERSHIP` |  |
| `LOAD_SKILL_TOOL_INTERSECTION` |  |
| `LOAD_SKILL_USE_ALLOWED_TOOLS` |  |
| `MAX_RUNTIME_SKILL_PROMPT_ENTRIES` |  |
| `NO_DELEGATION_NARRATION_UNLESS_ASKED` |  |
| `PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES` |  |
| `ROOT_OWNED_CHILD_RESULT_INSTRUCTION` |  |
| `RUNTIME_LOAD_SKILL_CONTINUATION_NOTE` |  |
| `RUNTIME_LOAD_SKILL_DESCRIPTION` |  |
| `RuntimeAgentContextItemSchema` |  |
| `RuntimeAgentIdSchema` |  |
| `RuntimeAgentProjectContextSchema` |  |
| `RuntimeAgentRunContextSchema` |  |
| `RuntimeAgentRunIdSchema` |  |
| `RuntimeAgentRunInvocationSchema` |  |
| `RuntimeAgentServiceIdSchema` |  |
| `RuntimeAgentSourceContextSchema` |  |
| `RuntimeAgentTargetKindSchema` |  |
| `RuntimeAgentToolCallIdSchema` |  |
| `RuntimeAgentToolNameSchema` |  |
| `RuntimeAgentToolSchema` |  |
| `RuntimeAgentValidatedClaimsSchema` |  |
| `RuntimeSkillFrontmatterSchema` |  |
| `SLASH_COMMAND_ARTIFACT_REMINDER` |  |
| `SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE` |  |

### Functions

| Name | Description |
|------|-------------|
| `addFirstTurnStarterIntentRootOwnershipReminder` |  |
| `addLoadSkillContinuationReminder` |  |
| `addSlashCommandArtifactReminder` |  |
| `agent` | Create an agent |
| `agentAsTool` | Wrap agent as callable tool |
| `appendConversationRunEvents` |  |
| `appendHostedChildMirrorChunk` |  |
| `appendMissingChildRunToolCalls` |  |
| `appendMissingChildRunToolResults` |  |
| `applyAgentProjectContextChange` |  |
| `applyDefaultResearchArtifactPath` |  |
| `applyPartToStreamedStepState` |  |
| `bootstrapAgentService` |  |
| `bootstrapConversationAgentRun` |  |
| `bootstrapHostedChildRun` |  |
| `buildAgentRunTraceAttributes` |  |
| `buildAgUiBrowserFinalizeResponse` |  |
| `buildAgUiSseTraceSignature` | Build a compact ordered event-type signature for regression checks. |
| `buildChatStreamChunkMessageMetadata` |  |
| `buildChildRunExecutionSnapshot` |  |
| `buildChildRunExhaustedStepBudgetErrorMessage` |  |
| `buildChildRunFailureResult` |  |
| `buildChildRunFailureSnapshot` |  |
| `buildChildRunResultCommon` |  |
| `buildChildRunResultSummary` |  |
| `buildChildRunSuccessResult` |  |
| `buildChildRunSuccessSnapshot` |  |
| `buildDefaultHostedChildForkToolSet` |  |
| `buildDefaultResearchArtifactPathReminder` |  |
| `buildDefaultResearchArtifactPaths` |  |
| `buildDetachedAgUiStartRequest` |  |
| `buildDetachedFallbackChunks` |  |
| `buildDetachedFallbackMessageState` |  |
| `buildExecuteToolTraceAttributes` |  |
| `buildFinalizedAgentRunTraceAttributes` |  |
| `buildFinalizedMessageFallbackChunks` |  |
| `buildFinalizedMessageState` |  |
| `buildForkRuntimeStepFromResponse` |  |
| `buildHostedChatRequestForwardedPropsFromRuntimeAgentInvocation` |  |
| `buildHostedChatRequestFromRuntimeAgentInvocation` |  |
| `buildHostedChatRequestInputFromRuntimeAgentInvocation` |  |
| `buildHostedChildCompletedLog` |  |
| `buildHostedChildConversationBody` |  |
| `buildHostedChildErrorLog` |  |
| `buildHostedChildExhaustedStepBudgetLog` |  |
| `buildHostedChildForkInstructions` |  |
| `buildHostedChildToolDescription` |  |
| `buildHostedDurableChildInvokeFailureResult` |  |
| `buildHostedDurableChildInvokeSuccessResult` |  |
| `buildHostedDurableChildInvokeTerminalFailureResult` |  |
| `buildInputRequestLifecycleDataEvent` |  |
| `buildInvokeAgentChildRunLifecycleCustomEvent` |  |
| `buildInvokeAgentChildRunProgressEvents` |  |
| `buildInvokeAgentChildRunStateDelta` |  |
| `buildInvokeAgentFollowupInstruction` |  |
| `buildInvokeAgentTraceAttributes` |  |
| `buildParsedHostedAgUiRequest` |  |
| `buildParsedHostedChatRequest` |  |
| `buildRecoveredStepParts` |  |
| `buildRootOwnedChildResultHint` |  |
| `buildRootOwnedChildRunResultHint` |  |
| `buildRootOwnedChildRunResultText` |  |
| `buildRootOwnedDelegatedFindingsInstruction` |  |
| `buildRuntimeAgentControlPlaneStreamRequestFromInvocation` |  |
| `buildRuntimeAvailableSkillsPromptBlock` |  |
| `buildRuntimeLoadedSkillResponse` |  |
| `buildRuntimeSkillDefinition` |  |
| `buildStarterIntentRootOwnershipBlockMessage` |  |
| `buildStarterIntentRootOwnershipReminder` |  |
| `buildStudioMcpHeaders` |  |
| `buildVeryfrontCloudRuntimeInstructions` |  |
| `cleanupAfterHostedChatExecutionFinalization` |  |
| `clearProjectAgentRuntimeRegistries` |  |
| `clientAllowsStudioMcp` |  |
| `cloneMirroredToolChunkState` |  |
| `closeChildRunExecutionBuffers` |  |
| `closeHostedChildReasoningSegment` |  |
| `closeHostedChildTextSegment` |  |
| `closeHostedMirroredOpenToolCalls` |  |
| `composeAbortSignals` |  |
| `computeOpenToolCalls` |  |
| `containsExactArtifactPathValue` |  |
| `convertAgentRuntimeMessagesToProviderMessages` |  |
| `convertCompactedProviderMessagesToChildForkRuntimeMessages` |  |
| `convertProviderMessagesToAgentRuntimeMessages` |  |
| `createAgentServiceRegistrationLifecycle` |  |
| `createAgentServiceRuntime` |  |
| `createAgentServiceServerRuntime` |  |
| `createAgUiBrowserChunkEncoder` |  |
| `createAgUiBrowserEncoderState` |  |
| `createAgUiBrowserFinalizeTracker` |  |
| `createAgUiBrowserResponseStream` |  |
| `createAgUiCancelHandler` |  |
| `createAgUiChatUiChunkBrowserEncoder` |  |
| `createAgUiChatUiTrackedBrowserResponse` |  |
| `createAgUiChunkEncoderBridge` |  |
| `createAgUiDetachedStartHandler` |  |
| `createAgUiHandler` |  |
| `createAgUiHandler` |  |
| `createAgUiHandler` |  |
| `createAgUiResumeHandler` |  |
| `createAgUiRunErrorEvent` |  |
| `createAgUiRuntimeBrowserResponse` |  |
| `createAgUiRuntimeChatStreamEncoder` |  |
| `createAgUiRuntimeContextMap` |  |
| `createAgUiRuntimeEventEncoder` |  |
| `createAgUiRuntimeHandler` |  |
| `createAgUiSseErrorResponse` |  |
| `createAgUiSseResponse` |  |
| `createAgUiTrackedBrowserResponse` |  |
| `createBootstrappedHostedChatExecutionRuntime` |  |
| `createChatUiMessageStreamFromDataStream` |  |
| `createConversationAgentRun` |  |
| `createConversationChildLifecycleAdapter` |  |
| `createConversationHostedLifecycleAdapter` |  |
| `createConversationHostedStreamLifecycleAdapter` |  |
| `createConversationHostedTerminalAdapter` |  |
| `createConversationMessage` |  |
| `createConversationRecord` |  |
| `createConversationRootRunContext` |  |
| `createConversationRootRunStartAdapter` |  |
| `createConversationRunChunkMirror` |  |
| `createConversationRunContext` |  |
| `createConversationRunEventQueueController` |  |
| `createConversationRunMirror` |  |
| `createConversationRunStreamMirror` |  |
| `createDefaultHostedChatRuntime` |  |
| `createDefaultHostedInvokeAgentTool` |  |
| `createDefaultHostedProjectSteeringRefresh` |  |
| `createDefaultResearchRunArtifactMirrorHandler` |  |
| `createDetachedRunShutdownLifecycle` |  |
| `createDetachedRunTracker` |  |
| `createExternalAgentWorkerClient` |  |
| `createForkRuntimeStreamMappingState` |  |
| `createForkRuntimeUserMessage` |  |
| `createFrameworkStreamState` |  |
| `createHostedAgentProjectSteering` |  |
| `createHostedAgentRunSpanController` |  |
| `createHostedAgentServiceRouteSet` |  |
| `createHostedAgentServiceRuntime` |  |
| `createHostedAgUiValidationErrorResponse` |  |
| `createHostedChatExecutionRuntime` |  |
| `createHostedChatExecutionRuntimeBootstrap` |  |
| `createHostedChatFinalizeDetachedBuildState` |  |
| `createHostedChatFinalizeResponseBuildState` |  |
| `createHostedChatRuntimeAgentAdapter` |  |
| `createHostedChatStreamFinalizationHooks` |  |
| `createHostedChildExecutionLogWriter` |  |
| `createHostedChildForkRunContext` |  |
| `createHostedChildInvokeTool` |  |
| `createHostedChildMirrorContext` |  |
| `createHostedChildPendingToolLifecycle` |  |
| `createHostedChildPendingToolLifecycleLogger` |  |
| `createHostedConversationRunChunkMirror` |  |
| `createHostedDurableChildForkRunContext` |  |
| `createHostedDurableChildInvokeTraceRecorder` |  |
| `createHostedFormInputTool` |  |
| `createHostedMirroredUiStream` |  |
| `createHostedProjectRemoteToolSource` |  |
| `createHostedProjectRemoteToolSources` |  |
| `createHostedProjectSteeringAdapter` |  |
| `createHostedRootRunLifecycleRuntimeAdapter` |  |
| `createHostedRuntimeStateResolver` |  |
| `createHostedServiceAuth` |  |
| `createInitialForkRuntimeMessages` |  |
| `createInputRequest` |  |
| `createLiveStudioMcpTools` |  |
| `createMemory` | Create memory (buffer, conversation, summary) |
| `createMirroredToolChunkState` |  |
| `createNodeAgentServiceRuntimeInfrastructure` |  |
| `createNodeVeryfrontCloudAgentServiceRuntime` |  |
| `createRedisMemory` | Create Redis-backed memory |
| `createRequestAuthCache` |  |
| `createRuntimeAgentDefinitionFromAgent` |  |
| `createRuntimeAgentFromMarkdownDefinition` |  |
| `createRuntimeAgentSystemMessages` |  |
| `createRuntimeLoadSkillTool` |  |
| `createRuntimeProjectFilesClient` |  |
| `createRuntimeProjectSkillLoader` |  |
| `createRuntimePromptBlock` |  |
| `createStreamedStepState` |  |
| `createToolExecutionDataEventBridgeStream` |  |
| `createToolResultPart` |  |
| `createVeryfrontCloudHostedChatExecutionRootRunOptions` |  |
| `createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions` |  |
| `createVeryfrontCloudRuntimeSystemMessages` |  |
| `createWorkflow` | Create sequential agent workflow |
| `dedupeChatUiMessageChunks` |  |
| `defineAgentService` | Define an agent service and expose a policy-neutral runtime shell. |
| `deriveAgUiForwardedConfig` |  |
| `deriveHostedAgUiChatContext` |  |
| `describeProjectAgentRuntimeAgentIdCandidates` |  |
| `discoverProjectAgentRuntime` |  |
| `dispatchConversationHostedStreamErrorState` |  |
| `dispatchConversationHostedTerminalState` |  |
| `doesProjectAgentRuntimeAgentMatchSource` |  |
| `encodeConversationRunEvents` |  |
| `ensureConversationProjectLink` |  |
| `evaluateSlashCommandArtifactPolicy` |  |
| `evaluateStarterIntentTurnPolicy` |  |
| `executeAgUiDetachedStart` |  |
| `executeDefaultHostedInvokeAgentTool` |  |
| `executeDurableHumanInputFlow` |  |
| `executeHostedChildForkRunContextStream` |  |
| `executeHostedChildForkStream` |  |
| `executeHostedChildForkToolInput` |  |
| `executeHostedChildForkWithPreparedTools` |  |
| `executeHostedDurableChatRun` |  |
| `executeHostedDurableChildFork` |  |
| `executeHostedLocalChildInvoke` |  |
| `expandAllowedRemoteToolNames` |  |
| `expandHostedChildRequestedTools` |  |
| `extractChatMessageMetadata` |  |
| `extractLatestUserText` |  |
| `extractStarterIntentId` |  |
| `fetchConversationRecord` |  |
| `fetchDefaultHostedProjectSteering` |  |
| `fetchLatestConversationUserText` |  |
| `filterAgentTraceAttributes` |  |
| `filterHostedChatRuntimeLocalTools` |  |
| `finalizeAgUiBrowserEvents` |  |
| `finalizeChildRunExecutionResources` |  |
| `finalizeConversationAgentRun` |  |
| `finalizeHostedChildForkCompletion` |  |
| `finalizeHostedChildForkRunContextResources` |  |
| `finalizeHostedDetached` |  |
| `finalizeHostedResponse` |  |
| `findLatestUserConversationMessageContext` |  |
| `flattenSystemInstructions` |  |
| `flushConversationRunEventBatches` |  |
| `flushConversationRunEventQueue` |  |
| `formatChildRunStreamPartError` |  |
| `formatRuntimeSkillMetadata` |  |
| `getAgent` | Get agent by ID |
| `getAgentRuntimeTextPart` |  |
| `getAgentRuntimeToolCallPart` |  |
| `getAgentRuntimeToolResultPart` |  |
| `getAgentsAsTools` | Get agents as tools (multi-agent) |
| `getAgUiChatUiMessageChunkMetadata` |  |
| `getAgUiChatUiMessageMetadataFromChunk` |  |
| `getAgUiChatUiMessageUsageMetadata` |  |
| `getAgUiSseEventsOfType` | Filter parsed AG-UI SSE events by normalized event type. |
| `getAgUiSseStringField` | Return a string field from a parsed AG-UI SSE event record. |
| `getAllAgentIds` | List registered agent IDs |
| `getChildRunSnapshotUsage` |  |
| `getConfirmedProjectContextSwitchId` |  |
| `getConversationRun` |  |
| `getConversationRunEventJsonByteLength` |  |
| `getEmptyHostedFinalizedMessageTerminalError` |  |
| `getForkRuntimeAllowedToolNames` |  |
| `getForwardedHostedModelId` |  |
| `getForwardedHostedRuntimeOverrides` |  |
| `getHostedChildWrittenArtifactPath` |  |
| `getHostedMirroredAbortErrorText` |  |
| `getHostedServiceTokenFromRequest` |  |
| `getHostedStreamErrorText` |  |
| `getInputRequest` |  |
| `getMaxForkRuntimeStepCount` |  |
| `getProjectAgentRuntimeAgentIdCandidates` |  |
| `getProjectSteeringMutation` |  |
| `getProviderNativeToolNames` |  |
| `getProviderToolProfile` |  |
| `getRuntimeAgentMarkdownDefinition` |  |
| `getRuntimeProjectFile` |  |
| `getRuntimeProjectFiles` |  |
| `getRuntimeProjectInstructions` |  |
| `getRuntimeProjectSkillCatalog` |  |
| `getRuntimeUploadUrl` |  |
| `getTextFromParts` | Extract text from multi-part message |
| `getToolArguments` | Extract parsed tool call args |
| `handleHostedChildForkFailure` |  |
| `handleHostedChildForkRunContextError` |  |
| `handleHostedChildForkStreamPart` |  |
| `hasArgs` | Check for parsed args on tool call |
| `hasInput` | Check for raw input on tool call |
| `initializeNodeAgentServiceOpenTelemetry` |  |
| `initializeNodeHostedAgentServiceOpenTelemetry` |  |
| `installAbortRejectionGuard` |  |
| `isAbortRejectionReason` |  |
| `isActiveConversationRunStatus` |  |
| `isAgentTraceAttributeValue` |  |
| `isAlreadyMirroredHostedChunk` |  |
| `isAppendableConversationRunProjection` |  |
| `isChildRunAbortError` |  |
| `isCursorMismatchConversationRunAppendError` |  |
| `isDurableMirroredOutputChunk` |  |
| `isHostedChildCreateFileAlreadyExistsResult` |  |
| `isHostedChildTerminalErrorCode` |  |
| `isHostedChildTextProjectArtifactPrompt` |  |
| `isHostedServiceAuthError` |  |
| `isIgnorableConversationRunAppendError` |  |
| `isResponseLike` |  |
| `isRuntimeAgentMarkdownAgent` |  |
| `isStarterIntentRootOwnershipRequired` |  |
| `isSuccessfulProjectSteeringMutationResult` |  |
| `listRuntimeBuiltinSkillReferenceFiles` |  |
| `listRuntimeBuiltinSkillReferences` |  |
| `loadAgentServiceEnvFiles` |  |
| `loadRuntimeAgentMarkdownDefinitionFromFile` |  |
| `loadRuntimeBuiltinSkillCatalog` |  |
| `mapAgUiRuntimeEventToForkParts` |  |
| `mapFrameworkEventToForkParts` |  |
| `mapHostedStreamPartToChatUiChunks` |  |
| `mapRuntimeStreamEventToAgUiBrowserEvents` |  |
| `mergeToolCallInput` |  |
| `mergeToolInputDelta` |  |
| `mirrorDefaultResearchRunArtifact` |  |
| `monitorConversationRunStatus` |  |
| `monitorHostedChildRunStatus` |  |
| `normalizeAgUiBrowserRuntimeRequest` |  |
| `normalizeAgUiMessages` |  |
| `normalizeAgUiRuntimeMessages` |  |
| `normalizeChatMessageMetadata` |  |
| `normalizeChatUiMessageChunk` |  |
| `normalizeChatUiMessageChunkToAgUiRuntimeEvent` |  |
| `normalizeChatUiMessageStream` |  |
| `normalizeConversationRunEvent` |  |
| `normalizeConversationRunEvents` |  |
| `normalizeEncodedConversationRunEvents` |  |
| `normalizeHostedChildArtifactPath` |  |
| `normalizeParsedHostedChatRequest` |  |
| `normalizeRuntimeSkillReferencePath` |  |
| `parseAgentServiceConfig` |  |
| `parseAgUiContextBoolean` |  |
| `parseAgUiContextJsonValue` |  |
| `parseAgUiContextNullableString` |  |
| `parseAgUiContextSchema` |  |
| `parseAgUiContextString` |  |
| `parseAgUiRequest` |  |
| `parseAgUiRequestOrError` |  |
| `parseAgUiRuntimeRequest` |  |
| `parseAgUiRuntimeRequestOrError` |  |
| `parseAgUiSseResponse` | Parse an AG-UI SSE `Response` into normalized events, text, tool starts, and terminal error state. |
| `parseAppendConversationRunEventsErrorBody` |  |
| `parseDataStreamSseEvents` |  |
| `parseHostedAgentServiceConfig` |  |
| `parseHostedChatRequestFromRequest` |  |
| `parseRuntimeAgentMarkdownDefinition` |  |
| `parseRuntimeAgentRunInvocation` |  |
| `parseRuntimeAgentRunInvocationHostedChatRequestFromRequest` |  |
| `parseRuntimeAgentRunInvocationOrError` |  |
| `parseRuntimeSkillDocument` |  |
| `parseRuntimeSkillMetadata` |  |
| `parseToolInputObject` |  |
| `persistConversationUserMessage` |  |
| `persistLatestConversationUserMessage` |  |
| `prepareAgentRuntimeMessagesFromUiMessages` |  |
| `prepareConversationRootRunContext` |  |
| `prepareConversationRootRunLifecycle` |  |
| `prepareConversationRunChunkEvents` |  |
| `prepareConversationRunExternalEvents` |  |
| `prepareConversationRunStreamEvents` |  |
| `prepareDefaultHostedChildForkRuntimeTools` |  |
| `prepareDefaultHostedChildForkSandboxToolSources` |  |
| `prepareDefaultHostedChildForkToolAssembly` |  |
| `prepareDefaultHostedChildForkToolSources` |  |
| `prepareHostedChatExecution` |  |
| `prepareHostedChatRuntimeCreationOptions` |  |
| `prepareHostedChatRuntimeMessages` |  |
| `prepareHostedChatRuntimeToolAssembly` |  |
| `prepareHostedChildForkRuntimeStepMessages` |  |
| `prepareHostedConversationRootRunContext` |  |
| `prepareVeryfrontCloudHostedChatExecution` |  |
| `publishInvokeAgentChildRunProgress` |  |
| `readRuntimeBuiltinDirectorySkill` |  |
| `readRuntimeBuiltinFlatSkill` |  |
| `readRuntimeBuiltinSkill` |  |
| `readRuntimeBuiltinSkillEntries` |  |
| `readRuntimeBuiltinSkillReferenceFile` |  |
| `recordMirroredToolChunkState` |  |
| `recoverConversationRunAppendExecution` |  |
| `recoverConversationRunAppendFailure` |  |
| `recoverConversationRunCursorMismatch` |  |
| `registerAgent` | Register agent for discovery |
| `resolveAgentServiceRegistrationInput` |  |
| `resolveConversationHostedStreamErrorState` |  |
| `resolveConversationHostedTerminalState` |  |
| `resolveConversationRunTargets` |  |
| `resolveForkRuntimeContinuationState` |  |
| `resolveForkStepResponse` |  |
| `resolveHostedChildForkRuntimeConfig` |  |
| `resolveHostedChildForkThinkingOverride` |  |
| `resolveHostedChildPromiseWithTimeout` |  |
| `resolveHostedChildStreamWatchdogState` |  |
| `resolveHostedChildTerminalErrorCode` |  |
| `resolveHostedDurableRunSetupErrorResponse` |  |
| `resolveHostedRuntimeRequestConfig` |  |
| `resolveHostedRuntimeThinkingOverride` |  |
| `resolveNodeAgentServiceTelemetryConfig` |  |
| `resolveNodeHostedAgentServiceTelemetryConfig` |  |
| `resolveRuntimeAgentDefinitionsDir` |  |
| `resolveRuntimeAgentMarkdownDefinitionFilePath` |  |
| `resolveRuntimeBuiltinSkillReferenceFilePath` |  |
| `resolveRuntimeBuiltinSkillsDir` |  |
| `resolveRuntimeClientProfile` |  |
| `resolveRuntimeMessageFileUrls` |  |
| `resolveSingleProjectAgentRuntimeAgentId` |  |
| `resyncConversationRunAppendCursor` |  |
| `runAgentRuntimeForkStep` |  |
| `runAgentServiceMain` |  |
| `runFrameworkForkStep` |  |
| `runHostedChildExecutionLifecycle` |  |
| `runHostedChildLifecycle` |  |
| `runHostedLifecycle` |  |
| `runHostedResponseStreamWithHeartbeat` |  |
| `runPreparedHostedChatExecutionDetached` |  |
| `sanitizeDefaultHostedChildRequestedTools` |  |
| `sanitizeHostedChildRequestedTools` |  |
| `sanitizeProviderToolSchema` |  |
| `selectDefaultHostedChildForkRuntimeTools` |  |
| `selectHostedChildForkRuntimeTools` |  |
| `selectProviderCompatibleToolNames` |  |
| `selectProviderCompatibleTools` |  |
| `shouldBlockHostedChildSameTurnRetry` |  |
| `shouldContinueForkRuntimeStep` |  |
| `shouldFailEmptyHostedFinalizedMessage` |  |
| `shouldInjectDefaultResearchArtifactPath` |  |
| `shouldPruneSandboxToolsFromHostedChildRequest` |  |
| `shouldReinforceLoadSkillContinuation` |  |
| `shouldRetryCreateResearchArtifactAsUpdate` |  |
| `shouldSkipHostedChildTerminalPersistence` |  |
| `startAgentRuntimeFork` |  |
| `startAgentRuntimeForkWithHostTools` |  |
| `startAgentService` |  |
| `startAgentServiceRuntime` |  |
| `startAgentServiceServer` |  |
| `startConversationRootRun` |  |
| `startHostedChildForkRuntimeWithHostTools` |  |
| `startNodeAgentService` |  |
| `startNodeAgentServiceServer` |  |
| `startNodeHostedAgentService` |  |
| `startNodeVeryfrontCloudAgentService` |  |
| `streamDataStreamEvents` |  |
| `streamPreparedHostedChatExecutionToAgUiResponse` |  |
| `stringifyAgUiSseEvent` | Stringify an AG-UI SSE event or fallback value for diagnostics. |
| `stripLeadingEmptyObjectPlaceholder` |  |
| `summarizeChildRunResultText` |  |
| `summarizeChildRunResultValue` |  |
| `throwIfChildRunAborted` |  |
| `toChildRunToolInputRecord` |  |
| `toConversationHostedTerminalState` |  |
| `toConversationRunStreamEvent` |  |
| `toHostedChatExecutionFinalState` |  |
| `toMirroredHostedStreamPart` |  |
| `updateDefaultResearchArtifacts` |  |
| `validateRuntimeAgentTargetSelection` |  |
| `veryfrontMcpServer` |  |
| `waitForDurableHumanInputResolution` |  |
| `waitForHumanInput` |  |
| `withDefaultResearchArtifactPath` |  |
| `withHostedChildRerunnableFileWriteFallbacks` |  |
| `withHostedChildStreamIdleTimeout` |  |
| `withRootOwnedChildResultHint` |  |
| `withRuntimeToolInventory` |  |
| `wrapHostedChildProjectSwitchTool` |  |
| `wrapHostedChildSteeringMutationTool` |  |
| `writeHostedChildExecutionLogEntry` |  |

### Classes

| Name | Description |
|------|-------------|
| `AgentRuntime` | Agent execution runtime |
| `AgentRuntimeMessageConversionError` |  |
| `AppendConversationRunEventsError` |  |
| `BufferMemory` | In-memory message buffer |
| `ConversationMemory` | Full conversation history |
| `ConversationRunEventEncoder` |  |
| `ConversationRunTerminalStateError` |  |
| `HostedChildStreamIdleTimeoutError` |  |
| `HostedChildTerminalStateError` |  |
| `HostedServiceAuthError` |  |
| `HumanInputResumeError` |  |
| `InvalidHumanInputResultError` |  |
| `RedisMemory` | Redis-backed persistent memory |
| `RunAlreadyExistsError` |  |
| `RunCancelledError` |  |
| `RunNotActiveError` |  |
| `RunResumeSessionManager` |  |
| `RuntimeProjectFilesApiAuthError` |  |
| `SummaryMemory` | Compresses old messages into summaries |
| `WaitConflictError` |  |
| `WaitNotPendingError` |  |

### Types

| Name | Description |
|------|-------------|
| `AbortRejectionEvent` |  |
| `AbortRejectionEventTarget` |  |
| `AbortRejectionGuardLogger` |  |
| `AbortRejectionProcessTarget` |  |
| `ActiveConversationRunStatus` |  |
| `Agent` | `agent()` return type |
| `AgentConfig` | Agent configuration |
| `AgentContext` | Agent handler context |
| `AgentContract` | Framework-owned agent service contract. |
| `AgentMessage` |  |
| `AgentMiddleware` | Agent execution middleware |
| `AgentPushRuntimeServiceRest` |  |
| `AgentRegistry` |  |
| `AgentResponse` | Agent execution response |
| `AgentRuntimeForkStepRunner` |  |
| `AgentRuntimeMessage` |  |
| `AgentRuntimeMessagePart` |  |
| `AgentServiceBootstrapExit` |  |
| `AgentServiceConfig` |  |
| `AgentServiceConfigInput` |  |
| `AgentServiceCorsConfig` |  |
| `AgentServiceDefinition` | Type-preserving service definition for request-native agent service runtimes. |
| `AgentServiceEnvFileLoadOptions` |  |
| `AgentServiceEnvFileLoadResult` |  |
| `AgentServiceOptions` |  |
| `AgentServicePreparedExecution` |  |
| `AgentServiceProcessTarget` |  |
| `AgentServiceRegistrationConfig` |  |
| `AgentServiceRegistrationLifecycle` |  |
| `AgentServiceRegistrationLogger` |  |
| `AgentServiceRegistrationMode` |  |
| `AgentServiceRegistryContract` | Multi-agent service contract. Framework services route to |
| `AgentServiceRoute` |  |
| `AgentServiceRouteMethod` | Host-facing server config for the agent service runtime shell. |
| `AgentServiceRuntimeBundle` |  |
| `AgentServiceRuntimeConfig` |  |
| `AgentServiceRuntimeLogger` |  |
| `AgentServiceRuntimeTrace` |  |
| `AgentServiceServer` |  |
| `AgentServiceServerConfig` |  |
| `AgentServiceServerLifecycle` |  |
| `AgentServiceSingleAgentContract` | Single-agent convenience accepted by `defineAgentService()`. Implementations |
| `AgentServiceTraceContext` |  |
| `AgentServiceTraceContextGetter` |  |
| `AgentStatus` | Agent status (idle, running, etc.) |
| `AgentStreamResult` | Streaming result (`.toDataStreamResponse()`) |
| `AgentTraceAttributes` |  |
| `AgentTraceAttributeValue` |  |
| `AgentTraceUsage` |  |
| `AgUiBeforeStream` |  |
| `AgUiBeforeStreamContext` |  |
| `AgUiBeforeStreamMessageInput` |  |
| `AgUiBeforeStreamResult` |  |
| `AgUiBrowserChunkEncoder` |  |
| `AgUiBrowserEncodedEvent` |  |
| `AgUiBrowserEncoderState` |  |
| `AgUiBrowserFinalizeTracker` |  |
| `AgUiBrowserResponseEncoder` |  |
| `AgUiBrowserResponseExecution` |  |
| `AgUiBrowserResponseRequestState` |  |
| `AgUiBrowserRunFinishedMetadata` |  |
| `AgUiCancelHandlerOptions` |  |
| `AgUiChatUiChunkBrowserEncoder` |  |
| `AgUiChunkEncoderBridge` |  |
| `AgUiContextItem` |  |
| `AgUiDetachedStartAccepted` |  |
| `AgUiDetachedStartHandlerOptions` |  |
| `AgUiDetachedStartRequest` |  |
| `AgUiForwardedConfigOptions` |  |
| `AgUiHandlerConfigWithAgent` |  |
| `AgUiHandlerOptions` |  |
| `AgUiInjectedTool` |  |
| `AgUiRequest` |  |
| `AgUiResumeHandlerOptions` |  |
| `AgUiResumeSignal` |  |
| `AgUiResumeValue` |  |
| `AgUiRuntimeChatStreamEncoder` |  |
| `AgUiRuntimeChatStreamEncoderState` |  |
| `AgUiRuntimeContextItem` |  |
| `AgUiRuntimeEventEncoder` |  |
| `AgUiRuntimeHandlerConfig` |  |
| `AgUiRuntimeHandlerConfigWithAgent` |  |
| `AgUiRuntimeHandlerExecute` |  |
| `AgUiRuntimeHandlerExecuteInput` |  |
| `AgUiRuntimeHandlerOptions` |  |
| `AgUiRuntimeInjectedTool` |  |
| `AgUiRuntimeLifecycleContext` |  |
| `AgUiRuntimeMessage` |  |
| `AgUiRuntimeRequest` |  |
| `AgUiRuntimeStreamEvent` |  |
| `AgUiSseEvent` |  |
| `AgUiSseEventType` | Normalized AG-UI runtime event type value. |
| `AgUiSseProgressSnapshot` | Progress snapshot emitted while parsing an AG-UI SSE response. |
| `AppendConversationRunEventsResponse` |  |
| `AppendExternalAgentWorkerRunEventsInput` |  |
| `BootstrapAgentServiceOptions` |  |
| `BootstrapConversationAgentRunResult` |  |
| `BootstrapHostedChildRunInput` |  |
| `BootstrapHostedChildRunResult` |  |
| `BootstrappedHostedChatExecutionRuntime` |  |
| `BuildChatStreamChunkMessageMetadataInput` |  |
| `BuildDetachedFallbackChunksInput` |  |
| `BuildDetachedFallbackMessageInput` |  |
| `BuildFinalizedMessageFallbackChunksInput` |  |
| `BuildFinalizedMessageStateInput` |  |
| `BuildHostedDurableChildInvokeFailureResultInput` |  |
| `BuildParsedHostedAgUiRequestOptions` |  |
| `CachedRequestAuthResult` |  |
| `ChatMessageMetadata` |  |
| `ChatMessageMetadataUsage` |  |
| `ChatUiMessageChunk` |  |
| `ChatUiMessageStreamFinish` |  |
| `ChatUiMessageStreamFinishPart` |  |
| `ChatUiMessageStreamOptions` |  |
| `ChildRunAudit` |  |
| `ChildRunAuditToolCall` |  |
| `ChildRunAuditToolResult` |  |
| `ChildRunExecutionBufferCleanupInput` |  |
| `ChildRunExecutionResourceFinalizeInput` |  |
| `ChildRunExecutionResult` |  |
| `ChildRunExecutionSnapshot` |  |
| `ChildRunExecutionUsage` |  |
| `ChildRunResultCommon` |  |
| `ChildRunToolCallSnapshot` |  |
| `ChildRunToolResultSnapshot` |  |
| `ClaimExternalAgentWorkerRunInput` |  |
| `CloseHostedMirroredOpenToolCallsInput` |  |
| `CompleteExternalAgentWorkerRunInput` |  |
| `ConversationAgentRunUsage` |  |
| `ConversationChildLifecycleContext` |  |
| `ConversationControlPlaneResponseError` |  |
| `ConversationHostedLifecycleFinalizeInput` |  |
| `ConversationHostedTerminalAdapter` |  |
| `ConversationHostedTerminalRuntimeAdapter` |  |
| `ConversationHostedTerminalStateInput` |  |
| `ConversationHostedTerminalStateResolution` |  |
| `ConversationMessageRecord` |  |
| `ConversationRecord` |  |
| `ConversationRootRunContext` |  |
| `ConversationRootRunDescriptor` |  |
| `ConversationRootRunLifecycle` |  |
| `ConversationRunAppendCursorResyncResult` |  |
| `ConversationRunAppendExecutionOutcome` |  |
| `ConversationRunAppendFailureOutcome` |  |
| `ConversationRunAppendRecoveryOutcome` |  |
| `ConversationRunBatchFlushOutcome` |  |
| `ConversationRunChunkMirror` |  |
| `ConversationRunChunkMirrorApiOptions` |  |
| `ConversationRunChunkMirrorOptions` |  |
| `ConversationRunChunkMirrorPrepareChunkEventsInput` |  |
| `ConversationRunChunkMirrorPreparedChunk` |  |
| `ConversationRunChunkMirrorPreparedEvents` |  |
| `ConversationRunChunkMirrorPrepareExternalEventsInput` |  |
| `ConversationRunChunkMirrorQueueOptions` |  |
| `ConversationRunContext` |  |
| `ConversationRunEvent` |  |
| `ConversationRunEventQueueController` |  |
| `ConversationRunMirror` |  |
| `ConversationRunMirrorRetryScheduledState` |  |
| `ConversationRunMirrorSnapshot` |  |
| `ConversationRunMirrorStoppedState` |  |
| `ConversationRunProjection` |  |
| `ConversationRunQueueFlushOutcome` |  |
| `ConversationRunStreamMirror` |  |
| `ConversationRunTargets` |  |
| `CreateAgentServiceRegistrationLifecycleOptions` |  |
| `CreateAgentServiceRuntimeOptions` |  |
| `CreateAgentServiceServerRuntimeOptions` |  |
| `CreateAgUiBrowserChunkEncoderOptions` |  |
| `CreateAgUiBrowserFinalizeTrackerOptions` |  |
| `CreateAgUiBrowserResponseStreamInput` |  |
| `CreateAgUiChatUiChunkBrowserEncoderOptions` |  |
| `CreateAgUiChatUiTrackedBrowserResponseInput` |  |
| `CreateAgUiChunkEncoderBridgeOptions` |  |
| `CreateAgUiRuntimeBrowserResponseInput` |  |
| `CreateAgUiRuntimeChatStreamEncoderOptions` |  |
| `CreateAgUiRuntimeEventEncoderOptions` |  |
| `CreateAgUiTrackedBrowserResponseInput` |  |
| `CreateBootstrappedHostedChatExecutionRuntimeInput` |  |
| `CreateConversationHostedLifecycleAdapterOptions` |  |
| `CreateConversationHostedTerminalAdapterOptions` |  |
| `CreateDefaultHostedChatRuntimeContextInput` |  |
| `CreateDefaultHostedChatRuntimeOptions` |  |
| `CreateDefaultHostedProjectSteeringRefreshOptions` |  |
| `CreateHostedAgentRunSpanControllerInput` |  |
| `CreateHostedAgentServiceRuntimeOptions` |  |
| `CreateHostedChatExecutionRuntimeBootstrapInput` |  |
| `CreateHostedChatExecutionRuntimeInput` |  |
| `CreateHostedChildInvokeToolOptions` |  |
| `CreateHostedMirroredUiStreamInput` |  |
| `CreateHostedProjectRemoteToolSourceInput` |  |
| `CreateHostedProjectRemoteToolSourcesInput` |  |
| `CreateHostedRootRunLifecycleRuntimeAdapterInput` |  |
| `CreateHostedRuntimeStateResolverOptions` |  |
| `CreateNodeAgentServiceRuntimeInfrastructureOptions` |  |
| `CreateNodeHostedAgentServiceRuntimeInfrastructureOptions` |  |
| `CreateRequestAuthCacheOptions` |  |
| `CreateRuntimeAgentSystemMessagesInput` |  |
| `CreateVeryfrontCloudPreparedHostedChatExecutionRuntimeOptionsInput` |  |
| `CreateVeryfrontCloudRuntimeSystemMessagesInput` |  |
| `DefaultHostedChatRuntimeConfig` |  |
| `DefaultHostedChatRuntimeCreationOptions` |  |
| `DefaultHostedChatRuntimeLogger` |  |
| `DefaultHostedChatRuntimeProjectSwitchInput` |  |
| `DefaultHostedChatRuntimeSteeringMutationInput` |  |
| `DefaultHostedChatRuntimeSystemRefreshInput` |  |
| `DefaultHostedChatRuntimeTaskContext` |  |
| `DefaultHostedChildForkRuntimeToolPreparationResult` |  |
| `DefaultHostedChildForkToolAssemblyResult` |  |
| `DefaultHostedChildForkToolAssemblySourceResult` |  |
| `DefaultHostedChildForkToolSourcesResult` |  |
| `DefaultHostedInvokeAgentConfig` |  |
| `DefaultHostedInvokeAgentContext` |  |
| `DefaultHostedInvokeAgentInput` |  |
| `DefaultHostedInvokeAgentLogger` |  |
| `DefaultHostedInvokeAgentProjectRefresh` |  |
| `DefaultHostedInvokeAgentToolOptions` |  |
| `DefaultHostedInvokeAgentToolResult` |  |
| `DefaultHostedInvokeAgentTrace` |  |
| `DefaultHostedInvokeAgentTraceAttributes` |  |
| `DefaultHostedProjectSteeringFetchers` |  |
| `DefaultHostedProjectSteeringRefreshLogger` |  |
| `DefaultHostedProjectSteeringRefreshLookup` |  |
| `DefaultResearchArtifactContext` |  |
| `DefaultResearchArtifactLogger` |  |
| `DefaultResearchArtifactPaths` |  |
| `DefaultResearchArtifacts` |  |
| `DerivedHostedAgUiChatContext` |  |
| `DetachedFallbackMessageState` |  |
| `DetachedRunDrainResult` |  |
| `DetachedRunShutdownLifecycle` |  |
| `DetachedRunShutdownLifecycleOptions` |  |
| `DetachedRunShutdownLogger` |  |
| `DetachedRunTracker` |  |
| `DetachedRunTrackerOptions` |  |
| `DiscoverProjectAgentRuntimeInput` |  |
| `DurableHumanInputFlowResult` |  |
| `DurableRunSink` | Transport-neutral durable run lifecycle sink for agent-service adoption work. |
| `EdgeConfig` | Agent-to-agent edge config |
| `ExecuteAgUiDetachedStartInput` |  |
| `ExecuteDurableHumanInputFlowOptions` |  |
| `ExecuteHostedChildForkRunContextStreamInput` |  |
| `ExecuteHostedChildForkStreamInput` |  |
| `ExecuteHostedChildForkToolInputOptions` |  |
| `ExecuteHostedChildForkWithPreparedToolsInput` |  |
| `ExecuteHostedDurableChatRunInput` |  |
| `ExecuteHostedDurableChildForkInput` |  |
| `ExecuteHostedLocalChildInvokeInput` |  |
| `ExternalAgentWorker` |  |
| `ExternalAgentWorkerClient` |  |
| `ExternalAgentWorkerClientOptions` |  |
| `ExternalAgentWorkerRequestSnapshot` |  |
| `ExternalAgentWorkerRun` |  |
| `ExternalAgentWorkerSession` |  |
| `FetchDefaultHostedProjectSteeringInput` |  |
| `FinalizedMessageState` |  |
| `FinalizeHostedChildForkRunContextResourcesInput` |  |
| `FinalizeHostedDetachedOptions` |  |
| `FinalizeHostedResponseOptions` |  |
| `ForkPart` |  |
| `ForkRecoveredPartsState` |  |
| `ForkRuntimeContinuationPromptResolver` |  |
| `ForkRuntimeStep` |  |
| `ForkRuntimeStepPreparer` |  |
| `ForkRuntimeStreamLogger` |  |
| `ForkRuntimeStreamMappingState` |  |
| `ForkRuntimeStreamResult` |  |
| `FormInputToolInput` |  |
| `FrameworkStreamState` |  |
| `HandleHostedChildForkFailureInput` |  |
| `HandleHostedChildForkRunContextErrorInput` |  |
| `HostedAgentProjectSteering` |  |
| `HostedAgentProjectSteeringLogger` |  |
| `HostedAgentProjectSteeringOptions` |  |
| `HostedAgentProjectSteeringOptionsData` |  |
| `HostedAgentRunSpan` |  |
| `HostedAgentRunSpanController` |  |
| `HostedAgentRunSpanFinalState` |  |
| `HostedAgentRunTracer` |  |
| `HostedAgentServiceActiveSpanAttributes` |  |
| `HostedAgentServiceConfig` |  |
| `HostedAgentServiceConfigInput` |  |
| `HostedAgentServiceDetachedCleanupInput` |  |
| `HostedAgentServiceDetachedExecutionInput` |  |
| `HostedAgentServiceEnvFileLoadOptions` |  |
| `HostedAgentServiceEnvFileLoadResult` |  |
| `HostedAgentServiceRouteSet` |  |
| `HostedAgentServiceRouteSetOptions` |  |
| `HostedAgentServiceRoutesLogger` |  |
| `HostedAgentServiceRoutesTrace` |  |
| `HostedAgentServiceRuntimeBundle` |  |
| `HostedAgentServiceRuntimeConfig` |  |
| `HostedAgentServiceRuntimeLogger` |  |
| `HostedAgentServiceRuntimeTrace` |  |
| `HostedAgentServiceStreamExecutionInput` |  |
| `HostedAgUiChatForwardedConfig` |  |
| `HostedChatExecutionLifecycleAdapter` |  |
| `HostedChatExecutionPreparationInput` |  |
| `HostedChatExecutionPreparationResult` |  |
| `HostedChatExecutionPreparationRootRunOptions` |  |
| `HostedChatExecutionRootStreamWatchdog` |  |
| `HostedChatExecutionRunContext` |  |
| `HostedChatExecutionRuntime` |  |
| `HostedChatExecutionRuntimeBootstrap` |  |
| `HostedChatExecutionRuntimeLogger` |  |
| `HostedChatProjectAccessError` |  |
| `HostedChatProjectAccessResult` |  |
| `HostedChatRequest` |  |
| `HostedChatRequestInput` |  |
| `HostedChatRequestPrincipal` |  |
| `HostedChatRuntimeAgent` |  |
| `HostedChatRuntimeAgentAdapterInput` |  |
| `HostedChatRuntimeAgentAdapterRunner` |  |
| `HostedChatRuntimeAgentAdapterWarning` |  |
| `HostedChatRuntimeAllowedToolNames` |  |
| `HostedChatRuntimeCreationOptions` |  |
| `HostedChatRuntimeCreationPreparationInput` |  |
| `HostedChatRuntimeCreationPreparationResult` |  |
| `HostedChatRuntimeCreationResult` |  |
| `HostedChatRuntimeFinishPart` |  |
| `HostedChatRuntimeInstructionsInput` |  |
| `HostedChatRuntimeOnFinishEvent` |  |
| `HostedChatRuntimePreparationRootRunContext` |  |
| `HostedChatRuntimePreparationSteering` |  |
| `HostedChatRuntimeProjectSteering` |  |
| `HostedChatRuntimeStreamInput` |  |
| `HostedChatRuntimeStreamResult` |  |
| `HostedChatRuntimeToolAssemblyContext` |  |
| `HostedChatRuntimeToolAssemblyResult` |  |
| `HostedChatRuntimeToUiMessageStreamOptions` |  |
| `HostedChildChunkMirror` |  |
| `HostedChildConversationBodyInput` |  |
| `HostedChildExecutionLifecycleOptions` |  |
| `HostedChildExecutionLifecycleResult` |  |
| `HostedChildExecutionLogEntry` |  |
| `HostedChildExecutionLogLevel` |  |
| `HostedChildExecutionLogWriter` |  |
| `HostedChildFileWriteFallbackLogger` |  |
| `HostedChildFileWriteFallbackTool` |  |
| `HostedChildFileWriteFallbackToolExecute` |  |
| `HostedChildForkExecutionInstrumentation` |  |
| `HostedChildForkInstructionsContext` |  |
| `HostedChildForkPendingToolLifecycle` |  |
| `HostedChildForkRunContext` |  |
| `HostedChildForkRunContextInput` |  |
| `HostedChildForkRuntimeConfig` |  |
| `HostedChildForkRuntimeStepMessages` |  |
| `HostedChildForkRuntimeStepSystemResolver` |  |
| `HostedChildForkRuntimeToolSelectionResult` |  |
| `HostedChildForkStreamHandlingState` |  |
| `HostedChildForkStreamLogger` |  |
| `HostedChildForkStreamMirrorContext` |  |
| `HostedChildForkStreamState` |  |
| `HostedChildForkStreamTraceInput` |  |
| `HostedChildForkToolCallSnapshot` |  |
| `HostedChildForkToolInput` |  |
| `HostedChildForkToolResultSnapshot` |  |
| `HostedChildForkToolSourcesLogger` |  |
| `HostedChildInvokeFailure` |  |
| `HostedChildLifecycleAdapter` |  |
| `HostedChildLifecycleRunnerOptions` |  |
| `HostedChildLifecycleRunResult` |  |
| `HostedChildLifecycleTerminalState` |  |
| `HostedChildMirrorContext` |  |
| `HostedChildMirrorPart` |  |
| `HostedChildMirrorState` |  |
| `HostedChildPendingToolCallPhase` |  |
| `HostedChildPendingToolCallState` |  |
| `HostedChildPendingToolLifecycleCloseLog` |  |
| `HostedChildPendingToolLifecycleCloseReason` |  |
| `HostedChildPendingToolLifecycleInput` |  |
| `HostedChildPendingToolLifecycleLogContext` |  |
| `HostedChildPendingToolLifecycleLogger` |  |
| `HostedChildPendingToolLifecycleLogWriter` |  |
| `HostedChildPendingToolLifecycleUnknownToolLog` |  |
| `HostedChildProjectSwitchHandler` |  |
| `HostedChildRequestedToolsInput` |  |
| `HostedChildRunIdentifiers` |  |
| `HostedChildRunStatusMonitor` |  |
| `HostedChildSameTurnRetryBlockSignal` |  |
| `HostedChildSteeringMutationHandler` |  |
| `HostedChildStreamWatchdogPhase` |  |
| `HostedChildStreamWatchdogState` |  |
| `HostedChildTerminalErrorCode` |  |
| `HostedChildTerminalStatus` |  |
| `HostedChildWrittenArtifactPathInput` |  |
| `HostedConversationRootRunContext` |  |
| `HostedConversationRootRunState` |  |
| `HostedConversationRunChunkMirrorInstrumentation` |  |
| `HostedConversationRunChunkMirrorOptions` |  |
| `HostedConversationRunChunkMirrorTraceAttributes` |  |
| `HostedDetachedFinalizationState` |  |
| `HostedDurableChildBootstrapCallbacks` |  |
| `HostedDurableChildBootstrapContext` |  |
| `HostedDurableChildExecutionOptions` |  |
| `HostedDurableChildForkRunContext` |  |
| `HostedDurableChildForkRunContextInput` |  |
| `HostedDurableChildInvokeResult` |  |
| `HostedDurableChildInvokeTraceBase` |  |
| `HostedDurableChildInvokeTraceInput` |  |
| `HostedDurableChildInvokeTraceOverrides` |  |
| `HostedDurableChildInvokeTraceRecorder` |  |
| `HostedDurableChildRuntimeDependencies` |  |
| `HostedDurableChildSetupFailure` |  |
| `HostedDurableChildSuccess` |  |
| `HostedDurableChildTerminalFailure` |  |
| `HostedDurableRunAccepted` |  |
| `HostedDurableRunAuthErrorResponse` |  |
| `HostedDurableRunLogger` |  |
| `HostedDurableRunSetupErrorStatusCode` |  |
| `HostedDurableRunStartCleanupInput` |  |
| `HostedDurableRunStartExecutionInput` |  |
| `HostedFormInputToolContext` |  |
| `HostedLifecycleAdapter` |  |
| `HostedLifecycleExecution` |  |
| `HostedLifecycleRunnerOptions` |  |
| `HostedLifecycleRunResult` |  |
| `HostedLifecycleTerminalState` |  |
| `HostedLocalChildInvokeTraceRecorder` |  |
| `HostedMirroredOpenToolCallLogger` |  |
| `HostedMirroredUiStreamLogger` |  |
| `HostedMirroredUiStreamWatchdog` |  |
| `HostedProjectRemoteToolSourceMutationHandler` |  |
| `HostedProjectRemoteToolSourcePrepareToolInput` |  |
| `HostedProjectRemoteToolSourceProjectSwitchHandler` |  |
| `HostedProjectRemoteToolSourceRetryPolicy` |  |
| `HostedProjectSkillIdsContext` |  |
| `HostedProjectSteeringAdapter` |  |
| `HostedProjectSteeringAdapterOptions` |  |
| `HostedProjectSteeringLogger` |  |
| `HostedResponseFinalizationState` |  |
| `HostedResponseStreamHeartbeat` |  |
| `HostedResponseStreamHeartbeatState` |  |
| `HostedResponseStreamWriter` |  |
| `HostedRootRunLifecycleRuntimeAdapter` |  |
| `HostedRuntimeRequestConfigAgent` |  |
| `HostedRuntimeRequestConfigRequest` |  |
| `HostedRuntimeStateResolverContext` |  |
| `HostedRuntimeStateResolverInput` |  |
| `HostedRuntimeStateResolverResult` |  |
| `HostedRuntimeSystemRefresh` |  |
| `HostedRuntimeSystemRefreshInput` |  |
| `HostedServiceAuth` |  |
| `HostedServiceAuthConfig` |  |
| `HostedServiceAuthenticatedRequest` |  |
| `HostedServiceAuthErrorCode` |  |
| `HostedServiceAuthFetch` |  |
| `HostedServiceAuthLogger` |  |
| `HostedServiceAuthOptions` |  |
| `HostedServiceAuthTrace` |  |
| `HostedServiceJwtError` |  |
| `HostedServiceJwtResult` |  |
| `HostedServiceProjectAccessError` |  |
| `HostedServiceProjectAccessResult` |  |
| `HostedStreamPartForUiChunkMapping` |  |
| `HostedStreamTerminalError` |  |
| `HostedTerminalError` |  |
| `HostedUiChunkMappingOptions` |  |
| `HumanInputField` |  |
| `HumanInputFieldInput` |  |
| `HumanInputOption` |  |
| `HumanInputPendingRequest` |  |
| `HumanInputRequest` |  |
| `HumanInputRequestInput` |  |
| `HumanInputResult` |  |
| `HumanInputResumeValue` |  |
| `InitializeNodeAgentServiceTelemetryOptions` |  |
| `InitializeNodeHostedAgentServiceTelemetryOptions` |  |
| `InputRequestOutput` |  |
| `InstallAbortRejectionGuardOptions` |  |
| `InstalledAbortRejectionGuard` |  |
| `InvokeAgentChildRunLifecycleCustomEvent` |  |
| `InvokeAgentChildRunLifecycleValue` |  |
| `InvokeAgentChildRunProgressEvent` |  |
| `InvokeAgentChildRunProgressInput` |  |
| `InvokeAgentChildRunStateDelta` |  |
| `LiveStudioMcpToolsOptions` |  |
| `LoadRuntimeAgentMarkdownDefinitionFromFileInput` |  |
| `Memory` | Memory interface |
| `MemoryConfig` | Memory creation config |
| `MemoryPersistence` | Memory storage backend |
| `MemoryStats` | Memory usage stats |
| `MessagePart` | Multi-part message segment |
| `MirroredToolChunkState` |  |
| `ModelProvider` | Model provider interface |
| `ModelString` | Model configuration string format: "provider/model-name" |
| `ModelTransportRequest` |  |
| `ModelTransportResolver` |  |
| `MonitorHostedChildRunStatusInput` |  |
| `MutableAgentProjectContext` |  |
| `NodeAgentServiceInstrumentationConfig` |  |
| `NodeAgentServiceRuntimeInfrastructure` |  |
| `NodeAgentServiceServer` |  |
| `NodeAgentServiceTelemetryConfig` |  |
| `NodeAgentServiceTelemetryEnv` |  |
| `NodeAgentServiceTelemetryLogger` |  |
| `NodeAgentServiceTelemetryProcessTarget` |  |
| `NodeHostedAgentServiceInstrumentationConfig` |  |
| `NodeHostedAgentServiceRuntimeInfrastructure` |  |
| `NodeHostedAgentServiceTelemetryConfig` |  |
| `NodeHostedAgentServiceTelemetryEnv` |  |
| `NodeHostedAgentServiceTelemetryLogger` |  |
| `NodeHostedAgentServiceTelemetryProcessTarget` |  |
| `NodeVeryfrontCloudAgentServiceMcpServer` |  |
| `NodeVeryfrontCloudAgentServiceOptions` |  |
| `NodeVeryfrontCloudAgentServicePreparedExecution` |  |
| `NodeVeryfrontCloudAgentServiceProcessTarget` |  |
| `NormalizedAgentServiceContract` |  |
| `NormalizedHostedChatRequest` |  |
| `OpenToolCalls` |  |
| `ParseAgUiSseResponseOptions` | Options for `parseAgUiSseResponse()`. |
| `ParsedAgUiSseRun` | Parsed AG-UI SSE response summary for evals, canaries, and host tests. |
| `ParsedHostedAgUiRequest` |  |
| `ParsedHostedChatRequest` |  |
| `ParsedRuntimeSkillDocument` |  |
| `ParseHostedChatRequestOptions` |  |
| `ParseRuntimeAgentMarkdownDefinitionInput` |  |
| `PersistConversationUserMessageFailure` |  |
| `PrepareAgentRuntimeMessagesFromUiMessagesOptions` |  |
| `PrepareConversationRootRunLifecycleOptions` |  |
| `PrepareDefaultHostedChildForkSandboxToolSourcesInput` |  |
| `PrepareDefaultHostedChildForkToolSourcesInput` |  |
| `PreparedHostedChatExecution` |  |
| `PreparedHostedChatExecutionDetachedInput` |  |
| `PreparedHostedChatExecutionRuntimeOptions` |  |
| `PreparedHostedChatExecutionStreamInput` |  |
| `PrepareHostedChatRuntimeMessagesOptions` |  |
| `PrepareHostedChatRuntimeToolAssemblyInput` |  |
| `PrepareHostedChildForkRuntimeStepMessagesInput` |  |
| `PrepareHostedConversationRootRunContextInput` |  |
| `PrepareVeryfrontCloudHostedChatExecutionInput` |  |
| `ProjectAgentRuntimeAgentIdCandidates` |  |
| `ProjectAgentRuntimeAgentSource` |  |
| `ProjectSteeringMutationInput` |  |
| `ProjectSteeringMutationResult` |  |
| `ProjectSteeringPaths` |  |
| `ProviderNativeToolInventoryOptions` |  |
| `ProviderToolCompatOptions` |  |
| `ProviderToolCompatProvider` |  |
| `ProviderToolProfile` |  |
| `RecordExternalAgentWorkerSessionInput` |  |
| `RedisClient` | Redis client interface (compatible with ioredis and node-redis) |
| `RedisMemoryConfig` | Redis memory configuration |
| `RegisterAgentPushRuntimeServiceRequest` |  |
| `RegisterExternalAgentWorkerInput` |  |
| `RequestAuthCache` |  |
| `ResolveAgentServiceRegistrationInputOptions` |  |
| `ResolveConversationHostedTerminalStateInput` |  |
| `ResolvedAgentConfig` |  |
| `ResolvedAgentServiceRegistrationInput` |  |
| `ResolvedHostedRuntimeRequestConfig` |  |
| `ResolvedModelTransport` |  |
| `ResolvedRuntimeState` |  |
| `ResolveHostedChildForkRuntimeConfigInput` |  |
| `ResolveHostedRuntimeRequestConfigInput` |  |
| `ResolveNodeAgentServiceTelemetryConfigOptions` |  |
| `ResolveNodeHostedAgentServiceTelemetryConfigOptions` |  |
| `ResolveRuntimeAgentDefinitionsDirInput` |  |
| `RootOwnedChildResultHint` |  |
| `RootOwnedChildResultHinted` |  |
| `RunAgentRuntimeForkStepInput` |  |
| `RunAgentServiceMainOptions` |  |
| `RunFrameworkForkStepInput` |  |
| `RunResumeSessionManagerOptions` |  |
| `RunSessionStatus` |  |
| `RuntimeAgentContextItem` |  |
| `RuntimeAgentControlPlaneStreamRequest` |  |
| `RuntimeAgentMarkdownDefinition` |  |
| `RuntimeAgentProjectContext` |  |
| `RuntimeAgentRunContext` |  |
| `RuntimeAgentRunInvocation` |  |
| `RuntimeAgentSourceContext` |  |
| `RuntimeAgentTargetKind` |  |
| `RuntimeAgentThinkingConfig` |  |
| `RuntimeAgentTool` |  |
| `RuntimeAgentValidatedClaims` |  |
| `RuntimeBuiltinSkillEntriesResult` |  |
| `RuntimeClientCapability` |  |
| `RuntimeClientProfile` |  |
| `RuntimeClientType` |  |
| `RuntimeFileUrlResolver` |  |
| `RuntimeFileUrlResolverInput` |  |
| `RuntimeGetProjectFileOptions` |  |
| `RuntimeLoadedProjectSkill` |  |
| `RuntimeLoadedSkillResponse` |  |
| `RuntimeLoadedSkillResponseMessages` |  |
| `RuntimeLoadSkillBuiltinStore` |  |
| `RuntimeLoadSkillErrorOutput` |  |
| `RuntimeLoadSkillReferenceFileOutput` |  |
| `RuntimeLoadSkillToolContext` |  |
| `RuntimeLoadSkillToolInput` |  |
| `RuntimeLoadSkillToolMessages` |  |
| `RuntimeLoadSkillToolOptions` |  |
| `RuntimeLoadSkillToolOutput` |  |
| `RuntimeProjectFile` |  |
| `RuntimeProjectFileListItem` |  |
| `RuntimeProjectFilesApiOptions` |  |
| `RuntimeProjectFilesClient` |  |
| `RuntimeProjectFilesClientOptions` |  |
| `RuntimeProjectFilesFetch` |  |
| `RuntimeProjectFilesTrace` |  |
| `RuntimeProjectInstructionsOptions` |  |
| `RuntimeProjectSkillCatalogOptions` |  |
| `RuntimeProjectSkillContext` |  |
| `RuntimeProjectSkillLoader` |  |
| `RuntimeProjectSkillLoaderLogger` |  |
| `RuntimeProjectSkillLoaderOptions` |  |
| `RuntimeProjectSteeringLookup` |  |
| `RuntimePromptBlockOptions` |  |
| `RuntimeSkillDefinition` |  |
| `RuntimeSkillFrontmatter` |  |
| `RuntimeSkillMetadataLogger` |  |
| `RuntimeStateRequest` |  |
| `RuntimeStateResolver` |  |
| `RuntimeUploadUrlClientOptions` |  |
| `RuntimeUploadUrlFetch` |  |
| `RuntimeUploadUrlOptions` |  |
| `SlashCommandArtifactPolicy` |  |
| `SlashCommandArtifactPolicyInput` |  |
| `StartAgentRuntimeForkInput` |  |
| `StartAgentRuntimeForkWithHostToolsInput` |  |
| `StartAgentServiceRuntimeOptions` |  |
| `StartAgentServiceRuntimeResult` |  |
| `StartAgentServiceServerOptions` |  |
| `StartedHostedChildForkRuntime` |  |
| `StartHostedChildForkRuntimeWithHostToolsInput` |  |
| `StartNodeAgentServiceOptions` |  |
| `StartNodeAgentServiceResult` |  |
| `StartNodeAgentServiceServerOptions` |  |
| `StartNodeHostedAgentServiceOptions` |  |
| `StartNodeHostedAgentServiceResult` |  |
| `StreamToolCall` | Streaming tool call |
| `SubmitResumeValueOutcome` |  |
| `Suggestion` |  |
| `Suggestions` |  |
| `TerminalConversationRunStatus` |  |
| `ToolCall` | Completed tool call |
| `ToolCallPart` | Tool call message segment |
| `ToolCallPartWithArgs` | Tool call with parsed args |
| `ToolCallPartWithInput` | Tool call with raw input |
| `ToolExecutionDataEventBridgeStreamInput` |  |
| `ToolExecutionDataEventPublisher` |  |
| `ToolResultPart` | Tool execution result segment |
| `VeryfrontCloudAgentServiceOptions` |  |
| `VeryfrontCloudHostedChatExecutionPreparationLogger` |  |
| `VeryfrontMcpServerKind` |  |
| `WaitForDurableHumanInputResolutionOptions` |  |
| `WaitForHumanInputOptions` |  |
| `WorkflowConfig` | `createWorkflow` config |
| `WorkflowResult` | Completed workflow result |
| `WorkflowStep` | Workflow step definition |
| `WrapHostedChildProjectSwitchToolInput` |  |
| `WrapHostedChildSteeringMutationToolInput` |  |

### Constants

| Name | Description |
|------|-------------|
| `agentServiceConfigSchema` |  |
| `agentServiceRegistrationConfigSchema` |  |
| `agUiSseEventTypes` | AG-UI runtime event type constants normalized from browser-wire SSE events. |
| `conversationRunEventTypes` |  |
| `createNodeHostedAgentServiceRuntimeInfrastructure` |  |
| `defaultHostedInvokeAgentInputSchema` |  |
| `defaultHostedInvokeAgentSelectionSchema` |  |
| `getAgUiRuntimeContextItemSchema` |  |
| `getAgUiRuntimeInjectedToolSchema` |  |
| `getAgUiRuntimeMessageSchema` |  |
| `getAgUiRuntimeRequestSchema` |  |
| `getCreateInputRequestRequestSchema` |  |
| `getCreateInputRequestResponseSchema` |  |
| `getFormInputToolInputSchema` |  |
| `getGetInputRequestResponseSchema` |  |
| `getHumanInputFieldSchema` |  |
| `getHumanInputOptionSchema` |  |
| `getHumanInputPendingRequestSchema` |  |
| `getHumanInputRequestSchema` |  |
| `getHumanInputResultSchema` |  |
| `getInputRequestLifecycleDataEventSchema` |  |
| `getInputRequestOutputSchema` |  |
| `getInputRequestRestSchema` |  |
| `getInputResponseRestSchema` |  |
| `getInputResponseValuesSchema` |  |
| `getParseRuntimeAgentMarkdownDefinitionInputSchema` |  |
| `getRuntimeAgentMarkdownDefinitionSchema` |  |
| `getRuntimeAgentThinkingConfigSchema` |  |
| `getRuntimeClientCapabilitySchema` |  |
| `getRuntimeClientProfileSchema` |  |
| `getRuntimeClientTypeSchema` |  |
| `hostedAgentProjectSteeringOptionsSchema` |  |
| `hostedAgentServiceConfigSchema` |  |
| `hostedAgUiChatForwardedConfigSchema` |  |
| `hostedChatRequestSchema` |  |
| `hostedChatRuntimeOverridesSchema` |  |
| `hostedChildForkToolInputSchema` |  |
| `hostedChildTerminalErrorCodes` |  |
| `hostedDurableRootRunDescriptorSchema` |  |
| `loadHostedAgentServiceEnvFiles` |  |
| `loadRuntimeAgentMarkdownDefinitionFromFileInputSchema` |  |
| `parseRuntimeAgentMarkdownDefinitionInputSchema` |  |
| `resolvedAgentServiceRegistrationInputSchema` |  |
| `resolveRuntimeAgentDefinitionsDirInputSchema` |  |
| `runtimeAgentMarkdownDefinitionSchema` |  |
| `runtimeAgentThinkingConfigSchema` |  |
| `runtimeClientCapabilitySchema` |  |
| `runtimeClientProfileSchema` |  |
| `runtimeClientTypeSchema` |  |
| `runtimeProjectFileListItemSchema` |  |
| `runtimeProjectFileSchema` |  |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/agent/conversation-bootstrap`

```ts
import { bootstrapConversationAgentRun, createConversationMessage, createConversationRecord } from "veryfront/agent/conversation-bootstrap";
```

#### Components

| Name | Description |
|------|-------------|
| `ConversationMessageRecordSchema` |  |
| `ConversationRecordSchema` |  |

#### Functions

| Name | Description |
|------|-------------|
| `bootstrapConversationAgentRun` |  |
| `createConversationMessage` |  |
| `createConversationRecord` |  |
| `ensureConversationProjectLink` |  |
| `fetchConversationRecord` |  |
| `findLatestUserConversationMessageContext` |  |
| `persistConversationUserMessage` |  |
| `persistLatestConversationUserMessage` |  |

#### Types

| Name | Description |
|------|-------------|
| `BootstrapConversationAgentRunResult` |  |
| `ConversationControlPlaneResponseError` |  |
| `ConversationMessageRecord` |  |
| `ConversationRecord` |  |
| `PersistConversationUserMessageFailure` |  |

#### Constants

| Name | Description |
|------|-------------|
| `getConversationMessageRecordSchema` |  |
| `getConversationRecordSchema` |  |

### `veryfront/agent/durable`

```ts
import { appendConversationRunEvents, createConversationAgentRun, createConversationRunEventQueueController } from "veryfront/agent/durable";
```

#### Components

| Name | Description |
|------|-------------|
| `AppendConversationRunEventsResponseSchema` |  |
| `CompleteConversationRunResponseSchema` |  |
| `ConversationRunProjectionSchema` |  |
| `ConversationRunStatusSchema` |  |
| `ConversationRunTargetsSchema` |  |
| `CreateConversationRunAcceptedSchema` |  |

#### Functions

| Name | Description |
|------|-------------|
| `appendConversationRunEvents` |  |
| `createConversationAgentRun` |  |
| `createConversationRunEventQueueController` |  |
| `finalizeConversationAgentRun` |  |
| `flushConversationRunEventBatches` |  |
| `flushConversationRunEventQueue` |  |
| `getConversationRun` |  |
| `isActiveConversationRunStatus` |  |
| `isAppendableConversationRunProjection` |  |
| `isCursorMismatchConversationRunAppendError` |  |
| `isIgnorableConversationRunAppendError` |  |
| `monitorConversationRunStatus` |  |
| `parseAppendConversationRunEventsErrorBody` |  |
| `recoverConversationRunAppendExecution` |  |
| `recoverConversationRunAppendFailure` |  |
| `recoverConversationRunCursorMismatch` |  |
| `resolveConversationRunTargets` |  |
| `resyncConversationRunAppendCursor` |  |

#### Classes

| Name | Description |
|------|-------------|
| `AppendConversationRunEventsError` |  |
| `ConversationRunTerminalStateError` |  |

#### Types

| Name | Description |
|------|-------------|
| `ActiveConversationRunStatus` |  |
| `AppendConversationRunEventsResponse` |  |
| `ConversationAgentRunUsage` |  |
| `ConversationRunAppendCursorResyncResult` |  |
| `ConversationRunAppendExecutionOutcome` |  |
| `ConversationRunAppendFailureOutcome` |  |
| `ConversationRunAppendRecoveryOutcome` |  |
| `ConversationRunBatchFlushOutcome` |  |
| `ConversationRunEventQueueController` |  |
| `ConversationRunProjection` |  |
| `ConversationRunQueueFlushOutcome` |  |
| `ConversationRunTargets` |  |
| `CreateConversationAgentRunInput` |  |
| `FinalizeConversationAgentRunInput` |  |
| `TerminalConversationRunStatus` |  |

#### Constants

| Name | Description |
|------|-------------|
| `getAppendConversationRunEventsResponseSchema` |  |
| `getCompleteConversationRunResponseSchema` |  |
| `getConversationRunProjectionSchema` |  |
| `getConversationRunStatusSchema` |  |
| `getConversationRunTargetsSchema` |  |
| `getCreateConversationRunAcceptedSchema` |  |

### `veryfront/agent/invoke-agent-child-runs`

```ts
import { buildInvokeAgentChildRunLifecycleCustomEvent, buildInvokeAgentChildRunProgressEvents, buildInvokeAgentChildRunStateDelta } from "veryfront/agent/invoke-agent-child-runs";
```

#### Components

| Name | Description |
|------|-------------|
| `InvokeAgentChildRunLifecycleCustomEventSchema` |  |
| `InvokeAgentChildRunLifecycleValueSchema` |  |
| `InvokeAgentChildRunStateDeltaSchema` |  |

#### Functions

| Name | Description |
|------|-------------|
| `buildInvokeAgentChildRunLifecycleCustomEvent` |  |
| `buildInvokeAgentChildRunProgressEvents` |  |
| `buildInvokeAgentChildRunStateDelta` |  |
| `publishInvokeAgentChildRunProgress` |  |

#### Types

| Name | Description |
|------|-------------|
| `InvokeAgentChildRunLifecycleCustomEvent` |  |
| `InvokeAgentChildRunLifecycleValue` |  |
| `InvokeAgentChildRunProgressEvent` |  |
| `InvokeAgentChildRunProgressInput` |  |
| `InvokeAgentChildRunStateDelta` |  |

#### Constants

| Name | Description |
|------|-------------|
| `getInvokeAgentChildRunLifecycleCustomEventSchema` |  |
| `getInvokeAgentChildRunLifecycleValueSchema` |  |
| `getInvokeAgentChildRunStateDeltaSchema` |  |

### `veryfront/agent/request-auth-cache`

```ts
import { createRequestAuthCache } from "veryfront/agent/request-auth-cache";
```

#### Functions

| Name | Description |
|------|-------------|
| `createRequestAuthCache` |  |

#### Types

| Name | Description |
|------|-------------|
| `CachedRequestAuthResult` |  |
| `CreateRequestAuthCacheOptions` |  |
| `RequestAuthCache` |  |

### `veryfront/agent/testing`

Agent Testing Utilities

```ts
import { assertCompleted, assertContains, assertDurableRunCanaryCompleted } from "veryfront/agent/testing";
```

#### Components

| Name | Description |
|------|-------------|
| `DEFAULT_DURABLE_RUN_CANARY_TIMEOUT_MS` |  |
| `DEFAULT_LIVE_EVAL_AREA_TAG_RULES` |  |
| `DEFAULT_LIVE_EVAL_ENDPOINT` |  |
| `DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES` |  |

#### Functions

| Name | Description |
|------|-------------|
| `assertCompleted` |  |
| `assertContains` |  |
| `assertDurableRunCanaryCompleted` |  |
| `assertNoMalformedCreateFileToolCalls` |  |
| `assertToolCalled` |  |
| `buildFailureSuffix` |  |
| `buildLiveEvalCaseMetadata` |  |
| `buildLiveEvalCaseTagSummary` |  |
| `buildLiveEvalRequestBody` |  |
| `buildLiveEvalRuntimeSummary` |  |
| `buildLiveEvalStatusSummary` |  |
| `buildProgressLine` |  |
| `buildRuntimePerformanceSummary` |  |
| `cancelLiveEvalInputRequest` |  |
| `collectAssistantText` |  |
| `containsOrderedSubsequence` |  |
| `containsSkillLoad` |  |
| `countStepStartedEvents` |  |
| `createDurableRunCanaryApiClient` |  |
| `createDurableRunCanaryRunner` |  |
| `createFailedEvalResult` |  |
| `createLiveEvalApiClient` |  |
| `createLiveEvalCaseSupport` |  |
| `createLiveEvalConversation` |  |
| `createLiveEvalProjectUploadFixture` |  |
| `createLiveEvalRelease` |  |
| `createPassedEvalResult` |  |
| `createPlainTextPdf` |  |
| `createSkippedEvalResult` |  |
| `deleteLiveEvalConversation` |  |
| `deleteLiveEvalProjectFile` |  |
| `evaluateRuntimeConfidenceEnv` |  |
| `findAssistantMessage` |  |
| `getLiveEvalProjectFile` |  |
| `hasEveryLiveEvalTag` |  |
| `hasFinished` |  |
| `listOpenLiveEvalInputRequests` |  |
| `parseDurableRunCanaryRunSummary` |  |
| `printRuntimeConfidencePreflight` |  |
| `printTestResults` |  |
| `resolveDurableRunCanaryEnvironment` |  |
| `resolveLiveEvalEnvironment` |  |
| `resolveLiveEvalRequestedCaseIds` |  |
| `runDurableRunCanaryCli` |  |
| `runLiveEvalCli` |  |
| `selectLiveEvalCases` |  |
| `stringifyUnknown` |  |
| `submitLiveEvalInputResponse` |  |
| `testAgent` |  |
| `waitForOpenLiveEvalInputRequest` |  |
| `withLiveEvalMetadata` |  |

#### Types

| Name | Description |
|------|-------------|
| `BuildLiveEvalCaseMetadataInput` |  |
| `BuildLiveEvalRequestBodyInput` |  |
| `DurableRunCanaryApiClient` |  |
| `DurableRunCanaryApiConfig` |  |
| `DurableRunCanaryCase` |  |
| `DurableRunCanaryCliCaseFactoryInput` |  |
| `DurableRunCanaryCreateRootRunInput` |  |
| `DurableRunCanaryEnvironment` |  |
| `DurableRunCanaryMessage` |  |
| `DurableRunCanaryPreparedCase` |  |
| `DurableRunCanaryResult` |  |
| `DurableRunCanaryRunnerConfig` |  |
| `DurableRunCanaryRunSummary` |  |
| `DurableRunCanarySendUserMessageInput` |  |
| `DurableRunCanaryStartRunInput` |  |
| `LiveEvalApiClient` |  |
| `LiveEvalApiContext` |  |
| `LiveEvalCase` |  |
| `LiveEvalCaseMetadata` |  |
| `LiveEvalCaseMetadataOptions` |  |
| `LiveEvalCaseSelectionInput` |  |
| `LiveEvalCaseSurface` |  |
| `LiveEvalCaseTagRule` |  |
| `LiveEvalCliCaseFactoryInput` |  |
| `LiveEvalCliCaseGroups` |  |
| `LiveEvalContext` |  |
| `LiveEvalConversationInput` |  |
| `LiveEvalCreateConversationInput` |  |
| `LiveEvalCreateReleaseInput` |  |
| `LiveEvalEnvironment` |  |
| `LiveEvalInputRequestInput` |  |
| `LiveEvalInputRequestRecord` |  |
| `LiveEvalInputResponseValues` |  |
| `LiveEvalProjectFile` |  |
| `LiveEvalProjectFileInput` |  |
| `LiveEvalProjectFileReaderInput` |  |
| `LiveEvalProjectUploadFixtureInput` |  |
| `LiveEvalRequestBody` |  |
| `LiveEvalRequestTimeoutInput` |  |
| `LiveEvalResultForPerformance` |  |
| `LiveEvalResultForReport` |  |
| `LiveEvalResultRecord` |  |
| `LiveEvalRunnerConfig` |  |
| `LiveEvalRuntime` |  |
| `LiveEvalSubmitInputResponseInput` |  |
| `LiveEvalWaitForOpenInputRequestInput` |  |
| `PreparedLiveEvalInput` |  |
| `RunDurableRunCanaryCliInput` |  |
| `RunLiveEvalCliInput` |  |
| `RuntimeConfidencePreflightResult` |  |
| `RuntimePerformanceSummary` |  |
| `TestCase` |  |
| `TestResult` |  |
| `TestSuite` |  |

#### Constants

| Name | Description |
|------|-------------|
| `durableRunCanaryRunnerInternals` |  |
| `getDurableRunCanaryMessageSchema` |  |
| `liveEvalRunnerInternals` |  |

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

- [03-agent-runtime](../../architecture/03-agent-runtime.md): Agent runtime architecture
- [08-hosted-agent-runs](../../architecture/08-hosted-agent-runs.md): Hosted agent runs
- [09-control-plane-channels](../../architecture/09-control-plane-channels.md): Control-plane channels
- [10-ag-ui-transport](../../architecture/10-ag-ui-transport.md): AG-UI transport contract
- [19-runtime-boundaries](../../architecture/19-runtime-boundaries.md): Runtime boundaries
- [24-ai-primitives](../../architecture/24-ai-primitives.md): AI primitives
