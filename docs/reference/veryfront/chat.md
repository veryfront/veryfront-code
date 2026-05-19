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

Options accepted by use chat.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `api` | `string` | Chat API endpoint URL | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L60) |
| `transport?` | `"ag-ui"` | Streaming response protocol used by the endpoint. AG-UI is the default. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L62) |
| `initialMessages?` | `ChatMessage[]` | Pre-populated messages | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L63) |
| `body?` | <code>Record&lt;string, unknown&gt;</code> | Extra body fields sent with each request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L64) |
| `headers?` | <code>Record&lt;string, string&gt;</code> | Custom request headers | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L65) |
| `credentials?` | `RequestCredentials` | Fetch credentials mode | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L66) |
| `model?` | `string` | Override model at runtime (e.g. "openai/gpt-4o", "Anthropic/claude-sonnet-4-5-20250929") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L68) |
| `systemPrompt?` | `string` | System prompt for browser-side inference (server uses agent config) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L70) |
| `browserFallback?` | `boolean` | Enable/disable browser fallback when server can't provide a runtime. Default: true | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L72) |
| `onResponse?` | <code>(response: Response) =&gt; void</code> | Raw response callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L73) |
| `onFinish?` | <code>(message: ChatMessage) =&gt; void</code> | Completion callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L74) |
| `onError?` | <code>(error: Error) =&gt; void</code> | Error callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L75) |
| `onToolCall?` | <code>(arg: OnToolCallArg) =&gt; void &#124; Promise&lt;void&gt;</code> | Tool call handler for client-side execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L76) |

### `UseChatResult`

Result returned from use chat.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `messages` | `ChatMessage[]` | All messages in the conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L87) |
| `input` | `string` | Current input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L88) |
| `isLoading` | `boolean` | Whether a request is in flight | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L89) |
| `error` | `Error \| null` | Last error (if any) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L90) |
| `model` | `string \| undefined` | Current model override (undefined = use agent default) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L92) |
| `activeModel` | `string \| undefined` | The actual model being used after auto-upgrade (e.g. "Anthropic/claude-sonnet-4-20250514") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L94) |
| `inferenceMode` | `InferenceMode` | Where inference is currently happening | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L96) |
| `browserStatus` | `BrowserInferenceStatus \| null` | Browser-side model loading/inference status (null when not using browser fallback) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L98) |
| `setInput` | <code>(input: string) =&gt; void</code> | Set input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L99) |
| `setModel` | <code>(model: string &#124; undefined) =&gt; void</code> | Change the model for subsequent requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L101) |
| `sendMessage` | <code>(message: &#123; text: string &#125;) =&gt; Promise&lt;void&gt;</code> | Send a message programmatically | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L102) |
| `editMessage` | <code>(messageId: string, newText: string) =&gt; Promise&lt;void&gt;</code> | Edit a user message and resubmit - truncates history to that point | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L104) |
| `getBranches` | <code>(messageId: string) =&gt; BranchInfo</code> | Get branch info for a message (returns { current, total }; total=1 if no branches) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L106) |
| `switchBranch` | <code>(messageId: string, branchIndex: number) =&gt; void</code> | Switch to a different branch at a given message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L108) |
| `reload` | <code>() =&gt; Promise&lt;void&gt;</code> | Re-send last user message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L109) |
| `stop` | <code>() =&gt; void</code> | Abort current request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L110) |
| `setMessages` | <code>(messages: ChatMessage[]) =&gt; void</code> | Replace message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L111) |
| `addToolOutput` | <code>(output: ToolOutput) =&gt; void</code> | Submit client-side tool result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L112) |
| `data?` | `unknown` | Extra data from server response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L113) |
| `handleInputChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Bind to input onChange | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L114) |
| `handleSubmit` | <code>(e: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Submit current input | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L115) |
| `onChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Alias for `handleInputChange` - matches `ChatProps.onChange` for easy spreading | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L117) |
| `onSubmit` | <code>(e: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Alias for `handleSubmit` - matches `ChatProps.onSubmit` for easy spreading | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L119) |
| `onModelChange` | <code>(model: string &#124; undefined) =&gt; void</code> | Alias for `setModel` - matches `ChatProps.onModelChange` for easy spreading | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L121) |

### `UseAgentOptions`

Options accepted by use agent.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `agent` | `string` | Agent ID or endpoint | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L8) |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback when tool is called | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L11) |
| `onToolResult?` | <code>(toolCall: ToolCall, result: unknown) =&gt; void</code> | Callback when tool result received | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L14) |
| `onError?` | <code>(error: Error) =&gt; void</code> | Callback when error occurs | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L17) |

