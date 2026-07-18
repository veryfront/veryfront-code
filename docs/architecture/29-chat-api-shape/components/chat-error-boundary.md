# ChatErrorBoundary

An error boundary for chat surfaces — catches render errors and exposes them through `useChatErrorHandler`.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatErrorBoundary } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatErrorBoundary>
  <Chat agentId="support-agent" api="/api/ag-ui" />
</ChatErrorBoundary>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatErrorBoundary` | children (fallback rendering TBD in implementation) | — | Error boundary; paired hook is [`useChatErrorHandler`](../hooks/use-chat-error-handler.md) |

Per the streaming a11y contract, **errors render with `role="alert"`**; decorative icons/shimmer are `aria-hidden`.

## Props

The RFC specifies the component and its hook; the boundary's own props (fallback, reset behavior) are TBD in implementation.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | The subtree to guard |

## State attributes

None specified in the RFC.

## Examples

### Default

The `<Chat />` preset's public default composition includes error handling — `Chat.ErrorBanner` displays session errors:

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

Wrap your own composition:

```tsx
<ChatErrorBoundary>
  <ChatRoot chat={chat}>
    <ChatMessageList />
    <ChatInput>
      <ChatInput.Field />
      <ChatInput.Submit />
    </ChatInput>
  </ChatRoot>
</ChatErrorBoundary>
```

### Headless (L3)

Handle errors with the hook and render your own alert (existing signature, kept):

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

## Customization

- **L1 appearance:** error display inside the `<Chat />` default composition (`Chat.ErrorBanner`).
- **L2 composition:** place `ChatErrorBoundary` where you want the blast radius to stop.
- **L3 hook:** `useChatErrorHandler()` — your own markup, `role="alert"` per the a11y contract.

## Related

- [`Chat`](./chat.md) · [`ChatRoot`](./chat-root.md)
- [`useChatErrorHandler`](../hooks/use-chat-error-handler.md) · [`useChat`](../hooks/use-chat.md)
