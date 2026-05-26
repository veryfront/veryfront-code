---
title: "veryfront/chat"
description: "Chat UI components and streaming hooks."
order: 4
---

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
  const chat = useChat();
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
  const chat = useChat();
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
| `api?` | `string` | AG-UI endpoint. Defaults to "/api/ag-ui". | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L60) |
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
| `agent` | `string` | Agent ID or endpoint | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L7) |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback when tool is called | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L10) |
| `onToolResult?` | <code>(toolCall: ToolCall, result: unknown) =&gt; void</code> | Callback when tool result received | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L13) |
| `onError?` | <code>(error: Error) =&gt; void</code> | Callback when error occurs | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L16) |

### `UseAgentResult`

Result returned from use agent.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `messages` | `AgentMessage[]` | Message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L22) |
| `toolCalls` | `ToolCall[]` | Active tool calls | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L25) |
| `status` | `AgentStatus` | Agent status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L28) |
| `thinking?` | `string` | Thinking/reasoning text | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L31) |
| `invoke` | <code>(input: string) =&gt; Promise&lt;void&gt;</code> | Invoke the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L34) |
| `stop` | <code>() =&gt; void</code> | Stop agent execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L37) |
| `isLoading` | `boolean` | Loading state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L40) |
| `error` | `Error \| null` | Error state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L43) |

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AgentCard` | Render agent card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L36) |
| `AttachmentPill` | Render attachment pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L40) |
| `BranchPicker` | Render branch picker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L12) |
| `Chat` | Render chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L264) |
| `ChatComponents` | Render chat components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L523) |
| `ChatComposer` | Render chat composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L52) |
| `ChatContextProvider` | Render chat context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L84) |
| `ChatEmpty` | Render chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L25) |
| `ChatIf` | Render chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L18) |
| `ChatMessageList` | Render chat message list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L76) |
| `ChatRoot` | Render chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L69) |
| `ChatSidebar` | Render chat sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L135) |
| `ChatWithSidebar` | Render chat with sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L136) |
| `ComposerContextProvider` | Render composer context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L65) |
| `ConversationEmptyState` | State for conversation empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L70) |
| `ConversationScrollButton` | Render conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L109) |
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` | Default value for chat stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L3) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` | Default value for chat stream tool running timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L5) |
| `DropZoneOverlay` | Render drop zone overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L10) |
| `ErrorBanner` | Render error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L18) |
| `FadeIn` | Render fade in. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L36) |
| `InferenceBadge` | Render inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L10) |
| `InlineCitation` | Render inline citation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L13) |
| `Loader` | Render loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L13) |
| `Message` | Message shape for message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L337) |
| `MessageActions` | Render message actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L16) |
| `MessageContextProvider` | Render message context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L55) |
| `MessageEditForm` | Render message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L11) |
| `MessageFeedback` | Render message feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L18) |
| `ModelAvatar` | Render model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L64) |
| `ModelSelector` | Render model selector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L56) |
| `QuickActions` | Render quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L19) |
| `ReasoningCard` | Render reasoning card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L13) |
| `RichCodeBlock` | Render rich code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L13) |
| `Shimmer` | Render shimmer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L4) |
| `SkillBadge` | Render skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L17) |
| `Sources` | Render sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L19) |
| `StandaloneMessage` | Render a standalone chat message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L45) |
| `StepIndicator` | Render step indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L12) |
| `StreamingMessage` | Message shape for streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L150) |
| `Suggestion` | Render suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L13) |
| `Suggestions` | Render suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L48) |
| `TabSwitcher` | Render tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L27) |
| `ThreadListContextProvider` | Render thread list context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L46) |
| `ToolCallCard` | Tool call card component - renders tool invocations with parameters and results Styled to match AI Elements (https://ai-sdk.dev/elements) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L135) |
| `ToolStatusBadge` | Render tool status badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L44) |
| `UpgradeCTA` | Render upgrade CTA. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/upgrade-cta.tsx#L11) |
| `UploadsPanel` | Render uploads panel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L29) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L120) |
| `createChatStreamWatchdog` | Create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L155) |
| `createChatStreamWatchdogState` | State for create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L48) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L170) |
| `downloadMarkdown` | Download messages as a .md file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L63) |
| `exportAsMarkdown` | Convert chat messages to a markdown string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L11) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L114) |
| `extractSourcesFromParts` | Extract sources from tool result parts. Looks for `documents` arrays in tool outputs and maps them to Source[]. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L117) |
| `getNextChatStreamWatchdogState` | State for get next chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L80) |
| `getTextContent` | Get text content from chat message parts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L14) |
| `groupPartsInOrder` | Group consecutive parts for ordered rendering Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L61) |
| `isHeartbeatOnlyMetadataChunk` | Check whether a chunk only carries heartbeat metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L150) |
| `isLongRunningToolRunning` | Check whether a long-running tool is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L68) |
| `isReasoningPart` | Check if a part is a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L42) |
| `isSkillToolPart` | Check if a tool part is a skill-related tool (load-skill, load-skill-reference, execute-skill-script) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L37) |
| `isToolPart` | Check if a part is a tool part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L25) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L216) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L89) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L139) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L232) |
| `useAgent` | React hook for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L47) |
| `useChat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/use-chat.ts#L77) |
| `useChatContext` | Context for use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L68) |
| `useChatContextOptional` | React hook for chat context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L79) |
| `useChatErrorHandler` | Handler for use chat error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L92) |
| `useCompletion` | useCompletion hook for single text generation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L54) |
| `useComposerContext` | Context for use composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L49) |
| `useComposerContextOptional` | React hook for composer context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L60) |
| `useMessageContext` | Context for use message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L39) |
| `useMessageContextOptional` | React hook for message context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L50) |
| `useStreaming` | React hook for streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L40) |
| `useThreadListContext` | Context for use thread list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L30) |
| `useThreadListContextOptional` | React hook for thread list context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L41) |
| `useThreads` | React hook for threads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L83) |
| `useVoiceInput` | Input payload for use voice. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L100) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatErrorBoundary` | Implement chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L16) |
| `ChatStreamIdleTimeoutError` | Error shape for chat stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L32) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentCardProps` | Props accepted by agent card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L12) |
| `AgentTheme` | Public API contract for agent theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L159) |
| `AttachmentInfo` | Public API contract for attachment info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L4) |
| `AttachmentPillProps` | Props accepted by attachment pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L14) |
| `BranchInfo` | Public API contract for branch info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L80) |
| `BranchPickerProps` | Props accepted by branch picker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L4) |
| `BrowserInferenceStatus` | Browser-side model loading and inference status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L16) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L8) |
| `ChatComposerProps` | Props accepted by chat composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L18) |
| `ChatContextValue` | Public API contract for chat context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L19) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L52) |
| `ChatEmptyProps` | Props accepted by chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L12) |
| `ChatErrorBoundaryProps` | Props accepted by chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L3) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L138) |
| `ChatIfProps` | Props accepted by chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L11) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L78) |
| `ChatMessageListProps` | Props accepted by chat message list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L44) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L122) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L87) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L69) |
| `ChatProps` | Props accepted by chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L196) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L17) |
| `ChatRootProps` | Props accepted by chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L24) |
| `ChatSidebarProps` | Props accepted by chat sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L6) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L63) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L153) |
| `ChatStreamWatchdogOptions` | Options accepted by chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L23) |
| `ChatStreamWatchdogPhase` | Public API contract for chat stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L8) |
| `ChatStreamWatchdogState` | State for chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L15) |
| `ChatTab` | Public API contract for chat tab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L12) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L10) |
| `ChatTheme` | Public API contract for chat theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L120) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L32) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L43) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L24) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L322) |
| `ChatWithSidebarAttachmentConfig` | Configuration used by chat with sidebar attachment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L60) |
| `ChatWithSidebarChatController` | Public API contract for chat with sidebar chat controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L17) |
| `ChatWithSidebarFeatureConfig` | Configuration used by chat with sidebar feature. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L87) |
| `ChatWithSidebarGroupedProps` | Props accepted by chat with sidebar grouped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L114) |
| `ChatWithSidebarMessageConfig` | Configuration used by chat with sidebar message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L79) |
| `ChatWithSidebarModelConfig` | Configuration used by chat with sidebar model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L55) |
| `ChatWithSidebarProps` | Props accepted by chat with sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L133) |
| `ChatWithSidebarQuickActionsConfig` | Configuration used by chat with sidebar quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L71) |
| `ChatWithSidebarSidebarConfig` | Configuration used by chat with sidebar sidebar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L44) |
| `ChatWithSidebarTabsConfig` | Configuration used by chat with sidebar tabs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L97) |
| `ChatWithSidebarVoiceConfig` | Configuration used by chat with sidebar voice. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-with-sidebar.tsx#L108) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L110) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L95) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L102) |
| `CodeBlockProps` | Props accepted by code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L5) |
| `ComposerContextValue` | Public API contract for composer context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L15) |
| `ConversationEmptyStateProps` | Props accepted by conversation empty state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L61) |
| `ConversationScrollButtonProps` | Props accepted by conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L102) |
| `DropZoneOverlayProps` | Props accepted by drop zone overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L4) |
| `ErrorBannerProps` | Props accepted by error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L11) |
| `FeedbackValue` | Public API contract for feedback value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L4) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L29) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L3) |
| `InferenceBadgeProps` | Props accepted by inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L4) |
| `InferenceMode` | Where inference is happening | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L13) |
| `InlineCitationProps` | Props accepted by inline citation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L5) |
| `MessageActionsProps` | Props accepted by message actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L8) |
| `MessageContextValue` | Public API contract for message context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L16) |
| `MessageEditFormProps` | Props accepted by message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L4) |
| `MessageFeedbackProps` | Props accepted by message feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L7) |
| `MessageProps` | Props accepted by message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L6) |
| `MessageRootProps` | Props accepted by message root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L56) |
| `ModelAvatarProps` | Props accepted by model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L13) |
| `ModelOption` | A "provider/model" value and its display label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L14) |
| `ModelSelectorProps` | Props accepted by `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L28) |
| `OnToolCallArg` | Public API contract for on tool call arg. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L48) |
| `PartGroup` | Part group types for ordered rendering | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L51) |
| `QuickAction` | Public API contract for quick action. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L4) |
| `QuickActionsProps` | Props accepted by quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L12) |
| `SkillBadgeProps` | Props accepted by skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L11) |
| `Source` | Public API contract for source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L4) |
| `SourcesProps` | Props accepted by sources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L12) |
| `StepIndicatorProps` | Props accepted by step indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L5) |
| `StreamingMessageProps` | Props accepted by streaming message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/message.tsx#L135) |
| `SuggestionProps` | Props accepted by suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L5) |
| `SuggestionsProps` | Props accepted by suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L41) |
| `TabSwitcherProps` | Props accepted by tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L15) |
| `Thread` | Public API contract for thread. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L5) |
| `ThreadListContextValue` | Public API contract for thread list context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/thread-list-context.tsx#L14) |
| `ToolOutput` | Output from tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L39) |
| `UpgradeCTAProps` | Props accepted by the upgrade CTA. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/upgrade-cta.tsx#L6) |
| `UploadedFile` | Public API contract for uploaded file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L5) |
| `UploadsPanelProps` | Props accepted by uploads panel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/uploads-panel.tsx#L14) |
| `UseAgentOptions` | Options accepted by use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L5) |
| `UseAgentResult` | Result returned from use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L20) |
| `UseChatOptions` | Options accepted by use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L58) |
| `UseChatResult` | Result returned from use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L86) |
| `UseCompletionOptions` | Options accepted by use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L10) |
| `UseCompletionResult` | Result returned from use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L31) |
| `UseStreamingOptions` | Options accepted by use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L4) |
| `UseStreamingResult` | Result returned from use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L19) |
| `UseThreadsOptions` | Options accepted by use threads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L18) |
| `UseThreadsResult` | Result returned from use threads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-threads.ts#L24) |
| `UseVoiceInputOptions` | Options accepted by use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L3) |
| `UseVoiceInputResult` | Result returned from use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L27) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/chat/ag-ui`

