# useChatErrorHandler

Error state and handlers for chat surfaces - the hook behind `ChatErrorBoundary`. Existing signature, kept.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useChatErrorHandler`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> **✂ Earns-its-place flag** (see [proposed v1 scope cuts](../../29-chat-api-shape.md)): nothing chat-specific - a bare `{ error, handleError, clearError, hasError }` error-state hook. **Proposed:** move to `veryfront/ui` as a generic `useErrorHandler` rather than ship it as chat API.

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
- [`Chat`](../components/chat.md) - error display (`Chat.ErrorBanner`) in the L1 default composition

## Related

- [`useChat`](./use-chat.md) - session-level `error` and per-message `status`/`error`
- [`ChatErrorBoundary`](../components/chat-error-boundary.md)
