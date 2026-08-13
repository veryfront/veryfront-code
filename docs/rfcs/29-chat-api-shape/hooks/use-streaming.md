# useStreaming

Low-level stream state - kept as today, no reshape.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useStreaming`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useStreaming } from "veryfront/chat";
```

## Signature

The RFC keeps `useStreaming` **as today** - a low-level, app-agnostic streaming primitive (POST fetch, chunked text) and the generic escape hatch beneath the chat surface. No reshape; stated here in full so the page is self-contained:

```ts
function useStreaming(options: {
  url: string;
  onChunk?: (chunk: string) => void;
  onComplete?: (data: string) => void;
  onError?: (error: Error) => void;
}): {
  data: string;
  isStreaming: boolean;
  error: Error | null;
  start: (body?: unknown) => void;
  stop: () => void;
  reset: () => void;
};
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

No L2 components consume it directly in the RFC's inventory - higher-level hooks ([`useChat`](./use-chat.md)) own streaming for chat sessions. Note that chat streams are **provider-scoped, not mount-scoped** (keyed by conversation id - see the RFC's State ownership contract).

## Related

- [`useChat`](./use-chat.md) - chat session streaming (per-message status, `streamingMessageId`)
- [`useCompletion`](./use-completion.md) - one-shot text