### `UseAgentResult`

Result returned from use agent.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `messages` | `AgentMessage[]` | Message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L23) |
| `toolCalls` | `ToolCall[]` | Active tool calls | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L26) |
| `status` | `AgentStatus` | Agent status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L29) |
| `thinking?` | `string` | Thinking/reasoning text | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L32) |
| `invoke` | <code>(input: string) =&gt; Promise&lt;void&gt;</code> | Invoke the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L35) |
| `stop` | <code>() =&gt; void</code> | Stop agent execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L38) |
| `isLoading` | `boolean` | Loading state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L41) |
| `error` | `Error \| null` | Error state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L44) |

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AgentCard` | Render agent card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L37) |
| `AttachmentPill` | Render attachment pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L41) |
| `BranchPicker` | Render branch picker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L13) |
| `Chat` | Render chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L265) |
| `ChatComponents` | Render chat components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L524) |
| `ChatComposer` | Render chat composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L53) |
| `ChatContextProvider` | Render chat context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L85) |
| `ChatEmpty` | Render chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L26) |
| `ChatIf` | Render chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L19) |
| `ChatMessageList` | Render chat message list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L77) |
| `ChatRoot` | Render chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L70) |
| `ChatSidebar` | Render chat sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L136) |
| `ChatWithSidebar` | Render chat with sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L137) |
| `ComposerContextProvider` | Render composer context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L66) |
| `ConversationEmptyState` | State for conversation empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L71) |
| `ConversationScrollButton` | Render conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L110) |
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` | Default value for chat stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L4) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` | Default value for chat stream tool running timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L6) |
| `DropZoneOverlay` | Render drop zone overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L11) |
| `ErrorBanner` | Render error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L19) |
| `FadeIn` | Render fade in. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L37) |
| `InferenceBadge` | Render inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L11) |
| `InlineCitation` | Render inline citation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L14) |
| `Loader` | Render loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L14) |
| `Message` | Message shape for message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L338) |
| `MessageActions` | Render message actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L17) |
| `MessageContextProvider` | Render message context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L56) |
| `MessageEditForm` | Render message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L12) |
| `MessageFeedback` | Render message feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L19) |
| `ModelAvatar` | Render model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L65) |
| `ModelSelector` | Render model selector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L57) |
| `QuickActions` | Render quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L20) |
| `ReasoningCard` | Render reasoning card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L14) |
| `RichCodeBlock` | Render rich code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L14) |
| `Shimmer` | Render shimmer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L5) |
| `SkillBadge` | Render skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L18) |
| `Sources` | Render sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L20) |
| `StandaloneMessage` | Render a standalone chat message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L46) |
| `StepIndicator` | Render step indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L13) |
| `StreamingMessage` | Message shape for streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L151) |
| `Suggestion` | Render suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L14) |
| `Suggestions` | Render suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L49) |
| `TabSwitcher` | Render tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L28) |
| `ThreadListContextProvider` | Render thread list context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L47) |
| `ToolCallCard` | Tool call card component - renders tool invocations with parameters and results Styled to match AI Elements (https://ai-sdk.dev/elements) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L136) |
| `ToolStatusBadge` | Render tool status badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L45) |
| `UpgradeCTA` | Render upgrade CTA. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/upgrade-cta.tsx#L12) |
| `UploadsPanel` | Render uploads panel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L30) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L121) |
| `createChatStreamWatchdog` | Create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L156) |
| `createChatStreamWatchdogState` | State for create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L49) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L171) |
| `downloadMarkdown` | Download messages as a .md file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L64) |
| `exportAsMarkdown` | Convert chat messages to a markdown string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L12) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L115) |
| `extractSourcesFromParts` | Extract sources from tool result parts. Looks for `documents` arrays in tool outputs and maps them to Source[]. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L118) |
| `getNextChatStreamWatchdogState` | State for get next chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L81) |
| `getTextContent` | Get text content from chat message parts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L15) |
| `groupPartsInOrder` | Group consecutive parts for ordered rendering Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L62) |
| `isHeartbeatOnlyMetadataChunk` | Check whether a chunk only carries heartbeat metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L151) |
| `isLongRunningToolRunning` | Check whether a long-running tool is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L69) |
| `isReasoningPart` | Check if a part is a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L43) |
| `isSkillToolPart` | Check if a tool part is a skill-related tool (load-skill, load-skill-reference, execute-skill-script) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L38) |
| `isToolPart` | Check if a part is a tool part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L26) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L217) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L90) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L140) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L233) |
| `useAgent` | React hook for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L48) |
| `useChat` | useChat hook for managing chat state with veryfront stream events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/use-chat.ts#L76) |
| `useChatContext` | Context for use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L69) |
| `useChatContextOptional` | React hook for chat context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L80) |
| `useChatErrorHandler` | Handler for use chat error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L93) |
| `useCompletion` | useCompletion hook for single text generation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L55) |
| `useComposerContext` | Context for use composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L50) |
| `useComposerContextOptional` | React hook for composer context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L61) |
| `useMessageContext` | Context for use message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L40) |
| `useMessageContextOptional` | React hook for message context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L51) |
| `useStreaming` | React hook for streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L41) |
| `useThreadListContext` | Context for use thread list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L31) |
| `useThreadListContextOptional` | React hook for thread list context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L42) |
| `useThreads` | React hook for threads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L84) |
| `useVoiceInput` | Input payload for use voice. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L101) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatErrorBoundary` | Implement chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L17) |
| `ChatStreamIdleTimeoutError` | Error shape for chat stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L33) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentCardProps` | Props accepted by agent card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L13) |
| `AgentTheme` | Public API contract for agent theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L160) |
| `AttachmentInfo` | Public API contract for attachment info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L5) |
| `AttachmentPillProps` | Props accepted by attachment pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L15) |
| `BranchInfo` | Public API contract for branch info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L80) |
| `BranchPickerProps` | Props accepted by branch picker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L5) |
| `BrowserInferenceStatus` | Browser-side model loading and inference status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L17) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L9) |
| `ChatComposerProps` | Props accepted by chat composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L19) |
| `ChatContextValue` | Public API contract for chat context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L20) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L53) |
| `ChatEmptyProps` | Props accepted by chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L13) |
| `ChatErrorBoundaryProps` | Props accepted by chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L4) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L139) |
| `ChatIfProps` | Props accepted by chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L12) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L79) |
| `ChatMessageListProps` | Props accepted by chat message list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L45) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L123) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L88) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L70) |
| `ChatProps` | Props accepted by chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L197) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L18) |
| `ChatRootProps` | Props accepted by chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L25) |
| `ChatSidebarProps` | Props accepted by chat sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L7) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L64) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L154) |
| `ChatStreamWatchdogOptions` | Options accepted by chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L24) |
| `ChatStreamWatchdogPhase` | Public API contract for chat stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L9) |
| `ChatStreamWatchdogState` | State for chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L16) |
| `ChatTab` | Public API contract for chat tab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L13) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L11) |
| `ChatTheme` | Public API contract for chat theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L121) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L33) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L44) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L25) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L323) |
| `ChatWithSidebarAttachmentConfig` | Configuration used by chat with sidebar attachment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L61) |
| `ChatWithSidebarChatController` | Public API contract for chat with sidebar chat controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L18) |
| `ChatWithSidebarFeatureConfig` | Configuration used by chat with sidebar feature. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L88) |
| `ChatWithSidebarGroupedProps` | Props accepted by chat with sidebar grouped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L115) |
| `ChatWithSidebarMessageConfig` | Configuration used by chat with sidebar message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L80) |
| `ChatWithSidebarModelConfig` | Configuration used by chat with sidebar model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L56) |
| `ChatWithSidebarProps` | Props accepted by chat with sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L134) |
| `ChatWithSidebarQuickActionsConfig` | Configuration used by chat with sidebar quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L72) |
| `ChatWithSidebarSidebarConfig` | Configuration used by chat with sidebar sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L45) |
| `ChatWithSidebarTabsConfig` | Configuration used by chat with sidebar tabs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L98) |
| `ChatWithSidebarVoiceConfig` | Configuration used by chat with sidebar voice. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L109) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L96) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L103) |
| `CodeBlockProps` | Props accepted by code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L6) |
| `ComposerContextValue` | Public API contract for composer context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L16) |
| `ConversationEmptyStateProps` | Props accepted by conversation empty state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L62) |
| `ConversationScrollButtonProps` | Props accepted by conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L103) |
| `DropZoneOverlayProps` | Props accepted by drop zone overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L5) |
| `ErrorBannerProps` | Props accepted by error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L12) |
| `FeedbackValue` | Public API contract for feedback value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L5) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L30) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L4) |
| `InferenceBadgeProps` | Props accepted by inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L5) |
| `InferenceMode` | Where inference is happening | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L14) |
| `InlineCitationProps` | Props accepted by inline citation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L6) |
| `MessageActionsProps` | Props accepted by message actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L9) |
| `MessageContextValue` | Public API contract for message context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L17) |
| `MessageEditFormProps` | Props accepted by message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L5) |
| `MessageFeedbackProps` | Props accepted by message feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L8) |
| `MessageProps` | Props accepted by message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L7) |
| `MessageRootProps` | Props accepted by message root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L57) |
| `ModelAvatarProps` | Props accepted by model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L14) |
| `ModelOption` | A "provider/model" value and its display label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L15) |
| `ModelSelectorProps` | Props accepted by `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L29) |
| `OnToolCallArg` | Public API contract for on tool call arg. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L49) |
| `PartGroup` | Part group types for ordered rendering | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L52) |
| `QuickAction` | Public API contract for quick action. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L5) |
| `QuickActionsProps` | Props accepted by quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L13) |
| `SkillBadgeProps` | Props accepted by skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L12) |
| `Source` | Public API contract for source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L5) |
| `SourcesProps` | Props accepted by sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L13) |
| `StepIndicatorProps` | Props accepted by step indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L6) |
| `StreamingMessageProps` | Props accepted by streaming message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L136) |
| `SuggestionProps` | Props accepted by suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L6) |
| `SuggestionsProps` | Props accepted by suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L42) |
| `TabSwitcherProps` | Props accepted by tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L16) |
| `Thread` | Public API contract for thread. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L6) |
| `ThreadListContextValue` | Public API contract for thread list context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L15) |
| `ToolOutput` | Output from tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L40) |
| `UpgradeCTAProps` | Props accepted by the upgrade CTA. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/upgrade-cta.tsx#L7) |
| `UploadedFile` | Public API contract for uploaded file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L6) |
| `UploadsPanelProps` | Props accepted by uploads panel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L15) |
| `UseAgentOptions` | Options accepted by use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L6) |
| `UseAgentResult` | Result returned from use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L21) |
| `UseChatOptions` | Options accepted by use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L59) |
| `UseChatResult` | Result returned from use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L86) |
| `UseCompletionOptions` | Options accepted by use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L11) |
| `UseCompletionResult` | Result returned from use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L32) |
| `UseStreamingOptions` | Options accepted by use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L5) |
| `UseStreamingResult` | Result returned from use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L20) |
| `UseThreadsOptions` | Options accepted by use threads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L19) |
| `UseThreadsResult` | Result returned from use threads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L25) |
| `UseVoiceInputOptions` | Options accepted by use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L4) |
| `UseVoiceInputResult` | Result returned from use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L28) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/chat/ag-ui`

```ts
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk, flushAgUiSseChunk } from "veryfront/chat/ag-ui";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AgUiRunFinishedMetadataSchema` | Schema for AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L147) |
| `AgUiSnapshotMessageSchema` | Schema for AG-UI snapshot message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L223) |
| `AgUiSnapshotToolCallSchema` | Schema for AG-UI snapshot tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L165) |
| `AgUiWireEventNameSchema` | Schema for AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L231) |
| `AgUiWireEventSchema` | Schema for AG-UI wire event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L550) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgUiChatEventDecoderState` | State for create AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L945) |
| `decodeAgUiSseChunk` | Decode AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L964) |
| `flushAgUiSseChunk` | Flush AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L1009) |
| `mapAgUiRuntimeMessagesToChatUiMessages` | Map AG-UI runtime messages to chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L391) |
| `parseSseEvent` | Event emitted for parse sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L911) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgUiChatEventDecoderState` | State for AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L94) |
| `AgUiDecodedChunk` | Public API contract for AG-UI decoded chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L85) |
| `AgUiDecodedEvent` | Event emitted for AG-UI decoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L78) |
| `AgUiDecoderValidationMode` | Public API contract for AG-UI decoder validation mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L91) |
| `AgUiRunFinishedMetadata` | Public API contract for AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L553) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L45) |
| `AgUiRuntimeToolCall` | Public API contract for AG-UI runtime tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L35) |
| `AgUiSnapshotMessage` | Message shape for AG-UI snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L557) |
| `AgUiWireEvent` | Event emitted for AG-UI wire. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L561) |
| `AgUiWireEventName` | Public API contract for AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L559) |
| `ParsedSseEvent` | Event emitted for parsed sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L71) |
| `ToolCallState` | State for tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L29) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAgUiRunFinishedMetadataSchema` | Zod schema for get AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L130) |
| `getAgUiSnapshotMessageSchema` | Zod schema for get AG-UI snapshot message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L185) |
| `getAgUiSnapshotToolCallSchema` | Zod schema for get AG-UI snapshot tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L150) |
| `getAgUiWireEventNameSchema` | Zod schema for get AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L226) |
| `getAgUiWireEventSchema` | Zod schema for get AG-UI wire event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L424) |

