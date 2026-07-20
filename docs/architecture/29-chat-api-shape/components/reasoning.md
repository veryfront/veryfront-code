# Reasoning

A disclosure for a model's reasoning part — auto-opens while streaming, auto-closes when done. Render it whole, or compose the parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`Reasoning` is the same component as `Message.Reasoning`'s disclosure family — a namespace re-export for use outside a `Message`, never a parallel implementation.

## Import

```tsx
import { Reasoning } from 'veryfront/chat'
```

## Parts index

- [`.Root`](#reasoningroot--changed) — `changed`: `icon` / `labels` props deleted; `data-open` / `data-streaming` proposed
- [`.Trigger`](#reasoningtrigger--changed) — `changed`: `icon` / `labels` props deleted — children own the content
- [`.Content`](#reasoningcontent--kept) — `kept`

## Anatomy

```tsx
<Reasoning.Root text={text} isStreaming={isStreaming}>
  <Reasoning.Trigger />   {/* "Thinking…" shimmer / "Thought process" · rotating chevron */}
  <Reasoning.Content />   {/* the reasoning text as Markdown; null while closed */}
</Reasoning.Root>
```

`<Reasoning.Root>` with **no children renders exactly this default anatomy** (render-or-compose, like `ToolCall`). Pass children to recompose.

## Default DOM (childless render)

The actual HTML of `<Reasoning text={…} />` today (classes abbreviated to layout-relevant ones):

```html
<div class="mb-3">                                                <!-- .Root — in-flow block -->
  <button class="flex w-full items-center gap-2 text-sm">         <!-- .Trigger — full-width flex row, gap-2 -->
    <span>Thinking…</span>                                        <!--   label: shimmer animation while streaming, plain "Thought process" when done -->
    <span class="flex size-3.5 shrink-0 items-center justify-center transition-transform"> <!-- chevron wrapper: rotates; -rotate-90 when CLOSED -->
      <svg class="size-3.5 shrink-0" />                           <!--   chevron glyph itself never rotates — the wrapper does -->
    </span>
  </button>
  <div class="mt-2 text-sm">                                      <!-- .Content — in-flow block; PRESENT ONLY WHEN OPEN -->
    <div class="markdown space-y-2.5 text-sm">…reasoning as Markdown at 14px…</div>
  </div>
</div>
```

No absolute positioning — both parts are in-flow; the disclosure works by mounting/unmounting `.Content`. The open/close transition is the chevron wrapper's rotation only.

## Parts

### `Reasoning.Root` — `changed`

Changed: the `icon` and `labels` props are deleted (children on `.Trigger` own the content), and `data-open` / `data-streaming` are proposed state attributes.

The disclosure wrapper (one `<div>`) + the compound's scoped context. The reasoning text and streaming flag enter here; sub-parts read them from context.

**Layout:** in-flow block (`mb-3`); no positioning context.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `text` *(required)* | `string` | — | The reasoning text; `.Content` renders it as Markdown. |
| `isStreaming` | `boolean` | `false` | Drives the shimmering "Thinking…" label, the auto open/close behavior, and `data-streaming` *(proposed)*. |
| `open` | `boolean` | — | Controlled open state. When provided, **all auto open/close behavior is disabled** — the parent owns the state. |
| `defaultOpen` | `boolean` | `isStreaming` at mount | Uncontrolled initial state: a live card opens as tokens arrive; a completed/reloaded card starts collapsed and never plays the open-then-collapse animation. |
| `onOpenChange` | `(open: boolean) => void` | — | Fired on every open-state change, both user toggles and auto transitions. |
| ~~`icon`~~ | `ReactNode` | — | **Removed** (today overrides the chevron glyph). The RFC bans `icon` slot props; pass children to `Reasoning.Trigger` instead. |
| ~~`labels`~~ | `{ thinking?: string; thought?: string }` | `"Thinking..."` / `"Thought process"` | **Removed** (the labels bag). At L1, `<Chat labels={…}>` handles i18n; at L2+ pass children to `Reasoning.Trigger` — the consumer owns all text. |
| `asChild` *(proposed)* | `boolean` | `false` | Merge the root node onto your own element. |
| + native | `React.HTMLAttributes<HTMLDivElement>` · `ref` | — | Spread onto the single node; `className` merges. |

**Auto open/close (uncontrolled):** opens when streaming starts; when streaming ends, collapses after a 1-second beat — but only if the card actually streamed during this session (a history-reloaded card mounts collapsed and stays put). A manual toggle by the user permanently opts that card out of the stream-driven behavior.

**State attributes (proposed):**

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-open` | present | Expanded. Automatically set while streaming; automatically removed ~1s after streaming ends (unless the user toggled). Today open state is expressed only by mounting `.Content` and rotating the chevron. |
| `data-streaming` | present | The reasoning content is streaming now. Today this is expressed only by the shimmer animation on the trigger label. |

```css
[data-streaming] .shimmer { animation: shimmer 1.2s infinite; }
[data-open] .chevron { rotate: 180deg; }
```

### `Reasoning.Trigger` — `changed`

Changed: the `icon` and `labels` props are deleted — pass children to replace the default label + chevron content.

One full-width `<button>`. Default content: the label — a shimmering `Thinking...` while streaming, a plain `Thought process` when done — followed by a chevron inside a rotating wrapper (`-rotate-90` when closed, so a custom glyph never needs to know about open state). Always renders.

**Layout:** in-flow full-width flex row (`gap-2`); label sizes naturally, chevron wrapper is `shrink-0`.

| Prop | Type | Description |
| --- | --- | --- |
| ~~`icon`~~ | `ReactNode` | **Removed** (today overrides the chevron glyph). Pass children to replace the default label + chevron content. |
| ~~`labels`~~ | `{ thinking?, thought? }` | **Removed** — children own the text. |
| `asChild` + native (`ButtonHTMLAttributes`, `ref`) | | Own the node; `data-open` *(proposed)* mirrors the root. |

### `Reasoning.Content` — `kept`

One `<div>`. Default content: the reasoning `text` rendered as [`Markdown`](./markdown.md) at 14px (the compact variant size). **Renders `null` while the disclosure is closed** — safe to include unconditionally.

**Layout:** in-flow block below the trigger; mounted/unmounted by open state (no height animation today).

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replaces the rendered Markdown (read `text` from `useReasoning()`). |
| `asChild` + native + `ref` | | Own the node. |

## Context (what the parts read)

`useReasoning()` — throws outside `Reasoning.Root`:

```ts
{
  open: boolean
  toggle: () => void
  isStreaming: boolean
  duration: number            // seconds spent thinking — proposed; see note
  getTriggerProps: () => ButtonProps
  getContentProps: () => DivProps
}
```

*Grounding:* today's context is `{ text, isStreaming, isOpen, toggle }`. The RFC adds the prop getters and `duration`. **TBD:** how `duration` is measured (first-token → last-token wall clock vs. provider-reported) — nothing tracks it in today's source.

## Examples

### Default

Rendered by the default part renderer inside `<Chat>` / `ChatMessageList` for reasoning parts.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

```tsx
<Message.Parts>
  {(part) =>
    isReasoningPart(part) ? (
      <Reasoning.Root className="my-reasoning">
        <Reasoning.Trigger className="my-reasoning-trigger">Thinking…</Reasoning.Trigger>
        <Reasoning.Content className="my-reasoning-content" />
      </Reasoning.Root>
    ) : (
      <Message.Text part={part} />
    )}
</Message.Parts>
```

### Headless (L3)

```tsx
function MyReasoning() {
  const reasoning = useReasoning()
  return (
    <div className="anything" data-open={reasoning.open || undefined}>
      <button {...reasoning.getTriggerProps()} className="anything">
        {reasoning.isStreaming ? 'Thinking…' : `Thought for ${reasoning.duration}s`}
      </button>
      {reasoning.open && <div {...reasoning.getContentProps()} className="anything" />}
    </div>
  )
}
```

## Customization (eject path)

1. **L1:** the default reasoning rendering is part of the public `<Chat>` composition — paste it to change it.
2. **L2:** handle reasoning parts in your `Message.Parts` render fn and compose `Reasoning.*` your way; swap any node via `asChild`.
3. **L3:** `useReasoning()` + your own elements via the prop getters.

## Related

- [`useReasoning`](../hooks/use-reasoning.md) — open state, streaming, duration, getters
- [`useMessageParts`](../hooks/use-message-parts.md) — part iteration (`isReasoningPart` guard)
- [Message](./message.md) — hosts reasoning parts via `Message.Reasoning`
