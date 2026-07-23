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
| `api?` | `string` | AG-UI endpoint. Defaults to "/api/ag-ui". | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L56) |
| `transport?` | `"ag-ui"` | Streaming response protocol used by the endpoint. AG-UI is the default. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L58) |
| `initialMessages?` | `ChatMessage[]` | Pre-populated messages | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L59) |
| `body?` | <code>Record&lt;string, unknown&gt;</code> | Extra body fields sent with each request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L60) |
| `headers?` | <code>Record&lt;string, string&gt;</code> | Custom request headers | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L61) |
| `credentials?` | `RequestCredentials` | Fetch credentials mode | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L62) |
| `model?` | `string` | Override model at runtime (e.g. "openai/gpt-4o", "Anthropic/claude-sonnet-4-5-20250929") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L64) |
| `onResponse?` | <code>(response: Response) =&gt; void</code> | Raw response callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L65) |
| `onFinish?` | <code>(message: ChatMessage) =&gt; void</code> | Completion callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L66) |
| `onError?` | <code>(error: Error) =&gt; void</code> | Error callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L67) |
| `onToolCall?` | <code>(arg: OnToolCallArg) =&gt; void &#124; Promise&lt;void&gt;</code> | Tool call handler for client-side execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L68) |

### `UseChatResult`

