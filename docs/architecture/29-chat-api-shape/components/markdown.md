# Markdown

Renders streamed markdown content — the one sanctioned multi-node primitive, tamed by a full `components` override map.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { Markdown, RichCodeBlock } from 'veryfront/chat'
```

## The markdown exception

Every other primitive in `veryfront/chat` renders exactly one DOM node. `Markdown` (and therefore [`Message.Text`](./message.md), which it backs) necessarily renders a node *tree* — a paragraph of prose becomes `<p>`, `<a>`, `<code>`, and so on. It is the **only** sanctioned exception to the node contract, tamed by one rule: **every emitted element type is replaceable** through the `components` override map. There is still no unreachable node — if `Markdown` can emit it, you can supply the component that renders it.

## Parts index

- [`Markdown`](#markdown--changed) — `changed`: `renderCodeBlock` deleted; hardening props + streaming ownership proposed
- [`components`](#components--the-override-map--changed) — `changed`: block-code hook moves from `pre` interception to the `code` key; virtual `citation` slot
- [Streaming](#streaming-proposed--owned-here--new) — `new`: incremental parsing, mid-stream repair, URL hardening
- [`RichCodeBlock`](#richcodeblock--changed) — `changed`: deprecated plain-`<pre>` fork collapses onto the `ui` `CodeBlock`; `copyIcon` / `collapseIcon` deleted

## Anatomy

Not a compound — one component, one override map:

```tsx
<Markdown
  components={{
    code: MyCodeBlock,     // replaces RichCodeBlock, the default
    a: MyLink,
    img: MyImage,
    table: MyTable,
    citation: MyCitation,  // replaces InlineCitation, the default
  }}
>
  {message.text}
</Markdown>
```

## Default DOM (childless render)

With no `components` overrides, a typical assistant message renders this tree today (classes abbreviated to layout-relevant ones):

```html
<div class="max-w-none min-w-0 overflow-hidden break-words [overflow-wrap:anywhere]">  <!-- the Markdown container div —
     in-flow block; min-w-0 + break-words keep streamed content from blowing out a flex row;
     all element rhythm (p/li/h1-h4 margins, list markers) is applied from here via descendant selectors -->

  <p>…prose…</p>                                              <!-- [&_p]:my-4 rhythm; first/last child margins zeroed -->

  <ul class="my-4 list-disc pl-6"><li class="my-1.5 pl-1">…</li></ul>  <!-- markers restored (preflight strips them) -->

  <!-- fenced code — the default `pre` interception → ui CodeBlock (= proposed RichCodeBlock): -->
  <div class="my-4 overflow-hidden rounded-md border bg-secondary">   <!-- code card; in-flow block -->
    <div class="flex items-center justify-between py-1.5 pl-3 pr-1.5 text-xs">  <!-- header row: language label left, copy right -->
      <span class="font-mono font-medium">tsx</span>
      <button aria-label="Copy code">⧉</button>               <!-- icon-only IconButton; check icon for ~2s after copy; label lives in the hover tooltip -->
    </div>
    <div class="border-t">                                    <!-- body sits behind a border-t under the header -->
      <pre class="overflow-x-auto p-3">                       <!-- the ONLY horizontal scroller for code -->
        <code class="language-tsx">…highlighted…</code>
      </pre>
    </div>
  </div>

  <code class="rounded px-1 py-0.5 font-mono">inline code</code>  <!-- inline code never reaches the code block;
                                                                       styled by the container's :not(pre)>code rule -->

  <!-- table — default `table` override wraps in a scroll container: -->
  <div class="my-4 max-w-full overflow-x-auto rounded-md border">  <!-- the table's own horizontal scroller -->
    <table class="w-full text-sm">                            <!-- th/td: px-4 py-2; row borders scoped per section -->
      …
    </table>
  </div>

  <a class="underline underline-offset-4 hover:no-underline" target="_blank" rel="noopener noreferrer">…</a>
  <blockquote class="border-l-4 pl-4 my-4 italic">…</blockquote>
