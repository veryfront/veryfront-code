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
  agentsToPickerOptions,
} from "veryfront/chat";
```

## Examples

### Basic chat (preset)

```tsx
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat();
  return <Chat chat={chat} />;
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
      <Chat.Input input={chat.input} onChange={chat.handleInputChange} onSubmit={chat.handleSubmit} />
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
| `onResponse?` | <code>(response: Response) =&gt; void</code> | Raw response callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L69) |
| `onFinish?` | <code>(message: ChatMessage) =&gt; void</code> | Completion callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L70) |
| `onError?` | <code>(error: Error) =&gt; void</code> | Error callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L71) |
| `onToolCall?` | <code>(arg: OnToolCallArg) =&gt; void &#124; Promise&lt;void&gt;</code> | Tool call handler for client-side execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L72) |

### `UseChatResult`

`useChat` result

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `messages` | `ChatMessage[]` | All messages in the conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L95) |
| `input` | `string` | Current input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L96) |
| `isLoading` | `boolean` | Whether a request is in flight | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L98) |
| `status` | `ChatStatus` | Streaming lifecycle of the current turn (AI-SDK parity). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L100) |
| `streamingMessageId` | `string \| null` | Id of the assistant message currently streaming, or `null` when idle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L102) |
| `error` | `Error \| null` | Last error (if any) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L103) |
| `model` | `string \| undefined` | Current model override (undefined = use agent default) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L105) |
| `activeModel` | `string \| undefined` | The actual model being used after auto-upgrade (e.g. "Anthropic/claude-sonnet-4-20250514") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L107) |
| `inferenceMode` | `InferenceMode` | Where inference is currently happening | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L109) |
| `setInput` | <code>(input: string) =&gt; void</code> | Set input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L110) |
| `setModel` | <code>(model: string &#124; undefined) =&gt; void</code> | Change the model for subsequent requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L112) |
| `sendMessage` | <code>(message: &#123; text: string; files?: ChatFilePart[] &#125;) =&gt; Promise&lt;void&gt;</code> | Send a message programmatically | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L113) |
| `editMessage` | <code>(messageId: string, newText: string) =&gt; Promise&lt;void&gt;</code> | Edit a user message and resubmit - truncates history to that point | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L115) |
| `getBranches` | <code>(messageId: string) =&gt; BranchInfo</code> | Get branch info for a message (returns { current, total }; total=1 if no branches) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L117) |
| `switchBranch` | <code>(messageId: string, branchIndex: number) =&gt; void</code> | Switch to a different branch at a given message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L119) |
| `reload` | <code>() =&gt; Promise&lt;void&gt;</code> | Re-send last user message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L120) |
| `stop` | <code>() =&gt; void</code> | Abort current request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L121) |
| `setMessages` | <code>(messages: ChatMessage[]) =&gt; void</code> | Replace message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L122) |
| `addToolOutput` | <code>(output: ToolOutput) =&gt; void</code> | Submit client-side tool result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L123) |
| `data?` | `unknown` | Extra data from server response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L124) |
| `handleInputChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Bind to input onChange | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L125) |
| `handleSubmit` | <code>(e?: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Submit current input | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L126) |

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

### `UseConversationOptions`

Options for `useConversation`.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `store?` | `ConversationStore` | Async persistence adapter. Default: `localConversationStore(storageKey)`. Ignored when a surrounding `ConversationsProvider` already holds the id. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L33) |
| `storageKey?` | `string` | Convenience storage key for the default localStorage adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L35) |
| `onError?` | <code>(error: ConversationStoreError) =&gt; void</code> | Called when loading the conversation fails. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L37) |

### `UseConversationResult`

Result of `useConversation`.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `conversation` | `Conversation \| null` | The full conversation (with messages), or `null` while loading / not found. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L43) |
| `isLoading` | `boolean` | True while the conversation is loading from the store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L45) |
| `reload` | <code>() =&gt; void</code> | Re-fetch from the store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L47) |

### `UseConversationPersistenceState`

Additive persistence state returned by `useConversation`. It is kept separate from the original result interface so existing structural fixtures remain source-compatible.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `error` | `ConversationStoreError \| null` | Most recent load failure, or `null`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L57) |
| `clearError` | <code>() =&gt; void</code> | Clear the reported load failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L59) |

### `ConversationStoreError`

Normalized persistence failure. Store implementations should reject rather than resolve when an operation did not complete; the React hooks wrap custom adapter rejections in this error so consumers can branch on `operation` without parsing an error message.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `operation` | `ConversationStoreOperation` | Persistence operation that failed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L33) |

### `ConversationStoreOperation`

Persistence operation associated with a `ConversationStoreError`.

**Type:** `"list" \| "load" \| "save" \| "delete" \| "subscribe"`

### `ConversationStorageLimits`

Named shape of the local conversation codec's public resource limits.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `maxIndexBytes` | `number` | Maximum UTF-8 bytes in one serialized index: 2 MiB. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L22) |
| `maxConversationBytes` | `number` | Maximum UTF-8 bytes in one serialized conversation: 4 MiB. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L24) |
| `maxConversations` | `number` | Maximum summaries in one store: 1,000. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L26) |
| `maxMessagesPerConversation` | `number` | Maximum messages in one conversation: 1,000. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L28) |
| `maxPartsPerMessage` | `number` | Maximum parts in one message: 1,000. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L30) |
| `maxJsonDepth` | `number` | Maximum nested JSON container depth: 64. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L32) |
| `maxJsonNodes` | `number` | Maximum nodes in one JSON value: 65,536. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L34) |
| `maxContainerEntries` | `number` | Maximum own entries in one object or array: 10,000. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L36) |
| `maxJsonStringBytes` | `number` | Maximum UTF-8 bytes in one JSON string: 4 MiB. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L38) |
| `maxStorageKeyComponentBytes` | `number` | Maximum UTF-8 bytes in a storage-key tuple component: 1 KiB. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L40) |
| `maxIdentifierBytes` | `number` | Maximum UTF-8 bytes in an identifier: 1 KiB. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L42) |
| `maxTitleBytes` | `number` | Maximum UTF-8 bytes in a title: 16 KiB. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L44) |

### `UseConversationsOptions`

Options for `useConversations`.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id?` | `string \| null` | Controlled active id - YOU own the source (e.g. `router.query.thread`). Omit to let the hook manage active internally (uncontrolled). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L143) |
| `onSelect?` | <code>(id: string &#124; null) =&gt; void</code> | Fired when active should change (select / after create / after remove). Wire it to your router. Omit → internal active state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L146) |
| `store?` | `ConversationStore` | Async persistence adapter. Default: `localConversationStore(storageKey)`. Keep it referentially stable (module-level factory or `useMemo`). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L149) |
| `storageKey?` | `string` | Convenience storage key for the default localStorage adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L151) |
| `onError?` | <code>(error: ConversationStoreError) =&gt; void</code> | Called when a persistence operation fails. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L153) |