### `veryfront/chat/conversation`

```ts
import { convertUiMessagesToProviderModelMessages, extractTextFromMessage, extractUploadId } from "veryfront/chat/conversation";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `UUID_PATTERN` | Shared UUID pattern value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L179) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `convertUiMessagesToProviderModelMessages` | Convert UI messages to provider model messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L966) |
| `extractTextFromMessage` | Message shape for extract text from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L514) |
| `extractUploadId` | Extract upload ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L188) |
| `getStringField` | Return string field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L219) |
| `getUiToolName` | Return UI tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L273) |
| `hasIncompleteToolParts` | Check whether incomplete tool parts is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L427) |
| `isDataUiPart` | Check whether a chat part is a custom data part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L257) |
| `isReasoningPart` | Check whether a value is a reasoning part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L509) |
| `isRecord` | Record shape for is. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L214) |
| `isTextPart` | Check whether a value is a text part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L504) |
| `isToolCallPart` | Check whether a value is a tool-call part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L484) |
| `isToolResultPart` | Check whether a value is a tool-result part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L494) |
| `isToolUiPart` | Check whether a chat part is a tool UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L264) |
| `isUuid` | Check whether a value is a UUID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L183) |
| `mapToolState` | State for map tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L194) |
| `markIncompleteToolPartsAsErrored` | Mark incomplete tool parts as errored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L437) |
| `markIncompleteToolPartsAsStopped` | Mark incomplete tool parts as stopped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L432) |
| `pushToolParts` | Push tool parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L283) |
| `stringifyUnknown` | Stringify unknown helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L246) |
| `toConversationPartsFromUiMessage` | Message shape for to conversation parts from UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L354) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ApiConversation` | Public API contract for API conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L112) |
| `ApiMessage` | Message shape for API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L142) |
| `ConversationType` | Public API contract for conversation type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L74) |
| `MessagePart` | Public API contract for message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L63) |
| `MessageStatus` | Public API contract for message status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L85) |
| `ReasoningPartLike` | Reasoning-like provider message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L169) |
| `TextPartLike` | Text-like provider message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L163) |
| `ToolCallLike` | Public API contract for tool call like. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L145) |
| `ToolResultLike` | Public API contract for tool result like. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L154) |
| `ToolUiPart` | Chat UI tool part with a call ID and state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L175) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `apiConversationSchema` | Schema for API conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L109) |
| `apiMessageSchema` | Schema for API message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L139) |
| `conversationTypeSchema` | Schema for conversation type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L72) |
| `convertUiMessagesToModelMessages` | Shared convert UI messages to model messages value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L987) |
| `getApiConversationSchema` | Zod schema for get API conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L88) |
| `getApiMessageSchema` | Zod schema for get API message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L115) |
| `getConversationTypeSchema` | Zod schema for get conversation type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L66) |
| `getMessagePartSchema` | Zod schema for get message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L6) |
| `getMessageStatusSchema` | Zod schema for get message status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L77) |
| `messagePartSchema` | Schema for message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L60) |
| `messageStatusSchema` | Schema for message status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L83) |

