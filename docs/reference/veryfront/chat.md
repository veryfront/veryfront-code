---
title: "veryfront/chat"
description: "Chat UI components and streaming hooks."
order: 6
---

# veryfront/chat

Chat UI components and streaming hooks.

## Import

```ts
import {
  Chat,
  useChat,
  useAgent,
  AgentCard,
  Message,
  buildChatStreamChunkMessageMetadata,
} from "veryfront/chat";
```

## Examples

### Basic chat (preset)

```tsx
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/ag-ui" });
  return (
    <Chat
      messages={chat.messages}
      input={chat.input}
      onChange={chat.handleInputChange}
      onSubmit={chat.handleSubmit}
    />
  );
}
```

### Custom layout (composition)

```tsx
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/ag-ui" });
  return (
    <Chat.Root messages={chat.messages} input={chat.input}>
      <Chat.Empty title="Ask me anything" />
      <Chat.MessageList messages={chat.messages} />
      <Chat.Composer input={chat.input} onChange={chat.handleInputChange} onSubmit={chat.handleSubmit} />
    </Chat.Root>
  );
}
```

### Per-message control (compound)

```tsx
import { Message } from "veryfront/chat";

<Message.Root message={msg}>
  <Message.Avatar />
  <Message.Content />
  <Message.Actions />
</Message.Root>
```

## Type Reference

### `UseChatOptions`

`useChat` options

