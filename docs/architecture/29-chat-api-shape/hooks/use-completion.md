# useCompletion

One-shot text generation (non-chat) — kept as today, no reshape.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useCompletion } from 'veryfront/chat'
```

## Signature

The RFC keeps `useCompletion` **as today**: one-shot text completion, existing documented signature, no reshape. The detailed signature is therefore not restated here — see the current library reference; any changes are TBD in implementation.

```ts
// Existing signature kept — no reshape in this RFC.
function useCompletion(options: …): …
```

## Options

Unchanged from the current library — TBD in implementation docs.

## Returns

Unchanged from the current library — TBD in implementation docs.

### Prop getters

None specified in the RFC.

## Example

Usage is unchanged from today's `useCompletion`. See the current library reference.

## Used by

No L2 components consume it in the RFC's inventory — it is a standalone session hook for non-chat, one-shot text.

## Related

- [`useChat`](./use-chat.md) — the full chat session
- [`useStreaming`](./use-streaming.md) — low-level stream state
