# useChatActions

Context reader for the `ChatActions` compound — and nothing more.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatActions } from 'veryfront/chat'
```

## Signature

```ts
function useChatActions(): ChatActionsContext
```

A **context reader only**, scoped to the [`ChatActions`](../components/chat-actions.md) compound. It does **not** carry action implementations: thread-level export and clear *compose from* the public helpers instead —

```ts
exportAsMarkdown(messages)              // → markdown string
downloadMarkdown(messages, filename?)   // → triggers download
setMessages([])                         // clear (from the chat session)
```

Per the providers contract, the raw context object stays unexported.

## Options

None — state comes from the nearest `ChatActions.Root`.

## Returns

The `ChatActions` compound's context — the menu state its parts render from (surfaced on the DOM as `data-open` on `.Trigger`).

## Example

Compose the actions from the helpers; use the reader when building a custom part inside the compound:

```tsx
function MyActionItems() {
  const actions = useChatActions()           // compound context (menu state)
  const { messages, setMessages } = useChatContext()
  return (
    <>
      <ChatActions.Item onClick={() => downloadMarkdown(messages)}>
        Export as Markdown
      </ChatActions.Item>
      <ChatActions.Item onClick={() => setMessages([])}>
        Clear conversation
      </ChatActions.Item>
    </>
  )
}

<ChatActions.Root>
  <ChatActions.Trigger />
  <ChatActions.Content>
    <MyActionItems />
  </ChatActions.Content>
</ChatActions.Root>
```

## Used by

- [`ChatActions`](../components/chat-actions.md) — every part is a thin shell over this reader.

## Related

- [`ChatActions`](../components/chat-actions.md)
- `exportAsMarkdown` / `downloadMarkdown` — transcript export helpers
- `useChat` — `setMessages` for clear