</div>

<!-- Fallback (today): until the dynamic react-markdown import resolves — and
     permanently after two failed attempts — the container holds only: -->
<div class="max-w-none min-w-0 …"><p class="whitespace-pre-wrap">raw markdown text</p></div>
```

**Layout:** the container and everything in it is in-flow block content — nothing absolute, portalled, or hover-revealed. The two horizontal scrollers (code `<pre>`, table wrapper) are the pressure valves that let the transcript column stay `min-w-0`.

Notes for the reviewer:

- **Today the code hook is `pre`, not `code`**: block code arrives as `<pre><code class="language-x">`, and the built-in `pre` renderer extracts language + raw text and hands them to the `ui` `CodeBlock`; inline code is left as a bare `<code>` styled by the container. The proposed map is keyed **`code`** (react-markdown convention, `RichCodeBlock` default) — how the `pre`/`code` split maps onto that key (does `components.code` receive `inline`?) is **TBD** in the RFC.
- Today react-markdown + remark-gfm load lazily from esm.sh at runtime (hence the plain-text fallback). The proposed streaming pipeline (below) replaces this wholesale; whether a fallback state remains is **TBD**.

## Props

### `Markdown` — `changed`

Changed: `renderCodeBlock` is deleted (it *is* `components.code` now), and the hardening props (`allowedLinkPrefixes` / `allowedImagePrefixes`) plus streaming ownership are proposed additions.

**Layout: one in-flow container `<div>` around the emitted tree** — the container carries the typographic rhythm; native attributes spread onto it.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` *(required)* | `string` | — | The markdown source (possibly mid-stream) |
| `components` | `{ [element]: Component }` | built-ins | Override map, merged **over** the built-in renderers (consumer entries win). Keys: any emitted element (`code`, `a`, `img`, `table`, `blockquote`, `th`, `td`, …) plus the virtual **`citation`** slot |
| `allowedLinkPrefixes` *(proposed)* | `string[]` | TBD | Hardening — URL prefixes links may point at |
| `allowedImagePrefixes` *(proposed)* | `string[]` | TBD | Hardening — URL prefixes images may load from |
| `remarkPlugins` / `rehypePlugins` | `PluggableList` | GFM built-in | Appended after the built-in list (kept from today; interaction with the proposed incremental parser is **TBD**) |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | | Onto the container div; `className` merges (today: `className` only) |

**Removed (proposed):** `renderCodeBlock` — it *is* `components.code` now (breaking-changes ledger).

### `components` — the override map — `changed`

Changed: today block code is intercepted at the `pre` renderer; the proposed map is keyed `code` (how the `pre`/`code` split maps onto that key is TBD) and adds the virtual `citation` slot.

The react-markdown convention: a map from emitted element type to the component that renders it.

