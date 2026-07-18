# Markdown

Renders streamed markdown content — the one sanctioned multi-node primitive, tamed by a full `components` override map.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## The markdown exception

Every other primitive in `veryfront/chat` renders exactly one DOM node. `Markdown` (and therefore [`Message.Text`](./message.md), which it backs) necessarily renders a node *tree* — a paragraph of prose becomes `<p>`, `<a>`, `<code>`, and so on. It is the **only** sanctioned exception to the node contract, and it is tamed by one rule: **every emitted element type is replaceable** through the `components` override map. There is still no unreachable node — if `Markdown` can emit it, you can supply the component that renders it.

## Usage

```tsx
import { Markdown, RichCodeBlock } from 'veryfront/chat'

<Markdown
  components={{
    code: MyCodeBlock,     // replaces RichCodeBlock, the default
    a: MyLink,
    img: MyImage,
    table: MyTable,
    citation: MyCitation,  // replaces InlineCitation, the default
  }}
/>
```

## `components` — the override map

The `components` prop follows the react-markdown convention: a map from emitted element type to the component that renders it — `components={{ code, a, img, table, citation, … }}`.

- **Every emitted element type is replaceable.** Pass a component for any element `Markdown` emits and yours renders instead.
- **`code`** — defaults to [`RichCodeBlock`](#richcodeblock) (see below). Swap it via the map; the legacy `renderCodeBlock` prop is deleted (breaking-changes ledger) — it *is* `components.code` now.
- **`citation`** — an override slot rendering footnote markers from source parts. Defaults to [`InlineCitation`](./inline-citation.md), which renders numbered pills.

Because [`ToolCall.Input`](./tool-call.md) and `ToolCall.Output` are `RichCodeBlock`/`Markdown`-backed, the same `components` map reaches those surfaces too.

## Streaming

Streaming is owned here (the streamdown model) — consumers never hand-roll token handling:

- **Incremental block parsing.** The document is parsed block-by-block; **only the tail block re-renders per token**. Completed blocks are stable.
- **Repair of unterminated syntax.** Unterminated code fences and emphasis are repaired mid-stream, so a half-arrived ` ``` ` never breaks the rendered tree.
- **Hardening.** `allowedLinkPrefixes` / `allowedImagePrefixes` restrict which URLs links and images may point at — streamed model output is a security surface, and hardening is table stakes.

## `RichCodeBlock`

`RichCodeBlock` is the **default `components.code` renderer**. It is an alias over the `veryfront/ui` `CodeBlock` (the `ui` component's `copyIcon`/`collapseIcon` props fall to the icon-slot ban — breaking-changes ledger).

To use your own code rendering, pass a component as `components.code`; to use the default elsewhere (e.g. in your own part renderer), import `RichCodeBlock` directly.

## Where it appears

- [`Message.Text`](./message.md) renders its part content through `Markdown`.
- [`ToolCall.Input` / `ToolCall.Output`](./tool-call.md) are `RichCodeBlock`/`Markdown`-backed.
- The default [`components.citation`](./inline-citation.md) renderer is `InlineCitation`.
