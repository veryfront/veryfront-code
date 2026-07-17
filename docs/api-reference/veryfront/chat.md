---
title: "veryfront/chat"
description: "Chat UI components and streaming hooks."
order: 3
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
| `api?` | `string` | AG-UI endpoint. Defaults to "/api/ag-ui". | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L55) |
| `transport?` | `"ag-ui"` | Streaming response protocol used by the endpoint. AG-UI is the default. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L57) |
| `initialMessages?` | `ChatMessage[]` | Pre-populated messages | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L58) |
| `body?` | <code>Record&lt;string, unknown&gt;</code> | Extra body fields sent with each request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L59) |
| `headers?` | <code>Record&lt;string, string&gt;</code> | Custom request headers | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L60) |
| `credentials?` | `RequestCredentials` | Fetch credentials mode | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L61) |
| `model?` | `string` | Override model at runtime (e.g. "openai/gpt-4o", "Anthropic/claude-sonnet-4-5-20250929") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L63) |
| `onResponse?` | <code>(response: Response) =&gt; void</code> | Raw response callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L64) |
| `onFinish?` | <code>(message: ChatMessage) =&gt; void</code> | Completion callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L65) |
| `onError?` | <code>(error: Error) =&gt; void</code> | Error callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L66) |
| `onToolCall?` | <code>(arg: OnToolCallArg) =&gt; void &#124; Promise&lt;void&gt;</code> | Tool call handler for client-side execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L67) |

### `UseChatResult`

