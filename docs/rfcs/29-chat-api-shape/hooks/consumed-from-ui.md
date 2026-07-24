# Consumed from `veryfront/ui`

Hooks that chat **consumes but does not own**. They live in `veryfront/ui`, are already shaped, and are documented **as-is** — this RFC does not reshape them. These pages exist only so the chat docs are complete; for full documentation, see the `veryfront/ui` reference.

> **Status: proposed (RFC).** This page documents the _proposed_ API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> Prefer this single reference over per-hook stub pages: none of these are chat surface. Chat renders them and reads their state; it never re-implements or re-exports them.

## `useAppShell`

Reads the [`AppShell`](../components/app-shell.md) compound's state — from `veryfront/ui`, alongside the shell it belongs to.

```tsx
import { useAppShell } from "veryfront/ui";

const shell = useAppShell();
```

Use it inside an `AppShell` to read shell state from your own components — for example, a custom sidebar trigger in place of `AppShell.Trigger`.

## `useColorMode`

Reads and controls the color mode — from `veryfront/ui`. Ships with `ColorModeProvider` (zero-node provider, see [Providers](../providers.md)) and the ready-made `ColorModeToggle` control.

```tsx
import { useColorMode, ColorModeProvider, ColorModeToggle } from "veryfront/ui";

<ColorModeProvider>
  <App />
</ColorModeProvider>;
```

- **`useColorMode`** — read and set the current color mode.
- **`ColorModeProvider`** — provides color-mode state to the tree; renders **zero DOM nodes**.
- **`ColorModeToggle`** — the ready-made toggle control, typically placed in an [`AppShell`](../components/app-shell.md) header.

## Related

- [`AppShell`](../components/app-shell.md) — the shell compound these usually live in (its real, current parts surface is documented there so chat compositions can be judged against it).
- [Providers](../providers.md) — the zero-node provider contract.
