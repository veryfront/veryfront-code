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
  AgentCard,
  // Error
  AIErrorBoundary,
  AttachmentPill,
  BranchPicker,
  // Preset
  Chat,
  ChatComponents,
  ChatComposer,
  ChatEmpty,
  ChatIf,
  ChatMessageList,
  // Composition
  ChatRoot,
  ChatSidebar,
  ChatWithSidebar,
  DropZoneOverlay,
  ErrorBanner,
  InferenceBadge,
  InlineCitation,
  // Compound
  Message,
  // Sub-components
  MessageActions,
  MessageFeedback,
  ModelAvatar,
  ModelSelector,
  QuickActions,
  ReasoningCard,
  Sources,
  StepIndicator,
  TabSwitcher,
  ToolCallCard,
  UploadsPanel,
  useAgent,
  useAIErrorHandler,
  // Hooks
  useChat,
  // Contexts
  useChatContext,
  useCompletion,
  useComposerContext,
  useMessageContext,
  useStreaming,
  useThreadListContext,
  useThreads,
  useVoiceInput,
} from "veryfront/chat";
```

## Preset Component

### `Chat`

Full-featured chat UI. Composes `ChatRoot`, `ChatMessageList`, `ChatComposer`, `ChatEmpty`, and `ErrorBanner` with sensible defaults.

| Prop                 | Type                              | Default               | Description                         |
| -------------------- | --------------------------------- | --------------------- | ----------------------------------- |
| `messages`           | `UIMessage[]`                     | —                     | **Required.** Message array.        |
| `input`              | `string`                          | —                     | **Required.** Current input value.  |
| `onChange`           | `(e: ChangeEvent) => void`        | —                     | **Required.** Input change handler. |
| `onSubmit`           | `(e?: FormEvent) => void`         | —                     | Form submit handler.                |
| `stop`               | `() => void`                      | —                     | Abort current request.              |
| `reload`             | `() => void`                      | —                     | Re-send last user message.          |
| `setInput`           | `(value: string) => void`         | —                     | Set input value programmatically.   |
| `isLoading`          | `boolean`                         | `false`               | Loading state.                      |
| `error`              | `Error \| null`                   | `null`                | Error to display.                   |
| `placeholder`        | `string`                          | `"Type a message..."` | Input placeholder.                  |
| `maxHeight`          | `string`                          | `"100%"`              | Container max height.               |
| `className`          | `string`                          | —                     | Container class.                    |
| `theme`              | `Partial<ChatTheme>`              | —                     | Theme overrides.                    |
| `renderMessage`      | `(msg: UIMessage) => ReactNode`   | —                     | Custom message renderer.            |
| `renderTool`         | `(tool: ToolUIPart) => ReactNode` | —                     | Custom tool call renderer.          |
| `suggestions`        | `string[]`                        | —                     | Suggestion chips in empty state.    |
| `onSuggestionClick`  | `(suggestion: string) => void`    | —                     | Suggestion click handler.           |
| `emptyState`         | `{ icon?, title?, description? }` | —                     | Empty state overrides.              |
| `showScrollButton`   | `boolean`                         | `false`               | Show scroll-to-bottom button.       |
| `showMessageActions` | `boolean`                         | `true`                | Show copy/edit on messages.         |
| `models`             | `ModelOption[]`                   | —                     | Available models for selector.      |
| `model`              | `string`                          | —                     | Current model.                      |
| `onModelChange`      | `(model: string) => void`         | —                     | Model change handler.               |
| `inferenceMode`      | `InferenceMode`                   | —                     | Where inference runs.               |
| `browserStatus`      | `BrowserInferenceStatus`          | —                     | Browser model status.               |
| `showSources`        | `boolean`                         | `false`               | Show source citations.              |
| `onSourceClick`      | `(source, index) => void`         | —                     | Source click handler.               |
| `onAttach`           | `(files: FileList) => void`       | —                     | File attach handler.                |
| `onDrop`             | `(files: FileList) => void`       | —                     | File drop handler.                  |
| `attachAccept`       | `string`                          | —                     | Accepted file types.                |
| `attachments`        | `AttachmentInfo[]`                | —                     | Attached files.                     |
| `onRemoveAttachment` | `(id: string) => void`            | —                     | Remove attachment.                  |
| `showExport`         | `boolean`                         | `false`               | Show export button.                 |
| `onFeedback`         | `(messageId, feedback) => void`   | —                     | Message feedback handler.           |
| `editMessage`        | `(messageId, text) => Promise`    | —                     | Edit and resubmit.                  |
| `getBranches`        | `(messageId) => BranchInfo`       | —                     | Get branch info.                    |
| `switchBranch`       | `(messageId, index) => void`      | —                     | Switch branch.                      |
| `showSteps`          | `boolean`                         | `false`               | Show step indicators.               |
| `showTabs`           | `boolean`                         | `false`               | Show Chat/Uploads tabs.             |
| `activeTab`          | `ChatTab`                         | —                     | Controlled tab.                     |
| `onTabChange`        | `(tab: ChatTab) => void`          | —                     | Tab change handler.                 |
| `uploads`            | `UploadedFile[]`                  | —                     | Uploads tab content.                |
| `onRemoveUpload`     | `(id: string) => void`            | —                     | Remove upload.                      |
| `quickActions`       | `QuickAction[]`                   | —                     | Quick action cards.                 |
| `onQuickAction`      | `(action) => void`                | —                     | Quick action handler.               |
| `enableVoice`        | `boolean`                         | `false`               | Enable voice input.                 |
| `onVoice`            | `() => void`                      | —                     | Custom voice handler.               |

### `ChatWithSidebar`

`ChatWithSidebar` wraps `Chat` with built-in thread persistence and a collapsible sidebar.
`chat` + grouped config is the required public API.

```tsx
<ChatWithSidebar
  chat={chat}
  sidebar={{ storageKey: "my-app" }}
  features={{ tabs: true, steps: true }}
  models={{ options: modelOptions }}