`useChat` result

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `messages` | `ChatMessage[]` | All messages in the conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L90) |
| `input` | `string` | Current input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L91) |
| `isLoading` | `boolean` | Whether a request is in flight | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L93) |
| `status` | `ChatStatus` | Streaming lifecycle of the current turn (AI-SDK parity). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L95) |
| `streamingMessageId` | `string \| null` | Id of the assistant message currently streaming, or `null` when idle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L97) |
| `error` | `Error \| null` | Last error (if any) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L98) |
| `model` | `string \| undefined` | Current model override (undefined = use agent default) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L100) |
| `activeModel` | `string \| undefined` | The actual model being used after auto-upgrade (e.g. "Anthropic/claude-sonnet-4-20250514") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L102) |
| `inferenceMode` | `InferenceMode` | Where inference is currently happening | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L104) |
| `setInput` | <code>(input: string) =&gt; void</code> | Set input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L105) |
| `setModel` | <code>(model: string &#124; undefined) =&gt; void</code> | Change the model for subsequent requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L107) |
| `sendMessage` | <code>(message: &#123; text: string; files?: ChatFilePart[] &#125;) =&gt; Promise&lt;void&gt;</code> | Send a message programmatically | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L108) |
| `editMessage` | <code>(messageId: string, newText: string) =&gt; Promise&lt;void&gt;</code> | Edit a user message and resubmit - truncates history to that point | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L110) |
| `getBranches` | <code>(messageId: string) =&gt; BranchInfo</code> | Get branch info for a message (returns { current, total }; total=1 if no branches) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L112) |
| `switchBranch` | <code>(messageId: string, branchIndex: number) =&gt; void</code> | Switch to a different branch at a given message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L114) |
| `reload` | <code>() =&gt; Promise&lt;void&gt;</code> | Re-send last user message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L115) |
| `stop` | <code>() =&gt; void</code> | Abort current request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L116) |
| `setMessages` | <code>(messages: ChatMessage[]) =&gt; void</code> | Replace message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L117) |
| `addToolOutput` | <code>(output: ToolOutput) =&gt; void</code> | Submit client-side tool result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L118) |
| `data?` | `unknown` | Extra data from server response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L119) |
| `handleInputChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Bind to input onChange | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L120) |
| `handleSubmit` | <code>(e?: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Submit current input | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L121) |

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
| `AgentAvatar` | Render agent avatar, falling back to model identity when agent identity is absent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/agent-avatar.tsx#L23) |
| `AgentCard` | AgentCard - render `<AgentCard {...props} />` for the default card, or compose `AgentCard.Header` / `Reasoning` / `Tools` / `Body` for a custom layout. Mirrors the `ToolCall` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L258) |
| `AgentPicker` | AgentPicker - render `<AgentPicker agents={...} .../>` for the default data-driven combobox, or compose `AgentPicker.Trigger`, `Content`, `Search`, `List`, `Item`, `Create`, and `Manage` for a custom menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L492) |
| `AppShell` | Compound AppShell. Compose: | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L529) |
| `AttachmentPill` | AttachmentPill - render `<AttachmentPill attachment={…} />` for the default chip, or compose `AttachmentPill.Root` + `.Thumbnail` / `.Icon` / `.Label` / `.Retry` / `.Remove` for a custom layout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L445) |
| `AttachmentsPanel` | AttachmentsPanel - render `<AttachmentsPanel uploads={…} />` for the default panel, or compose `AttachmentsPanel.Root` + `List` / `Item` / `Empty` / `Action` for a custom layout. Mirrors the `ToolCall` / `Sources` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L463) |
| `BranchPicker` | Branch picker with addressable previous, count, and next leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L179) |
| `Chat` | Render chat components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L320) |
| `ChatActions` | ChatActions - render `<ChatActions onAttachFiles={…} actions={…} />` for the default preset menu, or compose `ChatActions.Trigger` / `Content` / `Item` (each reads `useChatActions()`) for a custom menu. Mirrors the `ToolCall` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L508) |
| `ChatAgentPicker` | Render the connected agent switcher, or nothing when there's nothing to switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L62) |
| `ChatContextProvider` | Render chat context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L98) |
| `ChatEmpty` | Render chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L44) |
| `ChatEmptyState` | Compound empty state. Use the namespaced parts to compose the view: `Root`, `Avatar`, `Heading`, `Suggestions`, `Suggestion`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L168) |
| `ChatIf` | Render chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L18) |
| `ChatInput` | ChatInput - render `<ChatInput … />` for the default composer, or compose `ChatInput.Field` + `ChatInput.Send`/`Stop`/`Voice`/`Model`/`Attach`/`Export`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L607) |
| `ChatMessageList` | Render the default message list or compose its centered `Content` column. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L268) |
| `ChatMessagesSkeleton` | Render the loading skeleton for a chat thread. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/chat-messages-skeleton.tsx#L40) |
| `ChatRoot` | Render chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L86) |
| `ChatSidebar` | Render a chat sidebar - usable as `<ChatSidebar />` or `<ChatSidebar.Root>…`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L728) |
| `ChatThemeScope` | Wrap chat primitives in the `[data-vf-ui]` token scope so they're themed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-theme-scope.tsx#L29) |
| `CodeBlock` | Render a syntax-highlighted code block (or a mermaid diagram). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L437) |
| `CodeSurface` | The code surface. Plain highlighted code is ALWAYS visible immediately - shiki is progressive enhancement layered on top once it lazy-loads from esm.sh (so a stalled/blocked network never leaves an empty "no code block"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L373) |
| `ComposerContextProvider` | Render composer context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L66) |
| `ConversationEmptyState` | State for conversation empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L70) |
| `ConversationsContextProvider` | Low-level context provider (value supplied by the caller). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L37) |
| `ConversationScrollButton` | Render conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L115) |
| `ConversationsProvider` | ConversationsProvider - calls {@link useConversations} once with your `store` / `id` / `onSelect` and shares it via {@link ConversationsContext}. Declare persistence + router wiring here, once, at the app layout; children read it with {@link useConversationsContext}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L50) |
| `CopyButton` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L333) |
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` | Default value for chat stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L3) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` | Default value for chat stream tool running timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L5) |
| `DropZoneOverlay` | Drag overlay shown over the composer while files are dragged onto it - the glyph-in-a-circle + "Drop files" from Studio's `PromptForm`. Rendered inside a `relative` card; fills it and blurs the content behind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L17) |
| `ErrorBanner` | Render error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L27) |
| `FadeIn` | Render fade in. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L36) |
| `InferenceBadge` | Render inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L14) |
| `InlineCitation` | Render the default citation or compose its `Trigger` and `Card` parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L314) |
| `Loader` | Render loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L13) |
| `Markdown` | Render markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L190) |
| `Message` | Message - render `<Message message={msg} />` for the default turn, or compose `Message.Root` + `Message.Header`/`Content`/`Actions`/… for a custom layout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L970) |
| `MessageActionBar` | Context-free message actions with addressable `Copy`, `Copied`, `Regenerate`, and `Edit` icon leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L190) |
| `MessageContextProvider` | Render message context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L76) |
| `MessageEditForm` | Render message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L17) |
| `MessageFeedback` | Message feedback with addressable positive and negative action leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L172) |
| `ModelAvatar` | Render model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L69) |
| `ModelSelector` | ModelSelector - render `<ModelSelector models={...} .../>` for the default data-driven combobox, or compose `ModelSelector.Trigger`, `Content`, `Search`, `List`, and `Item` for a custom menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L435) |
| `QuickActions` | Render quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L19) |
| `Reasoning` | Reasoning - render `<Reasoning text={…} />` for the default disclosure, or compose `Reasoning.Trigger` + `Reasoning.Content` for a custom layout. Mirrors the `Message` / `ToolCall` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L207) |
| `RichCodeBlock` | Render rich code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L23) |
| `Shimmer` | Render shimmer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L4) |
| `SkillBadge` | Render skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L22) |
| `SourcePill` | Render a single source pill with hover preview and score-color behaviour. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L124) |
| `Sources` | Sources - render `<Sources sources={…} />` for the default row, or compose `Sources.Root` + `Sources.List` + `Sources.Pill` for a custom layout. Mirrors the `ToolCall` / `Reasoning` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L184) |
| `StepIndicator` | StepIndicator - render `<StepIndicator stepIndex={…} isComplete />` for the default divider, or compose `StepIndicator.Root` + `.Rule` / `.Label` for a custom layout. Mirrors the `ToolCall` / `Sources` compounds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L126) |
| `Suggestion` | Render suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L13) |
| `Suggestions` | Render suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L48) |
| `Tabs` | Tablist container - manages active state and passes context to items. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L40) |
| `TabsItem` | Individual tab - renders as a button, or an anchor when `href` is set. Forwards native props/ref and composes the caller's `onClick` with the internal selection (caller's runs first, then the tab activates), so a consumer-supplied handler adds to - never overrides - selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L79) |
| `TabSwitcher` | Render tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L27) |
| `ToolCall` | ToolCall - render `<ToolCall tool={part} />` for the default card, or compose `ToolCall.Trigger` / `Body` / `Input` / `Output` / `Error` for a custom layout. Mirrors the `Message` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L448) |
| `ToolStatusBadge` | Render tool status badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L75) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `agentsToPickerOptions` | Narrow browser-safe agent metadata to the picker's row shape. `AgentOption` now shares `AgentMetadata`'s `avatarUrl` field, so `AgentMetadata[]` is also accepted by `<AgentPicker agents>` directly - this helper just drops the fields the rows don't use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L31) |
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L232) |
| `createChatStreamWatchdog` | Create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L155) |
| `createChatStreamWatchdogState` | State for create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L48) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L287) |
| `downloadMarkdown` | Download messages as a .md file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L63) |
| `exportAsMarkdown` | Convert chat messages to a markdown string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L11) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L226) |
| `extractSourcesFromParts` | Extract sources from tool result parts. Looks for `documents` arrays in tool outputs and maps them to Source[]. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L162) |
| `getAgentPromptSuggestions` | Return prompt text suggestions that the current Chat component can render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L146) |
| `getNextChatStreamWatchdogState` | State for get next chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L80) |
| `getTextContent` | Get text content from chat message parts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L15) |
| `groupPartsInOrder` | Group consecutive parts for ordered rendering Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L101) |
| `isHeartbeatOnlyMetadataChunk` | Check whether a chunk only carries heartbeat metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L150) |
| `isLongRunningToolRunning` | Check whether a long-running tool is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L68) |
| `isReasoningPart` | Check if a part is a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L81) |
| `isSkillToolPart` | Check if a tool part is a skill-related tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L76) |
| `isToolPart` | Check if a part is a tool part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L31) |
| `localConversationStore` | localStorage-backed conversation persistence. Pass a `storage` to back it with something else (tests inject an in-memory store); defaults to `localStorage`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/local-conversation-store.ts#L62) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L218) |
| `memoryConversationStore` | In-memory conversation persistence. Optionally seed with initial conversations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/memory-conversation-store.ts#L21) |
| `normalizeAgentMetadata` | Normalize a single browser-safe agent record (the `agent` object inside the `/api/agents/:id` response, or one entry of the `/api/agents` list). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L123) |
| `normalizeAgentMetadataResponse` | Normalize the wire response from /api/agents/:id. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L138) |
| `normalizeAgentsListResponse` | Normalize the wire response from `GET /api/agents`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L32) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L191) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L256) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L349) |
| `useAgent` | React hook for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L47) |
| `useAgentCard` | Read the enclosing `AgentCard` state. Throws when used outside an `AgentCard`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L120) |
| `useAgentMetadata` | React hook for browser-safe source-defined agent metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L186) |
| `useAgentPicker` | Read the enclosing `AgentPicker` state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-context.tsx#L22) |
| `useAgents` | React hook that lists the browser-safe agents a project exposes, via `GET /api/agents`. Companion to {@link useAgentMetadata} (single agent) - use it to drive an agent switcher, e.g. only rendering a picker when `agents.length > 1`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L48) |
| `useAppShell` | Access the enclosing {@link AppShell}'s state (external triggers, etc.). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L48) |
| `useAttachmentPill` | Read the enclosing `AttachmentPill` state. Throws when used outside an `AttachmentPill`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L177) |
| `useAttachmentsPanel` | Read the enclosing `AttachmentsPanel` state. Throws when used outside an `AttachmentsPanel`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L62) |
| `useChat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/use-chat.ts#L110) |
| `useChatActions` | Read the enclosing `ChatActions` state. Throws when used outside a `ChatActions` - a misplaced sub-part is a loud error, never a silent null. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L311) |
| `useChatContext` | Context for use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L82) |
| `useChatContextOptional` | React hook for chat context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L93) |
| `useChatErrorHandler` | Handler for use chat error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L92) |
| `useClipboard` | Clipboard copy hook: copies `text`, flips `copied` for ~2s. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L284) |
| `useCompletion` | useCompletion hook for single text generation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L54) |
| `useComposerContext` | Context for use composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L50) |
| `useComposerContextOptional` | React hook for composer context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L61) |
| `useConversation` | Load one full conversation by id, over a swappable async store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L38) |
| `useConversationChat` | Bind the active conversation to an isolated chat session and persistence sink. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L66) |
| `useConversations` | List + active + persistence for conversations, over a swappable async store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L152) |
| `useConversationsContext` | Read the shared conversations state. Throws when used outside a provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L21) |
| `useConversationsContextOptional` | Read the shared conversations state, or `null` when there is no provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L32) |
| `useMessageContext` | Context for use message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L41) |
| `useMessageContextOptional` | React hook for message context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L52) |
| `useMessageParts` | `useMessageParts` - read the current message's parts as data, so a consumer can render them however they like (the headless access point to parts; `Message.Part` is the leaf and `Message.Content` provides the default rendering). Throws outside a `Message`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L70) |
| `useModelSelector` | Read the enclosing `ModelSelector` selection + open state. Throws when used outside a `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L164) |
| `useReasoning` | Read the enclosing `Reasoning` state. Throws when used outside a `Reasoning`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L27) |
| `useSources` | Read the enclosing `Sources` state. Throws when used outside a `Sources`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L30) |
| `useStepIndicator` | Read the enclosing `StepIndicator` state. Throws when used outside a `StepIndicator`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L44) |
| `useStickToBottom` | Track and maintain "stick to bottom" for a scroll container. Attach `scrollRef` to the scrollable container and `contentRef` to the element that grows as messages / tokens arrive; the hook follows that growth while the user is pinned to the bottom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L50) |
| `useStreaming` | React hook for streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L40) |
| `useToolCall` | Read the enclosing `ToolCall` state. Throws when used outside a `ToolCall`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L219) |
| `useUpload` | Drive file uploads and expose the resulting attachment lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L75) |
| `useUploadsRegistry` | Persistent, cross-conversation registry of uploaded files. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L112) |
| `useVoiceInput` | Input payload for use voice. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L100) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatErrorBoundary` | Implement chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L16) |
| `ChatStreamIdleTimeoutError` | Error shape for chat stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L32) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentAvatarProps` | Props accepted by agent avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/agent-avatar.tsx#L11) |
| `AgentCardContextValue` | Per-card state shared with `AgentCard.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L105) |
| `AgentCardProps` | Props accepted by agent card. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L33) |
| `AgentMetadata` | Browser-safe source-defined agent metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L31) |
| `AgentMetadataPromptSuggestion` | Source-defined prompt suggestion shown by chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L4) |
| `AgentMetadataSuggestion` | Source-defined agent suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L22) |
| `AgentMetadataSuggestions` | Source-defined suggestion group for an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L25) |
| `AgentMetadataTaskSuggestion` | Source-defined task suggestion shown by chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L16) |
| `AgentOption` | A selectable agent entry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L42) |
| `AgentPickerActionProps` | Props shared by `AgentPicker.Create` and `AgentPicker.Manage`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-actions.tsx#L6) |
| `AgentPickerContentProps` | Props for `AgentPicker.Content` - the popover surface + `Command` shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L247) |
| `AgentPickerContextValue` | Shared selection and open state exposed to `AgentPicker.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-context.tsx#L4) |
| `AgentPickerItemProps` | Props for `AgentPicker.Item` - a single selectable agent row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L282) |
| `AgentPickerProps` | Props accepted by `<AgentPicker>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L63) |
| `AgentPickerSearchProps` | Props for `AgentPicker.Search` - the addressable search input leaf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L226) |
| `AgentPickerSection` | A labelled group of agents (e.g. "Connected Agents"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L56) |
| `AgentPickerTriggerProps` | Props for `AgentPicker.Trigger` - the pill/input combobox button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L162) |
| `AgentTheme` | Public API contract for agent theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L61) |
| `AppShellHeaderProps` | Props accepted by {@link AppShellHeader}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L434) |
| `AppShellOpenState` | Per-side visibility map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L94) |
| `AppShellProps` | Props accepted by {@link AppShell}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L100) |
| `AppShellSide` | Which edge a sidebar docks to. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L27) |
| `AppShellSidebarProps` | Props accepted by {@link AppShellSidebar}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L230) |
| `AppShellTriggerProps` | Props accepted by {@link AppShellTrigger}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L466) |
| `AttachmentInfo` | Public API contract for attachment info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L16) |
| `AttachmentPillContextValue` | Derived per-pill view state shared with `AttachmentPill.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L141) |
| `AttachmentPillProps` | Props accepted by attachment pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L33) |
| `AttachmentsPanelActionProps` | Props for `AttachmentsPanel.Action` - the upload/attach button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L410) |
| `AttachmentsPanelContextValue` | Per-panel state shared with `AttachmentsPanel.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L41) |
| `AttachmentsPanelEmptyProps` | Props for `AttachmentsPanel.Empty` - the no-files state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L368) |
| `AttachmentsPanelItemProps` | Props accepted by an individual `AttachmentsPanel.Item` (attachment card). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L247) |
| `AttachmentsPanelListProps` | Props for `AttachmentsPanel.List` - the scrollable list of file rows. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L218) |
| `AttachmentsPanelLoadingProps` | Props for `AttachmentsPanel.Loading` - the initial-fetch placeholder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L329) |
| `AttachmentsPanelProps` | Props accepted by `AttachmentsPanel` / `AttachmentsPanel.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L73) |
| `BranchInfo` | Public API contract for branch info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L71) |
| `BranchPickerActionProps` | Props shared by `BranchPicker.Previous` and `BranchPicker.Next`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L17) |
| `BranchPickerCountProps` | Props accepted by `BranchPicker.Count`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L24) |
| `BranchPickerProps` | Props accepted by branch picker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L5) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L8) |
| `ChatActionItem` | A single data-driven action row in the `<ChatActions>` menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L229) |
| `ChatActionsContentProps` | Props for `ChatActions.Content` - the dropdown surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L404) |
| `ChatActionsContextValue` | Shared state exposed to `ChatActions.*` sub-parts via `useChatActions()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L292) |
| `ChatActionsItemProps` | Props for `ChatActions.Item` - a single selectable menu row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L427) |
| `ChatActionsProps` | Props accepted by `<ChatActions>` / `<ChatActions.Root>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L243) |
| `ChatActionsSettings` | The two toggle settings surfaced in the Settings submenu (forked from Studio). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L92) |
| `ChatActionsTriggerProps` | Props for `ChatActions.Trigger` - the menu's trigger button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L368) |
| `ChatAgentInfo` | Agent identity + agent-driven content for `<Chat>`. Collapses the old `agent` / `models` / suggestion props into one object. In app mode (`agentId`) this is derived from agent metadata automatically; pass it yourself to drive a controlled chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/chat-props.ts#L19) |
| `ChatAgentPickerProps` | Props accepted by `<ChatAgentPicker>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L40) |
| `ChatContextValue` | Public API contract for chat context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L19) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L67) |
| `ChatEmptyProps` | Props accepted by chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L20) |
| `ChatEmptyStateAvatarProps` | Props accepted by `<ChatEmptyState.Avatar>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L54) |
| `ChatEmptyStateHeadingProps` | Props accepted by `<ChatEmptyState.Heading>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L88) |
| `ChatEmptyStateRootProps` | Props accepted by `<ChatEmptyState.Root>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L28) |
| `ChatEmptyStateSuggestionProps` | Props accepted by `<ChatEmptyState.Suggestion>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L143) |
| `ChatEmptyStateSuggestionsProps` | Props accepted by `<ChatEmptyState.Suggestions>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L118) |
| `ChatErrorBoundaryProps` | Props accepted by chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L3) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L178) |
| `ChatIfProps` | Props accepted by chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L11) |
| `ChatInputExportProps` | Props accepted by `<ChatInput.Export>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L312) |
| `ChatInputProps` | Props accepted by `ChatInput`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L381) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L101) |
| `ChatMessageListContentProps` | Props accepted by the centered transcript column. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L82) |
| `ChatMessageListProps` | Props accepted by chat message list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L24) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L147) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L110) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L90) |
| `ChatMessagesSkeletonProps` | Props accepted by `<ChatMessagesSkeleton>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/chat-messages-skeleton.tsx#L35) |
| `ChatProps` | Props accepted by chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/chat-props.ts#L33) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L17) |
| `ChatRootProps` | Props accepted by chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L30) |
| `ChatSidebarComponent` | Compound type - the preset plus its namespaced sub-components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L718) |
| `ChatSidebarEmptyProps` | Props accepted by {@link ChatSidebarEmpty}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L542) |
| `ChatSidebarGroupProps` | Props accepted by {@link ChatSidebarGroup}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L515) |
| `ChatSidebarItemProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L335) |
| `ChatSidebarListProps` | Props accepted by {@link ChatSidebarList}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L593) |
| `ChatSidebarNewButtonProps` | Props accepted by {@link ChatSidebarNewButton}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L266) |
| `ChatSidebarProps` | Props accepted by the {@link ChatSidebar} preset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L675) |
| `ChatSidebarRootProps` | Props accepted by {@link ChatSidebarRoot}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L213) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L78) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L193) |
| `ChatStreamWatchdogOptions` | Options accepted by chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L23) |
| `ChatStreamWatchdogPhase` | Public API contract for chat stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L8) |
| `ChatStreamWatchdogState` | State for chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L15) |
| `ChatTab` | Public API contract for chat tab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L12) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L10) |
| `ChatTheme` | Public API contract for chat theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L21) |
| `ChatThemeScopeProps` | Props accepted by {@link ChatThemeScope}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-theme-scope.tsx#L22) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L47) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L58) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L39) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L371) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L135) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L120) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L127) |
| `CodeBlockProps` | Props accepted by code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L5) |
| `CodeSurfaceProps` | Props accepted by {@link CodeSurface}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L359) |
| `ComposerContextValue` | Public API contract for composer context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L15) |
| `Conversation` | A full conversation - metadata + its messages. Fetched via {@link ConversationStore.load}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L39) |
| `ConversationEmptyStateProps` | Props accepted by conversation empty state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L61) |
| `ConversationPatch` | Fields a conversation can be patched with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L100) |
| `ConversationScrollButtonProps` | Props accepted by conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L107) |
| `ConversationsProviderProps` | Props accepted by {@link ConversationsProvider}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L40) |
| `ConversationStore` | Async persistence contract for conversations. Implement all four methods; `subscribe`/`dispose` are optional capabilities (feature-detect them). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L47) |
| `ConversationSummary` | Lightweight conversation metadata - what a list / sidebar needs (no messages). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L32) |
| `CopyButtonProps` | Props accepted by {@link CopyButton}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L316) |
| `DropZoneOverlayProps` | Props accepted by drop zone overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L4) |
| `ErrorBannerProps` | Props accepted by error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L13) |
| `FeedbackValue` | Public API contract for feedback value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L5) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L29) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L3) |
| `InferenceBadgeProps` | Props accepted by inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L5) |
| `InferenceMode` | Where inference is happening. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L15) |
| `InlineCitationCardProps` | Props accepted by `InlineCitation.Card`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L107) |
| `InlineCitationProps` | Props accepted by inline citation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L6) |
| `InlineCitationTriggerProps` | Props accepted by `InlineCitation.Trigger`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L41) |
| `MarkdownProps` | Props accepted by markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L21) |
| `MessageActionBarActionProps` | Props shared by the `MessageActionBar.*` action leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L26) |
| `MessageActionBarProps` | Props accepted by the context-free message action bar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L10) |
| `MessageContextValue` | Public API contract for message context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L16) |
| `MessageEditFormProps` | Props accepted by message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L4) |
| `MessageFeedbackActionProps` | Props shared by `MessageFeedback.Positive` and `MessageFeedback.Negative`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L21) |
| `MessageFeedbackProps` | Props accepted by message feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L8) |
| `MessagePartsData` | The message's grouped parts exposed as headless data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L57) |
| `MessageProps` | Props accepted by `<Message />`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L930) |
| `MessageRootProps` | Props accepted by message root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L65) |
| `MessageTokensProps` | Props accepted by `Message.Tokens`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L791) |
| `ModelAvatarProps` | Props accepted by model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L13) |
| `ModelOption` | A "provider/model" value and its display label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L57) |
| `ModelSelectorContentProps` | Props for `ModelSelector.Content` - the popover surface + `Command` shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L247) |
| `ModelSelectorContextValue` | Shared selection + open state exposed to `ModelSelector.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L139) |
| `ModelSelectorItemProps` | Props for `ModelSelector.Item` - a single selectable model row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L282) |
| `ModelSelectorProps` | Props accepted by `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L71) |
| `ModelSelectorSearchProps` | Props for `ModelSelector.Search`, the addressable search input leaf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L232) |
| `ModelSelectorTriggerProps` | Props for `ModelSelector.Trigger` - the pill/icon combobox button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L175) |
| `OnToolCallArg` | Public API contract for on tool call arg. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L43) |
| `PartGroup` | Part group types for ordered rendering | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L90) |
| `QuickAction` | Public API contract for quick action. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L4) |
| `QuickActionsProps` | Props accepted by quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L12) |
| `ReasoningContextValue` | Per-card state shared with `Reasoning.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L17) |
| `ReasoningProps` | Props accepted by `Reasoning` / `Reasoning.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L38) |
| `ReasoningTriggerProps` | Props for `Reasoning.Trigger` - the disclosure button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L144) |
| `SkillBadgeProps` | Props accepted by skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L11) |
| `Source` | Public API contract for source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L5) |
| `SourcePillProps` | Props accepted by an individual source pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L116) |
| `SourcesContextValue` | Per-list state shared with `Sources.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L22) |
| `SourcesListProps` | Props for `Sources.List` - the flex-wrap row of pills. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L79) |
| `SourcesProps` | Props accepted by `Sources` / `Sources.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L41) |
| `StepIndicatorContextValue` | Per-indicator state shared with `StepIndicator.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L29) |
| `StepIndicatorProps` | Props accepted by step indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L6) |
| `StorageLike` | The slice of the Web Storage API this adapter needs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/local-conversation-store.ts#L19) |
| `SuggestionProps` | Props accepted by suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L5) |
| `SuggestionsProps` | Props accepted by suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L41) |
| `TabsItemProps` | Props accepted by `<TabsItem>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L66) |
| `TabsProps` | Props accepted by `<Tabs>` (the tablist container). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L32) |
| `TabSwitcherProps` | Props accepted by tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L15) |
| `TokenRowProps` | One row in the token usage breakdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L784) |
| `ToolCallContextValue` | Per-tool state shared with `ToolCall.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L208) |
| `ToolCallProps` | Props accepted by `ToolCall` / `ToolCall.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L230) |
| `ToolCallTriggerProps` | Props for `ToolCall.Trigger` - the header button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L318) |
| `ToolOutput` | Output from tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L34) |
| `UploadedFile` | Public API contract for uploaded file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L22) |
| `UseAgentMetadataResult` | Result returned from useAgentMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L40) |
| `UseAgentOptions` | Options accepted by use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L5) |
| `UseAgentResult` | Result returned from use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L20) |
| `UseAgentsOptions` | Options accepted by {@link useAgents}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L5) |
| `UseAgentsResult` | Result returned from {@link useAgents}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L14) |
| `UseChatOptions` | Options accepted by use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L53) |
| `UseChatResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L89) |
| `UseClipboardResult` | Result of {@link useClipboard}: the copied flag + a `copy` trigger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L276) |
| `UseCompletionOptions` | Options accepted by use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L10) |
| `UseCompletionResult` | Result returned from use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L31) |
| `UseConversationChatOptions` | `useConversationChat` - the library primitive that binds a `useChat` session to conversation persistence, so application code does not need to duplicate the persistence effect. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L38) |
| `UseConversationChatResult` | Result returned by {@link useConversationChat}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L56) |
| `UseConversationOptions` | Options for {@link useConversation}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L19) |
| `UseConversationResult` | Result of {@link useConversation}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L28) |
| `UseConversationsOptions` | Options for {@link useConversations}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L107) |
| `UseConversationsResult` | Result of {@link useConversations}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L122) |
| `UseStickToBottomOptions` | Options for {@link useStickToBottom}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L21) |
| `UseStickToBottomResult` | Result of {@link useStickToBottom}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L27) |
| `UseStreamingOptions` | Options accepted by use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L4) |
| `UseStreamingResult` | Result returned from use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L19) |
| `UseUploadOptions` | Options for {@link useUpload}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L18) |
| `UseUploadResult` | Result of {@link useUpload}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L29) |
| `UseUploadsRegistryOptions` | Options for {@link useUploadsRegistry}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L29) |
| `UseUploadsRegistryResult` | Result of {@link useUploadsRegistry}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L44) |
| `UseVoiceInputOptions` | Options accepted by use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L3) |
| `UseVoiceInputResult` | Result returned from use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L27) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/chat/ag-ui`

