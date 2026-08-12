# useCompletion

One-shot text generation (non-chat) - kept as today, no reshape.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useCompletion`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> **✂ Earns-its-place flag** (see [proposed v1 scope cuts](../../29-chat-api-shape.md)): non-chat one-shot text generation, no L2 consumer, couples to veryfront errors - **proposed cut** from the chat public surface. A chat library shouldn't ship a stray completion hook.

## Import

```tsx
import { useCompletion } from "veryfront/chat";
```

## Signature

The RFC keeps `useCompletion` **as today**: one-shot text completion, existing documented signature, no reshape. The detailed signature is therefore not restated here; this RFC proposes no new public contract for this hook.

```ts
// Existing signature kept. This RFC does not restate or reshape it.
function useCompletion(
  ...args: Parameters<typeof currentUseCompletion>
): ReturnType<typeof currentUseCompletion>;
```

## Options

Unchanged from the current library.

## Returns

Unchanged from the current library.

### Prop getters

None specified in the RFC.

## Example

Usage is unchanged from today's `useCompletion`. See the current library reference.

## Used by

No L2 components consume it in the RFC's inventory - it is a standalone session hook for non-chat, one-shot text.

## Related

- [`useChat`](./use-chat.md) - the full chat session
- [`useStreaming`](./use-streaming.md) - low-level stream state
