# Message

One message row: a single `<article>` plus scoped context, with composable parts for content, actions, and metadata.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { Message } from 'veryfront/chat'
// every sub-part is also a flat named export, with its Props type:
import { Message, MessageAvatar, type MessageAvatarProps } from 'veryfront/chat'
```

`Message.Avatar` and `MessageAvatar` are the same function — namespace alias and flat export, two access styles (same for every sub-part).

## Parts index

- [`.Root`](#messageroot--changed) — `changed`: `<div>`→`<article>`; per-message session props deleted
- [`.Avatar`](#messageavatar--changed) — `changed`: per-branch node (`<img>` / `<div>` fallback) → one node
- [`.Header`](#messageheader--changed) — `changed`: `<div>`→`<header>`
- [`.Name`](#messagename--changed) — `changed`: renamed from `Message.Header.Name`
- [`.Timestamp`](#messagetimestamp--changed) — `changed`: `<span>`→`<time>`
- [`.Content`](#messagecontent--changed) — `changed`: function-child moves to `.Parts`; `codeBlock` / `markdownComponents` deleted
- [`.Parts`](#messageparts--changed) — `changed`: replaces `Message.Part` + `.Content`'s function-child
- [`.Text`](#messagetext--changed) — `changed`: markdown exception, `components` map, streaming ownership
- [`.Reasoning`](#messagereasoning--kept) — `kept`
- [`.Source`](#messagesource--changed) — `changed`: `<button>`-in-`<span>` → `<a>` (same delta as `Sources.Pill`)
- [`.File`](#messagefile-proposed--no-current-source--new) — `new`: attachment part leaf
- [`.Image`](#messageimage-proposed--no-current-source--new) — `new`: image part leaf
- [`.Sources`](#messagesources--changed) — `changed`: `<section>`; `renderItem` deleted; `data-empty`
- [`.Actions`](#messageactions--changed) — `changed`: baked hover-reveal classes → `data-floating`
- [`.CopyAction`](#messagecopyaction--changed) — `changed`: `icon` deleted; composed `onClick`; `data-copied`
- [`.RegenerateAction`](#messageregenerateaction--changed) — `changed`: same leaf deltas as `.CopyAction`
- [`.EditAction`](#messageeditaction--changed) — `changed`: immediate `editMessage` → edit mode (`startEdit`)
- [`.Feedback`](#messagefeedback-cut--removed) — `removed`: cut from v1 (no backend endpoint)
- [`.BranchPicker`](#messagebranchpicker--kept) — `kept`
- [`.Tokens`](#messagetokens--changed) — `changed`: popover pair → display-only `<span>` (settled); `renderItem` deleted
- [`.Continuing`](#messagecontinuing--changed) — `changed`: `<div>`→`<span>`

## Anatomy

`Message.Root` renders exactly **one `<article>`** *(proposed — today it renders the `MessageItem` primitive `<div>` with baked layout classes: `flex w-full flex-col gap-1.5`, user turns `ml-auto max-w-[80%] items-end`)* and provides scoped context (`MessageContextProvider`) to its children. There is no other node — every layout element between the parts is yours.

```tsx
<Message.Root message={message}>   {/* ONE <article> + MessageContext */}
  <Message.Avatar />               {/* agent avatar — null on user turns */}
  <Message.Header>                 {/* avatar · name · HH:MM — null on user turns */}
    <Message.Name />               {/* "Support Agent" / "Assistant" fallback */}
    <Message.Timestamp />          {/* <time> — null without a valid createdAt */}
  </Message.Header>
  <Message.Content>                {/* the part column */}
    <Message.Parts>                {/* NO node — typed render-fn iterator */}
      {(part) =>
        isToolPart(part)      ? <ToolCall.Root part={part} /> :
        isReasoningPart(part) ? <Message.Reasoning part={part} /> :
                                <Message.Text part={part} />}
    </Message.Parts>
    <Message.Sources />            {/* citation pills — null with no sources */}
  </Message.Content>
  <Message.Actions>                {/* hover action bar — data-floating */}
    <Message.CopyAction />         {/* data-copied while ticked */}
    <Message.RegenerateAction />   {/* null on user turns / no reload */}
    <Message.EditAction />         {/* enters edit mode → data-editing */}
  </Message.Actions>
  <Message.BranchPicker />         {/* ‹ 2/3 › — null unless >1 branch */}
  <Message.Tokens />               {/* usage total — null without usage metadata */}
  <Message.Continuing />           {/* "Continuing…" shimmer — null unless streaming */}