```ts
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk, flushAgUiSseChunk } from "veryfront/chat/ag-ui";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgUiChatEventDecoderState` | State for create AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L928) |
| `decodeAgUiSseChunk` | Decode AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L947) |
| `flushAgUiSseChunk` | Flush AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L992) |
| `mapAgUiRuntimeMessagesToChatUiMessages` | Map AG-UI runtime messages to chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L372) |
| `parseSseEvent` | Event emitted for parse sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L894) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgUiChatEventDecoderState` | State for AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L93) |
| `AgUiDecodedChunk` | Public API contract for AG-UI decoded chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L84) |
| `AgUiDecodedEvent` | Event emitted for AG-UI decoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L77) |
| `AgUiDecoderValidationMode` | Public API contract for AG-UI decoder validation mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L90) |
| `AgUiRunFinishedMetadata` | Public API contract for AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L528) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L44) |
| `AgUiRuntimeToolCall` | Public API contract for AG-UI runtime tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L34) |
| `AgUiSnapshotMessage` | Message shape for AG-UI snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L532) |
| `AgUiWireEvent` | Event emitted for AG-UI wire. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L536) |
| `AgUiWireEventName` | Public API contract for AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L534) |
| `ParsedSseEvent` | Event emitted for parsed sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L70) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAgUiRunFinishedMetadataSchema` | Zod schema for get AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L129) |
| `getAgUiSnapshotMessageSchema` | Zod schema for get AG-UI snapshot message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L176) |
| `getAgUiSnapshotToolCallSchema` | Zod schema for get AG-UI snapshot tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L146) |
| `getAgUiWireEventNameSchema` | Zod schema for get AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L212) |
| `getAgUiWireEventSchema` | Zod schema for get AG-UI wire event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L405) |