### `veryfront/chat/final-step-fallback`

```ts
import { appendMissingFallbackTextPart, buildFallbackUiMessageChunks, buildFallbackUiMessageParts } from "veryfront/chat/final-step-fallback";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_STREAM_PROMISE_TIMEOUT_MS` | Default value for stream promise timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L17) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `appendMissingFallbackTextPart` | Append missing fallback text part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L900) |
| `buildFallbackUiMessageChunks` | Builds fallback UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L912) |
| `buildFallbackUiMessageParts` | Builds fallback UI message parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L890) |
| `buildMissingFallbackTextChunks` | Builds missing fallback text chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L964) |
| `buildMissingFallbackToolChunks` | Builds missing fallback tool chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L939) |
| `buildMissingFallbackToolChunksFromParts` | Builds missing fallback tool chunks from parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L952) |
| `extractFinalStepFinishReason` | Extract final step finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L781) |
| `extractFinalStepTerminalError` | Error shape for extract final step terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L871) |
| `extractFinalStepText` | Extract final step text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L790) |
| `extractFinalStepToolCalls` | Extract final step tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L799) |
| `extractFinalStepToolResults` | Extract final step tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L823) |
| `getLastStreamStep` | Return last stream step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L763) |
| `getStreamSteps` | Return stream steps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L772) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatFallbackPart` | Public API contract for chat fallback part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L22) |
| `ChatPart` | Public API contract for chat part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L24) |
| `FallbackToolChunkState` | State for fallback tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L43) |
| `FinalStepTerminalError` | Error shape for final step terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L728) |
| `FinalStepToolCall` | Public API contract for final step tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L28) |
| `FinalStepToolResult` | Result returned from final step tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L35) |

### `veryfront/chat/message-prep`

```ts
import { compactForStep, compressTurn, dedupeToolHistory } from "veryfront/chat/message-prep";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compactForStep` | Compact for step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L792) |
| `compressTurn` | Compress turn. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L33) |
| `dedupeToolHistory` | Dedupe tool history. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L813) |
| `enforceTokenBudget` | Enforce token budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L874) |
| `enforceTokenBudgetWithTurnCompression` | Enforce token budget with turn compression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L108) |
| `ensureToolCallInputs` | Ensure tool call inputs helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L761) |
| `estimateOverhead` | Estimate overhead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L755) |
| `estimateTokens` | Estimate tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L23) |
| `isModelSupportedFileMediaType` | Check whether the model supports the file media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L209) |
| `maskOldToolOutputs` | Mask old tool outputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L530) |
| `normalizeMessageFilePartMediaTypes` | Normalizes message file part media types. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L215) |
| `prepareProviderModelMessagesFromUiMessages` | Prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L421) |
| `repairToolPairs` | Repair tool pairs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L612) |
| `rewriteUnsupportedFilePartsAsAnnotations` | Rewrite unsupported file parts as annotations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L242) |
| `sanitizeProviderModelMessages` | Sanitize provider model messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L376) |
| `stripPendingToolParts` | Strip pending tool parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L313) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `prepareModelMessagesFromUiMessages` | Shared prepare model messages from UI messages value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L890) |
| `sanitizeModelMessages` | Shared sanitize model messages value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L408) |

### `veryfront/chat/protocol`

Canonical chat message and stream protocol for Veryfront chat surfaces. These types describe the framework-owned message parts and stream events used by AG-UI-aligned chat clients, hooks, and adapters.

```ts
import "veryfront/chat/protocol";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L53) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L139) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L79) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L123) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L88) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L70) |
| `ChatPartState` | Canonical chat message and stream protocol for Veryfront chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L8) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L18) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L64) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L154) |
| `ChatStreamEventBase` | Public API contract for chat stream event base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L11) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L33) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L44) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L25) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L323) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L96) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L103) |
| `IdChunk` | Public API contract for ID chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L291) |
| `IdDeltaChunk` | Public API contract for ID delta chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L297) |
| `MessageLifecycleChunk` | Public API contract for message lifecycle chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L274) |
| `NamedToolCallChunk` | Public API contract for named tool call chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L308) |
| `ToolCallChunk` | Public API contract for tool call chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L302) |
| `ToolErrorChunk` | Public API contract for tool error chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L318) |
| `ToolInputChunk` | Public API contract for tool input chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L313) |