```ts
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk, flushAgUiSseChunk } from "veryfront/chat/ag-ui";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AgUiRunFinishedMetadataSchema` | Schema for AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L146) |
| `AgUiSnapshotMessageSchema` | Schema for AG-UI snapshot message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L222) |
| `AgUiSnapshotToolCallSchema` | Schema for AG-UI snapshot tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L164) |
| `AgUiWireEventNameSchema` | Schema for AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L230) |
| `AgUiWireEventSchema` | Schema for AG-UI wire event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L549) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgUiChatEventDecoderState` | State for create AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L944) |
| `decodeAgUiSseChunk` | Decode AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L963) |
| `flushAgUiSseChunk` | Flush AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L1008) |
| `mapAgUiRuntimeMessagesToChatUiMessages` | Map AG-UI runtime messages to chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L390) |
| `parseSseEvent` | Event emitted for parse sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L910) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgUiChatEventDecoderState` | State for AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L93) |
| `AgUiDecodedChunk` | Public API contract for AG-UI decoded chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L84) |
| `AgUiDecodedEvent` | Event emitted for AG-UI decoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L77) |
| `AgUiDecoderValidationMode` | Public API contract for AG-UI decoder validation mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L90) |
| `AgUiRunFinishedMetadata` | Public API contract for AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L552) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L44) |
| `AgUiRuntimeToolCall` | Public API contract for AG-UI runtime tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L34) |
| `AgUiSnapshotMessage` | Message shape for AG-UI snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L556) |
| `AgUiWireEvent` | Event emitted for AG-UI wire. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L560) |
| `AgUiWireEventName` | Public API contract for AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L558) |
| `ParsedSseEvent` | Event emitted for parsed sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L70) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAgUiRunFinishedMetadataSchema` | Zod schema for get AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L129) |
| `getAgUiSnapshotMessageSchema` | Zod schema for get AG-UI snapshot message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L184) |
| `getAgUiSnapshotToolCallSchema` | Zod schema for get AG-UI snapshot tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L149) |
| `getAgUiWireEventNameSchema` | Zod schema for get AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L225) |
| `getAgUiWireEventSchema` | Zod schema for get AG-UI wire event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L423) |

### `veryfront/chat/conversation`

```ts
import { convertUiMessagesToProviderModelMessages, extractTextFromMessage, extractUploadId } from "veryfront/chat/conversation";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `UUID_PATTERN` | Shared UUID pattern value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L183) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `convertUiMessagesToProviderModelMessages` | Convert UI messages to provider model messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L1001) |
| `extractTextFromMessage` | Message shape for extract text from. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L518) |
| `extractUploadId` | Extract upload ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L192) |
| `getStringField` | Return string field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L223) |
| `getUiToolName` | Return UI tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L277) |
| `hasIncompleteToolParts` | Check whether incomplete tool parts is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L431) |
| `isDataUiPart` | Check whether a chat part is a custom data part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L261) |
| `isReasoningPart` | Check whether a value is a reasoning part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L513) |
| `isRecord` | Record shape for is. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L218) |
| `isTextPart` | Check whether a value is a text part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L508) |
| `isToolCallPart` | Check whether a value is a tool-call part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L488) |
| `isToolResultPart` | Check whether a value is a tool-result part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L498) |
| `isToolUiPart` | Check whether a chat part is a tool UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L268) |
| `isUuid` | Check whether a value is a UUID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L187) |
| `mapToolState` | State for map tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L198) |
| `markIncompleteToolPartsAsErrored` | Mark incomplete tool parts as errored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L441) |
| `markIncompleteToolPartsAsStopped` | Mark incomplete tool parts as stopped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L436) |
| `pushToolParts` | Push tool parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L287) |
| `stringifyUnknown` | Stringify unknown helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L250) |
| `toConversationPartsFromUiMessage` | Message shape for to conversation parts from UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L358) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ApiConversation` | Public API contract for API conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L116) |
| `ApiMessage` | Message shape for API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L146) |
| `ConversationType` | Public API contract for conversation type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L78) |
| `MessagePart` | Public API contract for message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L67) |
| `MessageStatus` | Public API contract for message status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L89) |
| `ReasoningPartLike` | Reasoning-like provider message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L173) |
| `TextPartLike` | Text-like provider message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L167) |
| `ToolCallLike` | Public API contract for tool call like. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L149) |
| `ToolResultLike` | Public API contract for tool result like. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L158) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `apiConversationSchema` | Schema for API conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L113) |
| `apiMessageSchema` | Schema for API message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L143) |
| `conversationTypeSchema` | Schema for conversation type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L76) |
| `convertUiMessagesToModelMessages` | Shared convert UI messages to model messages value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L1043) |
| `getApiConversationSchema` | Zod schema for get API conversation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L92) |
| `getApiMessageSchema` | Zod schema for get API message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L119) |
| `getConversationTypeSchema` | Zod schema for get conversation type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L70) |
| `getMessagePartSchema` | Zod schema for get message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L10) |
| `getMessageStatusSchema` | Zod schema for get message status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L81) |
| `messagePartSchema` | Schema for message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L64) |
| `messageStatusSchema` | Schema for message status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/conversation.ts#L87) |

### `veryfront/chat/final-step-fallback`

```ts
import { appendMissingFallbackTextPart, buildFallbackUiMessageChunks, buildFallbackUiMessageParts } from "veryfront/chat/final-step-fallback";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_STREAM_PROMISE_TIMEOUT_MS` | Default value for stream promise timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L16) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `appendMissingFallbackTextPart` | Append missing fallback text part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L899) |
| `buildFallbackUiMessageChunks` | Builds fallback UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L911) |
| `buildFallbackUiMessageParts` | Builds fallback UI message parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L889) |
| `buildMissingFallbackTextChunks` | Builds missing fallback text chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L963) |
| `buildMissingFallbackToolChunks` | Builds missing fallback tool chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L938) |
| `buildMissingFallbackToolChunksFromParts` | Builds missing fallback tool chunks from parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L951) |
| `extractFinalStepFinishReason` | Extract final step finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L780) |
| `extractFinalStepTerminalError` | Error shape for extract final step terminal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L870) |
| `extractFinalStepText` | Extract final step text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L789) |
| `extractFinalStepToolCalls` | Extract final step tool calls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L798) |
| `extractFinalStepToolResults` | Extract final step tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L822) |
| `getLastStreamStep` | Return last stream step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L762) |
| `getStreamSteps` | Return stream steps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L771) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatFallbackPart` | Public API contract for chat fallback part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L21) |
| `FallbackToolChunkState` | State for fallback tool chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L42) |
| `FinalStepToolCall` | Public API contract for final step tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L27) |
| `FinalStepToolResult` | Result returned from final step tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/final-step-fallback.ts#L34) |

