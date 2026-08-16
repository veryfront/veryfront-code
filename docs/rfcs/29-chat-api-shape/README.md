# `veryfront/chat` - proposed API shape

Reference pages for the proposed `veryfront/chat` surface, accompanying the RFC one level up: [`29-chat-api-shape.md`](../29-chat-api-shape.md). The RFC holds the full rationale, cross-cutting contracts, and resolved decisions; these pages hold the per-piece detail.

> **Status: RFC 29 - partly landed.** Per-symbol truth for this index, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `getAgentPromptSuggestionItems`, `mergeProps`, `useChatInput`, `useChatInputContext`, `useChatScroll`, `useMessageBranches`
> - **Not exported today:** `formatSize`
>
> Those six symbols resolve on the public surface today. That is **not** the same as a landed delta - see [reading the status block](#reading-the-status-block). For the deltas that have actually landed, see [what has landed](#what-has-landed---shipped-srcreactcomponentschatchathooksuse-chat-inputts85).

## Reading the status block

RFC 29 proposes a reset of a library that **already shipped**, and it is landing piecemeal. Every page here therefore carries a status block instead of a page-wide "not implemented" banner, because a page-wide banner is a claim no machine can check - and it went stale the moment [#3277](https://github.com/veryfront/veryfront-code/pull/3277) shipped the prop-getter surface and made `mergeProps` public.

Read a status block like this:

- **Exported from `veryfront/chat` today** - these symbols resolve on the real public surface (barrel exports plus compound sub-parts). **This does not mean the page's delta for them has landed.** `ChatInput.Submit` ships; the RFC's reshape of it does not.
- **Not exported today** - these symbols genuinely do not exist. `deno task lint:rfc-status` fails if any of them starts shipping without this list being updated.
- **Not in `src/` today** - the same guarantee for props and hook members, which are not exports (`submitMode`, `getDropTargetProps`).

The **Import** block on each page shows the shape this RFC _proposes_, not today's barrel - so where the two differ, the status block wins. The most common difference: "every sub-part is also a flat named export" is a proposal on every page except [`ChatInput`](./components/chat-input.md#chatinput-flat-sub-part-exports---new---shipped-srcchatindexts250), where it has actually landed (`src/chat/index.ts:250`).

What actually landed is marked **per delta**, on the delta's own heading:

- `` `shipped` (src/path/to/file.ts:42) `` - the delta landed as specified, with the source it landed in.
- `` `partly shipped` (src/path/to/file.ts:42) `` - part of it landed; the section says which part, and what is still proposed.
- no status badge - still proposed. The `kept` / `changed` / `new` / `removed` badge describes the proposal, not the runtime.

Every anchor is checked: the file must exist and the line must be in it. So must both symbol lists. The check runs in the lint chain, which is what stops this corpus drifting again.

### What has landed - `shipped` (src/react/components/chat/chat/hooks/use-chat-input.ts:85)

The complete set, as of `main`, and checked one delta at a time: every row links the delta's own heading, and `deno task lint:rfc-status` pairs each row with that badge. It fails if a badge has no row, if a row's anchor names no badge, if a row links a page without naming a delta, or if two rows claim the same delta. Pairing by page instead of by delta would let one badge cover a page's whole column - which is how the `ChatInput` flat sub-part exports row sat here unbadged.

| Delta                                                                                                                                                                            | Status           | Landed in                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`mergeProps` made public](./helpers.md#mergeprops---new---shipped-srcreactcomponentschatchathooksuse-chat-inputts85)                                                            | `shipped`        | `src/react/components/chat/chat/hooks/use-chat-input.ts:85`                                                                                          |
| [`useMessageBranches`](./hooks/use-message-branches.md#usemessagebranches---new---shipped-srcreactcomponentschatchatcontextsmessage-contexttsx87)                                | `shipped`        | `src/react/components/chat/chat/contexts/message-context.tsx:87`                                                                                     |
| [`useChatInputContext` naming](./hooks/use-chat-input-context.md#usechatinputcontext---new---shipped-srcreactcomponentschatchatcontextscomposer-contexttsx83)                    | `shipped`        | `src/react/components/chat/chat/contexts/composer-context.tsx:83`                                                                                    |
| [`useChatInput` + prop getters](./hooks/use-chat-input.md#usechatinput---new---partly-shipped-srcreactcomponentschatchathooksuse-chat-inputts155)                                | `partly shipped` | `src/react/components/chat/chat/hooks/use-chat-input.ts:155`                                                                                         |
| [`useChatScroll`](./hooks/use-chat-scroll.md#usechatscroll---new---partly-shipped-srcreactcomponentschatchathooksuse-stick-to-bottomts177)                                       | `partly shipped` | `src/react/components/chat/chat/hooks/use-stick-to-bottom.ts:177`                                                                                    |
| [`ChatInput.Field` IME guard + native surface](./components/chat-input.md#chatinputfield---changed---partly-shipped-srcreactcomponentschatchatcompositionchat-composertypests18) | `partly shipped` | `src/react/primitives/input-box.tsx:37` (guard); the native surface landed in `src/react/components/chat/chat/composition/chat-composer.types.ts:18` |
| [`ChatInput` flat sub-part exports](./components/chat-input.md#chatinput-flat-sub-part-exports---new---shipped-srcchatindexts250)                                                | `shipped`        | `src/chat/index.ts:250`                                                                                                                              |
| [`AttachmentsPanel.Item.Name`](./components/attachments-panel.md#attachmentspanelitemname---new---shipped-srcreactcomponentschatchatcomponentsattachments-paneltsx363)           | `shipped`        | `src/react/components/chat/chat/components/attachments-panel.tsx:363`                                                                                |
| [`AttachmentsPanel.Item.Size`](./components/attachments-panel.md#attachmentspanelitemsize---new---shipped-srcreactcomponentschatchatcomponentsattachments-paneltsx386)           | `shipped`        | `src/react/components/chat/chat/components/attachments-panel.tsx:386`                                                                                |

## The three layers

```
L1  Preset (black box)     <Chat agentId api />
L2  Components (ui-style)  <ChatInput><ChatInput.Field/><ChatInput.Submit/></ChatInput>
L3  Headless hooks         const c = useChatInput(); <textarea {...c.getFieldProps()} />
```

One graduation path, not three products: every L1 default is public L2; every L2 component is a thin shell over a public L3 hook. The library owns behaviour and state; the consumer owns markup.

## Components

### Session & shell

- [Chat](./components/chat.md) - the L1 preset
- [ChatRoot](./components/chat-root.md) - scoped session provider
- [ChatMessageList](./components/chat-message-list.md) - the transcript scroll container
- [ChatThemeScope](./components/chat-theme-scope.md) - token scope
- [ChatErrorBoundary](./components/chat-error-boundary.md) - error boundary
- [AppShell](./components/app-shell.md) - app layout (from `veryfront/ui`; reference)

### Composer

- [ChatInput](./components/chat-input.md) - the composer (`Field`, `Attach`, `Model`, `Voice`, `Submit`, …)
- [AttachmentPill](./components/attachment-pill.md) - pending upload chip

### Messages

- [Message](./components/message.md) - one message row and its parts
- [ToolCall](./components/tool-call.md) - tool lifecycle incl. approval
- [Reasoning](./components/reasoning.md) - reasoning disclosure
- [StepIndicator](./components/step-indicator.md) - step lifecycle
- [Sources](./components/sources.md) - citation list
- [InlineCitation](./components/inline-citation.md) - inline footnote markers
- [MessageActionBar](./components/message-action-bar.md) - re-export of the `Message.Actions` family
- [BranchPicker](./components/branch-picker.md) - message branch navigation
- [Markdown](./components/markdown.md) - streamed markdown + `RichCodeBlock` (the sanctioned multi-node exception)

### Conversations & files

- [ChatSidebar](./components/chat-sidebar.md) - conversation list
- [AttachmentsPanel](./components/attachments-panel.md) - durable files

### Agents & models

- [AgentPicker](./components/agent-picker.md) - agent selection compound
- [ModelSelector](./components/model-selector.md) - model selection compound
- [AgentCard](./components/agent-card.md) - agent detail preset
- [ChatAgentPicker](./components/chat-agent-picker.md) - preset over `AgentPicker`

### Chrome

- [ChatEmptyState](./components/chat-empty-state.md) - empty transcript + suggestions
- [ChatActions](./components/chat-actions.md) - thread-level actions menu

## Hooks

### Session & thread

- [useChat](./hooks/use-chat.md) - base session
- [useConversationChat](./hooks/use-conversation-chat.md) - session bound to the active thread
- [useCompletion](./hooks/use-completion.md) - one-shot text
- [useStreaming](./hooks/use-streaming.md) - low-level stream state
- [useChatContext](./hooks/use-chat-context.md) - read `ChatRoot` context
- [useChatErrorHandler](./hooks/use-chat-error-handler.md) - error boundary state
- [useChatScroll](./hooks/use-chat-scroll.md) - the scroll contract
- [useChatActions](./hooks/use-chat-actions.md) - `ChatActions` context reader

### Composer

- [useChatInput](./hooks/use-chat-input.md) - sole owner of input state
- [useChatInputContext](./hooks/use-chat-input-context.md) - read `ChatInput` context
- [useVoiceInput](./hooks/use-voice-input.md) - dictation
- [useUpload](./hooks/use-upload.md) - pending uploads + dropzone
- [useAttachmentPill](./hooks/use-attachment-pill.md) - per-pill context reader

### Messages

- [useMessageContext](./hooks/use-message-context.md) - read `Message` context
- [useMessageParts](./hooks/use-message-parts.md) - typed part groups
- [useClipboard](./hooks/use-clipboard.md) - copy with `copied` feedback
- [useToolCall](./hooks/use-tool-call.md) - tool part state
- [useReasoning](./hooks/use-reasoning.md) - reasoning disclosure state
- [useStepIndicator](./hooks/use-step-indicator.md) - step state
- [useSources](./hooks/use-sources.md) - citation list
- [useMessageBranches](./hooks/use-message-branches.md) - branch index/count/navigation

### Files

- [useAttachments](./hooks/use-attachments.md) - durable files
- [useAttachmentsPanel](./hooks/use-attachments-panel.md) - panel context reader

### Conversations

- [useConversations](./hooks/use-conversations.md) - list, active thread, CRUD, `selectAgent`
- [useConversation](./hooks/use-conversation.md) - one conversation
- [useConversationsContext](./hooks/use-conversations-context.md) - read `ConversationsProvider`
- [useChatSidebarItem](./hooks/use-chat-sidebar-item.md) - per-row `ChatSidebar.Item` context reader

### Agents & models

- [useAgents](./hooks/use-agents.md) - agents list
- [useAgentMetadata](./hooks/use-agent-metadata.md) - one agent's metadata
- [useAgent](./hooks/use-agent.md) - agent session callbacks
- [useAgentCard](./hooks/use-agent-card.md) - `AgentCard` context reader
- [useAgentPicker](./hooks/use-agent-picker.md) - picker state
- [useModelSelector](./hooks/use-model-selector.md) - selector state

### Shell

- [Consumed from `veryfront/ui`](./hooks/consumed-from-ui.md) - `useAppShell`, `useColorMode` (reference only; owned by `veryfront/ui`, not chat)

## Everything else

- [Helpers](./helpers.md) - pure functions, no DOM (`getTextContent`, `groupPartsInOrder`, `mergeProps`, …)
- [Providers](./providers.md) - the zero-node provider contract and precedence rules

## Cut from v1

**`MessageFeedback` / `useFeedback`** are cut from v1 - there is no backend endpoint behind them. They return additively when the endpoint exists ("nothing ships ahead of its backend").