### `veryfront/chat/provider-errors`

Error shape for parsed provider.

```ts
import { isCreditLimitMessage, parseKnownProblemBody, parseProviderError } from "veryfront/chat/provider-errors";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `isCreditLimitMessage` | Message shape for is credit limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L64) |
| `parseKnownProblemBody` | Parses known problem body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L35) |
| `parseProviderError` | Error shape for parse provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L152) |
| `safeJsonParse` | Parse JSON safely without throwing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L21) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ParsedProviderError` | Error shape for parsed provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L2) |
| `SafeJsonParseResult` | Result returned from safe JSON parse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L18) |

### `veryfront/chat/stream-watchdog`

```ts
import { createChatStreamWatchdog, createChatStreamWatchdogState, getNextChatStreamWatchdogState } from "veryfront/chat/stream-watchdog";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` | Default value for chat stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L4) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` | Default value for chat stream tool running timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L6) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createChatStreamWatchdog` | Create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L156) |
| `createChatStreamWatchdogState` | State for create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L49) |
| `getNextChatStreamWatchdogState` | State for get next chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L81) |
| `isHeartbeatOnlyMetadataChunk` | Check whether a chunk only carries heartbeat metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L151) |
| `isLongRunningToolRunning` | Check whether a long-running tool is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L69) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatStreamIdleTimeoutError` | Error shape for chat stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L33) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatStreamWatchdogOptions` | Options accepted by chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L24) |
| `ChatStreamWatchdogPhase` | Public API contract for chat stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L9) |
| `ChatStreamWatchdogState` | State for chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L16) |

