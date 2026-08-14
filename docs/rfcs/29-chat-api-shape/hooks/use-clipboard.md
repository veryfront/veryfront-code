# useClipboard

Copies a string to the clipboard and reports transient "copied" feedback.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useClipboard`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> **✂ Earns-its-place flag** (see [proposed v1 scope cuts](../../29-chat-api-shape.md)): this is a generic browser util (already shared with the code-block copy button), not a chat hook - **proposed** to reposition as a generic util or fold into `useMessageContext.copy`. The signature reshape vs today is disclosed in the `changed` note under Signature below.

## Import

```tsx
import { useClipboard } from "veryfront/chat";
```

## Signature

```ts
function useClipboard(text: string): UseClipboardResult;

interface UseClipboardResult {
  copied: boolean;
  copy: () => void;
}
```

> **`changed`** vs today: the implemented hook is `useClipboard(timeout = 2000)`
> returning `{ copied, copy: (text) => Promise<void> }`. This page proposes
> binding the text at the hook instead (`useClipboard(text)` →
> `copy: () => void`), with the feedback timeout becoming an internal constant.
> A breaking reshape - to batch in the breaking-changes ledger if accepted.

## Options

| Option | Type     | Default | Description                                 |
| ------ | -------- | ------- | ------------------------------------------- |
| `text` | `string` | -       | The string to copy when `copy()` is called. |

## Returns

### State

| Name     | Type      | Description                                                                                                                                                                             |
| -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copied` | `boolean` | `true` transiently after a successful copy. Copy buttons mirror this as `data-copied` - style the feedback with CSS, never a `.Copied` sub-component (deleted from `MessageActionBar`). |

### Actions

| Name   | Type         | Description                                     |
| ------ | ------------ | ----------------------------------------------- |
| `copy` | `() => void` | Write `text` to the clipboard and set `copied`. |

### Prop getters

None. Wire `copy` to your own button.

## Example

```tsx
function MyCopyButton({ text }: { text: string }) {
  const { copied, copy } = useClipboard(text);
  return (
    <button
      onClick={copy}
      data-copied={copied || undefined}
      className="my-copy [&[data-copied]]:text-green-600"
      aria-label="Copy message"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
```

## Used by

- [`Message`](../components/message.md) - `.CopyAction` (`data-copied`); `useMessageContext` exposes the same `copy`/`copied` pair pre-bound to the message's `textContent`.
- [`MessageActionBar`](../components/message-action-bar.md) - re-export of the `Message.Actions` family.

## Related

- [`useMessageContext`](use-message-context.md) - message-bound `copy` / `copied`.
- Helper: `getTextContent(msg)` - the flat text you typically pass in.
