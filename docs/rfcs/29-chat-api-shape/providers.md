# Providers

Scoped context providers - every one renders zero DOM nodes.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `ConversationsProvider`, `ChatContextProvider`, `ChatInputContextProvider`, `MessageContextProvider`, `ConversationsContextProvider`, `useChatContextOptional`, `useChatInputContextOptional`, `useMessageContextOptional`, `useConversationsContextOptional`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](./README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../29-chat-api-shape.md).

## The provider contract

- **Providers render zero nodes.** A provider contributes context, never markup. (`ChatRoot` can opt into a node via `asChild`, and only then.)
- **Raw context objects stay unexported.** You read context through the matching `use*Context` hook, never `useContext(SomeExportedContext)`.
- **Every `use*Context` has an `Optional` variant** - e.g. `useChatContextOptional` - which returns instead of throwing when no provider is present. **Library-wide convention: every `use*ContextOptional` returns `null` outside its provider - never `undefined`.**
- **Precedence is uniform everywhere:** explicit prop > nearest context > default.

Context is **scoped, not app-wide magic**: a `<ChatInput>` shares state with _its_ children only; nothing is a global store the whole tree reads implicitly. Nested providers follow nearest-provider-wins - this is what lets a `ChatInput` rendered _inside_ a `Message` become that message's edit composer.

## Reference

| Provider                   | Provided via                              | Read with                                                                       | Scope                                                   |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ConversationsProvider`    | rendered directly                         | [`useConversationsContext`](./hooks/use-conversations-context.md) (`…Optional`) | Conversation list, active thread, thread-keyed streams. |
| `ChatContextProvider`      | [`ChatRoot`](./components/chat-root.md)   | [`useChatContext`](./hooks/use-chat-context.md) (`…Optional`)                   | The shared chat session (`chat={useChat()}`).           |
| `ChatInputContextProvider` | [`ChatInput`](./components/chat-input.md) | [`useChatInputContext`](./hooks/use-chat-input-context.md) (`…Optional`)        | Composer state for _its_ children only.                 |
| `MessageContextProvider`   | [`Message`](./components/message.md)      | [`useMessageContext`](./hooks/use-message-context.md) (`…Optional`)             | One message row: message, role, streaming, editing.     |
| `ColorModeProvider`        | rendered directly (from `veryfront/ui`)   | [`useColorMode`](./hooks/consumed-from-ui.md)                                   | Color mode.                                             |

`ChatContextProvider`, `ChatInputContextProvider`, and `MessageContextProvider` are not components you normally render yourself - they are provided _via_ `ChatRoot`, `ChatInput`, and `Message` respectively. `ConversationsProvider` and `ColorModeProvider` are rendered directly at the top of your tree.

## Precedence in practice

```tsx
<ChatRoot chat={chat}>
  {/* reads the ChatRoot context… */}
  <ChatInput>…</ChatInput>

  {/* …unless a prop is passed explicitly - prop wins over nearest context */}
  <ChatInput chat={otherChat}>…</ChatInput>
</ChatRoot>;
```

Root context is **opt-in (Layer 2), never required** - every component also accepts its dependencies as explicit props, and config lives on the leaf that uses it.
