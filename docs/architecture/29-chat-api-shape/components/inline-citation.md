# InlineCitation

An inline footnote marker with a hover card — the default renderer behind the markdown `components.citation` slot.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { InlineCitation } from 'veryfront/chat'
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`.

```tsx
<InlineCitation.Trigger />
<InlineCitation.Card />
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `InlineCitation.Trigger` | `<a>` | `data-open` | The inline marker. Default appearance: numbered pill. |
| `InlineCitation.Card` | `<div>` | `data-open` | The citation detail card, shown when open. |

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the node onto your own element. |
| …rest | native attributes of the node (`<a>` for `.Trigger`, `<div>` for `.Card`) | Spread onto the node — `className`, `data-*`, `aria-*`, handlers, `ref`. |

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-open` | present | The citation card is expanded. |

```css
[data-open].my-citation-trigger { background: var(--accent-3); }
```

## The `components.citation` slot

Inline citations are an override slot in the `Markdown` `components` map (the sanctioned multi-node exception). `Markdown` renders footnote markers from a message's source parts; `InlineCitation` is the **default** `components.citation` renderer — numbered pills. Replace it per surface:

```tsx
<Markdown components={{ citation: MyCitation }}>{text}</Markdown>
```

Because `Message.Text` is `Markdown`-backed, the same map reaches citations rendered inside messages.

## Examples

### Default

Nothing to wire — source parts in an assistant message render numbered pills inline via the default `components.citation` renderer.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

Restyle or retag the default parts inside your own citation renderer.

```tsx
function MyCitation(props) {
  return (
    <>
      <InlineCitation.Trigger className="my-citation-trigger" {...props} />
      <InlineCitation.Card className="my-citation-card" />
    </>
  )
}

<Markdown components={{ citation: MyCitation }}>{text}</Markdown>
```

`asChild` when your own element should be the marker:

```tsx
<InlineCitation.Trigger asChild>
  <sup className="my-marker">1</sup>
</InlineCitation.Trigger>
```

### Headless (L3)

Skip the component entirely: supply your own `components.citation` renderer and pull the citation data from the message's source parts.

```tsx
const { sources } = useSources(message)

<Markdown components={{ citation: (props) => <a className="anything" {...props} /> }}>
  {text}
</Markdown>
```

## Customization (eject path)

1. **L1:** the default numbered pills come from the public composition — no wiring.
2. **L2:** override `components.citation` with your own composition of `InlineCitation.*`; swap nodes via `asChild`.
3. **L3:** a fully custom `components.citation` renderer over `useSources` / `extractSourcesFromParts`.

## Related

- [`useSources`](../hooks/use-sources.md) — the source parts behind citations
- [Sources](./sources.md) — the per-message citation list
- [Message](./message.md) — `Message.Text` is `Markdown`-backed, so the map reaches it
