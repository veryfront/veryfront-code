# Chat

The L1 preset — a batteries-included chat surface built entirely from the public L2 components, with sensible defaults.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { Chat } from 'veryfront/chat'
```

## Anatomy

`<Chat>` renders a complete chat UI on its own. Pass `children` to compose inside the preset using its compound parts:

```tsx
<Chat agentId="support-agent" api="/api/ag-ui">
  <Chat.Root>
    <Chat.Skeleton />
    <Chat.If test={(s) => s.isEmpty}>
      <Chat.Empty />
    </Chat.If>
    <Chat.MessageList>
      <Chat.Message />
    </Chat.MessageList>
    <Chat.ErrorBanner />
    <Chat.Input />
  </Chat.Root>
</Chat>
```

> The snippet above is illustrative. The **default composition is public**: the exact L2 source that `<Chat>` renders (theme scope, providers, and default classes included) is printed verbatim in the docs, and ejecting means pasting it. The full listing lands with the implementation.

## Parts

Every part renders **one** node, takes `asChild`, extends its node's `HTMLAttributes`, merges `className` (Tailwind-aware, consumer wins), and composes `ref`.

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `Chat.Root` | *no node by default* (`asChild` for a node) | `data-status` | Scoped session provider — see [`ChatRoot`](./chat-root.md) |
| `Chat.MessageList` | `<div>` (scroll container) | `data-at-bottom` · `data-autoscrolling` · `data-scrollable` · `data-loading` · `data-empty` | Transcript — see [`ChatMessageList`](./chat-message-list.md) |
| `Chat.Input` | `<form>` | `data-status` · `data-dragging` · `data-compact` | The composer (`ChatInput`) |
| `Chat.Empty` | `<div>` | — | Empty state (`ChatEmptyState`); typed suggestions via `getAgentPromptSuggestionItems(agent)` |
| `Chat.Skeleton` | TBD in implementation | — | Loading skeleton |
| `Chat.If` | *no node* | — | Selector conditional: `<Chat.If test={(s) => s.isEmpty}>…</Chat.If>` — no boolean-prop variants |
| `Chat.Message` | `<article>` | `data-role` · `data-agent-id` · `data-streaming` · `data-editing` · `data-error` | One message row (`Message`) |
| `Chat.ErrorBanner` | TBD in implementation (renders with `role="alert"`) | — | Session error display |

## Props

Session props set here flow to all descendants through `ChatRoot` context (precedence: explicit prop > nearest context > default). Trimmed from today's 28 props:

| Prop | Type | Description |
| --- | --- | --- |
| `agentId` | `string` | The agent to talk to |
| `api` \| `transport` | `string \| { url, headers, credentials, fetch, body }` | Endpoint or transport object — auth works without a custom client |
| `uploadApi?` | `string` | Upload endpoint for attachments |
| `tools?` | `{ [name: string]: Component }` | Tools registry — per-tool renderers receiving the typed part. Resolution order: inline render fn → registry by name → default renderer |
| `labels?` | object | i18n overrides for built-in strings (L1 only — at L2/L3 the consumer owns all text) |
| `chat?` | `UseChatResult` | Controlled session — bring your own `useChat()` |
| `children?` | `ReactNode` | Compose inside the preset using the compound parts |
| `asChild?` | `boolean` | Merge onto your own element |

## State attributes

| Attribute | Where | When |
| --- | --- | --- |
| `data-status="ready\|submitted\|streaming\|error"` | `Chat.Root`, `Chat.Input` | Mirrors `useChat().status` |

Sub-part attributes are documented on their own pages (see Parts table).

## Examples

### Default

Batteries included — runs every hook internally:

```tsx
<ConversationsProvider storageKey="ops">
  <AppShell>
    <AppShell.Sidebar><ChatSidebar /></AppShell.Sidebar>
    <AppShell.Main>
      <Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />
    </AppShell.Main>
  </AppShell>
</ConversationsProvider>
```

### Composed (L2)

Own every layout div; config on the leaf; state via `data-*`:

```tsx
function Workspace() {
  const { chat, ready } = useConversationChat({ agentId: 'support-agent', api: '/api/ag-ui' })
  return (
    <ChatInput chat={chat}>
      <div className="my-card">                        {/* YOUR div */}
        <ChatInput.Field className="my-input" placeholder="Ask…" />
        <div className="my-toolbar">                   {/* YOUR div */}
          <ChatInput.Attach />
          <ChatInput.Model models={MODELS} />           {/* config on the leaf */}
          <ChatInput.Submit className="my-btn" data-analytics="send" />
        </div>
      </div>
    </ChatInput>
  )
}
```

### Headless (L3)

You render every element; prop getters carry behaviour. Consumer props go *into* the getters — never `{...getter()} {...props}`:

```tsx
function MyChatInput() {
  const chat = useConversationChat({ agentId })
  const chatInput = useChatInput({ chat: chat.chat, upload: useUpload() })
  return (
    <form {...chatInput.getFormProps()} className="anything">
      <textarea {...chatInput.getFieldProps()} className="anything" />
      <button {...chatInput.getSubmitProps({ 'aria-label': 'Send' })}>
        {chatInput.isStreaming ? <Stop /> : <Send />}
      </button>
    </form>
  )
}
```

## Customization

The three layers are one graduation path — no rewrite cliff:

1. **Per-piece, without ejecting:** `<Chat tools={{ web_search: MyToolCard }} />` swaps one tool renderer; `labels` overrides strings; `children` recomposes the compound parts.
2. **Eject to L2:** paste the public default composition (identical pixels — it carries the theme scope, providers, and default classes) and edit the one piece you care about. Everything `<Chat>` renders is reachable L2 — no private components, no internal-only props.
3. **Rebuild at L3:** replace any L2 leaf, one at a time, with your own element driven by the same hook (`asChild` or prop getters).

## Related

- [`ChatRoot`](./chat-root.md) · [`ChatMessageList`](./chat-message-list.md) · [`ChatThemeScope`](./chat-theme-scope.md) · [`ChatErrorBoundary`](./chat-error-boundary.md)
- [`useChat`](../hooks/use-chat.md) · [`useConversationChat`](../hooks/use-conversation-chat.md) · [`useChatContext`](../hooks/use-chat-context.md)
