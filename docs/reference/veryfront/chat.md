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
| `editMessage` | <code>(messageId: string, newText: string) =&gt; Promise&lt;void&gt;</code> | Edit a user message and resubmit - truncates history to that point |
| `getBranches` | <code>(messageId: string) =&gt; BranchInfo</code> | Get branch info for a message (returns { current, total }; total=1 if no branches) |
| `switchBranch` | <code>(messageId: string, branchIndex: number) =&gt; void</code> | Switch to a different branch at a given message |
| `reload` | <code>() =&gt; Promise&lt;void&gt;</code> | Re-send last user message |
| `stop` | <code>() =&gt; void</code> | Abort current request |
| `setMessages` | <code>(messages: ChatMessage[]) =&gt; void</code> | Replace message history |
| `addToolOutput` | <code>(output: ToolOutput) =&gt; void</code> | Submit client-side tool result |
| `data?` | `unknown` | Extra data from server response |
| `handleInputChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Bind to input onChange |
| `handleSubmit` | <code>(e: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Submit current input |
| `onChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Alias for `handleInputChange` - matches `ChatProps.onChange` for easy spreading |
| `onSubmit` | <code>(e: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Alias for `handleSubmit` - matches `ChatProps.onSubmit` for easy spreading |
| `onModelChange` | <code>(model: string &#124; undefined) =&gt; void</code> | Alias for `setModel` - matches `ChatProps.onModelChange` for easy spreading |

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

| Name | Description | Source |
|------|-------------|--------|
| `AgentCard` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L34) |
| `AttachmentPill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L37) |
| `BranchPicker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L10) |
| `Chat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L262) |
| `ChatComponents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L520) |
| `ChatComposer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L50) |
| `ChatContextProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L80) |
| `ChatEmpty` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L23) |
| `ChatIf` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L16) |
| `ChatMessageList` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L74) |
| `ChatRoot` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L67) |
| `ChatSidebar` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L133) |
| `ChatWithSidebar` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L124) |
| `ComposerContextProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L61) |
| `ConversationEmptyState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L64) |
| `ConversationScrollButton` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L101) |
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L2) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L3) |
| `DropZoneOverlay` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L8) |
| `ErrorBanner` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L16) |
| `FadeIn` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L33) |
| `InferenceBadge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L8) |
| `InlineCitation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L11) |
| `Loader` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L11) |
| `Message` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L335) |
| `MessageActions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L14) |
| `MessageContextProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L51) |
| `MessageEditForm` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L9) |
| `MessageFeedback` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L15) |
| `ModelAvatar` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L62) |
| `ModelSelector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L55) |
| `QuickActions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L16) |
| `ReasoningCard` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L12) |
| `RichCodeBlock` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L11) |
| `Shimmer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L3) |
| `SkillBadge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L15) |
| `Sources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L16) |
| `StandaloneMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L44) |
| `StepIndicator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L10) |
| `StreamingMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L147) |
| `Suggestion` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L11) |
| `Suggestions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L44) |
| `TabSwitcher` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L24) |
| `ThreadListContextProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L42) |
| `ToolCallCard` | Tool call card component - renders tool invocations with parameters and results Styled to match AI Elements (https://ai-sdk.dev/elements) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L134) |
| `ToolStatusBadge` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L43) |
| `UpgradeCTA` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/upgrade-cta.tsx#L9) |
| `UploadsPanel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L26) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildChatStreamChunkMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L116) |
| `createChatStreamWatchdog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L144) |
| `createChatStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L41) |
| `dedupeChatUiMessageChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L164) |
| `downloadMarkdown` | Download messages as a .md file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L63) |
| `exportAsMarkdown` | Convert chat messages to a markdown string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L11) |
| `extractChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L111) |
| `extractSourcesFromParts` | Extract sources from tool result parts. Looks for `documents` arrays in tool outputs and maps them to Source[]. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L117) |
| `getNextChatStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L71) |
| `getTextContent` | Get text content from chat message parts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L14) |
| `groupPartsInOrder` | Group consecutive parts for ordered rendering Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L61) |
| `isHeartbeatOnlyMetadataChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L140) |
| `isLongRunningToolRunning` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L60) |
| `isReasoningPart` | Check if a part is a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L42) |
| `isSkillToolPart` | Check if a tool part is a skill-related tool (load-skill, load-skill-reference, execute-skill-script) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L37) |
| `isToolPart` | Check if a part is a tool part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L25) |
| `mapHostedStreamPartToChatUiChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L213) |
| `normalizeChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L87) |
| `normalizeChatUiMessageChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L134) |
| `normalizeChatUiMessageStream` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L225) |
| `useAgent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L44) |
| `useChat` | useChat hook for managing chat state with veryfront stream events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/use-chat.ts#L75) |
| `useChatContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L66) |
| `useChatContextOptional` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L76) |
| `useChatErrorHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L89) |
| `useCompletion` | useCompletion hook for single text generation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L52) |
| `useComposerContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L47) |
| `useComposerContextOptional` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L57) |
| `useMessageContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L37) |
| `useMessageContextOptional` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L47) |
| `useStreaming` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L37) |
| `useThreadListContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L28) |
| `useThreadListContextOptional` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L38) |
| `useThreads` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L79) |
| `useVoiceInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L97) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatErrorBoundary` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L14) |
| `ChatStreamIdleTimeoutError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L26) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentCardProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L11) |
| `AgentTheme` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L157) |
| `AttachmentInfo` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L3) |
| `AttachmentPillProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L12) |
| `BranchInfo` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L75) |
| `BranchPickerProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L3) |
| `BrowserInferenceStatus` | Browser-side model loading and inference status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L16) |
| `BuildChatStreamChunkMessageMetadataInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L7) |
| `ChatComposerProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L17) |
| `ChatContextValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L18) |
| `ChatDynamicToolPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L46) |
| `ChatEmptyProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L11) |
| `ChatErrorBoundaryProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L2) |
| `ChatFinishReason` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L123) |
| `ChatIfProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L10) |
| `ChatMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L69) |
| `ChatMessageListProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L43) |
| `ChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L108) |
| `ChatMessageMetadataUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L77) |
| `ChatMessagePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L61) |
| `ChatProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L195) |
| `ChatReasoningPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L15) |
| `ChatRootProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L23) |
| `ChatSidebarProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L5) |
| `ChatStepPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L56) |
| `ChatStreamEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L136) |
| `ChatStreamWatchdogOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L18) |
| `ChatStreamWatchdogPhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L5) |
| `ChatStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L11) |
| `ChatTab` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L11) |
| `ChatTextPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L9) |
| `ChatTheme` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L119) |
| `ChatToolPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L28) |
| `ChatToolResultPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L38) |
| `ChatToolState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L21) |
| `ChatUiMessageChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L297) |
| `ChatWithSidebarAttachmentConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L56) |
| `ChatWithSidebarChatController` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L16) |
| `ChatWithSidebarFeatureConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L80) |
| `ChatWithSidebarGroupedProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L104) |
| `ChatWithSidebarMessageConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L73) |
| `ChatWithSidebarModelConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L52) |
| `ChatWithSidebarProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L122) |
| `ChatWithSidebarQuickActionsConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L66) |
| `ChatWithSidebarSidebarConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L42) |
| `ChatWithSidebarTabsConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L89) |
| `ChatWithSidebarVoiceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L99) |
| `ChildRunAudit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L97) |
| `ChildRunAuditToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L84) |
| `ChildRunAuditToolResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L90) |
| `CodeBlockProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L4) |
| `ComposerContextValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L14) |
| `ConversationEmptyStateProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L56) |
| `ConversationScrollButtonProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L95) |
| `DropZoneOverlayProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L3) |
| `ErrorBannerProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L10) |
| `FeedbackValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L3) |
| `HostedStreamPartForUiChunkMapping` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L27) |
| `HostedUiChunkMappingOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L2) |
| `InferenceBadgeProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L3) |
| `InferenceMode` | Where inference is happening | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L13) |
| `InlineCitationProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L4) |
| `MessageActionsProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L7) |
| `MessageContextValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L15) |
| `MessageEditFormProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L3) |
| `MessageFeedbackProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L5) |
| `MessageProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L5) |
| `MessageRootProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L55) |
| `ModelAvatarProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L12) |
| `ModelOption` | A "provider/model" value and its display label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L14) |
| `ModelSelectorProps` | Props for `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L28) |
| `OnToolCallArg` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L46) |
| `PartGroup` | Part group types for ordered rendering | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L51) |
| `QuickAction` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L3) |
| `QuickActionsProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L10) |
| `SkillBadgeProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L10) |
| `Source` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L3) |
| `SourcesProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L10) |
| `StepIndicatorProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L4) |
| `StreamingMessageProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L133) |
| `SuggestionProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L4) |
| `SuggestionsProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L38) |
| `TabSwitcherProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L13) |
| `Thread` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L4) |
| `ThreadListContextValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L13) |
| `ToolOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L38) |
| `UpgradeCTAProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/upgrade-cta.tsx#L5) |
| `UploadedFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L4) |
| `UploadsPanelProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L12) |
| `UseAgentOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L4) |
| `UseAgentResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L18) |
| `UseChatOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L55) |
| `UseChatResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L80) |
| `UseCompletionOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L9) |
| `UseCompletionResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L29) |
| `UseStreamingOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L3) |
| `UseStreamingResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L17) |
| `UseThreadsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L16) |
| `UseThreadsResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L21) |
| `UseVoiceInputOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L2) |
| `UseVoiceInputResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L25) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/chat/ag-ui`

