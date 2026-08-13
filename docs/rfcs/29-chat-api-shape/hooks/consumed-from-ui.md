# Consumed from `veryfront/ui`

Layout primitives whose **shape is owned by `veryfront/ui`**, but which `veryfront/chat` **re-exports** so you can pull the shell straight from one import: `import { AppShell, useAppShell } from "veryfront/chat"`. They are part of chat's public surface; this RFC documents them but defers their contract to `veryfront/ui` rather than reshaping it.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `AppShell`, `useAppShell`
> - **Not exported today:** `useColorMode`, `ColorModeProvider`, `ColorModeToggle`
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> Grouped here rather than on per-hook pages because chat re-exports them verbatim from `veryfront/ui` (see `src/chat/index.ts`) - the chat RFC neither re-implements nor reshapes them. Any change to their shape (e.g. extracting a generic `useDisclosure` under `useAppShell`'s sidebar state) is a `veryfront/ui` decision that ripples through this re-export.

## `useAppShell`

Reads the [`AppShell`](../components/app-shell.md) compound's state - from `veryfront/ui`, alongside the shell it belongs to.

```tsx
import { useAppShell } from "veryfront/ui";

const shell = useAppShell();
```

Use it inside an `AppShell` to read shell state from your own components - for example, a custom sidebar trigger in place of `AppShell.Trigger`.

## `useColorMode`

Reads and controls the color mode - from `veryfront/ui`. Ships with `ColorModeProvider` (zero-node provider, see [Providers](../providers.md)) and the ready-made `ColorModeToggle` control.

```tsx
import { ColorModeProvider, ColorModeToggle, useColorMode } from "veryfront/ui";

<ColorModeProvider>
  <App />
</ColorModeProvider>;
```

- **`useColorMode`** - read and set the current color mode.
- **`ColorModeProvider`** - provides color-mode state to the tree; renders **zero DOM nodes**.
- **`ColorModeToggle`** - the ready-made toggle control, typically placed in an [`AppShell`](../components/app-shell.md) header.

## Decision: keep `useAppShell` specific

Because `veryfront/chat` re-exports `useAppShell`, its shape is part of chat's public surface and is fair game to shape here. Its state core - `isOpen(side)` / `toggle(side)` / `setOpen(side, open)` - is just **keyed binary disclosure**, i.e. a generic `useDisclosure` / `useCollapsible`. What makes it shell-specific is layered on top: two docked sides, viewport-aware open state (desktop inline column vs mobile off-canvas overlay), `sidebarId(side)` for `aria-controls`, and the ⌘/Ctrl+B shortcut.

Do not rename `useAppShell` to `useCollapsible`. That under-describes what it returns (shell context, not a lone toggle). Instead, **extract a generic `useDisclosure` primitive in `veryfront/ui`** and have `useAppShell` compose it, so the reusable disclosure state is available on its own while the shell hook keeps its shell-scoped surface. Implementation lands in `veryfront/ui`; this RFC records that target.

## Related

- [`AppShell`](../components/app-shell.md) - the shell compound these usually live in (its real, current parts surface is documented there so chat compositions can be judged against it).
- [Providers](../providers.md) - the zero-node provider contract.
