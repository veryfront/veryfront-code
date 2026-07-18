# useStreaming

Low-level stream state — kept as today, no reshape.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useStreaming } from 'veryfront/chat'
```

## Signature

The RFC keeps `useStreaming` **as today**: low-level stream state, existing documented signature, no reshape. The detailed signature is therefore not restated here — see the current library reference; any changes are TBD in implementation.

```ts
// Existing signature kept — no reshape in this RFC.
function useStreaming(options: …): …
```

## Options

Unchanged from the current library — TBD in implementation docs.

## Returns

Unchanged from the current library — TBD in implementation docs.

### Prop getters

None specified in the RFC.

## Example

Usage is unchanged from today's `useStreaming`. See the current library reference.

## Used by

No L2 components consume it directly in the RFC's inventory — higher-level hooks ([`useChat`](./use-chat.md)) own streaming for chat sessions. Note that chat streams are **provider-scoped, not mount-scoped** (keyed by conversation id — see the RFC's State ownership contract).

## Related

- [`useChat`](./use-chat.md) — chat session streaming (per-message status, `streamingMessageId`)
- [`useCompletion`](./use-completion.md) — one-shot text
