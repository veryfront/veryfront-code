# ChatThemeScope

One `<div>` carrying the design-token scope (`[data-vf-ui]`) for the chat UI beneath it.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatThemeScope } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatThemeScope>
  {/* chat UI styled by the token scope */}
</ChatThemeScope>
```

The legacy string-based `ChatTheme` system is **retired** in favor of the token system (breaking-changes ledger).

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatThemeScope` | `<div>` (`[data-vf-ui]` token scope) | — | The single token-scope node — same tokens as `veryfront/ui` |

Standard contract: renders exactly **one** node, takes `asChild`, extends `React.HTMLAttributes<HTMLDivElement>`, merges `className` (Tailwind-aware, consumer wins), composes `ref`.

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `asChild?` | `boolean` | Merge the token scope onto your own element instead of a `<div>` |
| `children` | `ReactNode` | The scoped subtree |

Plus every native `<div>` attribute (`className`, `style`, `data-*`, `aria-*`, `id`, `ref`, …) — spread onto the one node.

## State attributes

None. `data-vf-ui` is the scope marker the component exists to carry, not a state attribute.

## Examples

### Default

The `<Chat />` preset's public default composition carries the theme scope — ejecting keeps identical pixels because the pasted composition includes it:

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

Scope your own composition:

```tsx
<ChatThemeScope className="h-full">
  <ChatRoot chat={chat}>
    <ChatMessageList />
    <ChatInput>
      <ChatInput.Field />
      <ChatInput.Submit />
    </ChatInput>
  </ChatRoot>
</ChatThemeScope>
```

### Headless (L3)

There is no behavior hook — the component is the token scope itself. To own the element, use `asChild`:

```tsx
<ChatThemeScope asChild>
  <main className="my-shell">{/* … */}</main>
</ChatThemeScope>
```

## Customization

- The node is yours: retag via `asChild`, class it, attribute it — no hidden wrapper.
- Theming is token-based (shared with `veryfront/ui`); the token vocabulary is documented with the token system, TBD in implementation docs.

## Related

- [`Chat`](./chat.md) · [`ChatRoot`](./chat-root.md)
