# Sources

The citation list for a message, extracted from its source parts. Render it whole, or compose the parts.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `Sources`, `Sources.List`, `Sources.Pill`, `Sources.Root`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`Sources` is the same component as `Message.Sources` - a namespace re-export for use outside a `Message`, never a parallel implementation. `Message.*` is canonical. The children contract is the same on both names: node children recompose via `Sources.List` / `Sources.Pill` (as documented here), and a **function child** - `(source, index) => ReactNode` - maps each source, as documented on [`Message.Sources`](./message.md).

## Import

```tsx
import { Sources } from "veryfront/chat";
// every sub-part is also a flat named export (same function), with its props type:
import { Sources, SourcesPill, type SourcesPillProps } from "veryfront/chat";
```

## Parts index

- [`.Root`](#sourcesroot---changed) - `changed`: `renderItem` deleted; no `data-open` (the row has no disclosure); empty collections mount with `data-empty`
- [`.List`](#sourceslist---changed) - `changed`: `<div>` → `<ul>`; `renderItem` deleted
- [`.Pill`](#sourcespill---changed) - `changed`: `<button>` → `<a>`

## Anatomy

```tsx
<Sources.Root sources={sources}>
  <Sources.List>
    {/* flex-wrap row; proposed <ul> */}
    <Sources.Pill /> {/* number badge · truncated title · score dot · hover snippet preview */}
  </Sources.List>
</Sources.Root>;
```

`<Sources sources={…}>` with **no children renders exactly this default anatomy**: a wrapping row with one `Sources.Pill` per source. Pass children to recompose.

The `Source` shape the whole family consumes:

```ts
interface Source {
  title: string;
  url?: string;
  score?: number; // 0-1 relevance
  snippet?: string;
}
```

## Default DOM (childless render)

The actual HTML of `<Sources sources={…} />` today (classes abbreviated to layout-relevant ones):

```html
<div class="mt-1">
  <!-- .Root - in-flow block; NOT RENDERED AT ALL when sources is empty -->
  <div class="flex flex-wrap gap-2">
    <!-- .List - flex row that wraps; one pill per source -->
    <span class="relative">
      <!-- .Pill wrapper - inline positioning context for the preview -->
      <button
        class="inline-flex max-w-full items-center gap-1 rounded-full border py-1 pl-1 pr-2 text-xs"
      >
        <span class="flex size-4 shrink-0 rounded-full border">1</span>
        <!-- number badge: fixed 16px circle, never shrinks -->
        <span class="ml-0.5 max-w-[150px] truncate">Docs - Billing</span>
        <!-- title: capped at 150px, truncates -->
        <span class="ml-0.5 flex shrink-0 items-center gap-1">
          <!-- ONLY when source.score != null -->
          <span class="size-1.5 rounded-full bg-emerald-500"></span>
          <!-- score dot: emerald ≥0.7 · amber ≥0.4 · neutral below -->
        </span>
      </button>
      <div class="absolute bottom-full left-0 mb-2 z-50 w-64 pointer-events-none">
        <!-- hover preview - ABSOLUTE, anchored ABOVE the pill -->
        <div class="rounded-lg border bg-popover px-3 py-2 shadow-md">
          <!-- (relative to the .Pill wrapper span); REVEALED ON HOVER, -->
          <p class="text-xs line-clamp-3">…snippet…</p>
          <!-- and ONLY when source.snippet exists -->
        </div>
      </div>
    </span>
    <!-- …more pills… -->
  </div>
</div>
```

The only absolutely-positioned element is the hover preview: `bottom-full left-0` pins it above and left-aligned to its own pill's `relative` wrapper; `pointer-events-none` keeps it from stealing the mouse.

## Parts

### `Sources.Root` - `changed`

Changed: `renderItem` is deleted (compose `Sources.Pill` children instead), and empty collections mount with `data-empty` instead of rendering `null`.

The container (one `<div>`) + the compound's scoped context. The source list enters here; sub-parts read it from context.

**Layout:** in-flow block (`mt-1`); no positioning context of its own.

| Prop                                    | Type                                           | Default | Description                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources` _(required at L2 standalone)_ | `Source[]`                                     | -       | The citation list. Inside a `Message`, the list comes from message context instead (`useSources(message?)` - explicit prop > nearest context). |
| `onSourceClick`                         | `(source: Source, index: number) => void`      | -       | Click handler passed to every default `Sources.Pill`; without it pills render `cursor-default` and do nothing on click.                        |
| ~~`renderItem`~~                        | `({ item, index }) => ReactNode`               | -       | **Removed.** The RFC kills render-prop config (`renderItem`/`renderMessage`/…) - compose `Sources.Pill` children instead.                      |
| `asChild` _(proposed)_                  | `boolean`                                      | `false` | Merge the root node onto your own element.                                                                                                     |
| + native                                | `React.HTMLAttributes<HTMLDivElement>` · `ref` | -       | Spread onto the single node; `className` merges.                                                                                               |

**Empty behavior:** today the root **renders `null` when `sources.length === 0`**. The RFC changes `Sources.Root` and `Message.Sources` to mount an empty node with `data-empty`; style it away when no visual placeholder is wanted.

**State attributes (proposed):**

| Attribute    | Values  | Meaning                                  |
| ------------ | ------- | ---------------------------------------- |
| `data-empty` | present | Zero sources (see empty behavior above). |

`Sources.Root` carries **no `data-open`** - the row is always fully visible and has no disclosure.

```css
[data-empty] {
  display: none;
}
```

### `Sources.List` - `changed`

The row itself. Today a `<div>`; **proposed `<ul>`**. Default content: one `Sources.Pill` per source (keyed `title-index`), each wired to the root's `onSourceClick`. Always renders when the root does.

**Layout:** in-flow flex row that wraps (`flex flex-wrap gap-2`); pills flow like inline chips.

| Prop                                    | Type                             | Description                                                             |
| --------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `children`                              | `ReactNode`                      | Replaces the default pill mapping (read `sources` from `useSources()`). |
| ~~`renderItem`~~                        | `({ item, index }) => ReactNode` | **Removed** - same rule as on the root.                                 |
| `asChild` + native + `ref` _(proposed)_ |                                  | Own the node.                                                           |

### `Sources.Pill` - `changed`

One source chip. Today a `<button>` inside a `relative` `<span>` wrapper; **proposed `<a>`** (a source with a `url` is a link - display-only leaf, no prop getter needed). Default content: a 16px numbered circle (`index + 1`) → the title truncated at 150px → a 6px score dot when `score` is present (emerald ≥ 0.7, amber ≥ 0.4, neutral below). Hovering reveals a preview card above the pill showing the snippet (3-line clamp) - **only when `snippet` exists**; no preview otherwise.

**Layout:** in-flow inline-flex chip inside the wrapping row; its wrapper `span` is `relative` and is the positioning context for the absolute, hover-revealed preview (`bottom-full left-0`, 256px wide, `pointer-events-none`).

The hover snippet preview is removed from the default `Sources.Pill` because it requires a second rendered node. Consumers that need previews can compose a separate popover outside the pill.

| Prop                                    | Type         | Description                                                                                                           |
| --------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `source` _(required)_                   | `Source`     | The source to render.                                                                                                 |
| `index` _(required)_                    | `number`     | Zero-based; the badge shows `index + 1`.                                                                              |
| `onClick`                               | `() => void` | Wired from the root's `onSourceClick` in the default mapping.                                                         |
| `asChild` + native + `ref` _(proposed)_ |              | Own the node; children replace the badge/title/dot content. Today only `className` is accepted beyond the data props. |

## Context (what the parts read)

`useSources(message?)` - message explicit at L3, from context at L2:

```ts
{
  sources: Source[]
  isEmpty: boolean
}
```

Built over the pure helper `extractSourcesFromParts(parts)`, which is also exported for direct L3 use.

_Grounding:_ today's context is `{ sources, onSourceClick }`, plus a `useSourcesOptional()` escape hatch that returns `null` outside a `Sources` (it lets `Message.Source` opt into the row's click handler when present). `onSourceClick` and the optional variant survive in the proposed shape.

## Examples

### Default

Rendered as part of the public `<Chat>` composition when a message carries source parts.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />;
```

### Composed (L2)

```tsx
<Message.Root message={m}>
  <Message.Content>
    <Message.Parts>{(part) => <Message.Text part={part} />}</Message.Parts>
    <Sources.Root className="my-sources">
      <Sources.List className="my-sources-list">
        <Sources.Pill className="my-source-pill" />
      </Sources.List>
    </Sources.Root>
  </Message.Content>
</Message.Root>;
```

### Headless (L3)

```tsx
function MySources({ message }: { message: ChatMessage }) {
  const { sources, isEmpty } = useSources(message);
  if (isEmpty) return null;
  return (
    <ul className="anything">
      {sources.map((source) => (
        <li key={source.url}>
          <a href={source.url}>{source.title}</a>
        </li>
      ))}
    </ul>
  );
}
```

## Customization (eject path)

1. **L1:** paste the public `<Chat>` composition and edit the sources block.
2. **L2:** compose `Sources.*` with your own layout; swap any node via `asChild`.
3. **L3:** `useSources(message)` - or `extractSourcesFromParts` directly - and your own markup.

## Related

- [`useSources`](../hooks/use-sources.md) - citation list + empty state
- [InlineCitation](./inline-citation.md) - inline footnote markers for the same source parts
- [Message](./message.md) - `Message.Sources` is the canonical form