```ts
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk, flushAgUiSseChunk } from "veryfront/chat/ag-ui";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AgUiRunFinishedMetadataSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L135) |
| `AgUiSnapshotMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L205) |
| `AgUiSnapshotToolCallSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L150) |
| `AgUiWireEventNameSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L210) |
| `AgUiWireEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L525) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgUiChatEventDecoderState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L914) |
| `decodeAgUiSseChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L932) |
| `flushAgUiSseChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L976) |
| `mapAgUiRuntimeMessagesToChatUiMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L369) |
| `parseSseEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L881) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgUiChatEventDecoderState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L85) |
| `AgUiDecodedChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L78) |
| `AgUiDecodedEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L72) |
| `AgUiDecoderValidationMode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L83) |
| `AgUiRunFinishedMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L527) |
| `AgUiRuntimeMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L41) |
| `AgUiRuntimeToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L32) |
| `AgUiSnapshotMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L530) |
| `AgUiWireEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L532) |
| `AgUiWireEventName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L531) |
| `ParsedSseEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L66) |
| `ToolCallState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L27) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAgUiRunFinishedMetadataSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L120) |
| `getAgUiSnapshotMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L169) |
| `getAgUiSnapshotToolCallSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L137) |
| `getAgUiWireEventNameSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L207) |
| `getAgUiWireEventSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L401) |

