# ChatRoot

The scoped chat session provider — shares one `useChat()` result with its subtree, and renders **no node by default**.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatRoot } from 'veryfront/chat'
```

## Anatomy

`ChatRoot` is a provider, not a layout element — you supply every layout div between it and the components it feeds:

```tsx
<ChatRoot chat={chat}>
  <ChatMessageList>
    <ChatMessageList.Content />
    <ChatMessageList.ScrollButton />
  </ChatMessageList>
  <ChatInput>
    <ChatInput.Field />
    <ChatInput.Submit />
  </ChatInput>
</ChatRoot>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatRoot` | *no node by default*; one node via `asChild` | `data-status` (on the node when `asChild` is used) | Scoped session context (`ChatContextProvider`). Read via [`useChatContext`](../hooks/use-chat-context.md) |

When `asChild` provides a node, it follows the standard contract: extends the node's `HTMLAttributes`, merges `className`, composes `ref`.

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `chat` | `UseChatResult` | The session to share — `chat={useChat()}` is the single shared context |
| `asChild?` | `boolean` | Render a node by merging onto your element (zero nodes otherwise) |
| `children` | `ReactNode` | The subtree that reads this context |

Root context is **opt-in** (Layer 2), never required. Components that accept a `chat` prop (e.g. `ChatInput`, `Message`) resolve it by precedence: **explicit prop > nearest context > default**. Scoped, not app-wide: a `ChatRoot` shares state with *its* children only.

The raw context object stays unexported — read it through `useChatContext` / `useChatContextOptional`.

## State attributes

| Attribute | When |
| --- | --- |
| `data-status="ready\|submitted\|streaming\|error"` | Mirrors `useChat().status`; only present on a DOM node when `asChild` gives `ChatRoot` one |

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

## Customization

- **L1 appearance:** `Chat.Root` inside the public default composition.
- **L2 composition:** `<ChatRoot chat={chat}>` around your own markup — the provider adds zero wrapper divs.
- **L3 hook:** no provider at all; hand `UseChatResult` around explicitly. `useChatContextOptional` lets shared components work in both worlds.

## Related

- [`Chat`](./chat.md) · [`ChatMessageList`](./chat-message-list.md) · [`ChatErrorBoundary`](./chat-error-boundary.md)
- [`useChat`](../hooks/use-chat.md) · [`useChatContext`](../hooks/use-chat-context.md) · [`useConversationChat`](../hooks/use-conversation-chat.md)