### `veryfront/chat/types`

```ts
import { buildDataFileAnnotation, isImageFile, isTextPreviewFile } from "veryfront/chat/types";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildDataFileAnnotation` | Builds data file annotation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L666) |
| `isImageFile` | Check whether a file is an image. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L624) |
| `isTextPreviewFile` | Check whether a file supports text preview. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L638) |
| `isValidImageFile` | Check whether a file is a supported image upload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L629) |
| `normalizeInlineAttachmentMediaType` | Normalizes inline attachment media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L643) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatAssistantContentPart` | Public API contract for chat assistant content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L246) |
| `ChatAssistantMessage` | Message shape for chat assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L267) |
| `ChatDataUiPart` | Chat UI part that carries custom data chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L159) |
| `ChatDynamicToolUiPart` | Tool UI part for a runtime-selected tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L147) |
| `ChatFileUiPart` | Public API contract for chat file UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L105) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L123) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L88) |
| `ChatModelFilePart` | Public API contract for chat model file part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L200) |
| `ChatModelMessage` | Message shape for chat model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L289) |
| `ChatModelReasoningPart` | Provider model message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L194) |
| `ChatModelTextPart` | Provider model message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L188) |
| `ChatNamedToolUiPart` | Tool UI part keyed by a static tool type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L153) |
| `ChatReasoningUiPart` | Public API contract for chat reasoning UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L77) |
| `ChatRequestContext` | Context for chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L350) |
| `ChatRuntimeOverrides` | Public API contract for chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L303) |
| `ChatSourceDocumentUiPart` | Public API contract for chat source document UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L96) |
| `ChatSourceUrlUiPart` | Public API contract for chat source URL UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L88) |
| `ChatStepStartUiPart` | Public API contract for chat step start UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L83) |
| `ChatSystemMessage` | Message shape for chat system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L254) |
| `ChatTextUiPart` | Public API contract for chat text UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L71) |
| `ChatToolCallPart` | Provider model message part that carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L211) |
| `ChatToolMessage` | Message shape for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L273) |
| `ChatToolPartBase` | Public API contract for chat tool part base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L132) |
| `ChatToolPartState` | State for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L119) |
| `ChatToolResultOutput` | Output from chat tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L220) |
| `ChatToolResultPart` | Provider model message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L235) |
| `ChatUiMessage` | Message shape for chat UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L177) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L323) |
| `ChatUiMessagePart` | Public API contract for chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L165) |
| `ChatUiMessageRole` | Public API contract for chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L68) |
| `ChatUserContentPart` | Public API contract for chat user content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L244) |
| `ChatUserMessage` | Message shape for chat user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L261) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L96) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L103) |
| `DurableRootRunDescriptor` | Public API contract for durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L292) |
| `FileUIPartWithUpload` | File UI part enriched with upload metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L113) |
| `JsonValue` | JSON-compatible value used in chat tool output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L185) |
| `ProjectFile` | Public API contract for project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L310) |
| `ProjectFileListItem` | Public API contract for project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L316) |
| `ProviderModelMessage` | Message shape for provider model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L279) |
| `UploadedFileReference` | Public API contract for uploaded file reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L325) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `chatRequestContextSchema` | Schema for chat request context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L347) |
| `chatToolPartStateSchema` | Schema for chat tool part state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L450) |
| `chatUiMessagePartSchema` | Schema for chat ui message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L573) |
| `chatUiMessageRoleSchema` | Schema for chat ui message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L429) |
| `chatUiMessageSchema` | Schema for chat ui message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L588) |
| `chatUiMessagesSchema` | Schema for chat ui messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L596) |
| `getChatRequestContextSchema` | Zod schema for get chat request context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L335) |
| `getChatToolPartStateSchema` | Zod schema for get chat tool part state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L432) |
| `getChatUiMessagePartSchema` | Zod schema for get chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L556) |
| `getChatUiMessageRoleSchema` | Zod schema for get chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L422) |
| `getChatUiMessageSchema` | Zod schema for get chat UI message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L576) |
| `getChatUiMessagesSchema` | Zod schema for get chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L591) |
| `getMessageMetadataSchema` | Zod schema for get message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L399) |
| `imageFileTypes` | Image media types that chat uploads can display natively. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L53) |
| `messageMetadataSchema` | Schema for message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L419) |
| `textFileExtensions` | File extensions that chat uploads can inline as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L50) |

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
