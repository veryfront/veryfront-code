# useColorMode

Reads and controls the color mode — from `veryfront/ui`, documented as-is.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Reference only

`useColorMode`, `ColorModeProvider`, and `ColorModeToggle` live in **`veryfront/ui`** and are **documented as-is** — this RFC does not reshape them. Chat consumes them, doesn't own them. This page exists so the chat docs are complete — for full documentation, see the `veryfront/ui` reference.

## Usage

```tsx
import { useColorMode, ColorModeProvider, ColorModeToggle } from 'veryfront/ui'

<ColorModeProvider>
  <App />
</ColorModeProvider>
```

- **`useColorMode`** — hook: read and set the current color mode.
- **`ColorModeProvider`** — provides color-mode state to the tree. Like every provider in this surface, it renders **zero DOM nodes** (see [Providers](../providers.md)).
- **`ColorModeToggle`** — the ready-made toggle control, typically placed in an [`AppShell`](../components/app-shell.md) header.

## Related

- [`AppShell`](../components/app-shell.md) — the shell these usually live in.
- [Providers](../providers.md) — the zero-node provider contract.
