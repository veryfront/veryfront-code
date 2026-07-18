# ChatActions

A thread-level actions menu — export, clear, and preset actions composed from public helpers.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatActions } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatActions.Root>
  <ChatActions.Trigger />
  <ChatActions.Content>
    <ChatActions.Item />
    <ChatActions.Preset />
  </ChatActions.Content>
</ChatActions.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatActions.Root` | provider | — | Scoped context provider for the compound. |
| `ChatActions.Trigger` | `<button>` | `data-open` | Opens and closes the menu. Compose its children — there is no `trigger` prop. |
| `ChatActions.Content` | `<div>` | — | The menu panel. |
| `ChatActions.Item` | `<button>` | — | One action. |
| `ChatActions.Preset` | `<button>` | — | A preset action button. |

## Props

Every part follows the library-wide node contract: `extends` its element's native React attributes, spreads `{...props}` onto its single node, takes `asChild` and `ref`; `className` merges Tailwind-aware; handlers compose (consumer first, `preventDefault` cancels internal).

### Removed from today's API

| Removed | Replacement |
| --- | --- |
| `trigger?: ReactNode` | Deleted — compose `.Trigger` children instead (composition, not render-prop config). |

### Export and clear are compositions, not built-ins

Thread-level export and clear are **composed from public helpers**, not baked into the compound or its hook:

- **Export** — `exportAsMarkdown(messages)` / `downloadMarkdown(messages, filename?)`
- **Clear** — `setMessages([])` from the chat session

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-open` | `.Trigger` | Menu is expanded. |

## Examples

### Default

Rendered with default actions inside the `<Chat />` preset.

### Composed

```tsx
function ThreadActions() {
  const { messages, setMessages } = useChatContext()
  return (
    <ChatActions.Root>
      <ChatActions.Trigger aria-label="Thread actions">
        <MoreIcon /> {/* children replace the default icon */}
      </ChatActions.Trigger>
      <ChatActions.Content className="my-menu">
        <ChatActions.Item onClick={() => downloadMarkdown(messages)}>
          Export as Markdown
        </ChatActions.Item>
        <ChatActions.Item onClick={() => setMessages([])}>
          Clear conversation
        </ChatActions.Item>
      </ChatActions.Content>
    </ChatActions.Root>
  )
}
```

### Headless

[`useChatActions()`](../hooks/use-chat-actions.md) is a **context reader only** for this compound — the actions themselves are the same public helpers, so a fully custom menu needs nothing else:

```tsx
function MyActionsMenu() {
  const { messages, setMessages } = useChatContext()
  return (
    <MyMenu>
      <MyMenu.Item onSelect={() => downloadMarkdown(messages)}>Export</MyMenu.Item>
      <MyMenu.Item onSelect={() => setMessages([])}>Clear</MyMenu.Item>
    </MyMenu>
  )
}
```

## Customization (eject path)

1. **L1** — default actions inside `<Chat />`.
2. **L2** — paste the public composition; add, remove, or reorder `.Item`s; the trigger's children are yours.
3. **L3** — skip the compound: build any menu from `exportAsMarkdown` / `downloadMarkdown` + `setMessages`; [`useChatActions()`](../hooks/use-chat-actions.md) reads the compound's context if you're composing inside it.

## Related

- [`useChatActions`](../hooks/use-chat-actions.md)
- `exportAsMarkdown` / `downloadMarkdown` — transcript export helpers
- `useChat` — `setMessages` for clear
- `ChatInput.Export` — the composer's one-click export button