### `veryfront/chat/conversation`

```ts
import { convertUiMessagesToProviderModelMessages, extractTextFromMessage, extractUploadId } from "veryfront/chat/conversation";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `UUID_PATTERN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L152) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `convertUiMessagesToProviderModelMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L919) |
| `extractTextFromMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L468) |
| `extractUploadId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L159) |
| `getStringField` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L187) |
| `getUiToolName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L237) |
| `hasIncompleteToolParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L388) |
| `isDataUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L223) |
| `isReasoningPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L464) |
| `isRecord` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L183) |
| `isTextPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L460) |
| `isToolCallPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L442) |
| `isToolResultPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L451) |
| `isToolUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L229) |
| `isUuid` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L155) |
| `mapToolState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L164) |
| `markIncompleteToolPartsAsErrored` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L396) |
| `markIncompleteToolPartsAsStopped` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L392) |
| `pushToolParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L246) |
| `stringifyUnknown` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L213) |
| `toConversationPartsFromUiMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L316) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ApiConversation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L95) |
| `ApiMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L121) |
| `ConversationType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L65) |
| `MessagePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L58) |
| `MessageStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L72) |
| `ReasoningPartLike` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L144) |
| `TextPartLike` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L139) |
| `ToolCallLike` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L123) |
| `ToolResultLike` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L131) |
| `ToolUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L149) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `apiConversationSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L93) |
| `apiMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L119) |
| `conversationTypeSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L64) |
| `convertUiMessagesToModelMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L939) |
| `getApiConversationSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L74) |
| `getApiMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L97) |
| `getConversationTypeSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L60) |
| `getMessagePartSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L4) |
| `getMessageStatusSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L67) |
| `messagePartSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L56) |
| `messageStatusSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L71) |

