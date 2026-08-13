# useChatInputContext

Reads the scoped composer state provided by the nearest `ChatInput` (via `ChatInputContextProvider`).

> **Status: RFC 29 - partly landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useChatInputContext`, `useChatInputContextOptional`, `ChatInputContextProvider`, `ChatInputContextValue`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Landed so far

### `useChatInputContext` - `new` - `shipped` (src/react/components/chat/chat/contexts/composer-context.tsx:83)

The naming half of the RFC's "the word Composer is banned" decision has landed: `useChatInputContext`, `useChatInputContextOptional`, and `ChatInputContextProvider` are real exports of `veryfront/chat`, and the raw context object stays unexported as the providers rule requires.

**Still proposed:** the retirement itself. `useComposerContext`, `useComposerContextOptional`, and `ComposerContextProvider` remain exported as `@deprecated` aliases pointing at the same functions, so the old names have not gone away - that removal is batched into the one breaking release. The **returned shape** is also still the old `ComposerContextValue` (`input`, `isLoading`, `onSubmit`, …), not the `UseChatInputResult` documented below; see [`useChatInput`](./use-chat-input.md) for exactly which members are real.

## Import

```tsx
import { useChatInputContext, useChatInputContextOptional } from "veryfront/chat";
```

## Signature

```ts
function useChatInputContext(): UseChatInputResult;
function useChatInputContextOptional(): UseChatInputResult | null;
```

Returns the same object as [`useChatInput`](./use-chat-input.md) - state, actions, and prop getters - from the nearest `ChatInputContextProvider` (rendered by `ChatInput.Root`). Per the providers rule, every `use*Context` hook has an `Optional` variant; the raw context object stays unexported.

## Options

None.

## Returns

The full `UseChatInputResult` of the enclosing composer:

- **State:** `value` · `canSubmit` · `status` · `isStreaming` · `attachments` · `isListening`
- **Actions:** `submit` · `stop` · `clear` · `attach(files)`
- **Prop getters:** `getFormProps` · `getFieldProps` · `getSubmitProps` · `getAttachProps` · `getVoiceProps` · `getDropTargetProps`

See [`useChatInput`](./use-chat-input.md) for the full tables.

## Scoping

A `<ChatInput>` shares state with _its_ children only - this is scoped context, not an app-wide store. When composers nest (a `ChatInput` inside a `Message` is the edit form), the **nearest provider wins**.

## Example

A custom leaf inside a `<ChatInput>` - behavior from context, markup yours:

```tsx
function CharCount(props: React.HTMLAttributes<HTMLSpanElement>) {
  const chatInput = useChatInputContext();
  return <span {...props}>{chatInput.value.length}</span>;
}

function ClearButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const chatInput = useChatInputContext();
  return (
    <button type="button" className={className} {...props} onClick={chatInput.clear}>
      Clear
    </button>
  );
}

<ChatInput chat={chat}>
  <ChatInput.Field />
  <CharCount className="my-count" />
  <ClearButton />
  <ChatInput.Submit />
</ChatInput>;
```

This is exactly how the built-in leaves are implemented - for example, `ChatInput.Submit` reads `useChatInputContext()` and passes your props into `getSubmitProps`.

## Used by

- Every `ChatInput` sub-part (`.Field`, `.Attach`, `.Model`, `.Voice`, `.Submit`, `.Send`, `.Stop`, `.Export`, `.Toolbar`)
- Your own custom leaves rendered inside a `<ChatInput>`

## Related

- [`useChatInput`](./use-chat-input.md) - creates the state this hook reads
- [`ChatInput`](../components/chat-input.md) - provides the context via `ChatInputContextProvider`
