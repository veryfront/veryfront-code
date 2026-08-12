# ChatThemeScope

One `<div>` carrying the design-token scope for the chat UI beneath it - the same tokens as `veryfront/ui`.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `ChatThemeScope`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatThemeScope } from "veryfront/chat";

// Flat style (RFC decision: every part is a real named export with its Props type)
import { ChatThemeScope, type ChatThemeScopeProps } from "veryfront/chat";
```

## Parts index

- [`ChatThemeScope`](#chatthemescope---kept) - `kept`

## Anatomy

```tsx
<ChatThemeScope>
  {/* one <div data-vf-ui> - every [var(--token)] below resolves */}
  <AppShell>
    <AppShell.Sidebar>
      <ChatSidebar />
    </AppShell.Sidebar>{" "}
    {/* primitives OUTSIDE <Chat> get themed too */}
    <AppShell.Main>
      <Chat agentId="…" />
    </AppShell.Main>
  </AppShell>
</ChatThemeScope>;
```

`<Chat>` carries this scope for itself (it's part of the public default composition). You need `ChatThemeScope` when composing chat primitives _around_ `<Chat>` - a sidebar, header tabs, an uploads panel in your own shell - which would otherwise render unstyled. The legacy string-based `ChatTheme` system is **retired** in favor of the token system (breaking-changes ledger).

## Default DOM (childless render)

The actual HTML from today's source:

```html
<div data-vf-ui data-vf-chat                                <!-- the scope element; [var(--token)] classes in the
                                                                 subtree resolve against these attributes
                                                                 (data-vf-chat is the compat alias) -->
     class="bg-[var(--background)] text-[var(--foreground)]">
                                                            <!-- plain block element: NO flex/grid, NO positioning,
                                                                 no size of its own - children lay themselves out;
                                                                 add h-full/flex yourself if your shell needs it -->
  <style nonce="…">…generated token CSS…</style>            <!-- CSP-nonce-aware token definitions, injected once
                                                                 inside the scope; zero layout impact -->
  …children…                                                <!-- your shell / chat composition, in normal flow -->
</div>
```

**Layout:** in-flow block container, fully transparent to layout - it sets colors, not geometry.

## Parts

### `ChatThemeScope` - `kept`

The single token-scope node. Default content: the injected token `<style>` (an implementation detail with no layout footprint; it remains inline for this RFC) followed by `children`. Renders unconditionally - no null-render case. Nesting scopes is harmless; the innermost wins by CSS cascade.

**Layout:** plain block wrapper - no flex, no positioning, no implicit height (see Default DOM).

| Prop       | Type                                           | Default | Description                                                                                                                                     |
| ---------- | ---------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `asChild`  | `boolean`                                      | `false` | Merge the scope attributes onto your own element instead of a `<div>` _(proposed - today only `children` + `className` exist)_                  |
| `children` | `ReactNode`                                    | -       | The scoped subtree                                                                                                                              |
| + native   | `React.HTMLAttributes<HTMLDivElement>` · `ref` | -       | Spread onto the single node; `className` merges Tailwind-aware, consumer wins _(proposed - today `className` only, no `ref`, no other natives)_ |

**State attributes:** none. `data-vf-ui` (and the `data-vf-chat` compat alias) are the scope markers the component exists to carry, not state.

## Context

None - `ChatThemeScope` provides no React context and reads none. Theming is CSS-only: any element inside the scope may use the token vocabulary documented in the RFC token table: `--background`, `--foreground`, `--secondary`, `--tertiary`, `--faint`, `--edge`, `--edge-medium`, `--overlay`, `--destructive`, `--radius-sm`, `--radius-md`, and `--radius-lg`.

## Examples

### Default

The `<Chat />` preset's public default composition carries the theme scope - ejecting keeps identical pixels because the pasted composition includes it:

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />;
```

### Composed (L2)

Scope your own composition (the classic case: primitives outside `<Chat>`):

```tsx
<ChatThemeScope className="h-screen">
  <AppShell>
    <AppShell.Sidebar>
      <ChatSidebar />
    </AppShell.Sidebar>
    <AppShell.Main>
      <ChatRoot chat={chat}>
        <ChatMessageList />
        <ChatInput>
          <ChatInput.Field />
          <ChatInput.Submit />
        </ChatInput>
      </ChatRoot>
    </AppShell.Main>
  </AppShell>
</ChatThemeScope>;
```

### `asChild` - your element is the scope

There is no behavior hook - the component _is_ the token scope. To own the element:

```tsx
<ChatThemeScope asChild>
  <main className="my-shell grid grid-cols-[16rem_1fr] h-screen">{/* … */}</main>
</ChatThemeScope>;
```

## Customization (eject path)

1. **L1** - carried inside the `<Chat />` default composition; nothing to configure.
2. **L2** - the node is yours: retag via `asChild`, class it, attribute it - no hidden wrapper. Override tokens with your own CSS inside the scope (consumer classes win the merge).
3. **L3** - no hook exists (nothing stateful to expose); the eject path bottoms out at owning the element via `asChild`.

## Related

- [`Chat`](./chat.md) · [`ChatRoot`](./chat-root.md) · [`AppShell`](./app-shell.md)