</Message.Root>
```

The render-fn branches above show `.Text` / `.Reasoning` / `ToolCall`; the remaining part leaves — `Message.Source`, `Message.File`, `Message.Image` — slot into the same branches for their part types.

`<Message message={m} />` with **no children renders the default anatomy** (render-or-compose): `Header` → `Content` → `Sources` → `Continuing` → a footer row (`Actions` + `Tokens`). The footer row's `<div>` is a layout div — when you paste the public composition, it's yours.

Every part renders one node, `extends` the native attributes of that node, spreads `{...props}` onto it, and takes `asChild`.

## Default DOM (childless render)

What `<Message message={m} />` actually renders (classes abbreviated to the layout-relevant ones; today's source, with the proposed `<article>` tag). Nothing in this compound is absolutely positioned — the action bar and token trigger are **in-flow, revealed by opacity** on row hover.

```html
<article data-message-item="" data-role="assistant"
         class="group/msg flex w-full flex-col gap-1.5 items-start">
            <!-- Message.Root — flex COLUMN, gap 1.5. `group/msg` is the hover
                 scope every reveal below keys off. Assistant: items-start.
                 User turns instead: ml-auto max-w-[80%] items-end (right-aligned,
                 capped at 80% width). -->

  <div class="flex w-full items-center gap-2 pt-px pb-3">
            <!-- Message.Header — in-flow flex ROW, gap 2. ASSISTANT ONLY.
                 `w-full` fights the Root's items-start shrink so the
                 timestamp's ml-auto can reach the right edge. -->
    <div class="size-8 shrink-0 rounded-full">…</div>
            <!-- AgentAvatar — fixed 8×8 square, never shrinks -->
    <span class="min-w-0 truncate font-medium">Support Agent</span>
            <!-- Message.Name — min-w-0 + truncate → ellipsizes, never wraps -->
    <span class="ml-auto text-sm">14:32</span>
            <!-- Message.Timestamp — pushed to the right edge by ml-auto -->
  </div>

  <div class="flex w-full flex-col gap-2.5 flex-1 min-w-0">
            <!-- Message.Content (assistant) — flex COLUMN, gap 2.5 owns ALL
                 spacing between parts (no per-part margins). `w-full` again
                 fights the Root's shrink (a lone w-full tool card would
                 otherwise render narrow); min-w-0 lets code blocks scroll
                 instead of overflowing the row. -->
    <div class="my-2 text-[15px] leading-7">…markdown…</div>
            <!-- text part — my-2 widens text↔tool boundaries (flex gap does
                 not collapse with margins; tool↔tool stays at the base gap) -->
    <div>…</div>
            <!-- reasoning / step / file-pill / tool-call cards, in part order.
                 USER turns render a single themed bubble instead: attachment
                 pills (flex flex-wrap justify-end gap-2 mb-2, 200px each)
                 above whitespace-pre-wrap text. -->
  </div>

  <div class="mt-1">
    <div class="flex flex-wrap gap-2">…pills…</div>
  </div>
            <!-- Message.Sources — today the Sources root <div class="mt-1">
                 plus the inner list <div> wrapping the citation pills
                 (proposed retag: one <section> — see the part subsection);
                 present only when the message yields sources -->

  <div class="mt-3 text-sm">Continuing…</div>
            <!-- Message.Continuing — in-flow; present only while streaming -->

  <div class="mt-1.5 flex items-center gap-0.5">
            <!-- footer LAYOUT div (not a part — yours after eject) -->
    <div class="flex items-center gap-0.5
                opacity-0 group-hover/msg:opacity-100 transition-all">
            <!-- Message.Actions — in-flow flex ROW that HOLDS ITS SPACE;
                 hidden/revealed purely by opacity keyed to the ancestor
                 group/msg hover → zero layout shift. Proposed: the baked
                 opacity classes become your CSS on [data-floating]. -->
      <button class="size-7 rounded-full">⧉</button>   <!-- Message.CopyAction -->
      <button class="size-7 rounded-full">↻</button>   <!-- Message.RegenerateAction -->
    </div>
    <button class="h-7 px-2 text-xs opacity-0 group-hover/msg:opacity-100">79.8k</button>
            <!-- Message.Tokens trigger — same opacity hover-reveal, pinned
                 visible while its popover is open; the popover panel is
                 positioned by the Popover primitive relative to this trigger -->
  </div>