`useChat` result

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `messages` | `ChatMessage[]` | All messages in the conversation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L91) |
| `input` | `string` | Current input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L92) |
| `isLoading` | `boolean` | Whether a request is in flight | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L94) |
| `status` | `ChatStatus` | Streaming lifecycle of the current turn (AI-SDK parity). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L96) |
| `streamingMessageId` | `string \| null` | Id of the assistant message currently streaming, or `null` when idle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L98) |
| `error` | `Error \| null` | Last error (if any) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L99) |
| `model` | `string \| undefined` | Current model override (undefined = use agent default) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L101) |
| `activeModel` | `string \| undefined` | The actual model being used after auto-upgrade (e.g. "Anthropic/claude-sonnet-4-20250514") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L103) |
| `inferenceMode` | `InferenceMode` | Where inference is currently happening | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L105) |
| `setInput` | <code>(input: string) =&gt; void</code> | Set input value | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L106) |
| `setModel` | <code>(model: string &#124; undefined) =&gt; void</code> | Change the model for subsequent requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L108) |
| `sendMessage` | <code>(message: &#123; text: string; files?: ChatFilePart[] &#125;) =&gt; Promise&lt;void&gt;</code> | Send a message programmatically | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L109) |
| `editMessage` | <code>(messageId: string, newText: string) =&gt; Promise&lt;void&gt;</code> | Edit a user message and resubmit - truncates history to that point | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L111) |
| `getBranches` | <code>(messageId: string) =&gt; BranchInfo</code> | Get branch info for a message (returns { current, total }; total=1 if no branches) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L113) |
| `switchBranch` | <code>(messageId: string, branchIndex: number) =&gt; void</code> | Switch to a different branch at a given message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L115) |
| `reload` | <code>() =&gt; Promise&lt;void&gt;</code> | Re-send last user message | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L116) |
| `stop` | <code>() =&gt; void</code> | Abort current request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L117) |
| `setMessages` | <code>(messages: ChatMessage[]) =&gt; void</code> | Replace message history | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L118) |
| `addToolOutput` | <code>(output: ToolOutput) =&gt; void</code> | Submit client-side tool result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L119) |
| `data?` | `unknown` | Extra data from server response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L120) |
| `handleInputChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement &#124; HTMLTextAreaElement&gt;) =&gt; void</code> | Bind to input onChange | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L121) |
| `handleSubmit` | <code>(e?: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Submit current input | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L122) |

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
| `AgentAvatar` | Render agent avatar, falling back to model identity when agent identity is absent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/agent-avatar.tsx#L24) |
| `AgentCard` | AgentCard - render `<AgentCard {...props} />` for the default card, or compose `AgentCard.Header` / `Reasoning` / `Tools` / `Body` for a custom layout. Mirrors the `ToolCall` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L259) |
| `AgentPicker` | AgentPicker - render `<AgentPicker agents={...} .../>` for the default data-driven combobox, or compose `AgentPicker.Trigger`, `Content`, `Search`, `List`, `Item`, `Create`, and `Manage` for a custom menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L493) |
| `AppShell` | Compound AppShell. Compose: | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L530) |
| `AttachmentPill` | AttachmentPill - render `<AttachmentPill attachment={…} />` for the default chip, or compose `AttachmentPill.Root` + `.Thumbnail` / `.Icon` / `.Label` / `.Retry` / `.Remove` for a custom layout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L447) |
| `AttachmentsPanel` | AttachmentsPanel - render `<AttachmentsPanel uploads={…} />` for the default panel, or compose `AttachmentsPanel.Root` + `List` / `Item` / `Empty` / `Action` for a custom layout. Mirrors the `ToolCall` / `Sources` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L565) |
| `BranchPicker` | Branch picker with addressable previous, count, and next leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L180) |
| `Chat` | Render chat components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/index.tsx#L321) |
| `ChatActions` | ChatActions - render `<ChatActions onAttachFiles={…} actions={…} />` for the default preset menu, or compose `ChatActions.Trigger` / `Content` / `Item` (each reads `useChatActions()`) for a custom menu. Mirrors the `ToolCall` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L509) |
| `ChatAgentPicker` | Render the connected agent switcher, or nothing when there's nothing to switch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L63) |
| `ChatContextProvider` | Render chat context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L99) |
| `ChatEmpty` | Render chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L45) |
| `ChatEmptyState` | Compound empty state. Use the namespaced parts to compose the view: `Root`, `Avatar`, `Heading`, `Suggestions`, `Suggestion`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L169) |
| `ChatIf` | Render chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L19) |
| `ChatInput` | ChatInput - render `<ChatInput … />` for the default composer, or compose `ChatInput.Field` + `ChatInput.Send`/`Stop`/`Voice`/`Model`/`Attach`/`Export`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L608) |
| `ChatMessageList` | Render the default message list or compose its centered `Content` column. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L269) |
| `ChatMessagesSkeleton` | Render the loading skeleton for a chat thread. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/chat-messages-skeleton.tsx#L41) |
| `ChatRoot` | Render chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L87) |
| `ChatSidebar` | Render a chat sidebar - usable as `<ChatSidebar />` or `<ChatSidebar.Root>…`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L729) |
| `ChatThemeScope` | Wrap chat primitives in the `[data-vf-ui]` token scope so they're themed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-theme-scope.tsx#L30) |
| `CodeBlock` | Render a syntax-highlighted code block (or a mermaid diagram). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L438) |
| `CodeSurface` | The code surface. Plain highlighted code is ALWAYS visible immediately - shiki is progressive enhancement layered on top once it lazy-loads from esm.sh (so a stalled/blocked network never leaves an empty "no code block"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L374) |
| `ComposerContextProvider` | Render composer context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L67) |
| `ConversationEmptyState` | State for conversation empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L71) |
| `ConversationsContextProvider` | Low-level context provider (value supplied by the caller). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L38) |
| `ConversationScrollButton` | Render conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L116) |
| `ConversationsProvider` | ConversationsProvider - calls {@link useConversations} once with your `store` / `id` / `onSelect` and shares it via {@link ConversationsContext}. Declare persistence + router wiring here, once, at the app layout; children read it with {@link useConversationsContext}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L51) |
| `CopyButton` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L334) |
| `DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS` | Default value for chat stream idle timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L4) |
| `DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS` | Default value for chat stream tool running timeout ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L6) |
| `DropZoneOverlay` | Drag overlay shown over the composer while files are dragged onto it - the glyph-in-a-circle + "Drop files" from Studio's `PromptForm`. Rendered inside a `relative` card; fills it and blurs the content behind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L18) |
| `ErrorBanner` | Render error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L28) |
| `FadeIn` | Render fade in. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L37) |
| `InferenceBadge` | Render inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L15) |
| `InlineCitation` | Render the default citation or compose its `Trigger` and `Card` parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L315) |
| `Loader` | Render loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L14) |
| `Markdown` | Render Markdown with GFM, syntax-highlighted code, and Mermaid diagrams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L146) |
| `Message` | Message - render `<Message message={msg} />` for the default turn, or compose `Message.Root` + `Message.Header`/`Content`/`Actions`/… for a custom layout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L876) |
| `MessageActionBar` | Context-free message actions with addressable `Copy`, `Copied`, `Regenerate`, and `Edit` icon leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L191) |
| `MessageContextProvider` | Render message context provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L77) |
| `MessageEditForm` | Render message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L18) |
| `MessageFeedback` | Message feedback with addressable positive and negative action leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L173) |
| `ModelAvatar` | Render model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L70) |
| `ModelSelector` | ModelSelector - render `<ModelSelector models={...} .../>` for the default data-driven combobox, or compose `ModelSelector.Trigger`, `Content`, `Search`, `List`, and `Item` for a custom menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L436) |
| `QuickActions` | Render quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L20) |
| `Reasoning` | Reasoning - render `<Reasoning text={…} />` for the default disclosure, or compose `Reasoning.Trigger` + `Reasoning.Content` for a custom layout. Mirrors the `Message` / `ToolCall` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L208) |
| `RichCodeBlock` | Render rich code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L24) |
| `Shimmer` | Render shimmer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/animations.tsx#L5) |
| `SkillBadge` | Render skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L23) |
| `SourcePill` | Render a single source pill with hover preview and score-color behaviour. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L134) |
| `Sources` | Sources - render `<Sources sources={…} />` for the default row, or compose `Sources.Root` + `Sources.List` + `Sources.Pill` for a custom layout. Mirrors the `ToolCall` / `Reasoning` compounds: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L194) |
| `StepIndicator` | StepIndicator - render `<StepIndicator stepIndex={…} isComplete />` for the default divider, or compose `StepIndicator.Root` + `.Rule` / `.Label` for a custom layout. Mirrors the `ToolCall` / `Sources` compounds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L127) |
| `Suggestion` | Render suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L14) |
| `Suggestions` | Render suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L49) |
| `Tabs` | Tablist container - manages active state and passes context to items. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L41) |
| `TabsItem` | Individual tab - renders as a button, or an anchor when `href` is set. Forwards native props/ref and composes the caller's `onClick` with the internal selection (caller's runs first, then the tab activates), so a consumer-supplied handler adds to - never overrides - selection. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L80) |
| `TabSwitcher` | Render tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L28) |
| `ToolCall` | ToolCall - render `<ToolCall tool={part} />` for the default card, or compose `ToolCall.Trigger` / `Body` / `Input` / `Output` / `Error` for a custom layout. Mirrors the `Message` compound: render it, or compose it. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L449) |
| `ToolStatusBadge` | Render tool status badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L76) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `agentsToPickerOptions` | Narrow browser-safe agent metadata to the picker's row shape. `AgentOption` now shares `AgentMetadata`'s `avatarUrl` field, so `AgentMetadata[]` is also accepted by `<AgentPicker agents>` directly - this helper just drops the fields the rows don't use. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L32) |
| `buildChatStreamChunkMessageMetadata` | Builds chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L329) |
| `createChatStreamWatchdog` | Create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L174) |
| `createChatStreamWatchdogState` | State for create chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L64) |
| `dedupeChatUiMessageChunks` | Dedupe chat UI message chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L384) |
| `downloadMarkdown` | Download messages as a .md file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L64) |
| `exportAsMarkdown` | Convert chat messages to a markdown string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/export.ts#L12) |
| `extractChatMessageMetadata` | Extract chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L323) |
| `extractSourcesFromParts` | Extract sources from tool result parts. Looks for `documents` arrays in tool outputs and maps them to Source[]. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L163) |
| `getAgentPromptSuggestions` | Return prompt text suggestions that the current Chat component can render. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L161) |
| `getNextChatStreamWatchdogState` | State for get next chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L99) |
| `getTextContent` | Get text content from chat message parts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L16) |
| `groupPartsInOrder` | Group consecutive parts for ordered rendering Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L102) |
| `isHeartbeatOnlyMetadataChunk` | Check whether a chunk only carries heartbeat metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L169) |
| `isLongRunningToolRunning` | Check whether a caller-classified long-running tool is active. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L87) |
| `isReasoningPart` | Check if a part is a reasoning part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L82) |
| `isSkillToolPart` | Check if a tool part is a skill-related tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L77) |
| `isToolPart` | Check if a part is a tool part | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L32) |
| `localConversationStore` | localStorage-backed conversation persistence. Pass a `storage` to back it with something else (tests inject an in-memory store); defaults to `localStorage`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/local-conversation-store.ts#L63) |
| `mapHostedStreamPartToChatUiChunks` | Map hosted stream part to chat UI chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L271) |
| `memoryConversationStore` | In-memory conversation persistence. Optionally seed with initial conversations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/memory-conversation-store.ts#L22) |
| `normalizeAgentMetadata` | Normalize a single browser-safe agent record (the `agent` object inside the `/api/agents/:id` response, or one entry of the `/api/agents` list). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L136) |
| `normalizeAgentMetadataResponse` | Normalize the wire response from /api/agents/:id. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L153) |
| `normalizeAgentsListResponse` | Normalize the wire response from `GET /api/agents`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L35) |
| `normalizeChatMessageMetadata` | Normalizes chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L278) |
| `normalizeChatUiMessageChunk` | Normalizes chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L353) |
| `normalizeChatUiMessageStream` | Normalizes chat UI message stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L450) |
| `useAgent` | React hook for agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L48) |
| `useAgentCard` | Read the enclosing `AgentCard` state. Throws when used outside an `AgentCard`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-card.tsx#L121) |
| `useAgentMetadata` | React hook for browser-safe source-defined agent metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L201) |
| `useAgentPicker` | Read the enclosing `AgentPicker` state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-context.tsx#L23) |
| `useAgents` | React hook that lists the browser-safe agents a project exposes, via `GET /api/agents`. Companion to {@link useAgentMetadata} (single agent) - use it to drive an agent switcher, e.g. only rendering a picker when `agents.length > 1`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L53) |
| `useAppShell` | Access the enclosing {@link AppShell}'s state (external triggers, etc.). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L49) |
| `useAttachmentPill` | Read the enclosing `AttachmentPill` state. Throws when used outside an `AttachmentPill`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L179) |
| `useAttachments` | `useAttachments` - the headless state hook for chat attachments: a persistent, cross-conversation registry of uploaded files with the upload / remove / list actions. This is the domain primitive; render any UI on top of it (the `AttachmentsPanel` / `AttachmentPill` components are one skin - bring your own). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L118) |
| `useAttachmentsPanel` | Read the enclosing `AttachmentsPanel`'s state to compose custom leaves inside a `Root` you're already rendering. Throws when used outside an `AttachmentsPanel`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L69) |
| `useChat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/use-chat.ts#L111) |
| `useChatActions` | Read the enclosing `ChatActions` state. Throws when used outside a `ChatActions` - a misplaced sub-part is a loud error, never a silent null. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L312) |
| `useChatContext` | Context for use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L83) |
| `useChatContextOptional` | React hook for chat context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L94) |
| `useChatErrorHandler` | Handler for use chat error. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L93) |
| `useClipboard` | Clipboard copy hook: copies `text`, flips `copied` for ~2s. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L285) |
| `useCompletion` | useCompletion hook for single text generation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L55) |
| `useComposerContext` | Context for use composer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L51) |
| `useComposerContextOptional` | React hook for composer context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L62) |
| `useConversation` | Load one full conversation by id, over a swappable async store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L39) |
| `useConversationChat` | Bind the active conversation to an isolated chat session and persistence sink. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L67) |
| `useConversations` | List + active + persistence for conversations, over a swappable async store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L153) |
| `useConversationsContext` | Read the shared conversations state. Throws when used outside a provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L22) |
| `useConversationsContextOptional` | Read the shared conversations state, or `null` when there is no provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L33) |
| `useMessageContext` | Context for use message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L42) |
| `useMessageContextOptional` | React hook for message context optional. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L53) |
| `useMessageParts` | `useMessageParts` - read the current message's parts as data, so a consumer can render them however they like (the headless access point to parts; `Message.Part` is the leaf and `Message.Content` provides the default rendering). Throws outside a `Message`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L71) |
| `useModelSelector` | Read the enclosing `ModelSelector` selection + open state. Throws when used outside a `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L165) |
| `useReasoning` | Read the enclosing `Reasoning` state. Throws when used outside a `Reasoning`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L28) |
| `useSources` | Read the enclosing `Sources` state. Throws when used outside a `Sources`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L31) |
| `useStepIndicator` | Read the enclosing `StepIndicator` state. Throws when used outside a `StepIndicator`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L45) |
| `useStickToBottom` | Track and maintain "stick to bottom" for a scroll container. Attach `scrollRef` to the scrollable container and `contentRef` to the element that grows as messages / tokens arrive; the hook follows that growth while the user is pinned to the bottom. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L51) |
| `useStreaming` | React hook for streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L41) |
| `useToolCall` | Read the enclosing `ToolCall` state. Throws when used outside a `ToolCall`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L220) |
| `useUpload` | Drive file uploads and expose the resulting attachment lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L76) |
| `useUploadsRegistry` | `useAttachments` - the headless state hook for chat attachments: a persistent, cross-conversation registry of uploaded files with the upload / remove / list actions. This is the domain primitive; render any UI on top of it (the `AttachmentsPanel` / `AttachmentPill` components are one skin - bring your own). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L118) |
| `useVoiceInput` | Input payload for use voice. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L102) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ChatErrorBoundary` | Implement chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L17) |
| `ChatStreamIdleTimeoutError` | Error shape for chat stream idle timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L48) |