### `veryfront/chat/message-prep`

```ts
import { compactForStep, compactHistoricalUiMessageToolInputs, compactOldToolInputs } from "veryfront/chat/message-prep";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_MESSAGE_PREP_LIMITS` | Default limits for chat history preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L33) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compactForStep` | Compact for step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1770) |
| `compactHistoricalUiMessageToolInputs` | Compact large historical UI-message tool inputs after matching results are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1492) |
| `compactOldToolInputs` | Compact large historical tool-call inputs after matching results are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1405) |
| `compressTurn` | Compress turn. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L225) |
| `dedupeToolHistory` | Dedupe tool history. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1794) |
| `enforceTokenBudget` | Enforce token budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1861) |
| `enforceTokenBudgetWithTurnCompression` | Enforce token budget with turn compression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L300) |
| `ensureToolCallInputs` | Ensure tool call inputs helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1739) |
| `estimateMessageTokenBreakdown` | Estimate token categories for provider, UI, or runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L178) |
| `estimateOverhead` | Estimate overhead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1733) |
| `estimateTokens` | Estimate tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L96) |
| `isModelSupportedFileMediaType` | Check whether the model supports the file media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L659) |
| `maskOldToolOutputs` | Mask old tool outputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1307) |
| `normalizeMessageFilePartMediaTypes` | Normalizes message file part media types. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L665) |
| `prepareProviderModelMessagesFromUiMessages` | Prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1006) |
| `repairToolPairs` | Repair tool pairs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1590) |
| `rewriteUnsupportedFilePartsAsAnnotations` | Rewrite unsupported file parts as annotations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L692) |
| `sanitizeProviderModelMessages` | Sanitize provider model messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L897) |
| `stripPendingToolParts` | Strip pending tool parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L793) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `HistoricalToolInputCompactionDiagnostic` | Diagnostic emitted when a completed historical tool input is compacted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L70) |
| `HistoricalToolInputRetainedField` | Field selector retained in a historical tool-input summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L45) |
| `HistoricalToolInputRetentionOptions` | Options for historical tool-input compaction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L83) |
| `HistoricalToolInputRetentionPolicy` | Policy for compacting a completed historical tool-call input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L57) |
| `HistoricalToolInputRetentionPolicyResolver` | Resolves the retention policy for a completed historical tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L64) |
| `MessagePrepLimits` | Tunable limits used while preparing chat history for model context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L23) |
| `MessageTokenBreakdown` | Approximate token categories for context diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L101) |
| `PrepareProviderModelMessagesFromUiMessagesOptions` | Options accepted by prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L90) |

### `veryfront/chat/protocol`

Canonical chat message and stream protocol for Veryfront chat surfaces. These types describe the framework-owned message parts and stream events used by AG-UI-aligned chat clients, hooks, and adapters.

```ts
import "veryfront/chat/protocol";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatDataPart` | Public API contract for chat data part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L84) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L67) |
| `ChatFilePart` | Chat message part that carries an uploaded file or image attachment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L26) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L178) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L101) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L147) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L110) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L90) |
| `ChatPartState` | Canonical chat message and stream protocol for Veryfront chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L7) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L17) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L78) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L193) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L10) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L47) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L58) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L39) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L371) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L135) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L120) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L127) |

### `veryfront/chat/types`

```ts
import { buildDataFileAnnotation, isImageFile, isTextPreviewFile } from "veryfront/chat/types";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildDataFileAnnotation` | Builds data file annotation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L652) |
| `isImageFile` | Check whether a file is an image. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L610) |
| `isTextPreviewFile` | Check whether a file supports text preview. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L624) |
| `isValidImageFile` | Check whether a file is a supported image upload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L615) |
| `normalizeInlineAttachmentMediaType` | Normalizes inline attachment media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L629) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatAssistantContentPart` | Public API contract for chat assistant content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L249) |
| `ChatAssistantMessage` | Message shape for chat assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L270) |
| `ChatDataUiPart` | Chat UI part that carries custom data chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L160) |
| `ChatDynamicToolUiPart` | Tool UI part for a runtime-selected tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L148) |
| `ChatFileUiPart` | Public API contract for chat file UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L106) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L147) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L110) |
| `ChatModelFilePart` | Public API contract for chat model file part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L203) |
| `ChatModelReasoningPart` | Provider model message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L195) |
| `ChatModelTextPart` | Provider model message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L189) |
| `ChatNamedToolUiPart` | Tool UI part keyed by a static tool type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L154) |
| `ChatReasoningUiPart` | Public API contract for chat reasoning UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L76) |
| `ChatRequestContext` | Context for chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L347) |
| `ChatRuntimeOverrides` | Public API contract for chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L300) |
| `ChatSourceDocumentUiPart` | Public API contract for chat source document UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L97) |
| `ChatSourceUrlUiPart` | Public API contract for chat source URL UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L89) |
| `ChatStepStartUiPart` | Public API contract for chat step start UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L84) |
| `ChatSystemMessage` | Message shape for chat system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L257) |
| `ChatTextUiPart` | Public API contract for chat text UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L70) |
| `ChatToolCallPart` | Provider model message part that carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L214) |
| `ChatToolMessage` | Message shape for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L276) |
| `ChatToolPartState` | State for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L120) |
| `ChatToolResultOutput` | Output from chat tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L223) |
| `ChatToolResultPart` | Provider model message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L238) |
| `ChatUiMessage` | Message shape for chat UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L178) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L371) |
| `ChatUiMessagePart` | Public API contract for chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L166) |
| `ChatUiMessageRole` | Public API contract for chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L67) |
| `ChatUserContentPart` | Public API contract for chat user content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L247) |
| `ChatUserMessage` | Message shape for chat user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L264) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L135) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L120) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L127) |
| `DurableRootRunDescriptor` | Public API contract for durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L289) |
| `FileUIPartWithUpload` | File UI part enriched with upload metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L114) |
| `MessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L147) |
| `ProjectFile` | Public API contract for project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L307) |
| `ProjectFileListItem` | Public API contract for project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L313) |
| `ProviderModelMessage` | Message shape for provider model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L282) |
| `UploadedFileReference` | Public API contract for uploaded file reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L322) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getChatRequestContextSchema` | Zod schema for get chat request context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L332) |
| `getChatToolPartStateSchema` | Zod schema for get chat tool part state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L436) |
| `getChatUiMessagePartSchema` | Zod schema for get chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L557) |
| `getChatUiMessageRoleSchema` | Zod schema for get chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L431) |
| `getChatUiMessageSchema` | Zod schema for get chat UI message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L572) |
| `getChatUiMessagesSchema` | Zod schema for get chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L582) |
| `getMessageMetadataSchema` | Zod schema for get message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L398) |
| `imageFileTypes` | Image media types that chat uploads can display natively. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L52) |
| `textFileExtensions` | File extensions that chat uploads can inline as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L49) |

### `veryfront/chat/uploads`

Chat upload handler: the server side of `<Chat>`'s batteries-included attachments. Mount it at `app/api/uploads/route.ts` (the same endpoint the composer POSTs to) and files "just work": stored on the local disk in dev, on Veryfront Cloud (or a `BlobStorage` you pass) once deployed. ```ts // app/api/uploads/route.ts import { createChatUploadHandler } from "veryfront/chat/uploads"; function authorize(request: Request) { const token = Deno.env.get("UPLOAD_TOKEN"); return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`); } export const { POST, GET, DELETE } = createChatUploadHandler({ authorize }); ``` `POST` stores the multipart `file` field and returns `{ id, url, name, mediaType, size }`. The composer sends that `url` as a `file` message part, which the runtime fetches, so the URL must be reachable by the runtime (true for local dev, where `GET` streams the file back from the same origin).

```ts
import { createChatUploadHandler } from "veryfront/chat/uploads";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createChatUploadHandler` | Build `{ POST, GET, DELETE }` route handlers for chat attachments. Auto-selects local disk storage in dev and Veryfront Cloud once deployed, or the `storage` you provide. `DELETE ?id=` removes the file from storage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L114) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatUploadHandlerConfig` | Configuration for {@link createChatUploadHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L43) |