</article>
```

Not in the childless default: `Message.Avatar` (standalone — the header embeds its own avatar), `Message.BranchPicker`, `Message.EditAction`.

## Parts

### `Message.Root` — `changed`

Changed: today's `MessageItem` `<div>` becomes one `<article>`, and the per-message session props (`isStreaming`, `editMessage`, `getBranches`, `switchBranch`, `onReload`, `onFeedback`, `feedback`) are deleted in favor of `ChatRoot` context.

The single message node (one `<article>`) + the compound's scoped context. All message data enters here; sub-parts read it from context.

**Layout:** flex column (`gap-1.5`) establishing the `group/msg` hover scope; assistant turns `items-start`, user turns right-aligned (`ml-auto max-w-[80%] items-end`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `message` *(required)* | `ChatMessage<TMetadata, TDataParts, TTools>` | — | The message to render. Generics flow through `Message.Parts`' render prop, `useMessageParts`, and the part leaves. |
| `asChild` | `boolean` | `false` | Merge the single `<article>` onto your own element. |
| + native | `React.HTMLAttributes<HTMLElement>` · `ref` | — | Spread onto the `<article>`; `className` merges. |

**Removed (proposed):** today's `MessageRootProps` thread session concerns per message — `isStreaming?`, `editMessage?`, `getBranches?`, `switchBranch?`, `onReload?`, `onFeedback?`, `feedback?`. All are deleted: streaming derives from `ChatRoot` (`streamingMessageId === message.id` — already today's default when `isStreaming` is omitted), and session callbacks (`editMessage`, `reload`, `getBranches`, `switchBranch`) come from the nearest `ChatRoot` context — **never re-threaded per message**.

**State attributes** — the `MessageItem` primitive already emits `data-message-item` and `data-role` today (`primitives/message-list.tsx`); those two are **kept**. The rest are proposed additions (streaming/editing/error are presented only structurally today):

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-message-item` | present | Part marker — *kept* (exists today). |
| `data-role` | `user \| assistant \| system` | Author role — *kept* (exists today). |
| `data-agent-id` | `<id>` | Producing agent — per-message, for per-agent styling in multi-agent conversations. |
| `data-streaming` | present | This message is streaming now (also on `Message.Text`). |
| `data-editing` | present | The edit composer is active. |
| `data-error` | present | The message errored. |

```css
/* style state with CSS, not boolean props */
[data-role='user'] { justify-self: end; }
[data-streaming] .cursor { display: inline-block; }
[data-agent-id='researcher'] { --accent: var(--purple-9); }
```

### `Message.Avatar` — `changed`

Changed: today the `AgentAvatar` primitive renders a *different node per fallback branch* — an `<img>` when `avatarUrl` resolves (dropping to the next branch on load error), a `<div>` holding the name's initial otherwise, else the `ModelAvatar` logomark. The proposal normalizes this to **one node** regardless of which content branch wins.

