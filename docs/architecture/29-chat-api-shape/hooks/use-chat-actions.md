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

The `ChatActions` compound's context — **menu data only** (open state lives in the dropdown primitive, not this reader):

```ts
{
  actions: ChatActionItem[]        // the data-driven rows ([] when composed without them)
  onAttachFiles?: () => void
  attachFilesLabel: string         // resolved (default applied)
  settings?: ChatActionsSettings
}
```

## Example

Compose the actions from the helpers; use the reader when building a custom part inside the compound:

```tsx
function MyActionItems() {
  const actions = useChatActions()           // compound context (menu data)
  const { messages, setMessages } = useChatContext()
  return (
    <>
      <ChatActions.Item onSelect={() => downloadMarkdown(messages)}>
        Export as Markdown
      </ChatActions.Item>
      <ChatActions.Item onSelect={() => setMessages([])}>
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