### Types

| Name | Description | Source |
|------|-------------|--------|
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
| `AgentPickerContentProps` | Props for `AgentPicker.Content` - the popover surface + `Command` shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L248) |
| `AgentPickerContextValue` | Shared selection and open state exposed to `AgentPicker.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker-context.tsx#L5) |
| `AgentPickerItemProps` | Props for `AgentPicker.Item` - a single selectable agent row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L283) |
| `AgentPickerProps` | Props accepted by `<AgentPicker>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L64) |
| `AgentPickerSearchProps` | Props for `AgentPicker.Search` - the addressable search input leaf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L227) |
| `AgentPickerSection` | A labelled group of agents (e.g. "Connected Agents"). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L57) |
| `AgentPickerTriggerProps` | Props for `AgentPicker.Trigger` - the pill/input combobox button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/agent-picker.tsx#L163) |
| `AgentTheme` | Public API contract for agent theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L62) |
| `AppShellHeaderProps` | Props accepted by {@link AppShellHeader}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L435) |
| `AppShellOpenState` | Per-side visibility map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L95) |
| `AppShellProps` | Props accepted by {@link AppShell}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L101) |
| `AppShellSide` | Which edge a sidebar docks to. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L28) |
| `AppShellSidebarProps` | Props accepted by {@link AppShellSidebar}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L231) |
| `AppShellTriggerProps` | Props accepted by {@link AppShellTrigger}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/app-shell.tsx#L467) |
| `AttachmentInfo` | Public API contract for attachment info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L17) |
| `AttachmentPillContextValue` | Derived per-pill view state shared with `AttachmentPill.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L143) |
| `AttachmentPillProps` | Props accepted by attachment pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachment-pill.tsx#L34) |
| `AttachmentsPanelActionProps` | Props for `AttachmentsPanel.Action` - the upload/attach button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L512) |
| `AttachmentsPanelContextValue` | Per-panel state shared with `AttachmentsPanel.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L42) |
| `AttachmentsPanelEmptyProps` | Props for `AttachmentsPanel.Empty` - the no-files state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L470) |
| `AttachmentsPanelItemProps` | Props accepted by an individual `AttachmentsPanel.Item` (attachment card). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L254) |
| `AttachmentsPanelListProps` | Props for `AttachmentsPanel.List` - the scrollable list of file rows. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L225) |
| `AttachmentsPanelLoadingProps` | Props for `AttachmentsPanel.Loading` - the initial-fetch placeholder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L431) |
| `AttachmentsPanelProps` | Props accepted by `AttachmentsPanel` / `AttachmentsPanel.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L80) |
| `BranchInfo` | Public API contract for branch info. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L72) |
| `BranchPickerActionProps` | Props shared by `BranchPicker.Previous` and `BranchPicker.Next`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L18) |
| `BranchPickerCountProps` | Props accepted by `BranchPicker.Count`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L25) |
| `BranchPickerProps` | Props accepted by branch picker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/branch-picker.tsx#L6) |
| `BuildChatStreamChunkMessageMetadataInput` | Input payload for build chat stream chunk message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/chat-ui-message-helpers.ts#L12) |
| `ChatActionItem` | A single data-driven action row in the `<ChatActions>` menu. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L230) |
| `ChatActionsContentProps` | Props for `ChatActions.Content` - the dropdown surface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L405) |
| `ChatActionsContextValue` | Shared state exposed to `ChatActions.*` sub-parts via `useChatActions()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L293) |
| `ChatActionsItemProps` | Props for `ChatActions.Item` - a single selectable menu row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L428) |
| `ChatActionsProps` | Props accepted by `<ChatActions>` / `<ChatActions.Root>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L244) |
| `ChatActionsSettings` | The two toggle settings surfaced in the Settings submenu (forked from Studio). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L93) |
| `ChatActionsTriggerProps` | Props for `ChatActions.Trigger` - the menu's trigger button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-actions.tsx#L369) |
| `ChatAgentInfo` | Agent identity + agent-driven content for `<Chat>`. Collapses the old `agent` / `models` / suggestion props into one object. In app mode (`agentId`) this is derived from agent metadata automatically; pass it yourself to drive a controlled chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/chat-props.ts#L20) |
| `ChatAgentPickerProps` | Props accepted by `<ChatAgentPicker>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-agent-picker.tsx#L41) |
| `ChatContextValue` | Public API contract for chat context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/chat-context.tsx#L20) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L68) |
| `ChatEmptyProps` | Props accepted by chat empty. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty.tsx#L21) |
| `ChatEmptyStateAvatarProps` | Props accepted by `<ChatEmptyState.Avatar>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L55) |
| `ChatEmptyStateHeadingProps` | Props accepted by `<ChatEmptyState.Heading>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L89) |
| `ChatEmptyStateRootProps` | Props accepted by `<ChatEmptyState.Root>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L29) |
| `ChatEmptyStateSuggestionProps` | Props accepted by `<ChatEmptyState.Suggestion>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L144) |
| `ChatEmptyStateSuggestionsProps` | Props accepted by `<ChatEmptyState.Suggestions>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-empty-state.tsx#L119) |
| `ChatErrorBoundaryProps` | Props accepted by chat error boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/error-boundary.tsx#L4) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L179) |
| `ChatIfProps` | Props accepted by chat if. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-if.tsx#L12) |
| `ChatInputExportProps` | Props accepted by `<ChatInput.Export>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L313) |
| `ChatInputProps` | Props accepted by `ChatInput`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-composer.tsx#L382) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L102) |
| `ChatMessageListContentProps` | Props accepted by the centered transcript column. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L83) |
| `ChatMessageListProps` | Props accepted by chat message list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-message-list.tsx#L25) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L91) |
| `ChatMessagesSkeletonProps` | Props accepted by `<ChatMessagesSkeleton>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/chat-messages-skeleton.tsx#L36) |
| `ChatProps` | Props accepted by chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/chat-props.ts#L34) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L18) |
| `ChatRootProps` | Props accepted by chat root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/chat-root.tsx#L31) |
| `ChatSidebarComponent` | Compound type - the preset plus its namespaced sub-components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L719) |
| `ChatSidebarEmptyProps` | Props accepted by {@link ChatSidebarEmpty}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L543) |
| `ChatSidebarGroupProps` | Props accepted by {@link ChatSidebarGroup}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L516) |
| `ChatSidebarItemProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L336) |
| `ChatSidebarListProps` | Props accepted by {@link ChatSidebarList}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L594) |
| `ChatSidebarNewButtonProps` | Props accepted by {@link ChatSidebarNewButton}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L267) |
| `ChatSidebarProps` | Props accepted by the {@link ChatSidebar} preset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L676) |
| `ChatSidebarRootProps` | Props accepted by {@link ChatSidebarRoot}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sidebar.tsx#L214) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L79) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L194) |
| `ChatStreamWatchdogOptions` | Options accepted by chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L26) |
| `ChatStreamWatchdogPhase` | Public API contract for chat stream watchdog phase. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L11) |
| `ChatStreamWatchdogState` | State for chat stream watchdog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/stream-watchdog.ts#L18) |
| `ChatTab` | Public API contract for chat tab. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L13) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L11) |
| `ChatTheme` | Public API contract for chat theme. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/theme.ts#L22) |
| `ChatThemeScopeProps` | Props accepted by {@link ChatThemeScope}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat-theme-scope.tsx#L23) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L48) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L59) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L40) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L372) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L136) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L121) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L128) |
| `CodeBlockProps` | Props accepted by code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/code-block.tsx#L6) |
| `CodeSurfaceProps` | Props accepted by {@link CodeSurface}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L360) |
| `ComposerContextValue` | Public API contract for composer context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/composer-context.tsx#L16) |
| `Conversation` | A full conversation - metadata + its messages. Fetched via {@link ConversationStore.load}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L40) |
| `ConversationEmptyStateProps` | Props accepted by conversation empty state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L62) |
| `ConversationPatch` | Fields a conversation can be patched with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L101) |
| `ConversationScrollButtonProps` | Props accepted by conversation scroll button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L108) |
| `ConversationsProviderProps` | Props accepted by {@link ConversationsProvider}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/conversations-context.tsx#L41) |
| `ConversationStore` | Async persistence contract for conversations. Implement all four methods; `subscribe`/`dispose` are optional capabilities (feature-detect them). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L48) |
| `ConversationSummary` | Lightweight conversation metadata - what a list / sidebar needs (no messages). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/conversation-store.ts#L33) |
| `CopyButtonProps` | Props accepted by {@link CopyButton}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L317) |
| `DropZoneOverlayProps` | Props accepted by drop zone overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/drop-zone.tsx#L5) |
| `ErrorBannerProps` | Props accepted by error banner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/error-banner.tsx#L14) |
| `FeedbackValue` | Public API contract for feedback value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L6) |
| `HostedStreamPartForUiChunkMapping` | Public API contract for hosted stream part for UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L37) |
| `HostedUiChunkMappingOptions` | Options accepted by hosted UI chunk mapping. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/hosted-ui-chunk-mapping.ts#L11) |
| `InferenceBadgeProps` | Props accepted by inference badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inference-badge.tsx#L6) |
| `InferenceMode` | Where inference is happening. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L16) |
| `InlineCitationCardProps` | Props accepted by `InlineCitation.Card`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L108) |
| `InlineCitationProps` | Props accepted by inline citation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L7) |
| `InlineCitationTriggerProps` | Props accepted by `InlineCitation.Trigger`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/inline-citation.tsx#L42) |
| `MarkdownProps` | Props accepted by Markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L28) |
| `MessageActionBarActionProps` | Props shared by the `MessageActionBar.*` action leaves. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L27) |
| `MessageActionBarProps` | Props accepted by the context-free message action bar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-actions.tsx#L11) |
| `MessageContextValue` | Public API contract for message context value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L17) |
| `MessageEditFormProps` | Props accepted by message edit form. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-edit-form.tsx#L5) |
| `MessageFeedbackActionProps` | Props shared by `MessageFeedback.Positive` and `MessageFeedback.Negative`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L22) |
| `MessageFeedbackProps` | Props accepted by message feedback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/message-feedback.tsx#L9) |
| `MessagePartsData` | The message's grouped parts exposed as headless data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/contexts/message-context.tsx#L58) |
| `MessageProps` | Props accepted by `<Message />`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L836) |
| `MessageRootProps` | Props accepted by message root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L75) |
| `MessageTokensProps` | Props accepted by `Message.Tokens`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L697) |
| `ModelAvatarProps` | Props accepted by model avatar. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/model-avatar.tsx#L14) |
| `ModelOption` | A "provider/model" value and its display label. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L58) |
| `ModelSelectorContentProps` | Props for `ModelSelector.Content` - the popover surface + `Command` shell. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L248) |
| `ModelSelectorContextValue` | Shared selection + open state exposed to `ModelSelector.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L140) |
| `ModelSelectorItemProps` | Props for `ModelSelector.Item` - a single selectable model row. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L283) |
| `ModelSelectorProps` | Props accepted by `<ModelSelector>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L72) |
| `ModelSelectorSearchProps` | Props for `ModelSelector.Search`, the addressable search input leaf. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L233) |
| `ModelSelectorTriggerProps` | Props for `ModelSelector.Trigger` - the pill/icon combobox button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/model-selector.tsx#L176) |
| `OnToolCallArg` | Public API contract for on tool call arg. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L44) |
| `PartGroup` | Part group types for ordered rendering | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/utils/message-parts.ts#L91) |
| `QuickAction` | Public API contract for quick action. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L5) |
| `QuickActionsProps` | Props accepted by quick actions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/quick-actions.tsx#L13) |
| `ReasoningContextValue` | Per-card state shared with `Reasoning.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L18) |
| `ReasoningProps` | Props accepted by `Reasoning` / `Reasoning.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L39) |
| `ReasoningTriggerProps` | Props for `Reasoning.Trigger` - the disclosure button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/reasoning.tsx#L145) |
| `SkillBadgeProps` | Props accepted by skill badge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/skill-badge.tsx#L12) |
| `Source` | Public API contract for source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L6) |
| `SourcePillProps` | Props accepted by an individual source pill. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L126) |
| `SourcesContextValue` | Per-list state shared with `Sources.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L23) |
| `SourcesListProps` | Props for `Sources.List` - the flex-wrap row of pills. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L89) |
| `SourcesProps` | Props accepted by `Sources` / `Sources.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/sources.tsx#L51) |
| `StepIndicatorContextValue` | Per-indicator state shared with `StepIndicator.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L30) |
| `StepIndicatorProps` | Props accepted by step indicator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/step-indicator.tsx#L7) |
| `StorageLike` | The slice of the Web Storage API this adapter needs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/persistence/local-conversation-store.ts#L20) |
| `SuggestionProps` | Props accepted by suggestion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L6) |
| `SuggestionsProps` | Props accepted by suggestions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/empty-state.tsx#L42) |
| `TabsItemProps` | Props accepted by `<TabsItem>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L67) |
| `TabsProps` | Props accepted by `<Tabs>` (the tablist container). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/tabs.tsx#L33) |
| `TabSwitcherProps` | Props accepted by tab switcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tab-switcher.tsx#L16) |
| `TokenRowProps` | One row in the token usage breakdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/composition/message.tsx#L690) |
| `ToolCallContextValue` | Per-tool state shared with `ToolCall.*` sub-parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L209) |
| `ToolCallProps` | Props accepted by `ToolCall` / `ToolCall.Root`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L231) |
| `ToolCallTriggerProps` | Props for `ToolCall.Trigger` - the header button. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/tool-ui.tsx#L319) |
| `ToolOutput` | Output from tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L35) |
| `UploadedFile` | Public API contract for uploaded file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/components/attachments-panel.tsx#L23) |
| `UseAgentMetadataResult` | Result returned from useAgentMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent-metadata.ts#L43) |
| `UseAgentOptions` | Options accepted by use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L6) |
| `UseAgentResult` | Result returned from use agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agent.ts#L21) |
| `UseAgentsOptions` | Options accepted by {@link useAgents}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L8) |
| `UseAgentsResult` | Result returned from {@link useAgents}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-agents.ts#L17) |
| `UseAttachmentsOptions` | Options for {@link useAttachments}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L30) |
| `UseAttachmentsResult` | Result of {@link useAttachments}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L45) |
| `UseChatOptions` | Options accepted by use chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L54) |
| `UseChatResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-chat/types.ts#L90) |
| `UseClipboardResult` | Result of {@link useClipboard}: the copied flag + a `copy` trigger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/ui/code-block.tsx#L277) |
| `UseCompletionOptions` | Options accepted by use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L11) |
| `UseCompletionResult` | Result returned from use completion. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-completion.ts#L32) |
| `UseConversationChatOptions` | `useConversationChat` - the library primitive that binds a `useChat` session to conversation persistence, so application code does not need to duplicate the persistence effect. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L39) |
| `UseConversationChatResult` | Result returned by {@link useConversationChat}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation-chat.ts#L57) |
| `UseConversationOptions` | Options for {@link useConversation}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L20) |
| `UseConversationResult` | Result of {@link useConversation}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversation.ts#L29) |
| `UseConversationsOptions` | Options for {@link useConversations}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L108) |
| `UseConversationsResult` | Result of {@link useConversations}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-conversations.ts#L123) |
| `UseStickToBottomOptions` | Options for {@link useStickToBottom}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L22) |
| `UseStickToBottomResult` | Result of {@link useStickToBottom}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-stick-to-bottom.ts#L28) |
| `UseStreamingOptions` | Options accepted by use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L5) |
| `UseStreamingResult` | Result returned from use streaming. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-streaming.ts#L20) |
| `UseUploadOptions` | Options for {@link useUpload}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L19) |
| `UseUploadResult` | Result of {@link useUpload}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-upload.ts#L30) |
| `UseUploadsRegistryOptions` | Options for {@link useAttachments}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L30) |
| `UseUploadsRegistryResult` | Result of {@link useAttachments}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/chat/hooks/use-uploads-registry.ts#L45) |
| `UseVoiceInputOptions` | Options accepted by use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L5) |
| `UseVoiceInputResult` | Result returned from use voice input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/agent/react/use-voice-input.ts#L29) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/chat/ag-ui`

