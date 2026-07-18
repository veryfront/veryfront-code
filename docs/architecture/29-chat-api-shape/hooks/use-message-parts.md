# useMessageParts

Returns a message's parts as typed, ordered groups — the data behind `Message.Parts`.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useMessageParts } from 'veryfront/chat'
// pure primitive underneath, exported for L3:
import { groupPartsInOrder } from 'veryfront/chat'
```

## Signature

```ts
function useMessageParts<TMessage extends ChatMessage = ChatMessage>(
  message?: TMessage
): PartGroup<TMessage>[]

// The pure primitive under the hook — no React, no context.
function groupPartsInOrder(parts: ChatMessage['parts']): PartGroup[]
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `message` | `TMessage` | nearest `Message` context | Explicit message at L3. Context precedence applies: explicit prop > nearest context > default. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| *(return value)* | `PartGroup<TMessage>[]` | Adjacent parts grouped in order, typed. `ChatMessage<TMetadata, TDataParts, TTools>` generics flow through from `useChat<TMessage>`, so custom data parts and tool parts arrive narrowed. |

### Actions

None — the hook is a pure derivation over the message's parts.

### Prop getters

None. You iterate the groups and render your own elements; use the part type guards (`isToolPart`, `isReasoningPart`, `isSkillToolPart`) to switch.

## Example

```tsx
function MyMessageBody({ message }: { message: ChatMessage }) {
  const groups = useMessageParts(message)   // explicit at L3
  return (
    <div className="my-body">
      {groups.map((group, i) =>
        group.parts.map((part, j) =>
          isToolPart(part)      ? <MyToolCard key={`${i}-${j}`} part={part} /> :
          isReasoningPart(part) ? <MyReasoning key={`${i}-${j}`} part={part} /> :
                                  <MyText key={`${i}-${j}`} part={part} />
        )
      )}
    </div>
  )
}
```

At L2 the same data drives `Message.Parts` (a render-fn iterator, no node) — resolution order for part rendering is inline render fn → `tools` registry by name → default renderer.

## Used by

- [`Message`](../components/message.md) — `.Parts` is the render-fn iterator over this hook; `.Text`, `.Reasoning`, `.Source`, `.File`, `.Image` are the per-part leaves.

## Related

- [`useMessageContext`](use-message-context.md) — also exposes `parts` for the in-context message.
- [`useToolCall`](use-tool-call.md) — tool part state once you have a tool part.
- [`useSources`](use-sources.md) — citation list derived from parts.
- Helpers: `groupPartsInOrder`, `isToolPart`, `isReasoningPart`, `isSkillToolPart`, `getTextContent`.