### `veryfront/chat/final-step-fallback`

```ts
import { appendMissingFallbackTextPart, buildFallbackUiMessageChunks, buildFallbackUiMessageParts } from "veryfront/chat/final-step-fallback";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_STREAM_PROMISE_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L15) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `appendMissingFallbackTextPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L883) |
| `buildFallbackUiMessageChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L894) |
| `buildFallbackUiMessageParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L874) |
| `buildMissingFallbackTextChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L943) |
| `buildMissingFallbackToolChunks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L920) |
| `buildMissingFallbackToolChunksFromParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L932) |
| `extractFinalStepFinishReason` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L770) |
| `extractFinalStepTerminalError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L856) |
| `extractFinalStepText` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L778) |
| `extractFinalStepToolCalls` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L786) |
| `extractFinalStepToolResults` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L809) |
| `getLastStreamStep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L754) |
| `getStreamSteps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L762) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatFallbackPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L19) |
| `ChatPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L20) |
| `FallbackToolChunkState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L36) |
| `FinalStepTerminalError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L720) |
| `FinalStepToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L23) |
| `FinalStepToolResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L29) |

### `veryfront/chat/message-prep`

```ts
import { compactForStep, compressTurn, dedupeToolHistory } from "veryfront/chat/message-prep";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compactForStep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L776) |
| `compressTurn` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L30) |
| `dedupeToolHistory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L796) |
| `enforceTokenBudget` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L856) |
| `enforceTokenBudgetWithTurnCompression` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L104) |
| `ensureToolCallInputs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L746) |
| `estimateOverhead` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L741) |
| `estimateTokens` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L21) |
| `isModelSupportedFileMediaType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L204) |
| `maskOldToolOutputs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L518) |
| `normalizeMessageFilePartMediaTypes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L209) |
| `prepareProviderModelMessagesFromUiMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L410) |
| `repairToolPairs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L599) |
| `rewriteUnsupportedFilePartsAsAnnotations` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L235) |
| `sanitizeProviderModelMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L367) |
| `stripPendingToolParts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L305) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `prepareModelMessagesFromUiMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L871) |
| `sanitizeModelMessages` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L398) |

### `veryfront/chat/protocol`

Canonical chat message and stream protocol for Veryfront chat surfaces. These types describe the framework-owned message parts and stream events used by AG-UI-aligned chat clients, hooks, and adapters.

```ts
import "veryfront/chat/protocol";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatDynamicToolPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L46) |
| `ChatFinishReason` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L123) |
| `ChatMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L69) |
| `ChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L108) |
| `ChatMessageMetadataUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L77) |
| `ChatMessagePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L61) |
| `ChatPartState` | Canonical chat message and stream protocol for Veryfront chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L7) |
| `ChatReasoningPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L15) |
| `ChatStepPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L56) |
| `ChatStreamEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L136) |
| `ChatStreamEventBase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L131) |
| `ChatTextPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L9) |
| `ChatToolPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L28) |
| `ChatToolResultPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L38) |
| `ChatToolState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L21) |
| `ChatUiMessageChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L297) |
| `ChildRunAudit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L97) |
| `ChildRunAuditToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L84) |
| `ChildRunAuditToolResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L90) |
| `IdChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L271) |
| `IdDeltaChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L276) |
| `MessageLifecycleChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L255) |
| `NamedToolCallChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L285) |
| `ToolCallChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L280) |
| `ToolErrorChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L293) |
| `ToolInputChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L289) |