```ts
import { createAgUiChatEventDecoderState, decodeAgUiSseChunk, flushAgUiSseChunk } from "veryfront/chat/ag-ui";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgUiChatEventDecoderState` | State for create AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L1048) |
| `decodeAgUiSseChunk` | Decode AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L1148) |
| `flushAgUiSseChunk` | Flush AG-UI SSE chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L1181) |
| `mapAgUiRuntimeMessagesToChatUiMessages` | Map AG-UI runtime messages to chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L373) |
| `parseSseEvent` | Event emitted for parse sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L999) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgUiChatEventDecoderState` | State for AG-UI chat event decoder. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L99) |
| `AgUiDecodedChunk` | Public API contract for AG-UI decoded chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L90) |
| `AgUiDecodedEvent` | Event emitted for AG-UI decoded. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L83) |
| `AgUiDecoderValidationMode` | Public API contract for AG-UI decoder validation mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L96) |
| `AgUiRunFinishedMetadata` | Public API contract for AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L532) |
| `AgUiRuntimeMessage` | Message shape for AG-UI runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L50) |
| `AgUiRuntimeToolCall` | Public API contract for AG-UI runtime tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L40) |
| `AgUiSnapshotMessage` | Message shape for AG-UI snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L536) |
| `AgUiWireEvent` | Event emitted for AG-UI wire. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L540) |
| `AgUiWireEventName` | Public API contract for AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L538) |
| `ParsedSseEvent` | Event emitted for parsed sse. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L76) |
| `ToolCallState` | Accumulated state for one AG-UI tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L29) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getAgUiRunFinishedMetadataSchema` | Zod schema for get AG-UI run finished metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L139) |
| `getAgUiSnapshotMessageSchema` | Zod schema for get AG-UI snapshot message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L187) |
| `getAgUiSnapshotToolCallSchema` | Zod schema for get AG-UI snapshot tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L157) |
| `getAgUiWireEventNameSchema` | Zod schema for get AG-UI wire event name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L223) |
| `getAgUiWireEventSchema` | Zod schema for get AG-UI wire event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/ag-ui.ts#L406) |

