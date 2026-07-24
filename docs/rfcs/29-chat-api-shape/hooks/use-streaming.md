# useStreaming

Low-level stream state — kept as today, no reshape.

> **Status: proposed (RFC).** This page documents the _proposed_ API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useStreaming } from "veryfront/chat";
```

## Signature

The RFC keeps `useStreaming` **as today**: low-level stream state, existing documented signature, no reshape. The detailed signature is therefore not restated here; this RFC proposes no new public contract for this hook.

```ts
// Existing signature kept. This RFC does not restate or reshape it.
function useStreaming(
  ...args: Parameters<typeof currentUseStreaming>
): ReturnType<typeof currentUseStreaming>;
```

## Options

Unchanged from the current library.

## Returns

Unchanged from the current library.

### Prop getters

None specified in the RFC.

## Example

Usage is unchanged from today's `useStreaming`. See the current library reference.

## Used by

No L2 components consume it directly in the RFC's inventory — higher-level hooks ([`useChat`](./use-chat.md)) own streaming for chat sessions. Note that chat streams are **provider-scoped, not mount-scoped** (keyed by conversation id — see the RFC's State ownership contract).

## Related

- [`useChat`](./use-chat.md) — chat session streaming (per-message status, `streamingMessageId`)
- [`useCompletion`](./use-completion.md) — one-shot text
