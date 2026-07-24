# InlineCitation

An inline footnote marker with a hover card — the default renderer behind the markdown `components.citation` slot. Render it whole, or compose the parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { InlineCitation } from 'veryfront/chat'
// every sub-part is also a flat named export (same function), with its props type:
import { InlineCitation, InlineCitationTrigger, type InlineCitationTriggerProps } from 'veryfront/chat'
```

## Parts index

- [`InlineCitation` (Root)](#inlinecitation-root--kept) — `kept`
- [`.Trigger`](#inlinecitationtrigger--changed) — `changed`: `<button>` + span wrapper → `<a>`; `data-open` added
- [`.Card`](#inlinecitationcard--changed) — `changed`: `data-open` added (today open state = mounted)

## Anatomy

```tsx
<InlineCitation index={i} source={source}>   {/* Root: context only — renders NO node of its own */}
  <InlineCitation.Trigger />                 {/* superscript numbered pill; hover opens the card */}
  <InlineCitation.Card />                    {/* fixed-position hover card; null while closed */}
</InlineCitation>
```

`<InlineCitation index={i} source={source} />` with **no children renders exactly this default anatomy** (`Trigger` + `Card`).

## Default DOM (childless render)

The actual HTML of `<InlineCitation index={1} source={source} />` today, with the card open (classes abbreviated to layout-relevant ones):

```html
<!-- .Root renders no element — it is a context provider only -->

<span class="relative inline-block">                              <!-- Trigger wrapper — inline, flows with the surrounding text -->
  <button class="inline-flex items-center justify-center size-[15px] rounded-full border
                 align-super -translate-y-px ml-0.5">             <!-- .Trigger — 15px superscript pill, nudged up 1px -->
    2                                                             <!--   default content: index + 1 -->
  </button>
</span>

<div style="position: fixed; left: …px; bottom: …px; z-index: 9999"  <!-- .Card — FIXED to the VIEWPORT (not the trigger wrapper): -->
     class="w-80">                                                    <!-- horizontally centered on the trigger, clamped ≥8px from the -->
                                                                      <!-- viewport edges, bottom = 8px above the trigger's top. -->
                                                                      <!-- PRESENT ONLY while open AND a source exists. -->
  <div class="rounded-lg bg-popover p-3.5 shadow-sm">
    <p class="text-sm font-medium line-clamp-2">…title…</p>
    <p class="text-[10px] truncate mt-1 flex items-center gap-1">     <!-- url row — ONLY when source.url; external-link icon + url, truncates -->
      <svg class="size-2.5 shrink-0" /> https://…
    </p>
    <div class="mt-2.5 border-l-2 pl-3">                              <!-- snippet quote — ONLY when source.snippet -->
      <p class="text-xs line-clamp-4 italic">…snippet…</p>
    </div>
    <div class="mt-2.5 flex items-center gap-2">                      <!-- relevance row — ONLY when source.score != null -->
      <span class="text-[10px] shrink-0">Relevance</span>
      <div class="flex-1 h-1 rounded-full overflow-hidden">           <!-- meter track: grows to fill the row -->
        <div class="h-full rounded-full" style="width: 72%"></div>    <!-- fill: emerald ≥0.7 · amber ≥0.4 · neutral below -->
      </div>
      <span class="text-[10px] tabular-nums">72%</span>
    </div>
  </div>