Default content: the agent's avatar image, else the name's initial, else the provider logomark for `metadata.model`. Identity resolves **per message** (multi-agent decision): `metadata.agentName` → `metadata.agentId` for the name, `metadata.agentAvatarUrl` for the image, `metadata.model` for the logomark fallback. Today it also falls back to the conversation-level `chat.agent` between those; under the RFC's per-message identity rule the message metadata is canonical — whether the conversation-level fallback survives is **TBD**. **Renders `null` on user turns.**

**Layout:** in-flow fixed square (`size-8` when embedded in the header); never shrinks.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes<HTMLDivElement>`, `ref`) | | Own the node (today: `className` only). |

### `Message.Header` — `changed`

One `<header>` *(proposed — today a `<div>` row)*. Default content: `AgentAvatar` (`size-8`) → `Message.Name` → `Message.Timestamp` pushed right. Ported 1:1 from Studio's `ChatMessageHeader`. **Renders `null` on user turns** — user messages have no header. Pass children to recompose the inner row from `Message.Name` / `Message.Timestamp`.

**Layout:** in-flow flex row (`items-center gap-2 pt-px pb-3`); `w-full` against the Root's `items-start` shrink so the timestamp's `ml-auto` reaches the right edge.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Own the node; children replace the default avatar/name/timestamp row. |

### `Message.Name` — `changed`

Changed: today shipped as `Message.Header.Name`; the flat `Message.Name` spelling is the proposed naming (canonical spelling TBD).

One `<span>`. Default content: the agent name from message metadata (same chain as `.Avatar`), with the `"Assistant"` placeholder fallback — the placeholder lives **here**, deliberately not on the avatar, so `AgentAvatar` can still fall back to the model logomark. Children replace the text without losing styling/position. *(Today shipped as `Message.Header.Name`; the flat `Message.Name` spelling is the proposed naming — canonical spelling TBD.)*

**Layout:** in-flow flex child; `min-w-0 truncate` — ellipsizes rather than wrapping or pushing the timestamp out.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replace the default name text. |
| `asChild` + native (`HTMLAttributes<HTMLSpanElement>`, `ref`) | | Own the node. |

### `Message.Timestamp` — `changed`

One `<time>` *(proposed — today a `<span>` with `suppressHydrationWarning`)*. Default content: `HH:MM` via `toLocaleTimeString` from `message.createdAt`. **Renders `null` when `createdAt` is missing or invalid.** *(Today `Message.Header.Timestamp` — same naming note as `.Name`.)*

**Layout:** in-flow; pushed to the header's right edge with `ml-auto`.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`ref`) | | Own the node. Whether children can replace the formatted label is TBD (today: no children). |

### `Message.Content` — `changed`

Changed: today's function-child `(part, index) => ReactNode` moves to `Message.Parts`, and the `codeBlock` / `markdownComponents` props fold into the markdown `components` override map.

One `<div>`, role-split default content:

- **User turns** — the themed bubble (`theme.message.user`): sent attachments rendered as `AttachmentPill`s (200 px, image preview for `image/*`) above the text (`whitespace-pre-wrap`).
- **Assistant turns** — a column mapping the grouped parts (`groupPartsInOrder`: adjacent text merged, reasoning, steps, files, tool calls) through the default part renderer.

When childless it renders that default loop; compose the body with `Message.Parts` (+ `Message.Sources` where you want them — sources are **not** auto-appended in a composed body).

**Layout:** in-flow flex column (`gap-2.5` owns all between-part spacing); `w-full flex-1 min-w-0` — full row width despite the Root's `items-start`, code blocks scroll instead of overflowing.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes<HTMLDivElement>`, `ref`) | | Own the node. |

**Removed (proposed):** today's function-child `(part, index) => ReactNode` moves to `Message.Parts`; `codeBlock` / `markdownComponents` fold into the markdown `components` override map (`renderCodeBlock` is deleted per the breaking-changes ledger).

### `Message.Parts` — `changed`

**Renders no node** — a typed render-fn iterator over the message's parts. Replaces today's pair of `Message.Part` (opaque single-part leaf) + `Message.Content`'s function-child. Registry-aware: resolution order is **inline render fn → `tools` registry by name → default renderer**. Iterates the grouped parts (`groupPartsInOrder`), typed by `Message.Root`'s `ChatMessage<TMetadata, TDataParts, TTools>` generics — a tool part narrows per tool name.

**Layout:** no node — the returned children land directly in the parent column (usually `.Content`'s `gap-2.5` flex).

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `(part) => ReactNode` | Render each typed part; return a `Message.*` leaf, a `ToolCall`, or your own markup. Omit to render the default per-type mapping. |

**Childless default (settled):** `<Message.Parts />` with no render fn renders the default per-type mapping (registry-aware) — this is the public default behind `.Content`, so `.Content`'s childless body is expressible as public composition. **TBD:** whether the render fn also receives `index`.

### `Message.Text` — `changed`

Changed: streaming ownership (incremental block parse, repair, hardening) is a proposed addition, and today's `codeBlock` / `markdownComponents` props are replaced by the `components` override map.

The text-part leaf — **Markdown-backed, the sanctioned multi-node exception** (see the markdown exception in the RFC): it renders the part's text as `Markdown` (today `my-2 text-[15px] leading-7`) with streaming ownership (incremental block parse, fence/emphasis repair, link/image-prefix hardening). Every emitted element is replaceable via the `components` map — still no unreachable node.

**Layout:** in-flow block; `my-2` widens text↔tool boundaries (flex gap doesn't collapse with margins).

| Prop | Type | Description |
| --- | --- | --- |
| `part` *(required)* | the narrowed `text` part | The part to render. |
| `components` | `Components` | Markdown element override map (`code`, `a`, `img`, `citation`, …). Replaces today's `codeBlock` / `markdownComponents` props. |

**State attributes (proposed):** `data-streaming` — present while this part is streaming. Owner: message-level streaming (`streamingMessageId === message.id`) *combined with* this being the tail part of the message — only the last part of a streaming message carries it.

### `Message.Reasoning` — `kept`

Renders the shared [`Reasoning`](./reasoning.md) block with the part's text and streaming flag (auto-open while streaming, `data-open`). See that page for its own parts.

**Layout:** in-flow block card in the content column.

| Prop | Type | Description |
| --- | --- | --- |
| `part` *(required)* | the narrowed `reasoning` part | The part to render. |

### `Message.Source` — `changed`

Changed: today's `SourcePill` renders a `<button>` inside a relative `<span>` wrapper (the hover-preview anchor); proposed it becomes one `<a>` — the same delta as `Sources.Pill`.

One citation pill (`SourcePill`, proposed `<a>`-backed). Inside a `Message.Sources` function-child it inherits the row's `onSourceClick`; standalone it renders with no handler.

**Layout:** inline pill; flows in `.Sources`' wrap row.

| Prop | Type | Description |
| --- | --- | --- |
| `source` *(required)* | `Source` | The citation. |
| `index` *(required)* | `number` | Citation index (drives the pill number). |
| `onClick` | `() => void` | Override; falls back to the enclosing `Message.Sources` handler. |
| `asChild` + native (`ref`) | | Own the node (today: `className` only). |

### `Message.File` *(proposed — no current source)* — `new`

New part leaf: sent and received attachments are renderable parts. Proposed default content mirrors today's default file-part renderer: an `AttachmentPill` (`w-[200px]`) showing filename (fallback `"Attachment"`), media type/size, and an image preview when `mediaType` starts with `image/` — read-only, no upload-lifecycle badge.

**Layout:** in-flow block in the content column (today's renderer wraps the pill in a `my-1.5` div).

| Prop | Type | Description |
| --- | --- | --- |
| `part` *(required)* | the typed `file` part (`{ type: 'file', url, mediaType, filename?, size? }`) | The part to render. |
| `asChild` + native (`ref`) | | Own the node. |

**TBD:** exact node and anatomy beyond the pill default.

### `Message.Image` *(proposed — no current source)* — `new`

New part leaf for image parts — presumably one `<img>` for `image/*` file parts. Generated-image chrome beyond this leaf is explicitly out of scope for v1 (lands additively later).

**Layout:** in-flow block in the content column (TBD).

| Prop | Type | Description |
| --- | --- | --- |
| `part` *(required)* | the typed image/file part | The part to render. |
| `asChild` + native (`ref`) | | Own the node. |

**TBD:** exact node, prop shape, and whether the default renderer routes `image/*` file parts here instead of `.File`.

### `Message.Sources` — `changed`

One `<section>` *(proposed retag — today the `Sources` collection root renders a `<div class="mt-1">` plus an inner list `<div class="flex flex-wrap gap-2">`)*. Default content: one citation pill per source extracted from the message's tool results (`extractSourcesFromParts`). **Renders `null` when the message yields no sources** (today's behavior; the proposed `data-empty` state implies a mounted-empty node — which of the two v1 ships is **TBD**). In a composed `.Content` body sources are not auto-appended — place this part yourself. See [Sources](./sources.md).

**Layout:** in-flow wrap row of pills below the content column.

| Prop | Type | Description |
| --- | --- | --- |
| `onSourceClick` | `(source, index) => void` | Click handler for the default pills. No context fallback — the `ChatRoot`-level `onSourceClick` is removed per the ledger; clicking routes via composition only. |
| `children` | nodes or `(source, index) => ReactNode` | Function-child maps each source; nodes recompose via `Sources.List` / `Sources.Pill`. |
| `asChild` + native (`ref`) | | Own the node. |

**Removed (proposed):** `renderItem` (render-prop config, deleted per the ledger — compose instead).

**State attributes (proposed):** `data-empty` — no sources.

### `Message.Actions` — `changed`

One `<div>`. Default content: `Message.CopyAction` + `Message.RegenerateAction` (`Message.EditAction` stays available but is off by default). **Renders `null` when the message has no text content** (today). Hover reveal is today baked in as `opacity-0 group-hover/msg:opacity-100`; the RFC replaces the baked classes with `data-floating` so you own the reveal — **hidden-but-animatable, never unmounted to hide**.

**Layout:** in-flow flex row (`gap-0.5`) that holds its space; revealed by opacity on `group/msg` hover — zero layout shift, no absolute positioning.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Compose your own bar; omitted → the default cluster. |
| `asChild` + native (`HTMLAttributes<HTMLDivElement>`, `ref`) | | Own the node (already `extends HTMLAttributes` today). |

**State attributes (proposed):** `data-floating` — present whenever the bar is hidden-but-mounted (row not hovered *and* not the last message), removed while the bar is visible. Owner: `Message.Root`'s hover/last-message tracking — the bar itself does no tracking.

### `Message.CopyAction` — `changed`

One `<button>`. Default content: copy icon, swapping to a check while copied; `aria-label`/`title` `"Copy to clipboard"` / `"Copied!"`. Copies the message's `textContent` via `useClipboard`. **Renders `null` when there is no text content.** Children replace the default icon (the `icon` prop is deleted — icon-slot ban); today's `onClick(event, next)` wrap-signature becomes a standard composed `onClick` (consumer first; `preventDefault` skips the internal copy) per the merge-semantics contract.

**Layout:** in-flow fixed `size-7` round icon button (icon `size-3.5`).

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replace the default icon. |
| `onClick` | `MouseEventHandler` | Composes with the internal copy; `preventDefault()` cancels it. |
| `asChild` + native (`ButtonHTMLAttributes`, `ref`) | | Own the node. |

**State attributes (proposed):** `data-copied` — transient copied feedback (today expressed only by the icon/label swap).

### `Message.RegenerateAction` — `changed`

One `<button>`. Default content: refresh icon; `aria-label`/`title` `"Regenerate response"`. **Renders `null` unless regeneration is available** — assistant turns only, and only when `reload` exists on the `ChatRoot` context (today: `onReload`, gated `role !== 'user'`). Same props table as `.CopyAction` (children replace icon, composed `onClick`, `asChild`, native).

**Layout:** in-flow fixed `size-7` round icon button.

### `Message.EditAction` — `changed`

One `<button>`. Default content: pencil icon; `aria-label`/`title` `"Edit message"`. **Renders `null` when editing is unavailable or there is no text content.** Same props table as `.CopyAction`. **Semantics change (proposed):** today it calls `editMessage(id, textContent)` immediately; proposed it enters edit mode (`startEdit`) — `Message.Root` gets `data-editing` and a `ChatInput` rendered inside the message *is* the edit form (nearest provider wins; no separate edit-form family).

**Layout:** in-flow fixed `size-7` round icon button; not in the childless default cluster.

### `Message.Feedback` *(cut)* — `removed`

There is no `Message.Feedback` in v1 — cut (no backend endpoint behind `onFeedback`); it returns additively when the endpoint exists.

### `Message.BranchPicker` — `kept`

One `<div>` container: ‹ previous · `2/3` count · next ›. **Renders `null` unless the message has more than one branch** (`total <= 1`). Today it accepts **no props at all**; proposed it takes `asChild` + native attributes like every part. Branch data/actions come from `ChatRoot`'s existing `getBranches` / `switchBranch` via `useMessageBranches`. Full anatomy and per-leaf props: [BranchPicker](./branch-picker.md).

**Layout:** in-flow `inline-flex` row (`gap-1`); always visible when rendered (no hover reveal); not in the childless default.

**State attributes (proposed):** `data-active` — selected branch.

### `Message.Tokens` — `changed`

One display-only `<span>` **(settled)**. Today it renders a Popover pair — a trigger `<button>` showing the compact total (`726`, `79.8k`; hover-revealed like the actions, pinned visible while open) that opens a breakdown card (Model · Input · Output · Total, from `metadata.usage`: `inputTokens` / `outputTokens` / `reasoningTokens`). **Renders `null` on user turns and when total tokens are 0** (no usage metadata). The popover trim is settled: the leaf becomes a plain usage `<span>` because the library ships no positioning primitive — the breakdown popover falls to the popper-anchor open question and returns (if at all) with its resolution.

**Layout:** in-flow trigger revealed by opacity on `group/msg` hover (stays visible while its popover is open); the popover panel is positioned by the Popover primitive relative to the trigger.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`ref`) | | Own the node (today: `className` only). |

**Removed (proposed):** `renderItem` for the breakdown rows (render-prop config, deleted per the ledger).

### `Message.Continuing` — `changed`

One `<span>` *(proposed — today a `<div>`, `mt-3 text-sm`)*. Default content: a `Continuing...` `Shimmer`. **Renders `null` when the message is not streaming.** Children replace the shimmer.

**Layout:** in-flow block below the content (`mt-3`); appears/disappears with streaming (mounted only while streaming).

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replace the default shimmer. |
| `asChild` + native (`ref`) | | Own the node. |

## Context (what the parts read)

`useMessageContext()` — throws outside `Message.Root`; `useMessageContextOptional()` returns `null` instead:

```ts
{
  message: ChatMessage<TMetadata, TDataParts, TTools>
  role: 'user' | 'assistant' | 'system'
  isStreaming: boolean
  parts: PartGroup[]        // grouped, render-order parts
  textContent: string       // flat text of the answer parts
  copy: () => Promise<void>
  copied: boolean           // transient tick, lifted here so composed layouts keep it
  isEditing: boolean
  startEdit: () => void
  cancelEdit: () => void
  regenerate?: () => void   // assistant turns with reload only
}
```

Deltas vs today's `MessageContextValue`: `onCopy` → `copy`; `onEdit(content)` → `isEditing` / `startEdit` / `cancelEdit` (edit *mode* + nested `ChatInput`, instead of an immediate `editMessage` call); `onRegenerate` → `regenerate`; `branch` / `onBranchPrev` / `onBranchNext` move to [`useMessageBranches`](../hooks/use-message-branches.md); `onFeedback` / `feedback` are cut with `Message.Feedback`. Today's `role` union also includes `"tool"` — the `data-role` vocabulary is `user | assistant | system`, so whether `"tool"` survives is TBD.

`useMessageParts<TMessage>(message?)` returns the typed `PartGroup[]` — message explicit at L3, from context at L2 (today it is context-only). `groupPartsInOrder` is the pure primitive under it, exported for L3.

## Examples

### Default

The L1 `<Chat>` preset renders messages internally; its default composition is public, so this is also what you paste when ejecting.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

You own every layout div; parts read the message from `Message.Root`'s context.

```tsx
<Message.Root message={m} className="my-row">
  <div className="my-gutter">          {/* YOUR div */}
    <Message.Avatar className="my-avatar" />
  </div>
  <div className="my-body">            {/* YOUR div */}
    <Message.Parts>
      {(part) =>
        isToolPart(part)      ? <ToolCall.Root part={part} className="my-tool" /> :
        isReasoningPart(part) ? <Message.Reasoning part={part} className="my-reason" /> :
                                <Message.Text part={part} className="my-text" />}
    </Message.Parts>
    <Message.Actions className="my-actions">
      <Message.CopyAction />
      <Message.RegenerateAction />
    </Message.Actions>
  </div>