- **Every emitted element type is replaceable.** Pass a component for any element `Markdown` emits and yours renders instead — including the built-in defaults for `pre`/`code`, `table`, `th`, `td`, `a`, and `blockquote` documented in the DOM above.
- **`code`** — defaults to [`RichCodeBlock`](#richcodeblock--changed). The default renderer receives `{ language, code }` extracted from the fence.
- **`citation`** — a *virtual* slot (no HTML element named `citation`): renders footnote markers generated from source parts. Defaults to [`InlineCitation`](./inline-citation.md) — numbered pills.

Because [`ToolCall.Input`](./tool-call.md) and `ToolCall.Output` are `RichCodeBlock`/`Markdown`-backed, the same `components` map reaches those surfaces too.

### Streaming (proposed — owned here) — `new`

Streaming is owned by `Markdown` (the streamdown model) — consumers never hand-roll token handling. None of this exists in today's implementation (which re-renders the whole tree per update and loads the parser lazily):

- **Incremental block parsing.** The document is parsed block-by-block; **only the tail block re-renders per token**. Completed blocks are referentially stable.
- **Repair of unterminated syntax.** Unterminated code fences and emphasis are repaired mid-stream, so a half-arrived ` ``` ` never breaks the rendered tree.
- **Hardening.** `allowedLinkPrefixes` / `allowedImagePrefixes` restrict which URLs links and images may point at — streamed model output is a security surface, and hardening is table stakes.

## `RichCodeBlock` — `changed`

Changed: today's deprecated plain-`<pre>` fork and the `ui` `CodeBlock` collapse into one name aliasing the `ui` primitive; `copyIcon` / `collapseIcon` are deleted.

The **default `components.code` renderer** — an alias over the `veryfront/ui` `CodeBlock` (shiki highlighting, copy button with ~2s copied feedback, language label, collapsible shell, mermaid support). **Layout: an in-flow block card (`my-4 rounded border overflow-hidden`): header row (`flex justify-between`, label left / actions right) above the scrolling `<pre>`.**

> Today's exported `RichCodeBlock` is a *deprecated plain-`<pre>` fork with no highlighting*, kept for back-compat while `Markdown` already renders fences through the `ui` `CodeBlock`. The proposal collapses this: one name, aliasing the `ui` primitive.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `code` *(required)* | `string` | — | The source text |
| `language` | `string` | — | Highlight language + header label (`"text"` shown when absent) |
| `collapsible` / `defaultCollapsed` | `boolean` | `false` | Collapsible shell — header stays, body toggles |
| `mode` | `'light' \| 'dark'` | ColorMode context, else `light` | Forced highlight theme |
| `onCopy` | `(e, next) => void` | — | Intercept the header copy; call `next()` to actually copy |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | | Onto the card (today: `className` + `ref`) |

**Removed (proposed):** `copyIcon` / `collapseIcon` / `renderHeader` — the icon-slot and render-prop bans (breaking-changes ledger); `renderHeader` is deleted with the icon props. The replacements: copied feedback is `data-copied` on the copy button + CSS (no `copyIcon` swap needed), and header customization is a `components.code` swap — supply your own code renderer.

**State attributes (proposed):** `data-copied` on the copy button (global vocabulary; today copied feedback is internal state swapping the icon/label).

## Context (what the parts read)

None — `Markdown` is stateless from the consumer's perspective (input string in, tree out). The `components` map is the entire extension surface; `RichCodeBlock`'s copy behavior is available standalone via `useClipboard(text)` → `{ copied, copy }`.

## Where it appears

- [`Message.Text`](./message.md) renders its part content through `Markdown`.
- [`ToolCall.Input` / `ToolCall.Output`](./tool-call.md) are `RichCodeBlock`/`Markdown`-backed.
- The default [`components.citation`](./inline-citation.md) renderer is `InlineCitation`.

## Examples

### Default

```tsx
<Markdown>{message.text}</Markdown>
```

### Custom code + citation renderers

```tsx
<Markdown
  components={{
    code: ({ language, code }) => <MyCode lang={language}>{code}</MyCode>,
    citation: MyFootnotePill,
  }}
>
  {message.text}
</Markdown>
```

### Reusing the default renderer elsewhere

```tsx
import { RichCodeBlock } from 'veryfront/chat'

<RichCodeBlock code={toolCall.input} language="json" collapsible />
```

## Customization (eject path)

1. **L1** — the default tree inside `<Chat />` / `Message.Text` (defaults above).
2. **L2** — override per element type via `components` — per-element ejection, never all-or-nothing; `RichCodeBlock` stays importable for use inside your overrides.
3. **L3** — there is deliberately no lower layer: parsing + streaming repair are the library's job (the exception exists *because* this tree shouldn't be hand-built). For fully custom rendering, take `part.text` and use your own pipeline.

## Related

- [`Message.Text`](./message.md) · [`ToolCall`](./tool-call.md) · [`InlineCitation`](./inline-citation.md)
- `useClipboard` — the copy hook behind the code-block header
- The markdown exception + streaming contract: [`29-chat-api-shape.md`](../../29-chat-api-shape.md) *Cross-cutting contracts*
