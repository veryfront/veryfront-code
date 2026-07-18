# useConversationChat

`useChat` bound to a `ConversationsProvider`'s active thread — seeds from and persists to the active conversation, and tells you when it's `ready`.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useConversationChat } from 'veryfront/chat'
```

## Signature

```ts
function useConversationChat(options: {
  agentId?: string
  api?: string | { url, headers, credentials, fetch, body }
  // Further options: TBD in implementation (the RFC lists `{ agentId?, api?, … }`).
}): {
  chat: UseChatResult
  bound: …            // TBD in implementation
  resolvedAgentId: …  // the agent the session resolved to
  ready: boolean      // thread is seeded and safe to use
}
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `agentId?` | `string` | Agent for the session |
| `api?` | `string \| transport object` | Endpoint or transport (same shape as [`useChat`](./use-chat.md)) |

Additional options exist in the RFC's `…` — TBD in implementation.

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `chat` | `UseChatResult` | The bound session — pass to `ChatRoot`, `ChatInput`, `useChatInput`, … |
| `bound` | TBD | RFC names it; type/semantics TBD in implementation |
| `resolvedAgentId` | TBD | The resolved agent id |
| `ready` | `boolean` | Replaces every userland thread-ready guard (#2978) — consumers never write their own |

### Actions

None beyond those on `chat`.

### Prop getters

None.

### Behavior

- **Seed + persist:** the session is seeded from the `ConversationsProvider`'s active thread and persists back to it (replaces the userland `usePersistMessages` effect).
- **Streams are provider-scoped:** keyed by conversation id — switching threads neither aborts nor orphans an in-flight stream, and it persists to the correct thread.

## Example

```tsx
function App() {
  return (
    <ConversationsProvider storageKey="ops">
      <Workspace />
    </ConversationsProvider>
  )
}

function Workspace() {
  const { chat, ready } = useConversationChat({ agentId: 'support-agent', api: '/api/ag-ui' })
  return (
    <ChatRoot chat={chat}>
      <ChatMessageList />
      <ChatInput>
        <ChatInput.Field placeholder="Ask…" />
        <ChatInput.Submit />
      </ChatInput>
    </ChatRoot>
  )
}
```

## Used by

- [`Chat`](../components/chat.md) — the L1 preset runs the session hooks internally
- Any L2/L3 composition that pairs conversations with a chat session

## Related

- [`useChat`](./use-chat.md) — the unbound base hook
- [`useChatContext`](./use-chat-context.md)
- `useConversations` / `ConversationsProvider` — thread list, `activeReady`, `selectAgent`