### `veryfront/chat/provider-errors`

```ts
import { isCreditLimitMessage, parseKnownProblemBody, parseProviderError } from "veryfront/chat/provider-errors";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `isCreditLimitMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L58) |
| `parseKnownProblemBody` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L30) |
| `parseProviderError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L145) |
| `safeJsonParse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L17) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ParsedProviderError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts) |
| `SafeJsonParseResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L15) |

### `veryfront/chat/stream-watchdog`

```ts
import { createChatStreamWatchdog, createChatStreamWatchdogState, getNextChatStreamWatchdogState } from "veryfront/chat/stream-watchdog";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L2) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L3) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createChatStreamWatchdog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L144) |
| `createChatStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L41) |
| `getNextChatStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L71) |
| `isHeartbeatOnlyMetadataChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L140) |
| `isLongRunningToolRunning` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L60) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatStreamIdleTimeoutError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L26) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatStreamWatchdogOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L18) |
| `ChatStreamWatchdogPhase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L5) |
| `ChatStreamWatchdogState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L11) |

### `veryfront/chat/types`

```ts
import { buildDataFileAnnotation, isImageFile, isTextPreviewFile } from "veryfront/chat/types";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildDataFileAnnotation` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L601) |
| `isImageFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L563) |
| `isTextPreviewFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L575) |
| `isValidImageFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L567) |
| `normalizeInlineAttachmentMediaType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L579) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatAssistantContentPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L219) |
| `ChatAssistantMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L237) |
| `ChatDataUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L143) |
| `ChatDynamicToolUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L133) |
| `ChatFileUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L95) |
| `ChatMessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L108) |
| `ChatMessageMetadataUsage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L77) |
| `ChatModelFilePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L178) |
| `ChatModelMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L256) |
| `ChatModelReasoningPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L173) |
| `ChatModelTextPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L168) |
| `ChatNamedToolUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L138) |
| `ChatReasoningUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L71) |
| `ChatRequestContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L308) |
| `ChatRuntimeOverrides` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L268) |
| `ChatSourceDocumentUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L87) |
| `ChatSourceUrlUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L80) |
| `ChatStepStartUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L76) |
| `ChatSystemMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L226) |
| `ChatTextUiPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L66) |
| `ChatToolCallPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L188) |
| `ChatToolMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L242) |
| `ChatToolPartBase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L119) |
| `ChatToolPartState` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L107) |
| `ChatToolResultOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L196) |
| `ChatToolResultPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L210) |
| `ChatUiMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L159) |
| `ChatUiMessageChunk` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L297) |
| `ChatUiMessagePart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L148) |
| `ChatUiMessageRole` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L64) |
| `ChatUserContentPart` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L218) |
| `ChatUserMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L232) |
| `ChildRunAudit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L97) |
| `ChildRunAuditToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L84) |
| `ChildRunAuditToolResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L90) |
| `DurableRootRunDescriptor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L258) |
| `FileUIPartWithUpload` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L102) |
| `JsonValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L166) |
| `MessageMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L108) |
| `ProjectFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L274) |
| `ProjectFileListItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L279) |
| `ProviderModelMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L247) |
| `UploadedFileReference` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L287) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `chatRequestContextSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L306) |
| `chatToolPartStateSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L399) |
| `chatUiMessagePartSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L519) |
| `chatUiMessageRoleSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L381) |
| `chatUiMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L531) |
| `chatUiMessagesSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L536) |
| `getChatRequestContextSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L296) |
| `getChatToolPartStateSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L383) |
| `getChatUiMessagePartSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L504) |
| `getChatUiMessageRoleSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L376) |
| `getChatUiMessageSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L521) |
| `getChatUiMessagesSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L533) |
| `getMessageMetadataSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L356) |
| `imageFileTypes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L50) |
| `messageMetadataSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L374) |
| `textFileExtensions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L48) |

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