/>;
```

| Prop           | Type                                | Description                                                                                       |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `chat`         | `ChatWithSidebarChatController`     | **Required.** Core chat state/handlers, including `setMessages` for thread syncing.               |
| `sidebar`      | `ChatWithSidebarSidebarConfig`      | Sidebar + thread persistence (`storageKey`, `visible`). Controlled mode uses `open` + `onToggle`. |
| `models`       | `ChatWithSidebarModelConfig`        | Model selector config (`options`).                                                                |
| `attachments`  | `ChatWithSidebarAttachmentConfig`   | Attach/drop/upload config (`items`, `uploads`, remove handlers, accept filters).                  |
| `quickActions` | `ChatWithSidebarQuickActionsConfig` | Empty-state suggestions and quick actions.                                                        |
| `message`      | `ChatWithSidebarMessageConfig`      | Message-level behavior (`render`, `renderTool`, `onFeedback`, `onSourceClick`).                   |
| `features`     | `ChatWithSidebarFeatureConfig`      | Toggle UI features (`tabs`, `steps`, `sources`, `export`, etc.).                                  |
| `tabs`         | `ChatWithSidebarTabsConfig`         | Optional tab config. Controlled mode uses `active` + `onChange`.                                  |
| `voice`        | `ChatWithSidebarVoiceConfig`        | Voice input toggle/handler.                                                                       |
| `placeholder`  | `string`                            | Composer placeholder text.                                                                        |
| `emptyState`   | `{ icon?, title?, description? }`   | Empty-state content override.                                                                     |
| `className`    | `string`                            | Wrapper class name.                                                                               |
| `theme`        | `Partial<ChatTheme>`                | Theme overrides.                                                                                  |
| `maxHeight`    | `string`                            | Container max height.                                                                             |

### `ChatComponents`

The `Chat` component with compound sub-components via `Object.assign`:

```tsx
ChatComponents.Root; // = ChatRoot
ChatComponents.MessageList; // = ChatMessageList
ChatComponents.Composer; // = ChatComposer
ChatComponents.Empty; // = ChatEmpty
ChatComponents.If; // = ChatIf
ChatComponents.Message; // = Message (compound)
ChatComponents.ErrorBanner; // = ErrorBanner
```

## Composition Components

### `ChatRoot`

Context provider and container. Wraps all descendant chat components and provides `ChatContextValue`.

Extends `React.HTMLAttributes<HTMLDivElement>` — extra props (e.g. drag handlers) are forwarded to the container element.

| Prop                 | Type          | Description                           |
| -------------------- | ------------- | ------------------------------------- |
| `children`           | `ReactNode`   | **Required.**                         |
| `messages`           | `UIMessage[]` | **Required.**                         |
| `input`              | `string`      | **Required.**                         |
| All Chat state props | —             | Same as `Chat` minus rendering props. |

### `ChatMessageList`

Message rendering loop with editing, branching, feedback, sources, reasoning, tool calls, and step indicators.

| Prop                 | Type                    | Default | Description             |
| -------------------- | ----------------------- | ------- | ----------------------- |
| `messages`           | `UIMessage[]`           | —       | **Required.**           |
| `isLoading`          | `boolean`               | `false` | Show loading indicator. |
| `theme`              | `ChatTheme`             | —       | Theme.                  |
| `renderMessage`      | `(msg) => ReactNode`    | —       | Custom renderer.        |
| `renderTool`         | `(tool) => ReactNode`   | —       | Custom tool renderer.   |
| `model`              | `string`                | —       | For loading avatar.     |
| `showMessageActions` | `boolean`               | `true`  | Show copy/edit.         |
| `showSources`        | `boolean`               | `false` | Show citations.         |
| `showSteps`          | `boolean`               | `false` | Show step dots.         |
| `showScrollButton`   | `boolean`               | `false` | Scroll-to-bottom.       |
| `editMessage`        | `(id, text) => Promise` | —       | Edit handler.           |
| `getBranches`        | `(id) => BranchInfo`    | —       | Branch info.            |
| `switchBranch`       | `(id, index) => void`   | —       | Switch branch.          |
| `onFeedback`         | `(id, value) => void`   | —       | Feedback handler.       |

### `ChatComposer`

Input area with attachments, model selector, voice, export, and submit.

| Prop            | Type                       | Default               | Description         |
| --------------- | -------------------------- | --------------------- | ------------------- |
| `input`         | `string`                   | —                     | **Required.**       |
| `onChange`      | `(e: ChangeEvent) => void` | —                     | **Required.**       |
| `onSubmit`      | `(e: FormEvent) => void`   | —                     | Submit handler.     |
| `isLoading`     | `boolean`                  | `false`               | Loading state.      |
| `placeholder`   | `string`                   | `"Type a message..."` | Input placeholder.  |
| `models`        | `ModelOption[]`            | —                     | Model options.      |
| `model`         | `string`                   | —                     | Current model.      |
| `onModelChange` | `(model) => void`          | —                     | Model change.       |
| `onAttach`      | `(files) => void`          | —                     | Attach files.       |
| `attachments`   | `AttachmentInfo[]`         | —                     | Attached files.     |
| `showExport`    | `boolean`                  | `false`               | Show export button. |
| `stop`          | `() => void`               | —                     | Stop handler.       |
| `onVoice`       | `() => void`               | —                     | Voice handler.      |

### `ChatEmpty`

Empty state with icon, title, suggestions, and quick actions.

| Prop                | Type               | Default                   | Description         |
| ------------------- | ------------------ | ------------------------- | ------------------- |
| `icon`              | `ReactNode`        | Message icon              | Custom icon.        |
| `title`             | `string`           | `"What can I help with?"` | Title text.         |
| `description`       | `string`           | —                         | Description text.   |
| `suggestions`       | `string[]`         | —                         | Suggestion chips.   |
| `onSuggestionClick` | `(s) => void`      | —                         | Suggestion handler. |
| `quickActions`      | `QuickAction[]`    | —                         | Quick action cards. |
| `onQuickAction`     | `(action) => void` | —                         | Action handler.     |

### `ChatIf`

Conditional rendering helper.

| Prop        | Type                                            | Description        |
| ----------- | ----------------------------------------------- | ------------------ |
| `condition` | `boolean \| (ctx: ChatContextValue) => boolean` | Render condition.  |
| `children`  | `ReactNode`                                     | Content to render. |

### `ErrorBanner`

Error display with optional retry.

| Prop      | Type         | Description                     |
| --------- | ------------ | ------------------------------- |
| `error`   | `Error`      | **Required.** Error to display. |
| `onRetry` | `() => void` | Retry button handler.           |

### `ModelAvatar`

Provider-specific avatar (Claude, OpenAI, or default).

| Prop    | Type     | Description       |
| ------- | -------- | ----------------- |
| `model` | `string` | Model identifier. |

## Message Compound

### `Message`

Compound component for per-message rendering. Use inside `Chat.Root` for automatic context.

```tsx
<Message.Root message={msg}>
  <Message.Avatar />
  <Message.Content />
  <Message.Actions />
  <Message.Feedback />
  <Message.BranchPicker />
