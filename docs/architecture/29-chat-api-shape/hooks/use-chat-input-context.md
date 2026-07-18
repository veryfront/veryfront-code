# useChatInputContext

Reads the scoped composer state provided by the nearest `ChatInput` (via `ChatInputContextProvider`).

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatInputContext, useChatInputContextOptional } from 'veryfront/chat'
```

## Signature

```ts
function useChatInputContext(): UseChatInputResult
function useChatInputContextOptional(): UseChatInputResult | null
```

Returns the same object as [`useChatInput`](./use-chat-input.md) — state, actions, and prop getters — from the nearest `ChatInputContextProvider` (rendered by `ChatInput.Root`). Per the providers rule, every `use*Context` hook has an `Optional` variant; the raw context object stays unexported.

## Options

None.

## Returns

The full `UseChatInputResult` of the enclosing composer:

- **State:** `value` · `canSubmit` · `status` · `isStreaming` · `attachments` · `isListening`
- **Actions:** `submit` · `stop` · `clear` · `attach(files)`
- **Prop getters:** `getFormProps` · `getFieldProps` · `getSubmitProps` · `getAttachProps` · `getVoiceProps` · `getDropTargetProps`

See [`useChatInput`](./use-chat-input.md) for the full tables.

## Scoping

A `<ChatInput>` shares state with *its* children only — this is scoped context, not an app-wide store. When composers nest (a `ChatInput` inside a `Message` is the edit form), the **nearest provider wins**.

## Example

A custom leaf inside a `<ChatInput>` — behavior from context, markup yours:

```tsx
function CharCount(props: React.HTMLAttributes<HTMLSpanElement>) {
  const chatInput = useChatInputContext()
  return <span {...props}>{chatInput.value.length}</span>
}

function ClearButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const chatInput = useChatInputContext()
  return (
    <button type="button" className={className} {...props} onClick={chatInput.clear}>
      Clear
    </button>
  )
}

<ChatInput chat={chat}>
  <ChatInput.Field />
  <CharCount className="my-count" />
  <ClearButton />
  <ChatInput.Submit />
</ChatInput>
```

This is exactly how the built-in leaves are implemented — for example, `ChatInput.Submit` reads `useChatInputContext()` and passes your props into `getSubmitProps`.

## Used by

- Every `ChatInput` sub-part (`.Field`, `.Attach`, `.Model`, `.Voice`, `.Submit`, `.Send`, `.Stop`, `.Export`, `.Toolbar`)
- Your own custom leaves rendered inside a `<ChatInput>`

## Related

- [`useChatInput`](./use-chat-input.md) — creates the state this hook reads
- [`ChatInput`](../components/chat-input.md) — provides the context via `ChatInputContextProvider`
