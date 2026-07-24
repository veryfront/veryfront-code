# `veryfront/chat` — proposed API shape

Reference pages for the proposed `veryfront/chat` surface, accompanying the RFC one level up: [`29-chat-api-shape.md`](../29-chat-api-shape.md). Everything here documents the *proposed* shape — none of it is implemented yet. Each page carries the same status banner; the RFC holds the full rationale, cross-cutting contracts, and open questions.

## The three layers

```
L1  Preset (black box)     <Chat agentId api />
L2  Components (ui-style)  <ChatInput><ChatInput.Field/><ChatInput.Submit/></ChatInput>
L3  Headless hooks         const c = useChatInput(); <textarea {...c.getFieldProps()} />
```

One graduation path, not three products: every L1 default is public L2; every L2 component is a thin shell over a public L3 hook. The library owns behaviour and state; the consumer owns markup.

## Components

### Session & shell

- [Chat](./components/chat.md) — the L1 preset
- [ChatRoot](./components/chat-root.md) — scoped session provider
- [ChatMessageList](./components/chat-message-list.md) — the transcript scroll container
- [ChatThemeScope](./components/chat-theme-scope.md) — token scope
- [ChatErrorBoundary](./components/chat-error-boundary.md) — error boundary
- [AppShell](./components/app-shell.md) — app layout (from `veryfront/ui`; reference)

### Composer

- [ChatInput](./components/chat-input.md) — the composer (`Field`, `Attach`, `Model`, `Voice`, `Submit`, …)
- [AttachmentPill](./components/attachment-pill.md) — pending upload chip

### Messages

- [Message](./components/message.md) — one message row and its parts
- [ToolCall](./components/tool-call.md) — tool lifecycle incl. approval
- [Reasoning](./components/reasoning.md) — reasoning disclosure
- [StepIndicator](./components/step-indicator.md) — step lifecycle
- [Sources](./components/sources.md) — citation list
- [InlineCitation](./components/inline-citation.md) — inline footnote markers
- [MessageActionBar](./components/message-action-bar.md) — re-export of the `Message.Actions` family
- [BranchPicker](./components/branch-picker.md) — message branch navigation
- [Markdown](./components/markdown.md) — streamed markdown + `RichCodeBlock` (the sanctioned multi-node exception)

### Conversations & files

- [ChatSidebar](./components/chat-sidebar.md) — conversation list
- [AttachmentsPanel](./components/attachments-panel.md) — durable files

### Agents & models

- [AgentPicker](./components/agent-picker.md) — agent selection compound
- [ModelSelector](./components/model-selector.md) — model selection compound
- [AgentCard](./components/agent-card.md) — agent detail preset
- [ChatAgentPicker](./components/chat-agent-picker.md) — preset over `AgentPicker`

### Chrome

- [ChatEmptyState](./components/chat-empty-state.md) — empty transcript + suggestions
- [ChatActions](./components/chat-actions.md) — thread-level actions menu

## Hooks

### Session & thread

- [useChat](./hooks/use-chat.md) — base session
- [useConversationChat](./hooks/use-conversation-chat.md) — session bound to the active thread
- [useCompletion](./hooks/use-completion.md) — one-shot text
- [useStreaming](./hooks/use-streaming.md) — low-level stream state
- [useChatContext](./hooks/use-chat-context.md) — read `ChatRoot` context
- [useChatErrorHandler](./hooks/use-chat-error-handler.md) — error boundary state
- [useChatScroll](./hooks/use-chat-scroll.md) — the scroll contract
- [useChatActions](./hooks/use-chat-actions.md) — `ChatActions` context reader

### Composer

- [useChatInput](./hooks/use-chat-input.md) — sole owner of input state
- [useChatInputContext](./hooks/use-chat-input-context.md) — read `ChatInput` context
- [useVoiceInput](./hooks/use-voice-input.md) — dictation
- [useUpload](./hooks/use-upload.md) — pending uploads + dropzone
- [useAttachmentPill](./hooks/use-attachment-pill.md) — per-pill context reader

### Messages

- [useMessageContext](./hooks/use-message-context.md) — read `Message` context
- [useMessageParts](./hooks/use-message-parts.md) — typed part groups
- [useClipboard](./hooks/use-clipboard.md) — copy with `copied` feedback
- [useToolCall](./hooks/use-tool-call.md) — tool part state
- [useReasoning](./hooks/use-reasoning.md) — reasoning disclosure state
- [useStepIndicator](./hooks/use-step-indicator.md) — step state
- [useSources](./hooks/use-sources.md) — citation list
- [useMessageBranches](./hooks/use-message-branches.md) — branch index/count/navigation

### Files

- [useAttachments](./hooks/use-attachments.md) — durable files
- [useAttachmentsPanel](./hooks/use-attachments-panel.md) — panel context reader

### Conversations

- [useConversations](./hooks/use-conversations.md) — list, active thread, CRUD, `selectAgent`
- [useConversation](./hooks/use-conversation.md) — one conversation
- [useConversationsContext](./hooks/use-conversations-context.md) — read `ConversationsProvider`
- [useChatSidebarItem](./hooks/use-chat-sidebar-item.md) — per-row `ChatSidebar.Item` context reader

### Agents & models

- [useAgents](./hooks/use-agents.md) — agents list
- [useAgentMetadata](./hooks/use-agent-metadata.md) — one agent's metadata
- [useAgent](./hooks/use-agent.md) — agent session callbacks
- [useAgentCard](./hooks/use-agent-card.md) — `AgentCard` context reader
- [useAgentPicker](./hooks/use-agent-picker.md) — picker state
- [useModelSelector](./hooks/use-model-selector.md) — selector state

### Shell

- [useAppShell](./hooks/use-app-shell.md) — `AppShell` state (from `veryfront/ui`; reference)
- [useColorMode](./hooks/use-color-mode.md) — color mode (from `veryfront/ui`; reference)

## Everything else

- [Helpers](./helpers.md) — pure functions, no DOM (`getTextContent`, `groupPartsInOrder`, `mergeProps`, …)
- [Providers](./providers.md) — the zero-node provider contract and precedence rules

## Cut from v1

**`MessageFeedback` / `useFeedback`** are cut from v1 — there is no backend endpoint behind them. They return additively when the endpoint exists ("nothing ships ahead of its backend").