### `veryfront/chat/message-prep`

```ts
import { compactForStep, compactHistoricalUiMessageToolInputs, compactOldToolInputs } from "veryfront/chat/message-prep";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_MESSAGE_PREP_LIMITS` | Default limits for chat history preparation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L34) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `compactForStep` | Compact for step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1963) |
| `compactHistoricalUiMessageToolInputs` | Compact large historical UI-message tool inputs after matching results are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1718) |
| `compactOldToolInputs` | Compact large historical tool-call inputs after matching results are available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1626) |
| `compressTurn` | Compress turn. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L295) |
| `dedupeToolHistory` | Dedupe tool history. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1987) |
| `enforceTokenBudget` | Enforce token budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L2054) |
| `enforceTokenBudgetWithTurnCompression` | Enforce token budget with turn compression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L373) |
| `ensureToolCallInputs` | Ensure tool call inputs helper. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1932) |
| `estimateMessageTokenBreakdown` | Estimate token categories for provider, UI, or runtime messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L246) |
| `estimateOverhead` | Estimate overhead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1919) |
| `estimateTokens` | Estimate tokens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L164) |
| `isModelSupportedFileMediaType` | Check whether the model supports the file media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L839) |
| `maskOldToolOutputs` | Mask old tool outputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1528) |
| `normalizeMessageFilePartMediaTypes` | Normalizes message file part media types. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L845) |
| `prepareProviderModelMessagesFromUiMessages` | Prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1189) |
| `repairToolPairs` | Repair tool pairs without inventing missing calls, names, or results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1896) |
| `rewriteUnsupportedFilePartsAsAnnotations` | Rewrite unsupported file parts as annotations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L872) |
| `sanitizeProviderModelMessages` | Sanitize provider model messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L1080) |
| `stripPendingToolParts` | Strip pending tool parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L976) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `HistoricalToolInputCompactionDiagnostic` | Diagnostic emitted when a completed historical tool input is compacted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L138) |
| `HistoricalToolInputRetainedField` | Field selector retained in a historical tool-input summary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L113) |
| `HistoricalToolInputRetentionOptions` | Options for historical tool-input compaction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L151) |
| `HistoricalToolInputRetentionPolicy` | Policy for compacting a completed historical tool-call input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L125) |
| `HistoricalToolInputRetentionPolicyResolver` | Resolves the retention policy for a completed historical tool input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L132) |
| `MessagePrepLimits` | Tunable limits used while preparing chat history for model context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L24) |
| `MessageTokenBreakdown` | Approximate token categories for context diagnostics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L169) |
| `PrepareProviderModelMessagesFromUiMessagesOptions` | Options accepted by prepare provider model messages from UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/message-prep.ts#L158) |