</Message.Root>;
```

### `Message.Root`

| Prop           | Type                    | Description                             |
| -------------- | ----------------------- | --------------------------------------- |
| `message`      | `UIMessage`             | **Required.** The message to render.    |
| `isStreaming`  | `boolean`               | Whether the message is still streaming. |
| `editMessage`  | `(id, text) => Promise` | Override edit handler.                  |
| `getBranches`  | `(id) => BranchInfo`    | Override branch getter.                 |
| `switchBranch` | `(id, index) => void`   | Override branch switcher.               |
| `onFeedback`   | `(id, value) => void`   | Override feedback handler.              |
| `feedback`     | `FeedbackValue \| null` | Current feedback value.                 |

### `Message.Avatar`

Renders a model-specific avatar icon. Hidden for user messages.

### `Message.Content`

| Prop            | Type                      | Default | Description            |
| --------------- | ------------------------- | ------- | ---------------------- |
| `renderTool`    | `(tool) => ReactNode`     | —       | Custom tool renderer.  |
| `showSteps`     | `boolean`                 | `false` | Show step indicators.  |
| `showSources`   | `boolean`                 | `false` | Show source citations. |
| `onSourceClick` | `(source, index) => void` | —       | Source click handler.  |

### `Message.Actions`

Copy and edit buttons. Visible on hover.

### `Message.Feedback`

Thumbs up/down buttons. Only rendered when `onFeedback` is provided.

### `Message.BranchPicker`

Branch navigation (prev/next). Only rendered when multiple branches exist.

## Contexts

Each context has a Provider (for custom wiring), a required hook (throws if missing), and an optional hook (returns `null` if missing):

| Context    | Provider                    | Required hook            | Optional hook                    |
| ---------- | --------------------------- | ------------------------ | -------------------------------- |
| Chat       | `ChatContextProvider`       | `useChatContext()`       | `useChatContextOptional()`       |
| Message    | `MessageContextProvider`    | `useMessageContext()`    | `useMessageContextOptional()`    |
| Composer   | `ComposerContextProvider`   | `useComposerContext()`   | `useComposerContextOptional()`   |
| ThreadList | `ThreadListContextProvider` | `useThreadListContext()` | `useThreadListContextOptional()` |

### `ChatContextValue`

Root-level shared state. Provided by `ChatRoot` / `Chat`.

| Field            | Type              | Description       |
| ---------------- | ----------------- | ----------------- |
| `messages`       | `UIMessage[]`     | All messages.     |
| `isLoading`      | `boolean`         | Loading state.    |
| `error`          | `Error \| null`   | Current error.    |
| `input`          | `string`          | Input value.      |
| `setInput`       | `(value) => void` | Set input.        |
| `onSubmit`       | `(e?) => void`    | Submit.           |
| `onStop`         | `() => void`      | Stop.             |
| `onReload`       | `() => void`      | Reload.           |
| `model`          | `string`          | Current model.    |
| `models`         | `ModelOption[]`   | Available models. |
| `isEmpty`        | `boolean`         | No messages.      |
| `isAtBottom`     | `boolean`         | Scroll position.  |
| `scrollToBottom` | `() => void`      | Scroll action.    |
| `theme`          | `ChatTheme`       | Current theme.    |

### `MessageContextValue`

Per-message state. Provided by `Message.Root`.

| Field         | Type                    | Description       |
| ------------- | ----------------------- | ----------------- |
| `message`     | `UIMessage`             | The message.      |
| `role`        | `string`                | Message role.     |
| `isStreaming` | `boolean`               | Streaming state.  |
| `parts`       | `PartGroup[]`           | Grouped parts.    |
| `textContent` | `string`                | Text content.     |
| `branch`      | `BranchInfo \| null`    | Branch info.      |
| `onCopy`      | `() => Promise`         | Copy handler.     |
| `onEdit`      | `(content) => void`     | Edit handler.     |
| `onFeedback`  | `(value) => void`       | Feedback handler. |
| `feedback`    | `FeedbackValue \| null` | Current feedback. |

### `ComposerContextValue`

Input area state. Provided by Composer components.

| Field         | Type               | Description       |
| ------------- | ------------------ | ----------------- |
| `input`       | `string`           | Input value.      |
| `setInput`    | `(value) => void`  | Set input.        |
| `onChange`    | `(e) => void`      | Change handler.   |
| `attachments` | `AttachmentInfo[]` | Attachments.      |
| `onSubmit`    | `(e?) => void`     | Submit.           |
| `isLoading`   | `boolean`          | Loading.          |
| `canSubmit`   | `boolean`          | Can submit.       |
| `model`       | `string`           | Current model.    |
| `models`      | `ModelOption[]`    | Available models. |

## Sub-components

| Component                  | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `MessageActions`           | Copy/edit action bar.                              |
| `MessageFeedback`          | Thumbs up/down buttons.                            |
| `MessageEditForm`          | Inline message editor.                             |
| `BranchPicker`             | Branch navigation.                                 |
| `Sources`                  | Source citation list.                              |
| `InlineCitation`           | Inline source reference.                           |
| `ReasoningCard`            | Collapsible reasoning display.                     |
| `ToolCallCard`             | Tool call visualization.                           |
| `ToolStatusBadge`          | Tool status pill (running, complete, error).       |
| `StepIndicator`            | Multi-step progress dots.                          |
| `InferenceBadge`           | Inference mode indicator.                          |
| `UpgradeCTA`               | Upgrade prompt for local mode.                     |
| `AttachmentPill`           | File attachment chip.                              |
| `DropZoneOverlay`          | Drag-and-drop overlay.                             |
| `TabSwitcher`              | Chat/Uploads tab bar.                              |
| `QuickActions`             | Quick action card grid.                            |
| `UploadsPanel`             | Upload management panel.                           |
| `ChatSidebar`              | Thread list sidebar.                               |
| `ModelSelector`            | Model picker dropdown.                             |
| `RichCodeBlock`            | Syntax-highlighted code block with copy.           |
| `FadeIn`                   | Fade-in animation wrapper.                         |
| `Loader`                   | Three-dot loading animation.                       |
| `Shimmer`                  | Shimmer placeholder animation.                     |
| `StandaloneMessage`        | Standalone message bubble (outside chat compound). |
| `StreamingMessage`         | Streaming message with live updates.               |
| `ConversationEmptyState`   | Empty state shown when no messages exist.          |
| `ConversationScrollButton` | Scroll-to-bottom floating button.                  |
| `Suggestion`               | Single suggestion chip.                            |
| `Suggestions`              | Suggestion chip container.                         |

## Hooks

### `useChat`

Main chat hook. Returns:

| Property            | Type                          | Description                                          |
| ------------------- | ----------------------------- | ---------------------------------------------------- |
| `messages`          | `UIMessage[]`                 | Current message list.                                |
| `input`             | `string`                      | Current input value.                                 |
| `isLoading`         | `boolean`                     | Whether a response is streaming.                     |
| `error`             | `Error \| null`               | Last error, if any.                                  |
| `model`             | `string \| undefined`         | Current model ID.                                    |
| `setInput`          | `(value: string) => void`     | Update input.                                        |
| `setModel`          | `(model: string) => void`     | Switch model.                                        |
| `setMessages`       | `SetState<UIMessage[]>`       | Replace message list.                                |
| `sendMessage`       | `(msg) => Promise<void>`      | Send a message.                                      |
| `editMessage`       | `(id, text) => Promise<void>` | Edit and resubmit.                                   |
| `getBranches`       | `(id) => BranchInfo`          | Get branch info for a message.                       |
| `switchBranch`      | `(id, index) => void`         | Switch to a branch.                                  |
| `reload`            | `() => Promise<void>`         | Regenerate last response.                            |
| `stop`              | `() => void`                  | Cancel active stream.                                |
| `handleInputChange` | `ChangeEventHandler`          | Bind to input onChange.                              |
| `handleSubmit`      | `FormEventHandler`            | Bind to form onSubmit.                               |
| `onChange`          | `ChangeEventHandler`          | Alias for `handleInputChange` — matches `ChatProps`. |
| `onSubmit`          | `FormEventHandler`            | Alias for `handleSubmit` — matches `ChatProps`.      |
| `onModelChange`     | `(model: string) => void`     | Alias for `setModel` — matches `ChatProps`.          |
| `addToolOutput`     | `(output) => void`            | Provide tool call result.                            |

See [Chat UI guide](../guides/chat-ui.md) for full documentation.

### `useAgent`

Direct agent invocation.

### `useCompletion`

Simple text completion.

### `useStreaming`

Low-level streaming.

### `useVoiceInput`

Web Speech API voice input.

### `useThreads`

Multi-conversation thread management with localStorage persistence.

| Option       | Type     | Description              |
| ------------ | -------- | ------------------------ |
| `storageKey` | `string` | localStorage key prefix. |

## Utilities

| Export                           | Description                        |
| -------------------------------- | ---------------------------------- |
| `getTextContent(msg)`            | Extract text from message parts.   |
| `groupPartsInOrder(parts)`       | Group parts for ordered rendering. |
| `extractSourcesFromParts(parts)` | Extract sources from tool results. |
| `isToolPart(part)`               | Check if part is a tool call.      |
| `isReasoningPart(part)`          | Check if part is reasoning.        |
| `downloadMarkdown(messages)`     | Download conversation as .md.      |
| `exportAsMarkdown(messages)`     | Convert to markdown string.        |

## Types

| Type                     | Description                  |
| ------------------------ | ---------------------------- |
| `ChatProps`              | `<Chat>` props.              |
| `ChatRootProps`          | `<ChatRoot>` props.          |
| `ChatMessageListProps`   | `<ChatMessageList>` props.   |
| `ChatComposerProps`      | `<ChatComposer>` props.      |
| `ChatEmptyProps`         | `<ChatEmpty>` props.         |
| `MessageRootProps`       | `<Message.Root>` props.      |
| `ErrorBannerProps`       | `<ErrorBanner>` props.       |
| `ChatContextValue`       | Chat context shape.          |
| `MessageContextValue`    | Message context shape.       |
| `ComposerContextValue`   | Composer context shape.      |
| `ThreadListContextValue` | Thread list context shape.   |
| `UIMessage`              | Normalized UI message.       |
| `UIMessagePart`          | Message segment.             |
| `PartGroup`              | Grouped parts for rendering. |
| `BranchInfo`             | Branch navigation info.      |
| `FeedbackValue`          | `"positive" \| "negative"`.  |
| `AttachmentInfo`         | Attached file metadata.      |
| `Source`                 | Source citation.             |
| `ModelOption`            | Model selector option.       |
| `ChatTheme`              | Theme configuration.         |
| `ChatTab`                | `"chat" \| "uploads"`.       |
| `QuickAction`            | Quick action definition.     |
| `UploadedFile`           | Uploaded file info.          |
| `Thread`                 | Conversation thread.         |

## Related

- [`veryfront/agent`](./agent.md) — Server-side agent runtime that powers chat
- [`veryfront/tool`](./tool.md) — Define tools that agents can call
- [Chat UI Guide](../guides/chat-ui.md) — Getting started guide