### `UseConversationsResult`

Result of `useConversations`.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `conversations` | `ConversationSummary[]` | All conversations as summaries (no messages), newest first. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L159) |
| `activeConversation` | `Conversation \| null` | The full active conversation (with messages), or `null`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L161) |
| `active` | `Conversation \| null` | Deprecated alias for activeConversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L163) |
| `activeConversationId` | `string \| null` | Id of the active conversation, or `null`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L165) |
| `activeId` | `string \| null` | Deprecated alias for activeConversationId | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L167) |
| `isLoading` | `boolean` | True only while the initial list is loading from the store. Active-record loading is reported separately by `UseConversationsPersistenceState`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L172) |
| `select` | <code>(id?: string &#124; null) =&gt; void</code> | Select a conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L173) |
| `create` | <code>(agentId?: string) =&gt; Conversation</code> | Create or reuse an empty conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L174) |
| `rename` | <code>(id: string, title: string) =&gt; void</code> | Rename a conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L175) |
| `remove` | <code>(id: string) =&gt; void</code> | Delete a conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L176) |
| `update` | <code>(id: string, patch: ConversationPatch) =&gt; void</code> | Patch a conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L177) |
| `save` | <code>(conversation: Conversation) =&gt; void</code> | Upsert a whole conversation (create-or-update). The store default for `<Chat onUpdate>` - hand it the emitted `{ id, messages, title, updatedAt }` and it lands in the list + persists. The conversation arrives fully formed (title already derived by the emitter), so this stays dumb about titling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L184) |
| `bind` | <code>(id: string, chat: &#123; messages: ChatMessage[] &#125;) =&gt; void</code> | Persist a live chat's messages + auto-title from the first user message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L186) |

### `UseConversationsPersistenceState`

Additive persistence state returned by `useConversations`.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `isActiveConversationLoading` | `boolean` | True while the active conversation's full record is being resolved. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L192) |
| `error` | `ConversationStoreError \| null` | Most recent persistence or reconciliation failure, or `null`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L194) |
| `clearError` | <code>() =&gt; void</code> | Clear the reported persistence failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L196) |

### `ActiveConversationLoadFailure`

