# useAppShell

Reads the [`AppShell`](../components/app-shell.md) state — from `veryfront/ui`.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Reference only

`useAppShell` lives in **`veryfront/ui`**, alongside the `AppShell` compound it belongs to. It is already shaped; chat consumes it, doesn't own it. This page exists so the chat docs are complete — for full documentation, see the `veryfront/ui` reference.

## Usage

```tsx
import { useAppShell } from 'veryfront/ui'

const shell = useAppShell()
```

Use it inside an `AppShell` to read shell state from your own components — for example, a custom sidebar trigger in place of `AppShell.Trigger`.

## Related

- [`AppShell`](../components/app-shell.md) — the compound this hook serves.
- [`useColorMode`](./use-color-mode.md) — color mode, also from `veryfront/ui`.