</Message.Root>
```

#### Editing

A `ChatInput` rendered *inside* the message **is** the edit form — nearest provider wins, no separate edit-form family. `Message.Root` carries `data-editing` while active. Gate the nested composer on `isEditing` from `useMessageContext()`: `useChatInput` reads the message context, seeds `value` from `textContent`, routes submit to `editMessage(message.id, value)`, and maps Escape to `cancelEdit`.

```tsx
function EditableMessage({ m }: { m: ChatMessage }) {
  return (
    <Message.Root message={m}>
      <MessageBody />
    </Message.Root>
  )
}

function MessageBody() {
  const { isEditing } = useMessageContext()
  if (!isEditing) return <Message.Content />
  return (
    <ChatInput>
      <ChatInput.Field />
      <ChatInput.Submit />
    </ChatInput>
  )
}
```

### Headless (L3)

`useMessageParts` returns the typed part list; `useMessageContext` reads the message context; you render every element.

```tsx
function MyMessage({ message }: { message: ChatMessage<MyMeta> }) {
  const groups = useMessageParts(message)   // typed PartGroup[]
  const { copied, copy } = useClipboard(getTextContent(message))
  return (
    <article className="anything" data-role={message.role}>
      {groups.map((group) => /* your own switch over part types */ null)}
      <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </article>
  )
}
```

`groupPartsInOrder` is the pure primitive under `useMessageParts`, exported for L3.

## Customization (eject path)

Per-piece, never all-or-nothing:

1. **Parts first.** Restyle one part type via the `tools` registry or the `Message.Parts` render fn — this never ejects the row.
2. **The row next.** Paste the public L1 composition of the row and edit the piece you care about.
3. **The list never.** Swapping a part or a row never forces ejecting `ChatMessageList`.

Any leaf can be replaced by your own element via `asChild` or the corresponding hook.

## Related

- [`useMessageParts`](../hooks/use-message-parts.md) — typed part groups
- [`useMessageContext`](../hooks/use-message-context.md) — message context reader
- [`useClipboard`](../hooks/use-clipboard.md) — copy state
- [`useMessageBranches`](../hooks/use-message-branches.md) — branch navigation
- [`useChat`](../hooks/use-chat.md) — session state and callbacks
- [ToolCall](./tool-call.md) · [Reasoning](./reasoning.md) · [Sources](./sources.md) · [MessageActionBar](./message-action-bar.md) · [BranchPicker](./branch-picker.md)