### `veryfront/chat/message-prep`

```ts
import { compactForStep, compressTurn, dedupeToolHistory } from "veryfront/chat/message-prep";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compactForStep` | Compact for step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L859) |
| `compressTurn` | Compress turn. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L32) |
| `dedupeToolHistory` | Dedupe tool history. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L880) |
| `enforceTokenBudget` | Enforce token budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L941) |
| `enforceTokenBudgetWithTurnCompression` | Enforce token budget with turn compression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L107) |
| `ensureToolCallInputs` | Ensure tool call inputs helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L828) |
| `estimateOverhead` | Estimate overhead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L822) |
| `estimateTokens` | Estimate tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L22) |
| `isModelSupportedFileMediaType` | Check whether the model supports the file media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L208) |
| `maskOldToolOutputs` | Mask old tool outputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L597) |
| `normalizeMessageFilePartMediaTypes` | Normalizes message file part media types. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L214) |
| `prepareProviderModelMessagesFromUiMessages` | Prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L485) |
| `repairToolPairs` | Repair tool pairs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L679) |
| `rewriteUnsupportedFilePartsAsAnnotations` | Rewrite unsupported file parts as annotations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L241) |
| `sanitizeProviderModelMessages` | Sanitize provider model messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L440) |
| `stripPendingToolParts` | Strip pending tool parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L336) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `prepareModelMessagesFromUiMessages` | Shared prepare model messages from UI messages value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L957) |
| `sanitizeModelMessages` | Shared sanitize model messages value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L472) |

