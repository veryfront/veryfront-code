# ChatErrorBoundary

An error boundary for chat surfaces — catches **render** errors in its subtree and shows a resettable fallback. Paired with `useChatErrorHandler` for handler-level (non-render) errors.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented; the component exists today and the RFC keeps its signature (existing props kept, a11y contract applied). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatErrorBoundary } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatErrorBoundary
  fallback={(error, reset) => <MyErrorCard error={error} onRetry={reset} />}
  onError={reportToSentry}
>
  <Chat agentId="support-agent" api="/api/ag-ui" />   {/* the blast radius stops here */}
</ChatErrorBoundary>
```

Don't confuse the two error surfaces: **stream/session errors** (a failed completion) render inline via [`Chat.ErrorBanner`](./chat.md#chaterrorbanner) and never trip the boundary; the boundary catches **thrown render errors** — a bad custom part renderer, malformed message data.

## Default DOM (childless render)

While nothing has thrown, `ChatErrorBoundary` renders **children only — zero nodes of its own**. After a descendant throws (and no `fallback` prop is given), it renders the default fallback card from today's source:

```html
<div role="alert"                                          <!-- announced immediately by SRs (a11y contract) -->
     class="rounded-lg border border-[var(--destructive)]/20
            bg-[var(--destructive)]/5 p-6">                <!-- in-flow block card; fills whatever slot the
                                                                crashed subtree occupied — NOT an overlay -->
  <div class="flex items-start gap-4">                     <!-- horizontal row, top-aligned -->
    <div class="size-10 rounded-full flex items-center justify-center flex-shrink-0">
      <svg aria-hidden>⚠</svg>                             <!-- fixed 40px icon circle, never shrinks;
                                                                sits left of the text column -->
    </div>
    <div class="flex-1 min-w-0">                           <!-- text column: takes remaining width;
                                                                min-w-0 lets long messages wrap, not overflow -->
      <h3>An error occurred in the chat component</h3>     <!-- `errorMessage` prop overrides this heading -->
      <p class="mt-1.5">…error.message…</p>
      <button class="mt-4 rounded-full px-5 py-2.5">Try Again</button>
                                                           <!-- calls the boundary's reset(): clears state,
                                                                re-renders children -->
    </div>
  </div>
</div>
```

**Layout:** no node in the happy path; the error card is an in-flow block (icon fixed-left, text column flexible) that replaces the crashed subtree in place.

## Parts

### `ChatErrorBoundary`

A React error boundary (class component today). Default content: `children`, verbatim. **Render condition:** children until a descendant throws during render; then the `fallback` (function form receives `(error, reset)`), or the default card above when no fallback is given. `reset()` clears the caught error and re-renders children. Caught errors are also logged to the console and forwarded to `onError`.

**Layout:** none of its own — transparent wrapper; only the fallback occupies space, in-flow where the subtree was.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` *(required)* | `ReactNode` | — | The subtree to guard |
| `fallback?` | `ReactNode \| (error: Error, reset: () => void) => ReactNode` | default card | Your error UI; the function form gets the error and the reset action |
| `onError?` | `(error: Error, errorInfo: React.ErrorInfo) => void` | — | Reporting hook (fires from `componentDidCatch`) |
| `errorMessage?` | `string` | `"An error occurred in the chat component"` | Heading of the *default* fallback only |

All four props exist today and are **kept** (the RFC lists this component as signature-kept). Not on the convention row: as a boundary it renders no node of its own, so `asChild` / native-attr spread / `ref` don't apply to the boundary itself. The default fallback card is multi-node today; whether it gets reshaped onto the node contract (a composable fallback part) is TBD in implementation.

**State attributes:** none specified. Per the streaming a11y contract, errors render with `role="alert"` (the default card already does); decorative icons are `aria-hidden`.

## Hook: `useChatErrorHandler`

For errors that *don't* throw during render (async handlers, event callbacks) — boundaries can't catch those. Existing signature, kept:

```ts
const { error, handleError, clearError, hasError } = useChatErrorHandler()
// error: Error | null · handleError(err) stores + logs · clearError() · hasError: boolean
```

Local state, not context — each call site owns its own error; there is no provider.

## Examples

### Default

The `<Chat />` preset's composition handles *session* errors inline via `Chat.ErrorBanner`; wrap the preset to also contain *render* crashes:

```tsx
<ChatErrorBoundary>
  <Chat agentId="support-agent" api="/api/ag-ui" />
</ChatErrorBoundary>
```

### Composed (L2) — custom fallback, scoped blast radius

```tsx
<ChatErrorBoundary
  onError={(err, info) => track('chat_crash', { err })}
  fallback={(error, reset) => (
    <div role="alert" className="my-error-card">      {/* YOUR markup */}
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  )}
>
  <ChatRoot chat={chat}>
    <ChatMessageList />
    <ChatInput>
      <ChatInput.Field />
      <ChatInput.Submit />
    </ChatInput>
  </ChatRoot>
</ChatErrorBoundary>
```

### Headless (L3) — handler-level errors

```tsx
function MyErrorRegion() {
  const { error, hasError, clearError } = useChatErrorHandler()
  if (!hasError) return null
  return (
    <div role="alert" className="my-error">
      {String(error)}
      <button onClick={clearError}>Dismiss</button>
    </div>
  )
}
```

## Customization (eject path)

1. **L1** — session errors: `Chat.ErrorBanner` inside the default composition; wrap `<Chat>` in the boundary for render crashes.
2. **L2** — place `ChatErrorBoundary` where you want the blast radius to stop (per-panel, per-message-list, whole shell); own the UI via `fallback`.
3. **L3** — `useChatErrorHandler()` for non-render errors — your own markup, `role="alert"` per the a11y contract.

## Related

- [`Chat`](./chat.md) · [`ChatRoot`](./chat-root.md)
- [`useChatErrorHandler`](../hooks/use-chat-error-handler.md) · [`useChat`](../hooks/use-chat.md)