| Property | Type | Description |
|----------|------|-------------|
| `api` | `string` | Chat API endpoint URL |
| `transport?` | `"ag-ui"` | Streaming response protocol used by the endpoint. AG-UI is the default. |
| `initialMessages?` | `ChatMessage[]` | Pre-populated messages |
| `body?` | <code>Record&lt;string, unknown&gt;</code> | Extra body fields sent with each request |
| `headers?` | <code>Record&lt;string, string&gt;</code> | Custom request headers |
| `credentials?` | `RequestCredentials` | Fetch credentials mode |
| `model?` | `string` | Override model at runtime (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929") |
| `systemPrompt?` | `string` | System prompt for browser-side inference (server uses agent config) |
| `browserFallback?` | `boolean` | Enable/disable browser fallback when server can't provide a runtime. Default: true |
| `onResponse?` | <code>(response: Response) =&gt; void</code> | Raw response callback |
| `onFinish?` | <code>(message: ChatMessage) =&gt; void</code> | Completion callback |
| `onError?` | <code>(error: Error) =&gt; void</code> | Error callback |
| `onToolCall?` | <code>(arg: OnToolCallArg) =&gt; void &#124; Promise&lt;void&gt;</code> | Tool call handler for client-side execution |

### `UseChatResult`

`useChat` result

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `ChatMessage[]` | All messages in the conversation |
| `input` | `string` | Current input value |
| `isLoading` | `boolean` | Whether a request is in flight |
| `error` | `Error \| null` | Last error (if any) |
| `model` | `string \| undefined` | Current model override (undefined = use agent default) |
| `activeModel` | `string \| undefined` | The actual model being used after auto-upgrade (e.g. "anthropic/claude-sonnet-4-20250514") |
| `inferenceMode` | `InferenceMode` | Where inference is currently happening |
| `browserStatus` | `BrowserInferenceStatus \| null` | Browser-side model loading/inference status (null when not using browser fallback) |
| `setInput` | <code>(input: string) =&gt; void</code> | Set input value |
| `setModel` | <code>(model: string &#124; undefined) =&gt; void</code> | Change the model for subsequent requests |
| `sendMessage` | <code>(message: &#123; text: string &#125;) =&gt; Promise&lt;void&gt;</code> | Send a message programmatically |
| `editMessage` | <code>(messageId: string, newText: string) =&gt; Promise&lt;void&gt;</code> | Edit a user message and resubmit — truncates history to that point |
| `getBranches` | <code>(messageId: string) =&gt; BranchInfo</code> | Get branch info for a message (returns { current, total }; total=1 if no branches) |
| `switchBranch` | <code>(messageId: string, branchIndex: number) =&gt; void</code> | Switch to a different branch at a given message |
| `reload` | <code>() =&gt; Promise&lt;void&gt;</code> | Re-send last user message |
| `stop` | <code>() =&gt; void</code> | Abort current request |
| `setMessages` | <code>(messages: ChatMessage[]) =&gt; void</code> | Replace message history |
| `addToolOutput` | <code>(output: ToolOutput) =&gt; void</code> | Submit client-side tool result |
| `data?` | `unknown` | Extra data from server response |
| `handleInputChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Bind to input onChange |
| `handleSubmit` | <code>(e: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Submit current input |
| `onChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Alias for `handleInputChange` — matches `ChatProps.onChange` for easy spreading |
| `onSubmit` | <code>(e: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Alias for `handleSubmit` — matches `ChatProps.onSubmit` for easy spreading |
| `onModelChange` | <code>(model: string &#124; undefined) =&gt; void</code> | Alias for `setModel` — matches `ChatProps.onModelChange` for easy spreading |

### `UseAgentOptions`

`useAgent` options

| Property | Type | Description |
|----------|------|-------------|
| `agent` | `string` | Agent ID or endpoint |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback when tool is called |
| `onToolResult?` | <code>(toolCall: ToolCall, result: unknown) =&gt; void</code> | Callback when tool result received |
| `onError?` | <code>(error: Error) =&gt; void</code> | Callback when error occurs |

### `UseAgentResult`

`useAgent` result

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `AgentMessage[]` | Message history |
| `toolCalls` | `ToolCall[]` | Active tool calls |
| `status` | `AgentStatus` | Agent status |
| `thinking?` | `string` | Thinking/reasoning text |
| `invoke` | <code>(input: string) =&gt; Promise&lt;void&gt;</code> | Invoke the agent |
| `stop` | <code>() =&gt; void</code> | Stop agent execution |
| `isLoading` | `boolean` | Loading state |
| `error` | `Error \| null` | Error state |

## Exports

### Components

| Name | Description |
|------|-------------|
| `AgentCard` | Agent status, tool calls, and messages |
| `AttachmentPill` |  |
| `BranchPicker` |  |
| `Chat` | Full chat UI (messages + input) |
| `ChatComponents` | Compound components for custom layouts |
| `ChatComposer` |  |
| `ChatContextProvider` |  |
| `ChatEmpty` |  |
| `ChatIf` |  |
| `ChatMessageList` |  |
| `ChatRoot` |  |
| `ChatSidebar` |  |
| `ChatWithSidebar` |  |
| `ComposerContextProvider` |  |
| `ConversationEmptyState` |  |
| `ConversationScrollButton` |  |
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` |  |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` |  |
| `DropZoneOverlay` |  |
| `ErrorBanner` |  |
| `FadeIn` |  |
| `InferenceBadge` |  |
| `InlineCitation` |  |
| `Loader` |  |
| `Message` | Chat message bubble |
| `MessageActions` |  |
| `MessageContextProvider` |  |
| `MessageEditForm` |  |
| `MessageFeedback` |  |
| `ModelAvatar` |  |
| `ModelSelector` | Dropdown for switching models at runtime |
| `QuickActions` |  |
| `ReasoningCard` |  |
| `RichCodeBlock` |  |
| `Shimmer` |  |
| `SkillBadge` |  |
| `Sources` |  |
| `StandaloneMessage` |  |
| `StepIndicator` |  |
| `StreamingMessage` | Incrementally rendered message |
| `Suggestion` |  |
| `Suggestions` |  |
| `TabSwitcher` |  |
| `ThreadListContextProvider` |  |
| `ToolCallCard` | Tool call card component - renders tool invocations with parameters and results |
| `ToolStatusBadge` |  |
| `UpgradeCTA` |  |
| `UploadsPanel` |  |

### Functions

| Name | Description |
|------|-------------|
| `buildChatStreamChunkMessageMetadata` |  |
| `createChatStreamWatchdog` |  |
| `createChatStreamWatchdogState` |  |
| `dedupeChatUiMessageChunks` |  |
| `downloadMarkdown` | Download messages as a .md file. |
| `exportAsMarkdown` | Convert chat messages to a markdown string. |
| `extractChatMessageMetadata` |  |
| `extractSourcesFromParts` | Extract sources from tool result parts. |
| `getNextChatStreamWatchdogState` |  |
| `getTextContent` | Get text content from chat message parts |
| `groupPartsInOrder` | Group consecutive parts for ordered rendering |
| `isHeartbeatOnlyMetadataChunk` |  |
| `isLongRunningToolRunning` |  |
| `isReasoningPart` | Check if a part is a reasoning part |
| `isSkillToolPart` | Check if a tool part is a skill-related tool (load-skill, load-skill-reference, execute-skill-script) |
| `isToolPart` | Check if a part is a tool part |
| `mapHostedStreamPartToChatUiChunks` |  |
| `normalizeChatMessageMetadata` |  |
| `normalizeChatUiMessageChunk` |  |
| `normalizeChatUiMessageStream` |  |
| `useAgent` | Agent interactions with tool call tracking |
| `useChat` | useChat hook for managing chat state with veryfront stream events. |
| `useChatContext` |  |
| `useChatContextOptional` |  |
| `useChatErrorHandler` |  |
| `useCompletion` | useCompletion hook for single text generation |
| `useComposerContext` |  |
| `useComposerContextOptional` |  |
| `useMessageContext` |  |
| `useMessageContextOptional` |  |
| `useStreaming` | Low-level streaming hook |
| `useThreadListContext` |  |
| `useThreadListContextOptional` |  |
| `useThreads` |  |
| `useVoiceInput` | Voice input (Web Speech API) |

### Classes

| Name | Description |
|------|-------------|
| `ChatErrorBoundary` |  |
| `ChatStreamIdleTimeoutError` |  |

### Types

| Name | Description |
|------|-------------|
| `AgentCardProps` | `<AgentCard>` props |
| `AgentTheme` | Agent card theme config |
| `AttachmentInfo` |  |
| `AttachmentPillProps` |  |
| `BranchInfo` |  |
| `BranchPickerProps` |  |
| `BrowserInferenceStatus` | Browser-side model loading and inference status |
| `BuildChatStreamChunkMessageMetadataInput` |  |
| `ChatComposerProps` |  |
| `ChatContextValue` |  |
| `ChatDynamicToolPart` |  |
| `ChatEmptyProps` |  |
| `ChatErrorBoundaryProps` |  |
| `ChatFinishReason` |  |
| `ChatIfProps` |  |
| `ChatMessage` |  |
| `ChatMessageListProps` |  |
| `ChatMessageMetadata` |  |
| `ChatMessageMetadataUsage` |  |
| `ChatMessagePart` |  |
| `ChatProps` | `<Chat>` props |
| `ChatReasoningPart` |  |
| `ChatRootProps` |  |
| `ChatSidebarProps` |  |
| `ChatStepPart` |  |
| `ChatStreamEvent` |  |
| `ChatStreamWatchdogOptions` |  |
| `ChatStreamWatchdogPhase` |  |
| `ChatStreamWatchdogState` |  |
| `ChatTab` |  |
| `ChatTextPart` |  |
| `ChatTheme` | Theme System for Styled Components |
| `ChatToolPart` |  |
| `ChatToolResultPart` |  |
| `ChatToolState` |  |
| `ChatUiMessageChunk` |  |
| `ChatWithSidebarAttachmentConfig` |  |
| `ChatWithSidebarChatController` |  |
| `ChatWithSidebarFeatureConfig` |  |
| `ChatWithSidebarGroupedProps` |  |
| `ChatWithSidebarMessageConfig` |  |
| `ChatWithSidebarModelConfig` |  |
| `ChatWithSidebarProps` |  |
| `ChatWithSidebarQuickActionsConfig` |  |
| `ChatWithSidebarSidebarConfig` |  |
| `ChatWithSidebarTabsConfig` |  |
| `ChatWithSidebarVoiceConfig` |  |
| `ChildRunAudit` |  |
| `ChildRunAuditToolCall` |  |
| `ChildRunAuditToolResult` |  |
| `CodeBlockProps` |  |
| `ComposerContextValue` |  |
| `ConversationEmptyStateProps` |  |
| `ConversationScrollButtonProps` |  |
| `DropZoneOverlayProps` |  |
| `ErrorBannerProps` |  |
| `FeedbackValue` |  |
| `HostedStreamPartForUiChunkMapping` |  |
| `HostedUiChunkMappingOptions` |  |
| `InferenceBadgeProps` |  |
| `InferenceMode` | Where inference is happening |
| `InlineCitationProps` |  |
| `MessageActionsProps` |  |
| `MessageContextValue` |  |
| `MessageEditFormProps` |  |
| `MessageFeedbackProps` |  |
| `MessageProps` | `<Message>` props |
| `MessageRootProps` |  |
| `ModelAvatarProps` |  |
| `ModelOption` | A "provider/model" value and its display label. |
| `ModelSelectorProps` | Props for `<ModelSelector>`. |
| `OnToolCallArg` | `onToolCall` callback argument |
| `PartGroup` | Part group types for ordered rendering |
| `QuickAction` |  |
| `QuickActionsProps` |  |
| `SkillBadgeProps` |  |
| `Source` |  |
| `SourcesProps` |  |
| `StepIndicatorProps` |  |
| `StreamingMessageProps` | `<StreamingMessage>` props |
| `SuggestionProps` |  |
| `SuggestionsProps` |  |
| `TabSwitcherProps` |  |
| `Thread` |  |
| `ThreadListContextValue` |  |
| `ToolOutput` | Tool execution output |
| `UpgradeCTAProps` |  |
| `UploadedFile` |  |
| `UploadsPanelProps` |  |
| `UseAgentOptions` | `useAgent` options |
| `UseAgentResult` | `useAgent` result |
| `UseChatOptions` | `useChat` options |
| `UseChatResult` | `useChat` result |
| `UseCompletionOptions` | `useCompletion` options |
| `UseCompletionResult` | `useCompletion` result |
| `UseStreamingOptions` | `useStreaming` options |
| `UseStreamingResult` | `useStreaming` result |
| `UseThreadsOptions` |  |
| `UseThreadsResult` |  |
| `UseVoiceInputOptions` | `useVoiceInput` options |
| `UseVoiceInputResult` | `useVoiceInput` result |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/chat/ag-ui`

```ts
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk, flushAgUiSseChunk } from "veryfront/chat/ag-ui";
```

#### Components

| Name | Description |
|------|-------------|
| `AgUiRunFinishedMetadataSchema` |  |
| `AgUiSnapshotMessageSchema` |  |
| `AgUiSnapshotToolCallSchema` |  |
| `AgUiWireEventNameSchema` |  |
| `AgUiWireEventSchema` |  |

#### Functions

| Name | Description |
|------|-------------|
| `createAgUiChatEventDecoderState` |  |
| `decodeAgUiSseChunk` |  |
| `flushAgUiSseChunk` |  |
| `mapAgUiRuntimeMessagesToChatUiMessages` |  |
| `parseSseEvent` |  |

#### Types

| Name | Description |
|------|-------------|
| `AgUiChatEventDecoderState` |  |
| `AgUiDecodedChunk` |  |
| `AgUiDecodedEvent` |  |
| `AgUiDecoderValidationMode` |  |
| `AgUiRunFinishedMetadata` |  |
| `AgUiRuntimeMessage` |  |
| `AgUiRuntimeToolCall` |  |
| `AgUiSnapshotMessage` |  |
| `AgUiWireEvent` |  |
| `AgUiWireEventName` |  |
| `ParsedSseEvent` |  |
| `ToolCallState` |  |

#### Constants

| Name | Description |
|------|-------------|
| `getAgUiRunFinishedMetadataSchema` |  |
| `getAgUiSnapshotMessageSchema` |  |
| `getAgUiSnapshotToolCallSchema` |  |
| `getAgUiWireEventNameSchema` |  |
| `getAgUiWireEventSchema` |  |

### `veryfront/chat/conversation`

```ts
import { convertUiMessagesToProviderModelMessages, extractTextFromMessage, extractUploadId } from "veryfront/chat/conversation";
```

#### Components

| Name | Description |
|------|-------------|
| `UUID_PATTERN` |  |

#### Functions

| Name | Description |
|------|-------------|
| `convertUiMessagesToProviderModelMessages` |  |
| `extractTextFromMessage` |  |
| `extractUploadId` |  |
| `getStringField` |  |
| `getUiToolName` |  |
| `hasIncompleteToolParts` |  |
| `isDataUiPart` |  |
| `isReasoningPart` |  |
| `isRecord` |  |
| `isTextPart` |  |
| `isToolCallPart` |  |
| `isToolResultPart` |  |
| `isToolUiPart` |  |
| `isUuid` |  |
| `mapToolState` |  |
| `markIncompleteToolPartsAsErrored` |  |
| `markIncompleteToolPartsAsStopped` |  |
| `pushToolParts` |  |
| `stringifyUnknown` |  |
| `toConversationPartsFromUiMessage` |  |

#### Types

| Name | Description |
|------|-------------|
| `ApiConversation` |  |
| `ApiMessage` |  |
| `ConversationType` |  |
| `MessagePart` |  |
| `MessageStatus` |  |
| `ReasoningPartLike` |  |
| `TextPartLike` |  |
| `ToolCallLike` |  |
| `ToolResultLike` |  |
| `ToolUiPart` |  |

#### Constants

| Name | Description |
|------|-------------|
| `apiConversationSchema` |  |
| `apiMessageSchema` |  |
| `conversationTypeSchema` |  |
| `convertUiMessagesToModelMessages` |  |
| `getApiConversationSchema` |  |
| `getApiMessageSchema` |  |
| `getConversationTypeSchema` |  |
| `getMessagePartSchema` |  |
| `getMessageStatusSchema` |  |
| `messagePartSchema` |  |
| `messageStatusSchema` |  |

### `veryfront/chat/final-step-fallback`

```ts
import { appendMissingFallbackTextPart, buildFallbackUiMessageChunks, buildFallbackUiMessageParts } from "veryfront/chat/final-step-fallback";
```

#### Components

| Name | Description |
|------|-------------|
| `DEFAULT_STREAM_PROMISE_TIMEOUT_MS` |  |

#### Functions

| Name | Description |
|------|-------------|
| `appendMissingFallbackTextPart` |  |
| `buildFallbackUiMessageChunks` |  |
| `buildFallbackUiMessageParts` |  |
| `buildMissingFallbackTextChunks` |  |
| `buildMissingFallbackToolChunks` |  |
| `buildMissingFallbackToolChunksFromParts` |  |
| `extractFinalStepFinishReason` |  |
| `extractFinalStepTerminalError` |  |
| `extractFinalStepText` |  |
| `extractFinalStepToolCalls` |  |
| `extractFinalStepToolResults` |  |
| `getLastStreamStep` |  |
| `getStreamSteps` |  |

#### Types

| Name | Description |
|------|-------------|
| `ChatFallbackPart` |  |
| `ChatPart` |  |
| `FallbackToolChunkState` |  |
| `FinalStepTerminalError` |  |
| `FinalStepToolCall` |  |
| `FinalStepToolResult` |  |

### `veryfront/chat/message-prep`

```ts
import { compactForStep, compressTurn, dedupeToolHistory } from "veryfront/chat/message-prep";
```

#### Functions

| Name | Description |
|------|-------------|
| `compactForStep` |  |
| `compressTurn` |  |
| `dedupeToolHistory` |  |
| `enforceTokenBudget` |  |
| `enforceTokenBudgetWithTurnCompression` |  |
| `ensureToolCallInputs` |  |
| `estimateOverhead` |  |
| `estimateTokens` |  |
| `isModelSupportedFileMediaType` |  |
| `maskOldToolOutputs` |  |
| `normalizeMessageFilePartMediaTypes` |  |
| `prepareProviderModelMessagesFromUiMessages` |  |
| `repairToolPairs` |  |
| `rewriteUnsupportedFilePartsAsAnnotations` |  |
| `sanitizeProviderModelMessages` |  |
| `stripPendingToolParts` |  |

#### Constants

| Name | Description |
|------|-------------|
| `prepareModelMessagesFromUiMessages` |  |
| `sanitizeModelMessages` |  |

### `veryfront/chat/protocol`

Canonical chat message and stream protocol for Veryfront chat surfaces. These types describe the framework-owned message parts and stream events used by AG-UI-aligned chat clients, hooks, and adapters.

```ts
import "veryfront/chat/protocol";
```

#### Types

| Name | Description |
|------|-------------|
| `ChatDynamicToolPart` |  |
| `ChatFinishReason` |  |
| `ChatMessage` |  |
| `ChatMessageMetadata` |  |
| `ChatMessageMetadataUsage` |  |
| `ChatMessagePart` |  |
| `ChatPartState` | Canonical chat message and stream protocol for Veryfront chat surfaces. |
| `ChatReasoningPart` |  |
| `ChatStepPart` |  |
| `ChatStreamEvent` |  |
| `ChatStreamEventBase` |  |
| `ChatTextPart` |  |
| `ChatToolPart` |  |
| `ChatToolResultPart` |  |
| `ChatToolState` |  |
| `ChatUiMessageChunk` |  |
| `ChildRunAudit` |  |
| `ChildRunAuditToolCall` |  |
| `ChildRunAuditToolResult` |  |
| `IdChunk` |  |
| `IdDeltaChunk` |  |
| `MessageLifecycleChunk` |  |
| `NamedToolCallChunk` |  |
| `ToolCallChunk` |  |
| `ToolErrorChunk` |  |
| `ToolInputChunk` |  |

### `veryfront/chat/provider-errors`

```ts
import { isCreditLimitMessage, parseKnownProblemBody, parseProviderError } from "veryfront/chat/provider-errors";
```

#### Functions

| Name | Description |
|------|-------------|
| `isCreditLimitMessage` |  |
| `parseKnownProblemBody` |  |
| `parseProviderError` |  |
| `safeJsonParse` |  |

#### Types

| Name | Description |
|------|-------------|
| `ParsedProviderError` |  |
| `SafeJsonParseResult` |  |

### `veryfront/chat/stream-watchdog`

```ts
import { createChatStreamWatchdog, createChatStreamWatchdogState, getNextChatStreamWatchdogState } from "veryfront/chat/stream-watchdog";
```

#### Components

| Name | Description |
|------|-------------|
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` |  |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` |  |

#### Functions

| Name | Description |
|------|-------------|
| `createChatStreamWatchdog` |  |
| `createChatStreamWatchdogState` |  |
| `getNextChatStreamWatchdogState` |  |
| `isHeartbeatOnlyMetadataChunk` |  |
| `isLongRunningToolRunning` |  |

#### Classes

| Name | Description |
|------|-------------|
| `ChatStreamIdleTimeoutError` |  |

#### Types

| Name | Description |
|------|-------------|
| `ChatStreamWatchdogOptions` |  |
| `ChatStreamWatchdogPhase` |  |
| `ChatStreamWatchdogState` |  |

### `veryfront/chat/types`

```ts
import { buildDataFileAnnotation, isImageFile, isTextPreviewFile } from "veryfront/chat/types";
```

#### Functions

| Name | Description |
|------|-------------|
| `buildDataFileAnnotation` |  |
| `isImageFile` |  |
| `isTextPreviewFile` |  |
| `isValidImageFile` |  |
| `normalizeInlineAttachmentMediaType` |  |

#### Types

| Name | Description |
|------|-------------|
| `ChatAssistantContentPart` |  |
| `ChatAssistantMessage` |  |
| `ChatDataUiPart` |  |
| `ChatDynamicToolUiPart` |  |
| `ChatFileUiPart` |  |
| `ChatMessageMetadata` |  |
| `ChatMessageMetadataUsage` |  |
| `ChatModelFilePart` |  |
| `ChatModelMessage` |  |
| `ChatModelReasoningPart` |  |
| `ChatModelTextPart` |  |
| `ChatNamedToolUiPart` |  |
| `ChatReasoningUiPart` |  |
| `ChatRequestContext` |  |
| `ChatRuntimeOverrides` |  |
| `ChatSourceDocumentUiPart` |  |
| `ChatSourceUrlUiPart` |  |
| `ChatStepStartUiPart` |  |
| `ChatSystemMessage` |  |
| `ChatTextUiPart` |  |
| `ChatToolCallPart` |  |
| `ChatToolMessage` |  |
| `ChatToolPartBase` |  |
| `ChatToolPartState` |  |
| `ChatToolResultOutput` |  |
| `ChatToolResultPart` |  |
| `ChatUiMessage` |  |
| `ChatUiMessageChunk` |  |
| `ChatUiMessagePart` |  |
| `ChatUiMessageRole` |  |
| `ChatUserContentPart` |  |
| `ChatUserMessage` |  |
| `ChildRunAudit` |  |
| `ChildRunAuditToolCall` |  |
| `ChildRunAuditToolResult` |  |
| `DurableRootRunDescriptor` |  |
| `FileUIPartWithUpload` |  |
| `JsonValue` |  |
| `ProjectFile` |  |
| `ProjectFileListItem` |  |
| `ProviderModelMessage` |  |
| `UploadedFileReference` |  |

#### Constants

| Name | Description |
|------|-------------|
| `chatRequestContextSchema` |  |
| `chatToolPartStateSchema` |  |
| `chatUiMessagePartSchema` |  |
| `chatUiMessageRoleSchema` |  |
| `chatUiMessageSchema` |  |
| `chatUiMessagesSchema` |  |
| `getChatRequestContextSchema` |  |
| `getChatToolPartStateSchema` |  |
| `getChatUiMessagePartSchema` |  |
| `getChatUiMessageRoleSchema` |  |
| `getChatUiMessageSchema` |  |
| `getChatUiMessagesSchema` |  |
| `getMessageMetadataSchema` |  |
| `imageFileTypes` |  |
| `messageMetadataSchema` |  |
| `textFileExtensions` |  |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Server-side agent runtime that powers chat
- [`veryfront/tool`](./tool.md): Define tools that agents can call

User guides:

- [chat-ui](../../guides/chat-ui.md): Compose chat UI in the browser
- [chat-hooks](../../guides/chat-hooks.md): Manage chat state and streaming
- [chat-composition](../../guides/chat-composition.md): Mix prebuilt and custom chat pieces
- [chat-theming](../../guides/chat-theming.md): Theme chat components

Architecture:

- [05-agent-runtime](../../architecture/05-agent-runtime.md): AI primitives and chat surfaces
- [06-ag-ui-transport](../../architecture/06-ag-ui-transport.md): AG-UI streaming transport
