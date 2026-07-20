# ChatRoot

The scoped chat session provider — shares one `useChat()` result with its subtree, and renders **no node by default**.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatRoot } from 'veryfront/chat'
```

## Parts index

- [`ChatRoot`](#chatroot--changed) — `changed`: today's token-scope `<div>` + `<style>` are deleted — context only, zero nodes; 25 props collapse into `chat`

## Anatomy

`ChatRoot` is a provider, not a layout element — you supply every layout div between it and the components it feeds:

```tsx
<ChatRoot chat={chat}>            {/* context only — zero nodes */}
  <div className="my-layout">     {/* YOUR div — ChatRoot adds nothing around it */}
    <ChatMessageList>
      <ChatMessageList.Content />
      <ChatMessageList.ScrollButton />
    </ChatMessageList>
    <ChatInput>                   {/* reads the session from this context */}
      <ChatInput.Field />
      <ChatInput.Submit />
    </ChatInput>
  </div>
</ChatRoot>
```

## Default DOM (childless render)

What `ChatRoot` puts in the DOM **today** — the RFC deletes both nodes (context only; the token scope moves to [`ChatThemeScope`](./chat-theme-scope.md)):

```html
<!-- TODAY -->
<style>…generated token CSS (CSP-nonce aware)…</style>   <!-- injected style tag, sibling of the container -->
<div data-vf-ui data-vf-chat data-chat-container         <!-- token scope + native div attrs spread here -->
     class="flex flex-col h-full overflow-hidden relative"
     style="max-height:100%">
     <!-- vertical flex column filling its parent; clips overflow; `relative`
          exists as a positioning context but anchors nothing of its own -->
  …children (your composition / the preset's parts)…
</div>

<!-- PROPOSED -->
…children only — zero nodes. With `asChild`, YOUR element carries data-status. -->
```

**Layout:** none (proposed) — children lay out in whatever container *you* render. Today's container is the outer flex column of the preset; after the reshape that div is pasted composition, not hidden library DOM.

## Parts

### `ChatRoot` — `changed`

*Changed: the node is deleted — today's token-scope `<div>` (and injected `<style>`) go away, leaving context only (the scope moves to `ChatThemeScope`); 25 individual props collapse into the one `chat` object.*

The compound's context provider (`ChatContextProvider` internally). All session state enters here; `ChatInput`, `ChatMessageList`, `Message`, `Chat.If` and the `use*Context` hooks read it. Default content: `children`, unchanged — there is no default anatomy to describe because there is no node. Renders `children` unconditionally (no null-render condition).

**Layout:** no node (see Default DOM); via `asChild` the single merged node is yours to place.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `chat` *(required)* | `UseChatResult` | — | The session to share — `chat={useChat()}` is the single shared context (#2973) |
| `asChild` | `boolean` | `false` | Render a node by merging onto your element (zero nodes otherwise); the standard contract applies to it (native attrs spread, `className` merge, `ref` composes) |
| `children` | `ReactNode` | — | The subtree that reads this context |

Root context is **opt-in** (Layer 2), never required. Components that accept a `chat` prop resolve by precedence: **explicit prop > nearest context > default**. Scoped, not app-wide: a `ChatRoot` shares state with *its* children only; nesting is allowed and the nearest provider wins (the rule message editing relies on).

**State attributes (proposed):** `data-status="ready|submitted|streaming|error"` (mirrors `useChat().status`) — present only on a DOM node when `asChild` provides one.

### Removed (today → where it went)

Today `ChatRootProps` threads **25 individual props** plus native div attributes. The RFC collapses all of them into the one `chat` object — this table is the reviewer's ledger:

| Today's props | Replacement |
| --- | --- |
| `messages` · `isLoading` · `status` · `streamingMessageId` · `error` | Fields of `chat` (`UseChatResult`) |
| `input` · `setInput` | **Moved out of the session entirely** — input state's one owner is `useChatInput` (ledger: `useChat` drops `input`/`setInput`/`handleInputChange`) |
| `onSubmit` · `onStop` · `onReload` | `chat.sendMessage` / `chat.stop` / `chat.reload(messageId?)`; the submit fold/guard/clear moves into `useChatInput` (#2974) |
| `model` · `models` · `onModelChange` | `chat.setModel` for state; `models` config moves to the leaf (`ChatInput.Model models=`) per the config-escalation rule |
| `agent` | Deleted — message identity is **per-message** (multi-agent decision); agent metadata via `useAgentMetadata` |
| `attachments` · `onAttach` · `onRemoveAttachment` | `useUpload` / `ChatInput upload=` |
| `editMessage` · `getBranches` · `switchBranch` | Fields of `chat`; `useMessageBranches` is the thin reader |
| `onFeedback` | `MessageFeedback` cut from v1 (no backend endpoint) |
| `onSourceClick` | `Sources` / `InlineCitation` composition |
| `theme` · `maxHeight` · `className` · native div attrs · `ref` | Node deleted — string `ChatTheme` retired (ledger); token scope via `ChatThemeScope`; layout divs are yours. Native attrs/`ref` apply only with `asChild` |

## Context (what the subtree reads)

`useChatContext()` — throws outside `ChatRoot`; `useChatContextOptional()` returns `null`. Proposed shape (today's 25-field `ChatContextValue` collapsed per #2973):

```ts
{
  ...UseChatResult,     // messages, status, error, streamingMessageId,
                        // sendMessage, stop, reload(messageId?), setModel,
                        // editMessage, getBranches, switchBranch, setMessages, …
  isEmpty: boolean      // derived; used by Chat.If selectors
  // further derived flags: TBD in implementation
}
```

Streams are **provider-scoped, not mount-scoped**: keyed by conversation id, so switching threads neither aborts nor orphans an in-flight stream (see *State ownership* in the RFC). The raw context object stays unexported.

## Examples

### Default

Inside `<Chat />`, the preset renders `Chat.Root` for you — session props (`agentId`, `api`, …) flow through this context:

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

Provide the session once; children stop re-threading props (kills the ~30-prop re-threading — session callbacks like `editMessage` and `reload` come from this context):

```tsx
function Workspace() {
  const { chat, ready } = useConversationChat({ agentId: 'support-agent', api: '/api/ag-ui' })
  return (
    <ChatRoot chat={chat}>
      <div className="my-layout">
        <ChatMessageList />
        <ChatInput>
          <ChatInput.Field />
          <ChatInput.Submit />
        </ChatInput>
      </div>
    </ChatRoot>
  )
}
```

### `asChild` — give the provider a node

```tsx
<ChatRoot chat={chat} asChild>
  <section className="my-chat-pane" />   {/* YOUR element; gets data-status */}
</ChatRoot>
```

Style off the state: `[data-status="streaming"] .my-send { … }`.

### Headless (L3)

Skip the provider entirely — pass the chat result explicitly to hooks and components that take it:

```tsx
function MyChat() {
  const chat = useChat({ api: '/api/ag-ui' })
  const chatInput = useChatInput({ chat })
  return (
    <form {...chatInput.getFormProps()}>
      <textarea {...chatInput.getFieldProps()} />
      <button {...chatInput.getSubmitProps()}>Send</button>
    </form>
  )
}
```

## Customization (eject path)

1. **L1** — `Chat.Root` inside the public default composition.
2. **L2** — `<ChatRoot chat={chat}>` around your own markup — the provider adds zero wrapper divs.
3. **L3** — no provider at all; hand `UseChatResult` around explicitly. `useChatContextOptional` lets shared components work in both worlds.

## Related

- [`Chat`](./chat.md) · [`ChatMessageList`](./chat-message-list.md) · [`ChatThemeScope`](./chat-theme-scope.md) · [`ChatErrorBoundary`](./chat-error-boundary.md)
- [`useChat`](../hooks/use-chat.md) · [`useChatContext`](../hooks/use-chat-context.md) · [`useConversationChat`](../hooks/use-conversation-chat.md)