A failed provider-owned active-record load, attributed to its exact id.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id` | `string` | Conversation id whose full record failed to load. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L202) |
| `error` | `ConversationStoreError` | Normalized failure for this specific load attempt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L204) |

### `UseConversationsActiveLoadState`

Additive active-record controls returned by `useConversations`.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `activeConversationError` | `ActiveConversationLoadFailure \| null` | Most recent active-record failure, or `null` after a new attempt/success/clear. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L210) |
| `clearActiveConversationError` | <code>() =&gt; void</code> | Clear only the active-record failure without discarding a newer unrelated error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L212) |
| `reloadActiveConversation` | <code>() =&gt; void</code> | Re-fetch the current active conversation from the provider-owned store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L214) |

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AgentAvatar` | Render agent avatar, falling back to model identity when agent identity is absent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/agent-avatar.tsx#L24) |
| `AgentCard` | AgentCard - render `<AgentCard {...props} />` for the default card, or compose `AgentCard.Header` / `Reasoning` / `Tools` / `Body` for a custom layout. Mirrors the `ToolCall` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L250) |
| `AgentPicker` | AgentPicker - render `<AgentPicker agents={...} .../>` for the default data-driven combobox, or compose `AgentPicker.Trigger`, `Content`, `Search`, `List`, `Item`, `Create`, and `Manage` for a custom menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L485) |
| `AppShell` | Compound AppShell. Compose: | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L628) |
| `AttachmentPill` | AttachmentPill - render `<AttachmentPill attachment={…} />` for the default chip, or compose `AttachmentPill.Root` + `.Thumbnail` / `.Icon` / `.Label` / `.Retry` / `.Remove` for a custom layout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L437) |
| `AttachmentsPanel` | AttachmentsPanel - render `<AttachmentsPanel uploads={…} />` for the default panel, or compose `AttachmentsPanel.Root` + `List` / `Item` / `Empty` / `Action` for a custom layout. Mirrors the `ToolCall` / `Sources` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L553) |
| `BranchPicker` | Branch picker with addressable previous, count, and next leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L173) |
| `Chat` | Render chat components through the preset or its composable sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/chat-preset.tsx#L37) |
| `ChatActions` | ChatActions - render `<ChatActions onAttachFiles={…} actions={…} />` for the default preset menu, or compose `ChatActions.Trigger` / `Content` / `Item` (each reads `useChatActions()`) for a custom menu. Mirrors the `ToolCall` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L309) |
| `ChatAgentPicker` | Render the connected agent switcher, or nothing when there's nothing to switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L63) |
| `ChatContextProvider` | Render chat context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L91) |
| `ChatEmpty` | Render chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L45) |
| `ChatEmptyState` | Compound empty state. Use the namespaced parts to compose the view: `Root`, `Avatar`, `Heading`, `Suggestions`, `Suggestion`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L169) |
| `ChatIf` | Render chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L19) |
| `ChatInput` | ChatInput - render `<ChatInput … />` for the default composer, or compose `ChatInput.Field` + `ChatInput.Send`/`Stop`/`Voice`/`Model`/`Attach`/`Export`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L608) |
| `ChatMessageList` | Render the default message list or compose its centered `Content` column. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L264) |
| `ChatMessagesSkeleton` | Render the loading skeleton for a chat thread. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/chat-messages-skeleton.tsx#L41) |
| `ChatRoot` | Render chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L87) |
| `ChatSidebar` | Render a chat sidebar - usable as `<ChatSidebar />` or `<ChatSidebar.Root>…`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L714) |
| `ChatThemeScope` | Wrap chat primitives in the `[data-vf-ui]` token scope so they're themed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-theme-scope.tsx#L30) |
| `CodeBlock` | Render escaped source or delegate to explicit syntax/diagram capabilities. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L270) |
| `CodeSurface` | Render through an explicit extension capability or escaped plain source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L239) |
| `ComposerContextProvider` | Render composer context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L59) |
| `ConversationEmptyState` | State for conversation empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L71) |
| `ConversationsContextProvider` | Low-level context provider (value supplied by the caller). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L45) |
| `ConversationScrollButton` | Render conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L116) |
| `ConversationsProvider` | ConversationsProvider - calls `useConversations` once with your `store` / `id` / `onSelect` and shares it via `ConversationsContext`. Declare persistence + router wiring here, once, at the app layout; children read it with `useConversationsContext`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L58) |
| `CopyButton` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L191) |
| `DropZoneOverlay` | Drag overlay shown over the composer while files are dragged onto it - the glyph-in-a-circle + "Drop files" from Studio's `PromptForm`. Rendered inside a `relative` card; fills it and blurs the content behind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L18) |
| `ErrorBanner` | Render error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L28) |
| `FadeIn` | Render fade in. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L37) |
| `InferenceBadge` | Render inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L15) |
| `InlineCitation` | Render the default citation or compose its `Trigger` and `Card` parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L308) |
| `Loader` | Render loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L14) |
| `Markdown` | Present Markdown source using an injected rich renderer or the explicit dependency-free plain-source contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L126) |
| `Message` | Message - render `<Message message={msg} />` for the default turn, or compose `Message.Root` + `Message.Header`/`Content`/`Actions`/… for a custom layout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L888) |
| `MessageActionBar` | Context-free message actions with addressable `Copy`, `Copied`, `Regenerate`, and `Edit` icon leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L211) |
| `MessageContextProvider` | Render message context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L73) |
| `MessageEditForm` | Render message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L18) |
| `MessageFeedback` | Message feedback with addressable positive and negative action leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L168) |
| `ModelAvatar` | Render model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L70) |
| `ModelSelector` | ModelSelector - render `<ModelSelector models={...} .../>` for the default data-driven combobox, or compose `ModelSelector.Trigger`, `Content`, `Search`, `List`, and `Item` for a custom menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L424) |
| `QuickActions` | Render quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L20) |
| `Reasoning` | Reasoning - render `<Reasoning text={…} />` for the default disclosure, or compose `Reasoning.Trigger` + `Reasoning.Content` for a custom layout. Mirrors the `Message` / `ToolCall` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L201) |
| `RichCodeBlock` | **Deprecated:** Use the shared `CodeBlock` primitive (`ui/code-block.tsx`) instead. It provides the maintained copy/collapse surface and accepts extension-owned syntax and diagram renderers without putting third-party implementations in core. This older plain `<pre>` fork is retained only for compatibility and will be removed. Render rich code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L25) |
| `Shimmer` | Render shimmer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L5) |
| `SkillBadge` | Render skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L23) |
| `SourcePill` | Render a single source pill with hover preview and score-color behaviour. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L127) |
| `Sources` | Sources - render `<Sources sources={…} />` for the default row, or compose `Sources.Root` + `Sources.List` + `Sources.Pill` for a custom layout. Mirrors the `ToolCall` / `Reasoning` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L187) |
| `StepIndicator` | StepIndicator - render `<StepIndicator stepIndex={…} isComplete />` for the default divider, or compose `StepIndicator.Root` + `.Rule` / `.Label` for a custom layout. Mirrors the `ToolCall` / `Sources` compounds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L115) |
| `Suggestion` | Render suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L14) |
| `Suggestions` | Render suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L49) |
| `Tabs` | Tablist container - manages active state and passes context to items. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L42) |
| `TabsItem` | Individual tab - renders as a button, or an anchor when `href` is set. Forwards native props/ref and composes the caller's `onClick` with the internal selection (caller's runs first, then the tab activates), so a consumer-supplied handler adds to - never overrides - selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L81) |
| `TabSwitcher` | Render tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L28) |
| `ToolCall` | ToolCall - render `<ToolCall tool={part} />` for the default card, or compose `ToolCall.Trigger` / `Body` / `Input` / `Output` / `Error` for a custom layout. Mirrors the `Message` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L458) |
| `ToolStatusBadge` | Render tool status badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L84) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `agentsToPickerOptions` | Narrow browser-safe agent metadata to the picker's row shape. `AgentOption` now shares `AgentMetadata`'s `avatarUrl` field, so `AgentMetadata[]` is also accepted by `<AgentPicker agents>` directly - this helper just drops the fields the rows don't use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L32) |
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L308) |
| `createChatStreamWatchdog` | Create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L252) |
| `createChatStreamWatchdogState` | State for create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L59) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L363) |
| `downloadMarkdown` | Download messages as a .md file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L64) |
| `exportAsMarkdown` | Convert chat messages to a markdown string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L12) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L302) |
| `extractSourcesFromParts` | Extract sources from native citations and tool result parts. Native source parts map directly, while tool outputs may expose a `documents` array. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L164) |
| `getAgentPromptSuggestions` | Return prompt text suggestions that the current Chat component can render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L161) |
| `getNextChatStreamWatchdogState` | State for get next chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L171) |
| `getTextContent` | Get text content from chat message parts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L16) |
| `groupPartsInOrder` | Group consecutive parts for ordered rendering Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L102) |
| `isHeartbeatOnlyMetadataChunk` | Check whether a chunk only carries heartbeat metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L247) |
| `isLongRunningToolRunning` | Check whether a long-running tool is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L84) |
| `isReasoningPart` | Check if a part is a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L82) |
| `isSkillToolPart` | Check if a tool part is a skill-related tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L77) |
| `isToolPart` | Check if a part is a tool part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L32) |
| `localConversationStore` | localStorage-backed conversation persistence. Pass a `storage` to back it with another Web-Storage-like implementation. Every operation requires the Web Locks API so concurrent browser contexts cannot lose index updates. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/local-conversation-store.ts#L381) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L220) |
| `memoryConversationStore` | In-memory conversation persistence. Optionally seed with initial conversations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/memory-conversation-store.ts#L22) |
| `normalizeAgentMetadata` | Normalize a single browser-safe agent record (the `agent` object inside the `/api/agents/:id` response, or one entry of the `/api/agents` list). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L136) |
| `normalizeAgentMetadataResponse` | Normalize the wire response from /api/agents/:id. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L153) |
| `normalizeAgentsListResponse` | Normalize the wire response from `GET /api/agents`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L35) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L265) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L332) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L425) |
| `useAgent` | React hook for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L48) |
| `useAgentMetadata` | React hook for browser-safe source-defined agent metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L201) |
| `useAgents` | React hook that lists the browser-safe agents a project exposes, via `GET /api/agents`. Companion to `useAgentMetadata` (single agent) - use it to drive an agent switcher, e.g. only rendering a picker when `agents.length > 1`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L53) |
| `useAttachments` | `useAttachments` - the headless state hook for chat attachments: a persistent, cross-conversation registry of uploaded files with the upload / remove / list actions. This is the domain primitive; render any UI on top of it (the `AttachmentsPanel` / `AttachmentPill` components are one skin - bring your own). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L351) |
| `useChat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/use-chat.ts#L111) |
| `useChatContextOptional` | React hook for chat context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L86) |
| `useChatErrorHandler` | Handler for use chat error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L92) |
| `useClipboard` | Copy `text` and expose transient success or failure feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L159) |
| `useCompletion` | useCompletion hook for single text generation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L55) |
| `useComposerContextOptional` | React hook for composer context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L54) |
| `useConversation` | Load one full conversation by id, over a swappable async store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L67) |
| `useConversationChat` | Bind the active conversation to an isolated chat session and persistence sink. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L67) |
| `useConversations` | List + active + persistence for conversations, over a swappable async store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L289) |
| `useConversationsContextOptional` | Read the shared conversations state, or `null` when there is no provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L38) |
| `useMessageContextOptional` | React hook for message context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L47) |
| `useMessageParts` | `useMessageParts` - read the current message's parts as data, so a consumer can render them however they like (the headless access point to parts; `Message.Part` is the leaf and `Message.Content` provides the default rendering). Throws outside a `Message`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L67) |
| `useStickToBottom` | Track and maintain "stick to bottom" for a scroll container. Attach `scrollRef` to the scrollable container and `contentRef` to the element that grows as messages / tokens arrive; the hook follows that growth while the user is pinned to the bottom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L51) |
| `useStreaming` | React hook for streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L41) |
| `useUpload` | Drive file uploads and expose the resulting attachment lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L174) |
| `useUploadsRegistry` | `useAttachments` - the headless state hook for chat attachments: a persistent, cross-conversation registry of uploaded files with the upload / remove / list actions. This is the domain primitive; render any UI on top of it (the `AttachmentsPanel` / `AttachmentPill` components are one skin - bring your own). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L351) |
| `useVoiceInput` | Input payload for use voice. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L102) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatErrorBoundary` | Implement chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L17) |
| `ChatStreamIdleTimeoutError` | Error shape for chat stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L43) |
| `ConversationStoreError` | Normalized persistence failure. Store implementations should reject rather than resolve when an operation did not complete; the React hooks wrap custom adapter rejections in this error so consumers can branch on `operation` without parsing an error message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L31) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveConversationLoadFailure` | A failed provider-owned active-record load, attributed to its exact id. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L200) |
| `AgentAvatarProps` | Props accepted by agent avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/agent-avatar.tsx#L12) |
| `AgentCardContextValue` | Per-card state shared with `AgentCard.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L106) |
| `AgentCardProps` | Props accepted by agent card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L34) |
| `AgentMetadata` | Browser-safe source-defined agent metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L34) |
| `AgentMetadataPromptSuggestion` | Source-defined prompt suggestion shown by chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L7) |
| `AgentMetadataSuggestion` | Source-defined agent suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L25) |
| `AgentMetadataSuggestions` | Source-defined suggestion group for an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L28) |
| `AgentMetadataTaskSuggestion` | Source-defined task suggestion shown by chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L19) |
| `AgentOption` | A selectable agent entry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L43) |
| `AgentPickerActionProps` | Props shared by `AgentPicker.Create` and `AgentPicker.Manage`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-actions.tsx#L7) |
| `AgentPickerContentProps` | Props for `AgentPicker.Content` - the popover surface + `Command` shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L240) |
| `AgentPickerContextValue` | Shared selection and open state exposed to `AgentPicker.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-context.tsx#L4) |
| `AgentPickerItemProps` | Props for `AgentPicker.Item` - a single selectable agent row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L275) |
| `AgentPickerProps` | Props accepted by `<AgentPicker>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L64) |
| `AgentPickerSearchProps` | Props for `AgentPicker.Search` - the addressable search input leaf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L219) |
| `AgentPickerSection` | A labelled group of agents (e.g. "Connected Agents"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L57) |
| `AgentPickerTriggerProps` | Props for `AgentPicker.Trigger` - the pill/input combobox button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L155) |
| `AgentTheme` | Public API contract for agent theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L62) |
| `AppShellHeaderProps` | Props accepted by `AppShellHeader`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L533) |
| `AppShellOpenState` | Per-side visibility map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L155) |
| `AppShellProps` | Props accepted by `AppShell`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L161) |
| `AppShellSide` | Which edge a sidebar docks to. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L29) |
| `AppShellSidebarProps` | Props accepted by `AppShellSidebar`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L319) |
| `AppShellTriggerProps` | Props accepted by `AppShellTrigger`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L565) |
| `AttachmentInfo` | Public API contract for attachment info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L17) |
| `AttachmentPillContextValue` | Derived per-pill view state shared with `AttachmentPill.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L145) |
| `AttachmentPillProps` | Props accepted by attachment pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L36) |
| `AttachmentsPanelActionProps` | Props for `AttachmentsPanel.Action` - the upload/attach button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L500) |
| `AttachmentsPanelContextValue` | Per-panel state shared with `AttachmentsPanel.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L43) |
| `AttachmentsPanelEmptyProps` | Props for `AttachmentsPanel.Empty` - the no-files state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L458) |
| `AttachmentsPanelItemProps` | Props accepted by an individual `AttachmentsPanel.Item` (attachment card). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L239) |
| `AttachmentsPanelListProps` | Props for `AttachmentsPanel.List` - the scrollable list of file rows. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L210) |
| `AttachmentsPanelLoadingProps` | Props for `AttachmentsPanel.Loading` - the initial-fetch placeholder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L419) |
| `AttachmentsPanelProps` | Props accepted by `AttachmentsPanel` / `AttachmentsPanel.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L65) |
| `BranchInfo` | Public API contract for branch info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L76) |
| `BranchPickerActionProps` | Props shared by `BranchPicker.Previous` and `BranchPicker.Next`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L18) |
| `BranchPickerCountProps` | Props accepted by `BranchPicker.Count`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L25) |
| `BranchPickerProps` | Props accepted by branch picker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L6) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L9) |
| `ChatActionItem` | A single data-driven action row in the `<ChatActions>` menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L42) |
| `ChatActionsContentProps` | Props for `ChatActions.Content` - the dropdown surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L205) |
| `ChatActionsContextValue` | Shared state exposed to `ChatActions.*` sub-parts via `useChatActions()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L105) |
| `ChatActionsItemProps` | Props for `ChatActions.Item` - a single selectable menu row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L228) |
| `ChatActionsProps` | Props accepted by `<ChatActions>` / `<ChatActions.Root>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L56) |
| `ChatActionsSettings` | The two toggle settings surfaced in the Settings submenu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions-settings.tsx#L16) |
| `ChatActionsTriggerProps` | Props for `ChatActions.Trigger` - the menu's trigger button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L169) |
| `ChatAgentInfo` | Agent identity + agent-driven content for `<Chat>`. Collapses the old `agent` / `models` / suggestion props into one object. In app mode (`agentId`) this is derived from agent metadata automatically; pass it yourself to drive a controlled chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/chat-props.ts#L20) |
| `ChatAgentPickerProps` | Props accepted by `<ChatAgentPicker>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L41) |
| `ChatContextValue` | Public API contract for chat context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L20) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L91) |
| `ChatEmptyProps` | Props accepted by chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L21) |
| `ChatEmptyStateAvatarProps` | Props accepted by `<ChatEmptyState.Avatar>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L55) |
| `ChatEmptyStateHeadingProps` | Props accepted by `<ChatEmptyState.Heading>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L89) |
| `ChatEmptyStateRootProps` | Props accepted by `<ChatEmptyState.Root>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L29) |
| `ChatEmptyStateSuggestionProps` | Props accepted by `<ChatEmptyState.Suggestion>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L144) |
| `ChatEmptyStateSuggestionsProps` | Props accepted by `<ChatEmptyState.Suggestions>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L119) |
| `ChatErrorBoundaryProps` | Props accepted by chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L4) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L206) |
| `ChatIfProps` | Props accepted by chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L12) |
| `ChatInputExportProps` | Props accepted by `<ChatInput.Export>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L313) |
| `ChatInputProps` | Props accepted by `ChatInput`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L382) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L129) |
| `ChatMessageListContentProps` | Props accepted by the centered transcript column. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L78) |
| `ChatMessageListProps` | Props accepted by chat message list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L25) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L175) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L138) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L116) |
| `ChatMessagesSkeletonProps` | Props accepted by `<ChatMessagesSkeleton>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/chat-messages-skeleton.tsx#L36) |
| `ChatProps` | Props accepted by chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/chat-props.ts#L34) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L18) |
| `ChatRootProps` | Props accepted by chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L31) |
| `ChatSidebarComponent` | Compound type - the preset plus its namespaced sub-components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L704) |
| `ChatSidebarEmptyProps` | Props accepted by `ChatSidebarEmpty`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L528) |
| `ChatSidebarGroupProps` | Props accepted by `ChatSidebarGroup`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L501) |
| `ChatSidebarItemProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L320) |
| `ChatSidebarListProps` | Props accepted by `ChatSidebarList`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L579) |
| `ChatSidebarNewButtonProps` | Props accepted by `ChatSidebarNewButton`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L258) |
| `ChatSidebarProps` | Props accepted by the `ChatSidebar` preset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L661) |
| `ChatSidebarRootProps` | Props accepted by `ChatSidebarRoot`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L205) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L104) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L221) |
| `ChatStreamWatchdogActiveTool` | Active tool tracked by a chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L17) |
| `ChatStreamWatchdogOptions` | Options accepted by chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L33) |
| `ChatStreamWatchdogPhase` | Public API contract for chat stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L10) |
| `ChatStreamWatchdogState` | State for chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L24) |
| `ChatTab` | Public API contract for chat tab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L13) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L11) |
| `ChatTheme` | Public API contract for chat theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L22) |
| `ChatThemeScopeProps` | Props accepted by `ChatThemeScope`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-theme-scope.tsx#L23) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L69) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L82) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L61) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L411) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L163) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L155) |
| `CodeBlockProps` | Props accepted by code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L7) |
| `CodeSurfaceProps` | Props accepted by `CodeSurface`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L227) |
| `ComposerContextValue` | Public API contract for composer context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L16) |
| `Conversation` | A full conversation - metadata + its messages. Fetched via `ConversationStore.load`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L70) |
| `ConversationEmptyStateProps` | Props accepted by conversation empty state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L62) |
| `ConversationPatch` | Fields a conversation can be patched with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L133) |
| `ConversationsContextValue` | Value accepted by the low-level context provider. Persistence state is optional here so existing caller-supplied structural fixtures remain compatible; `ConversationsProvider` always supplies it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L26) |
| `ConversationScrollButtonProps` | Props accepted by conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L108) |
| `ConversationsProviderProps` | Props accepted by `ConversationsProvider`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L48) |
| `ConversationStorageLimits` | Named shape of the local conversation codec's public resource limits. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L20) |
| `ConversationStore` | Async persistence contract for conversations. Implement all four methods; `subscribe`/`dispose` are optional capabilities (feature-detect them). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L83) |
| `ConversationStoreOperation` | Persistence operation associated with a `ConversationStoreError`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L23) |
| `ConversationSummary` | Lightweight conversation metadata - what a list / sidebar needs (no messages). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L63) |
| `CopyButtonProps` | Props accepted by `CopyButton`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L174) |
| `DropZoneOverlayProps` | Props accepted by drop zone overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L5) |
| `ErrorBannerProps` | Props accepted by error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L14) |
| `FeedbackValue` | Public API contract for feedback value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L6) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L31) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L5) |
| `InferenceBadgeProps` | Props accepted by inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L6) |
| `InferenceMode` | Where inference is happening. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L18) |
| `InlineCitationCardProps` | Props accepted by `InlineCitation.Card`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L101) |
| `InlineCitationProps` | Props accepted by inline citation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L7) |
| `InlineCitationTriggerProps` | Props accepted by `InlineCitation.Trigger`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L35) |
| `MarkdownProps` | Props accepted by `Markdown`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L106) |
| `MessageActionBarActionProps` | Props shared by the `MessageActionBar.*` action leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L27) |
| `MessageActionBarProps` | Props accepted by the context-free message action bar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L11) |
| `MessageContextValue` | Public API contract for message context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L17) |
| `MessageEditFormProps` | Props accepted by message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L5) |
| `MessageFeedbackActionProps` | Props shared by `MessageFeedback.Positive` and `MessageFeedback.Negative`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L22) |
| `MessageFeedbackProps` | Props accepted by message feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L9) |
| `MessagePartsData` | The message's grouped parts exposed as headless data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L54) |
| `MessageProps` | Props accepted by `<Message />`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L848) |
| `MessageRootProps` | Props accepted by message root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L75) |
| `MessageTokensProps` | Props accepted by `Message.Tokens`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L709) |
| `ModelAvatarProps` | Props accepted by model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L14) |
| `ModelOption` | A "provider/model" value and its display label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L58) |
| `ModelSelectorContentProps` | Props for `ModelSelector.Content` - the popover surface + `Command` shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L236) |
| `ModelSelectorContextValue` | Shared selection + open state exposed to `ModelSelector.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L140) |
| `ModelSelectorItemProps` | Props for `ModelSelector.Item` - a single selectable model row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L271) |
| `ModelSelectorProps` | Props accepted by `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L72) |
| `ModelSelectorSearchProps` | Props for `ModelSelector.Search`, the addressable search input leaf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L221) |
| `ModelSelectorTriggerProps` | Props for `ModelSelector.Trigger` - the pill/icon combobox button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L164) |
| `OnToolCallArg` | Public API contract for on tool call arg. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L48) |
| `PartGroup` | Part group types for ordered rendering | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L91) |
| `QuickAction` | Public API contract for quick action. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L5) |
| `QuickActionsProps` | Props accepted by quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L13) |
| `ReasoningContextValue` | Per-card state shared with `Reasoning.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L18) |
| `ReasoningProps` | Props accepted by `Reasoning` / `Reasoning.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L32) |
| `ReasoningTriggerProps` | Props for `Reasoning.Trigger` - the disclosure button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L138) |
| `SkillBadgeProps` | Props accepted by skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L12) |
| `Source` | Public API contract for source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L6) |
| `SourcePillProps` | Props accepted by an individual source pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L119) |
| `SourcesContextValue` | Per-list state shared with `Sources.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L23) |
| `SourcesListProps` | Props for `Sources.List` - the flex-wrap row of pills. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L82) |
| `SourcesProps` | Props accepted by `Sources` / `Sources.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L44) |
| `StepIndicatorContextValue` | Per-indicator state shared with `StepIndicator.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L30) |
| `StepIndicatorProps` | Props accepted by step indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L7) |
| `StorageLike` | The slice of the Web Storage API this adapter needs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/local-conversation-store.ts#L43) |
| `SuggestionProps` | Props accepted by suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L6) |
| `SuggestionsProps` | Props accepted by suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L42) |
| `TabsItemProps` | Props accepted by `<TabsItem>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L68) |
| `TabsProps` | Props accepted by `<Tabs>` (the tablist container). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L34) |
| `TabSwitcherProps` | Props accepted by tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L16) |
| `TokenRowProps` | One row in the token usage breakdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L702) |
| `ToolCallContextValue` | Per-tool state shared with `ToolCall.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L224) |
| `ToolCallProps` | Props accepted by `ToolCall` / `ToolCall.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L239) |
| `ToolCallTriggerProps` | Props for `ToolCall.Trigger` - the header button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L327) |
| `ToolOutput` | Output from tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L39) |
| `UploadedFile` | Public API contract for uploaded file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L24) |
| `UseAgentMetadataResult` | Result returned from useAgentMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L43) |
| `UseAgentOptions` | Options accepted by use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L6) |
| `UseAgentResult` | Result returned from use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L21) |
| `UseAgentsOptions` | Options accepted by `useAgents`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L8) |
| `UseAgentsResult` | Result returned from `useAgents`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L17) |
| `UseAttachmentsOptions` | Options for `useAttachments`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L35) |
| `UseAttachmentsRequestState` | Additive remote-request status returned by `useAttachments`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L82) |
| `UseAttachmentsResult` | Result of `useAttachments`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L50) |
| `UseAttachmentsStorageState` | Additive cache-status contract returned by `useAttachments`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L74) |
| `UseChatOptions` | Options accepted by use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L58) |
| `UseChatResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L94) |
| `UseClipboardResult` | Result of `useClipboard`: transient copy feedback and a `copy` trigger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L149) |
| `UseCompletionOptions` | Options accepted by use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L11) |
| `UseCompletionResult` | Result returned from use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L32) |
| `UseConversationChatOptions` | `useConversationChat` - the library primitive that binds a `useChat` session to conversation persistence, so application code does not need to duplicate the persistence effect. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L39) |
| `UseConversationChatResult` | Result returned by `useConversationChat`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L57) |
| `UseConversationOptions` | Options for `useConversation`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L30) |
| `UseConversationPersistenceState` | Additive persistence state returned by `useConversation`. It is kept separate from the original result interface so existing structural fixtures remain source-compatible. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L55) |
| `UseConversationResult` | Result of `useConversation`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L41) |
| `UseConversationsActiveLoadState` | Additive active-record controls returned by `useConversations`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L208) |
| `UseConversationsOptions` | Options for `useConversations`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L140) |
| `UseConversationsPersistenceState` | Additive persistence state returned by `useConversations`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L190) |
| `UseConversationsResult` | Result of `useConversations`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L157) |
| `UseStickToBottomOptions` | Options for `useStickToBottom`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L22) |
| `UseStickToBottomResult` | Result of `useStickToBottom`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L28) |
| `UseStreamingOptions` | Options accepted by use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L5) |
| `UseStreamingResult` | Result returned from use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L20) |
| `UseUploadOptions` | Options for `useUpload`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L24) |
| `UseUploadResult` | Result of `useUpload`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L35) |
| `UseUploadsRegistryOptions` | Options for `useAttachments`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L35) |
| `UseUploadsRegistryResult` | Result of `useAttachments`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L50) |
| `UseVoiceInputOptions` | Options accepted by use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L5) |
| `UseVoiceInputResult` | Result returned from use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L29) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `CONVERSATION_STORAGE_LIMITS` | Explicit resource limits applied on both the read and write paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-codec.ts#L48) |
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` | Default value for chat stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L5) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` | Default value for chat stream tool running timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L7) |
| `useAgentCard` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L116) |
| `useAgentPicker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-context.tsx#L19) |
| `useAppShell` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L108) |
| `useAttachmentPill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L173) |
| `useAttachmentsPanel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L56) |
| `useChatActions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L116) |
| `useChatContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L80) |
| `useComposerContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L48) |
| `useConversationsContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L30) |
| `useMessageContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L41) |
| `useModelSelector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L157) |
| `useReasoning` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L25) |
| `useSources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L28) |
| `useStepIndicator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L37) |
| `useToolCall` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L232) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/chat/ag-ui`

```ts
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk, flushAgUiSseChunk } from "veryfront/chat/ag-ui";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgUiChatEventDecoderState` | State for create AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L941) |
| `decodeAgUiSseChunk` | Decode AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L971) |
| `flushAgUiSseChunk` | Flush AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L1035) |
| `mapAgUiRuntimeMessagesToChatUiMessages` | Map AG-UI runtime messages to chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L377) |
| `parseSseEvent` | Event emitted for parse sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L906) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgUiChatEventDecoderState` | State for AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L97) |
| `AgUiDecodedChunk` | Public API contract for AG-UI decoded chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L85) |
| `AgUiDecodedEvent` | Event emitted for AG-UI decoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L78) |
| `AgUiDecoderValidationMode` | Public API contract for AG-UI decoder validation mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L91) |
| `AgUiRunFinishedMetadata` | Public API contract for AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L533) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L45) |
| `AgUiRuntimeToolCall` | Public API contract for AG-UI runtime tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L35) |
| `AgUiSnapshotMessage` | Message shape for AG-UI snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L537) |
| `AgUiWireEvent` | Event emitted for AG-UI wire. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L541) |
| `AgUiWireEventName` | Public API contract for AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L539) |
| `ParsedSseEvent` | Event emitted for parsed sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L71) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_AG_UI_MAX_FRAME_CHARS` | Default maximum characters retained for one AG-UI SSE frame. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L94) |
| `getAgUiRunFinishedMetadataSchema` | Zod schema for get AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L134) |
| `getAgUiSnapshotMessageSchema` | Zod schema for get AG-UI snapshot message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L181) |
| `getAgUiSnapshotToolCallSchema` | Zod schema for get AG-UI snapshot tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L151) |
| `getAgUiWireEventNameSchema` | Zod schema for get AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L217) |
| `getAgUiWireEventSchema` | Zod schema for get AG-UI wire event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L410) |

### `veryfront/chat/message-prep`

```ts
import { compactForStep, compactHistoricalUiMessageToolInputs, compactOldToolInputs } from "veryfront/chat/message-prep";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compactForStep` | Compact for step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1915) |
| `compactHistoricalUiMessageToolInputs` | Compact large historical UI-message tool inputs after matching results are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1632) |
| `compactOldToolInputs` | Compact large historical tool-call inputs after matching results are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1545) |
| `compressTurn` | Compress turn. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L229) |
| `dedupeToolHistory` | Dedupe tool history. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1939) |
| `enforceTokenBudget` | Enforce token budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L2006) |
| `enforceTokenBudgetWithTurnCompression` | Enforce token budget with turn compression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L304) |
| `ensureToolCallInputs` | Ensure tool call inputs helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1884) |
| `estimateMessageTokenBreakdown` | Estimate token categories for provider, UI, or runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L182) |
| `estimateOverhead` | Estimate overhead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1878) |
| `estimateTokens` | Estimate tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L100) |
| `isModelSupportedFileMediaType` | Check whether the model supports the file media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L737) |
| `maskOldToolOutputs` | Mask old tool outputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1447) |
| `normalizeMessageFilePartMediaTypes` | Normalizes message file part media types. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L743) |
| `prepareProviderModelMessagesFromUiMessages` | Prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1146) |
| `repairToolPairs` | Repair tool pairs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1730) |
| `rewriteUnsupportedFilePartsAsAnnotations` | Rewrite unsupported file parts as annotations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L770) |
| `sanitizeProviderModelMessages` | Sanitize provider model messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1043) |
| `stripPendingToolParts` | Strip pending tool parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L872) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `HistoricalToolInputCompactionDiagnostic` | Diagnostic emitted when a completed historical tool input is compacted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L74) |
| `HistoricalToolInputRetainedField` | Field selector retained in a historical tool-input summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L49) |
| `HistoricalToolInputRetentionOptions` | Options for historical tool-input compaction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L87) |
| `HistoricalToolInputRetentionPolicy` | Policy for compacting a completed historical tool-call input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L61) |
| `HistoricalToolInputRetentionPolicyResolver` | Resolves the retention policy for a completed historical tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L68) |
| `MessagePrepLimits` | Tunable limits used while preparing chat history for model context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L27) |
| `MessageTokenBreakdown` | Approximate token categories for context diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L105) |
| `PrepareProviderModelMessagesFromUiMessagesOptions` | Options accepted by prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L94) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_MESSAGE_PREP_LIMITS` | Default limits for chat history preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L37) |

