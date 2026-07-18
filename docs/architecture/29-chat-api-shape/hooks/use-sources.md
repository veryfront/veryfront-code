# useSources

The citation list for a message, derived from its source parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useSources } from 'veryfront/chat'
// pure primitive underneath:
import { extractSourcesFromParts } from 'veryfront/chat'
```

## Signature

```ts
function useSources(message?: ChatMessage): UseSourcesResult

interface UseSourcesResult {
  sources: Source[]
  isEmpty: boolean
}

// The pure primitive under the hook — no React, no context.
function extractSourcesFromParts(parts: ChatMessage['parts']): Source[]
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `message` | `ChatMessage` | nearest `Message` context | Explicit at L3; from context at L2. Context precedence: explicit prop > nearest context > default. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `sources` | `Source[]` | Citation list extracted from the message's source parts (`extractSourcesFromParts`). |
| `isEmpty` | `boolean` | No sources (mirrored as `data-empty` on `Sources.Root` / `Message.Sources`). |

### Actions

None — the hook is a pure derivation over the message's parts.

### Prop getters

None. `Sources.Pill` is a display-only leaf (`<a>`); hook state plus your own elements suffice.

## Example

```tsx
function MySources({ message }: { message: ChatMessage }) {
  const { sources, isEmpty } = useSources(message)   // explicit at L3
  if (isEmpty) return null
  return (
    <section className="my-sources" aria-label="Sources">
      <ul className="my-source-list">
        {sources.map((source, i) => (
          <li key={i}>
            <a href={source.url} className="my-pill">
              {i + 1}. {source.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

## Used by

- [`Sources`](../components/sources.md) — `.Root` (`data-open`, `data-empty`) · `.List` · `.Pill`. Also available as `Message.Sources` (same component, namespace re-export).
- [`InlineCitation`](../components/inline-citation.md) — footnote markers rendered from the same source parts via the markdown `components.citation` slot.

## Related

- [`useMessageParts`](use-message-parts.md) — the full typed part list.
- [`useMessageContext`](use-message-context.md) — the in-context message.
- Helper: `extractSourcesFromParts(parts)`.