### `veryfront/chat/protocol`

Canonical chat message and stream protocol for Veryfront chat surfaces. These types describe the framework-owned message parts and stream events used by AG-UI-aligned chat clients, hooks, and adapters.

```ts
import "veryfront/chat/protocol";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L52) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L138) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L78) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L122) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L87) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L69) |
| `ChatPartState` | Canonical chat message and stream protocol for Veryfront chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L7) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L17) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L63) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L153) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L10) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L32) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L43) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L24) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L322) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L110) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L95) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L102) |

### `veryfront/chat/provider-errors`

Error shape for parsed provider.

```ts
import { isCreditLimitMessage, parseKnownProblemBody, parseProviderError } from "veryfront/chat/provider-errors";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `isCreditLimitMessage` | Message shape for is credit limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L63) |
| `parseKnownProblemBody` | Parses known problem body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L34) |
| `parseProviderError` | Error shape for parse provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L151) |
| `safeJsonParse` | Parse JSON safely without throwing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L20) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ParsedProviderError` | Error shape for parsed provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L1) |
| `SafeJsonParseResult` | Result returned from safe JSON parse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/provider-errors.ts#L17) |

### `veryfront/chat/stream-watchdog`

```ts
import { createChatStreamWatchdog, createChatStreamWatchdogState, getNextChatStreamWatchdogState } from "veryfront/chat/stream-watchdog";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` | Default value for chat stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L3) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` | Default value for chat stream tool running timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L5) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createChatStreamWatchdog` | Create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L155) |
| `createChatStreamWatchdogState` | State for create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L48) |
| `getNextChatStreamWatchdogState` | State for get next chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L80) |
| `isHeartbeatOnlyMetadataChunk` | Check whether a chunk only carries heartbeat metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L150) |
| `isLongRunningToolRunning` | Check whether a long-running tool is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L68) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatStreamIdleTimeoutError` | Error shape for chat stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L32) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatStreamWatchdogOptions` | Options accepted by chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L23) |
| `ChatStreamWatchdogPhase` | Public API contract for chat stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L8) |
| `ChatStreamWatchdogState` | State for chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L15) |

### `veryfront/chat/types`

```ts
import { buildDataFileAnnotation, isImageFile, isTextPreviewFile } from "veryfront/chat/types";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildDataFileAnnotation` | Builds data file annotation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L665) |
| `isImageFile` | Check whether a file is an image. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L623) |
| `isTextPreviewFile` | Check whether a file supports text preview. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L637) |
| `isValidImageFile` | Check whether a file is a supported image upload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L628) |
| `normalizeInlineAttachmentMediaType` | Normalizes inline attachment media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L642) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatAssistantContentPart` | Public API contract for chat assistant content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L245) |
| `ChatAssistantMessage` | Message shape for chat assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L266) |
| `ChatDataUiPart` | Chat UI part that carries custom data chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L158) |
| `ChatDynamicToolUiPart` | Tool UI part for a runtime-selected tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L146) |
| `ChatFileUiPart` | Public API contract for chat file UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L104) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L122) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L87) |
| `ChatModelFilePart` | Public API contract for chat model file part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L199) |
| `ChatModelMessage` | Message shape for chat model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L288) |
| `ChatModelReasoningPart` | Provider model message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L193) |
| `ChatModelTextPart` | Provider model message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L187) |
| `ChatNamedToolUiPart` | Tool UI part keyed by a static tool type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L152) |
| `ChatReasoningUiPart` | Public API contract for chat reasoning UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L76) |
| `ChatRequestContext` | Context for chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L349) |
| `ChatRuntimeOverrides` | Public API contract for chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L302) |
| `ChatSourceDocumentUiPart` | Public API contract for chat source document UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L95) |
| `ChatSourceUrlUiPart` | Public API contract for chat source URL UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L87) |
| `ChatStepStartUiPart` | Public API contract for chat step start UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L82) |
| `ChatSystemMessage` | Message shape for chat system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L253) |
| `ChatTextUiPart` | Public API contract for chat text UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L70) |
| `ChatToolCallPart` | Provider model message part that carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L210) |
| `ChatToolMessage` | Message shape for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L272) |
| `ChatToolPartState` | State for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L118) |
| `ChatToolResultOutput` | Output from chat tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L219) |
| `ChatToolResultPart` | Provider model message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L234) |
| `ChatUiMessage` | Message shape for chat UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L176) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L322) |
| `ChatUiMessagePart` | Public API contract for chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L164) |
| `ChatUiMessageRole` | Public API contract for chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L67) |
| `ChatUserContentPart` | Public API contract for chat user content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L243) |
| `ChatUserMessage` | Message shape for chat user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L260) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L110) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L95) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L102) |
| `DurableRootRunDescriptor` | Public API contract for durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L291) |
| `FileUIPartWithUpload` | File UI part enriched with upload metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L112) |
| `MessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L122) |
| `ProjectFile` | Public API contract for project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L309) |
| `ProjectFileListItem` | Public API contract for project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L315) |
| `ProviderModelMessage` | Message shape for provider model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L278) |
| `UploadedFileReference` | Public API contract for uploaded file reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L324) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `chatRequestContextSchema` | Schema for chat request context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L346) |
| `chatToolPartStateSchema` | Schema for chat tool part state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L449) |
| `chatUiMessagePartSchema` | Schema for chat ui message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L572) |
| `chatUiMessageRoleSchema` | Schema for chat ui message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L428) |
| `chatUiMessageSchema` | Schema for chat ui message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L587) |
| `chatUiMessagesSchema` | Schema for chat ui messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L595) |
| `getChatRequestContextSchema` | Zod schema for get chat request context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L334) |
| `getChatToolPartStateSchema` | Zod schema for get chat tool part state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L431) |
| `getChatUiMessagePartSchema` | Zod schema for get chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L555) |
| `getChatUiMessageRoleSchema` | Zod schema for get chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L421) |
| `getChatUiMessageSchema` | Zod schema for get chat UI message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L575) |
| `getChatUiMessagesSchema` | Zod schema for get chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L590) |
| `getMessageMetadataSchema` | Zod schema for get message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L398) |
| `imageFileTypes` | Image media types that chat uploads can display natively. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L52) |
| `messageMetadataSchema` | Schema for message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L418) |
| `textFileExtensions` | File extensions that chat uploads can inline as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L49) |