### `veryfront/chat/protocol`

Canonical chat message and stream protocol for Veryfront chat surfaces. These types describe the framework-owned message parts and stream events used by AG-UI-aligned chat clients, hooks, and adapters.

```ts
import "veryfront/chat/protocol";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatDataPart` | Public API contract for chat data part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L110) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L91) |
| `ChatFilePart` | Chat message part that carries an uploaded file or image attachment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L27) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L206) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L129) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L175) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L138) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L116) |
| `ChatPartState` | Canonical chat message and stream protocol for Veryfront chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L8) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L18) |
| `ChatSourceDocumentPart` | Chat message part that carries a document citation source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L52) |
| `ChatSourceUrlPart` | Chat message part that carries a URL citation source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L44) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L104) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L221) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L11) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L69) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L82) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L61) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L411) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L163) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L155) |

### `veryfront/chat/types`

```ts
import { buildDataFileAnnotation, isImageFile, isTextPreviewFile } from "veryfront/chat/types";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildDataFileAnnotation` | Builds data file annotation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L656) |
| `isImageFile` | Check whether a file is an image. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L614) |
| `isTextPreviewFile` | Check whether a file supports text preview. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L628) |
| `isValidImageFile` | Check whether a file is a supported image upload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L619) |
| `normalizeInlineAttachmentMediaType` | Normalizes inline attachment media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L633) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatAssistantContentPart` | Public API contract for chat assistant content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L251) |
| `ChatAssistantMessage` | Message shape for chat assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L272) |
| `ChatDataUiPart` | Chat UI part that carries custom data chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L162) |
| `ChatDynamicToolUiPart` | Tool UI part for a runtime-selected tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L150) |
| `ChatFileUiPart` | Public API contract for chat file UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L107) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L175) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L138) |
| `ChatModelFilePart` | Public API contract for chat model file part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L205) |
| `ChatModelReasoningPart` | Provider model message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L197) |
| `ChatModelTextPart` | Provider model message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L191) |
| `ChatNamedToolUiPart` | Tool UI part keyed by a static tool type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L156) |
| `ChatReasoningUiPart` | Public API contract for chat reasoning UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L77) |
| `ChatRequestContext` | Context for chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L350) |
| `ChatRuntimeOverrides` | Public API contract for chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L302) |
| `ChatSourceDocumentUiPart` | Public API contract for chat source document UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L98) |
| `ChatSourceUrlUiPart` | Public API contract for chat source URL UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L90) |
| `ChatStepStartUiPart` | Public API contract for chat step start UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L85) |
| `ChatSystemMessage` | Message shape for chat system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L259) |
| `ChatTextUiPart` | Public API contract for chat text UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L71) |
| `ChatToolCallPart` | Provider model message part that carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L216) |
| `ChatToolMessage` | Message shape for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L278) |
| `ChatToolPartState` | State for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L122) |
| `ChatToolResultOutput` | Output from chat tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L225) |
| `ChatToolResultPart` | Provider model message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L240) |
| `ChatUiMessage` | Message shape for chat UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L180) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L411) |
| `ChatUiMessagePart` | Public API contract for chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L168) |
| `ChatUiMessageRole` | Public API contract for chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L68) |
| `ChatUserContentPart` | Public API contract for chat user content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L249) |
| `ChatUserMessage` | Message shape for chat user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L266) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L163) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L155) |
| `DurableRootRunDescriptor` | Public API contract for durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L291) |
| `FileUIPartWithUpload` | File UI part enriched with upload metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L116) |
| `MessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L175) |
| `ProjectFile` | Public API contract for project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L310) |
| `ProjectFileListItem` | Public API contract for project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L316) |
| `ProviderModelMessage` | Message shape for provider model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L284) |
| `UploadedFileReference` | Public API contract for uploaded file reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L325) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getChatRequestContextSchema` | Zod schema for get chat request context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L335) |
| `getChatToolPartStateSchema` | Zod schema for get chat tool part state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L439) |
| `getChatUiMessagePartSchema` | Zod schema for get chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L561) |
| `getChatUiMessageRoleSchema` | Zod schema for get chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L434) |
| `getChatUiMessageSchema` | Zod schema for get chat UI message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L576) |
| `getChatUiMessagesSchema` | Zod schema for get chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L586) |
| `getMessageMetadataSchema` | Zod schema for get message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L401) |
| `imageFileTypes` | Image media types that chat uploads can display natively. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L53) |
| `textFileExtensions` | File extensions that chat uploads can inline as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L50) |

### `veryfront/chat/uploads`

Chat upload handler: the server side of `<Chat>`'s batteries-included attachments. Mount it at `app/api/uploads/route.ts` (the same endpoint the composer POSTs to) and files "just work": stored on the local disk in dev, on Veryfront Cloud (or a `BlobStorage` you pass) once deployed. ```ts // app/api/uploads/route.ts import { createChatUploadHandler } from "veryfront/chat/uploads"; function authorize(request: Request) { const token = Deno.env.get("UPLOAD_TOKEN"); return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`); } export const { POST, GET, DELETE } = createChatUploadHandler({ authorize }); ``` `POST` stores the multipart `file` field and returns `{ id, url, name, mediaType, size }`. The composer sends that `url` as a `file` message part, which the runtime fetches, so the URL must be reachable by the runtime (true for local dev, where `GET` streams the file back from the same origin).

```ts
import { createChatUploadHandler } from "veryfront/chat/uploads";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createChatUploadHandler` | Build `{ POST, GET, DELETE }` route handlers for chat attachments. Auto-selects local disk storage in dev and Veryfront Cloud once deployed, or the `storage` you provide. Every route fails closed unless an authorizer returns literal `true` or unauthenticated access is explicitly enabled. Multipart request bodies and file bytes are bounded independently. `DELETE ?id=` removes the file from storage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L361) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatUploadAuthorizationResult` | Result returned by a chat upload-route authorizer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L50) |
| `ChatUploadAuthorize` | Authorizes one chat upload-route request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L53) |
| `ChatUploadHandlerConfig` | Configuration for `createChatUploadHandler`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L58) |