</div>
```

Hover mechanics today: entering the trigger opens the card after a **150ms delay**; leaving either the trigger or the card closes it after **100ms** (so the mouse can travel between them). Clicking the trigger fires `onClick(index)`. The card measures itself, then centers over the trigger and clamps to the viewport.

## Parts

### `InlineCitation` (Root) — `kept`

The compound's scoped context — **renders no node of its own**; children (or the default `Trigger` + `Card`) render in place. Owns the hover open/close timers and the card positioning math.

**Layout:** none — contributes no element; the trigger flows inline with the text where the root is placed.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `index` *(required)* | `number` | — | Zero-based; the trigger shows `index + 1` and `onClick` receives it. |
| `source` | `Source` | — | `{ title, url?, score?, snippet? }` — drives the card. **The card never renders without it.** |
| `onClick` | `(index: number) => void` | — | Fired when the trigger is clicked (unless the click was `defaultPrevented`). |
| `className` | `string` | — | Today this is forwarded to the **trigger** (not a root node — there isn't one). |
| `children` | `ReactNode` | default anatomy | Compose the trigger and hover card. |

**State attributes (proposed):**

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-open` | present | The citation card is expanded — on `.Trigger` and `.Card`. Today open state is expressed only by mounting/unmounting the card. |

```css
[data-open].my-citation-trigger { background: var(--accent-3); }
```

### `InlineCitation.Trigger` — `changed`

The inline marker. Today a `<button>` inside a `relative inline-block` `<span>` wrapper; **proposed `<a>`** — a citation is a link to its source, so the marker gets native anchor semantics (and the wrapper span is deleted). Default content: the number `index + 1` in a 15px round superscript pill (`align-super`, nudged up 1px, left margin so it hugs the preceding word). Always renders. Hovering starts the card's 150ms open timer; leaving starts the 100ms close timer; clicking calls the root's `onClick(index)` after your own `onClick`, unless you `preventDefault()`.

**Layout:** inline-flex pill that flows with the surrounding text (superscript alignment); the `<a>` is the only node in the proposed shape (today's wrapper span never positioned the card anyway — see `.Card`).

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replaces the default number. |
| `asChild` *(proposed)* + native (`ButtonHTMLAttributes` today, `AnchorHTMLAttributes` proposed) + `ref` | | Own the node; your `onClick`/`onMouseEnter`/`onMouseLeave` compose with (don't replace) the hover/click behavior. |

### `InlineCitation.Card` — `changed`

*Changed: a `data-open` state attribute is added (today open state is expressed only by mounting/unmounting) and `asChild` opens up; the render gating itself is unchanged.*

The hover card, one `<div>`. Default content: source title (2-line clamp) → url row with external-link icon (only when `url`) → snippet as an italic left-bordered quote, 4-line clamp (only when `snippet`) → a "Relevance" meter row with percentage (only when `score != null`; fill color emerald ≥ 0.7, amber ≥ 0.4, neutral below). **Renders `null` unless the card is open *and* a `source` was provided** — safe to include unconditionally. Hovering the card itself keeps it open (re-arms the show timer); leaving closes it after 100ms.

**Layout:** absolute overlay — `position: fixed` against the **viewport**, `z-index: 9999`, 320px wide; horizontally centered over the trigger and clamped 8px inside the viewport edges; anchored 8px above the trigger's top (always opens upward today).

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replaces the default card body (title/url/snippet/relevance). |
| `style` | `CSSProperties` | Merged **over** the computed positioning style — you can override the placement. |
| `asChild` *(proposed)* + native (`HTMLAttributes<HTMLDivElement>`) + `ref` | | Own the node. |

## Context (what the parts read)

Today the context hook is **private** (`useInlineCitation` is not exported); parts throw when used outside an `InlineCitation`. Its value:

```ts
{
  index: number
  source?: Source
  onCitationClick?: (index: number) => void
  cardVisible: boolean
  cardStyle: React.CSSProperties   // the computed fixed position
  show: () => void                 // 150ms-delayed open
  hide: () => void                 // 100ms-delayed close
  setTriggerRef / setCardRef       // anchor + measurement plumbing
}
```

**TBD:** whether the RFC exports a public `useInlineCitation()` (for L3 markers) or keeps L3 on `useSources` + a fully custom `components.citation` renderer, as the examples below assume.

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

Restyle or retag the default parts inside your own citation renderer. `Markdown` wraps custom `components.citation` renderers in the `InlineCitation` root context, so `.Trigger` / `.Card` work bare inside one; standalone use (outside the citation slot) requires the Root.

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