### `veryfront/chat/protocol`

Canonical chat message and stream protocol for Veryfront chat surfaces. These types describe the framework-owned message parts and stream events used by AG-UI-aligned chat clients, hooks, and adapters.

```ts
import "veryfront/chat/protocol";
```

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatDataPart` | Public API contract for chat data part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L85) |
| `ChatDynamicToolPart` | Public API contract for chat dynamic tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L68) |
| `ChatFilePart` | Chat message part that carries an uploaded file or image attachment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L27) |
| `ChatFinishReason` | Public API contract for chat finish reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L179) |
| `ChatMessage` | Message shape for chat. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L102) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChatMessagePart` | Public API contract for chat message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L91) |
| `ChatPartState` | Canonical chat message and stream protocol for Veryfront chat surfaces. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L8) |
| `ChatReasoningPart` | Chat message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L18) |
| `ChatStepPart` | Public API contract for chat step part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L79) |
| `ChatStreamEvent` | Event emitted for chat stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L194) |
| `ChatTextPart` | Chat message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L11) |
| `ChatToolPart` | Public API contract for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L48) |
| `ChatToolResultPart` | Chat message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L59) |
| `ChatToolState` | State for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L40) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L372) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L136) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L121) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L128) |

### `veryfront/chat/types`

```ts
import { buildDataFileAnnotation, isImageFile, isTextPreviewFile } from "veryfront/chat/types";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildDataFileAnnotation` | Builds data file annotation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L807) |
| `isImageFile` | Check whether a file is an image. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L756) |
| `isTextPreviewFile` | Check whether a file supports text preview. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L771) |
| `isValidImageFile` | Check whether a file is a supported image upload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L761) |
| `normalizeInlineAttachmentMediaType` | Normalizes inline attachment media type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L776) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatAssistantContentPart` | Public API contract for chat assistant content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L301) |
| `ChatAssistantMessage` | Message shape for chat assistant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L322) |
| `ChatDataUiPart` | Chat UI part that carries custom data chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L204) |
| `ChatDynamicToolUiPart` | Tool UI part for a runtime-selected tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L162) |
| `ChatFileUiPart` | Public API contract for chat file UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L118) |
| `ChatLegacyToolCallUiPart` | Persisted legacy tool call accepted while replaying stored chat messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L174) |
| `ChatLegacyToolResultUiPart` | Persisted legacy tool result accepted while replaying stored chat messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L189) |
| `ChatMessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ChatMessageMetadataUsage` | Public API contract for chat message metadata usage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L111) |
| `ChatModelFilePart` | Public API contract for chat model file part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L255) |
| `ChatModelReasoningPart` | Provider model message part that carries reasoning text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L247) |
| `ChatModelTextPart` | Provider model message part that carries text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L241) |
| `ChatNamedToolUiPart` | Tool UI part keyed by a static tool type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L168) |
| `ChatReasoningUiPart` | Public API contract for chat reasoning UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L88) |
| `ChatRequestContext` | Context for chat request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L399) |
| `ChatRuntimeOverrides` | Public API contract for chat runtime overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L352) |
| `ChatSourceDocumentUiPart` | Public API contract for chat source document UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L109) |
| `ChatSourceUrlUiPart` | Public API contract for chat source URL UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L101) |
| `ChatStepStartUiPart` | Public API contract for chat step start UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L96) |
| `ChatSystemMessage` | Message shape for chat system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L309) |
| `ChatTextUiPart` | Public API contract for chat text UI part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L82) |
| `ChatToolCallPart` | Provider model message part that carries a tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L266) |
| `ChatToolMessage` | Message shape for chat tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L328) |
| `ChatToolPartBase` | Shared fields for canonical chat tool UI parts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L146) |
| `ChatToolPartState` | State for chat tool part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L132) |
| `ChatToolResultOutput` | Output from chat tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L275) |
| `ChatToolResultPart` | Provider model message part that carries a tool result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L290) |
| `ChatUiMessage` | Message shape for chat UI. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L224) |
| `ChatUiMessageChunk` | Public API contract for chat UI message chunk. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L372) |
| `ChatUiMessagePart` | Public API contract for chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L210) |
| `ChatUiMessageRole` | Public API contract for chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L79) |
| `ChatUserContentPart` | Public API contract for chat user content part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L299) |
| `ChatUserMessage` | Message shape for chat user. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L316) |
| `ChildRunAudit` | Public API contract for child run audit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L136) |
| `ChildRunAuditToolCall` | Public API contract for child run audit tool call. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L121) |
| `ChildRunAuditToolResult` | Result returned from child run audit tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L128) |
| `DurableRootRunDescriptor` | Public API contract for durable root run descriptor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L341) |
| `FileUIPartWithUpload` | File UI part enriched with upload metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L126) |
| `JsonValue` | JSON-compatible value used in chat tool output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L232) |
| `MessageMetadata` | Public API contract for chat message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/protocol.ts#L148) |
| `ProjectFile` | Public API contract for project file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L359) |
| `ProjectFileListItem` | Public API contract for project file list item. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L365) |
| `ProviderModelMessage` | Message shape for provider model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L334) |
| `UploadedFileReference` | Public API contract for uploaded file reference. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L374) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getChatRequestContextSchema` | Zod schema for get chat request context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L384) |
| `getChatToolPartStateSchema` | Zod schema for get chat tool part state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L535) |
| `getChatUiMessagePartSchema` | Zod schema for get chat UI message part. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L690) |
| `getChatUiMessageRoleSchema` | Zod schema for get chat UI message role. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L530) |
| `getChatUiMessageSchema` | Zod schema for get chat UI message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L707) |
| `getChatUiMessagesSchema` | Zod schema for get chat UI messages. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L717) |
| `getMessageMetadataSchema` | Zod schema for get message metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/types.ts#L497) |
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
| `createChatUploadHandler` | Build `{ POST, GET, DELETE }` route handlers for chat attachments. Auto-selects local disk storage in dev and Veryfront Cloud once deployed, or the `storage` you provide. `DELETE ?id=` removes the file from storage. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L240) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ChatUploadHandlerConfig` | Configuration for {@link createChatUploadHandler}. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/chat/upload-handler.ts#L48) |
