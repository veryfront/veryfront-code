# useChatErrorHandler

Error state and handlers for chat surfaces — the hook behind `ChatErrorBoundary`. Existing signature, kept.

> **Status: proposed (RFC).** This page documents the _proposed_ API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatErrorHandler } from "veryfront/chat";
```

## Signature

```ts
function useChatErrorHandler(): {
  error: Error | null;
  handleError: (error: unknown) => void;
  clearError: () => void;
  hasError: boolean;
};
```

The RFC keeps the **existing member names** and pins the public error type to `Error | null`; unknown inputs are normalized before storage.

## Options

None specified in the RFC.

## Returns

### State

| Name       | Type            | Description                 |
| ---------- | --------------- | --------------------------- |
| `error`    | `Error \| null` | The current error           |
| `hasError` | `boolean`       | Whether an error is present |

### Actions

| Name          | Description            |
| ------------- | ---------------------- |
| `handleError` | Handle/record an error |
| `clearError`  | Clear the error state  |

### Prop getters

None.

### A11y

Per the streaming a11y contract, errors render with **`role="alert"`**; decorative icons/shimmer are `aria-hidden`. Your markup should follow the same rule.

## Example

```tsx
function MyErrorBanner() {
  const { error, hasError, clearError } = useChatErrorHandler();
  if (!hasError) return null;
  return (
    <div role="alert" className="my-error">
      {String(error)}
      <button onClick={clearError}>Dismiss</button>
    </div>
  );
}
```

## Used by

- [`ChatErrorBoundary`](../components/chat-error-boundary.md)
- [`Chat`](../components/chat.md) — error display (`Chat.ErrorBanner`) in the L1 default composition

## Related

- [`useChat`](./use-chat.md) — session-level `error` and per-message `status`/`error`
- [`ChatErrorBoundary`](../components/chat-error-boundary.md)
