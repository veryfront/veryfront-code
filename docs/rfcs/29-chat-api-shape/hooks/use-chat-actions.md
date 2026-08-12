# useChatActions

Context reader for the `ChatActions` compound - and nothing more.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useChatActions`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatActions } from "veryfront/chat";
```

## Signature

```ts
function useChatActions(): ChatActionsContext;
```

A **context reader only**, scoped to the [`ChatActions`](../components/chat-actions.md) compound. It does **not** carry action implementations: thread-level export and clear _compose from_ the public helpers instead:

```ts
exportAsMarkdown(messages)              // → markdown string
downloadMarkdown(messages, filename?)   // → triggers download
setMessages([])                         // clear (from the chat session)
```

Per the providers contract, the raw context object stays unexported.

## Options

None - state comes from the nearest `ChatActions.Root`.

## Returns

The `ChatActions` compound's context - **menu data only** (open state lives in the dropdown primitive, not this reader):

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
  const actions = useChatActions(); // compound context (menu data)
  const { messages, setMessages } = useChatContext();
  return (
    <>
      <ChatActions.Item onSelect={() => downloadMarkdown(messages)}>
        Export as Markdown
      </ChatActions.Item>
      <ChatActions.Item onSelect={() => setMessages([])}>
        Clear conversation
      </ChatActions.Item>
    </>
  );
}

<ChatActions.Root>
  <ChatActions.Trigger />
  <ChatActions.Content>
    <MyActionItems />
  </ChatActions.Content>
</ChatActions.Root>;
```

## Used by

- [`ChatActions`](../components/chat-actions.md) - every part is a thin shell over this reader.

## Related

- [`ChatActions`](../components/chat-actions.md)
- `exportAsMarkdown` / `downloadMarkdown` - transcript export helpers
- `useChat` - `setMessages` for clear
