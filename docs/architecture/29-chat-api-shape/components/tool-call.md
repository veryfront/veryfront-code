# ToolCall

A disclosure for one tool invocation — input, output, and the full lifecycle including human-in-the-loop approval. Render it whole, or compose the parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ToolCall } from 'veryfront/chat'
```

## Anatomy

```tsx
<ToolCall.Root part={part}>
  <ToolCall.Trigger />     {/* wrench icon · tool name · status badge · chevron */}
  <ToolCall.Body>          {/* collapsible region; null while collapsed */}
    <ToolCall.Input />     {/* "Parameters" + highlighted JSON, only when input exists */}
    <ToolCall.Output />    {/* "Result" + auto-table or JSON, only when output exists */}
    <ToolCall.Error />     {/* error Alert, only when errorText exists */}
  </ToolCall.Body>
</ToolCall.Root>
```

`<ToolCall.Root>` with **no children renders exactly this default anatomy** (render-or-compose, like `Message`). Pass children to recompose, reorder, or omit parts. With `variant="compact"` the default anatomy is a single-line row instead (see [Compact variant](#compact-variant)).

## Default DOM (childless render)

The actual HTML of `<ToolCall part={part} />` today (classes abbreviated to layout-relevant ones):

```html
<div class="w-full overflow-hidden rounded-md border px-4 py-2.5">   <!-- .Root — in-flow block card, full width -->
  <button class="flex w-full items-center justify-between gap-3">    <!-- .Trigger — full-width flex row; name cluster left, chevron pushed right -->
    <div class="flex min-w-0 items-center gap-2">                    <!--   name cluster: flex row gap-2; min-w-0 lets the name truncate -->
      <svg class="size-3.5 shrink-0" />                              <!--   wrench icon: fixed size, never shrinks -->
      <span class="min-w-0 truncate text-sm font-medium">web_search</span>  <!-- tool name: truncates first -->
      <span class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5">…</span> <!-- status badge pill: icon + label -->
    </div>
    <svg class="size-3.5 shrink-0" />                                <!--   chevron: shrink-0; rotate-180 when open -->
  </button>

  <div class="mt-3 border-t pt-3">                                   <!-- .Body — in-flow block; PRESENT ONLY WHEN EXPANDED -->
    <div class="space-y-2 overflow-hidden">                          <!-- .Input — ONLY when part.input !== undefined -->
      <h4 class="text-xs">Parameters</h4>
      <div class="rounded-md bg-secondary p-3">
        <pre class="whitespace-pre-wrap font-mono text-sm">…highlighted JSON…</pre>
      </div>
    </div>
    <div class="mt-3 space-y-2 border-t pt-3">                       <!-- .Output — ONLY when output is not null/undefined -->
      <h4 class="text-xs">Result</h4>
      <div class="overflow-x-auto rounded-md bg-secondary">…auto-table or JSON…</div>  <!-- wide tables scroll horizontally -->
    </div>
    <div class="mt-3 border-t pt-3">                                 <!-- .Error — ONLY when part.errorText exists -->
      <div role="alert">…error Alert: icon + text…</div>
    </div>
  </div>
</div>
```

No absolute positioning anywhere — every part is an in-flow block/flex child; the disclosure works by mounting/unmounting `.Body`.

Compact variant (`variant="compact"`, default for skill tools) renders a single in-flow row instead:

```html
<p class="flex min-w-0 items-center gap-2 truncate text-sm">         <!-- flex row; label truncates -->
  <svg class="size-3.5 shrink-0" />                                  <!-- sparkles (pulsing) while loading, check when loaded -->
  <span class="min-w-0 truncate">Loading skill: research</span>      <!-- shimmers while loading -->
</p>
```

## Parts

### `ToolCall.Root`

The card container (one `<div>`, bordered, rounded) + the compound's scoped context. The tool part enters here; sub-parts read it from context.

**Layout:** in-flow block card, `w-full overflow-hidden`; establishes no positioning context (no absolute children).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `part` *(required)* | typed tool part (`ChatToolPart \| ChatDynamicToolPart`) | — | The tool part to render. `useToolCall<TTools>` narrows per tool name (`part.type === 'tool-…'`). *(Today's prop is named `tool`; `part` is the proposed rename to match `Message.Parts` vocabulary.)* |
| `variant` | `'card' \| 'compact'` | `'compact'` for skill tools (`load_skill`, `load_skill_reference`, `execute_skill_script`), `'card'` otherwise | Presentation axis, not a severity/type. `'compact'` is the retired `SkillTool` folded in as a variant. |
| `defaultExpanded` | `boolean` | auto: errored tools open, everything else collapsed | Initial expanded state when uncontrolled. Today's default keeps fast tools from stacking up expanded and burying the reply; errors stay open so failures aren't hidden behind a click. |
| `onToggle` | `(next: boolean, e: MouseEvent) => void` | — | Called when the disclosure toggles. |
| ~~`icon`~~ | `ReactNode` | — | **Removed.** The RFC bans `icon` slot props (~30 files use them today); pass children to `ToolCall.Trigger` to replace the default icon. |
| `asChild` *(proposed)* | `boolean` | `false` | Merge the root node onto your own element. |
| + native | `React.HTMLAttributes<HTMLDivElement>` · `ref` | — | Spread onto the single node; `className` merges. |

**State attributes (proposed):**

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-state` | `input-streaming \| input-available \| output-available \| output-error \| approval-requested \| approval-responded \| output-denied` | Full tool lifecycle including human-in-the-loop approval. All seven states exist in today's status-badge config (labels `Pending / Running / Awaiting Approval / Responded / Completed / Error / Denied`); surfacing them as `data-state` on the root is the proposed addition. |
| `data-open` | present | Expanded. **Proposed behavior change:** auto-opens on completion. Today the card is collapsed by default and only auto-opens on error. |

```css
[data-state='input-streaming'] { opacity: 0.7; }
[data-state='approval-requested'] { border-color: var(--warning); }
[data-state='output-error'] { border-color: var(--danger); }
```

### `ToolCall.Trigger`

One full-width `<button>`. Default content: wrench icon → tool name (`truncate`, from `part.toolName`) → status badge (a pill with per-state icon + label: pulsing clock while running, green check when completed, yellow clock awaiting approval, red X on error, orange X when denied) → chevron pushed right, rotating 180° when open. Always renders.

**Layout:** in-flow full-width flex row (`justify-between gap-3`); the left cluster is `flex min-w-0 gap-2` so the tool name truncates while icon, badge, and chevron are `shrink-0`.

| Prop | Type | Description |
| --- | --- | --- |
| ~~`icon`~~ | `ReactNode` | **Removed** (today overrides the leading wrench icon). Pass children to replace the default icon/name/badge content. |
| `asChild` + native (`ButtonHTMLAttributes`, `ref`) | | Own the node; `data-open` *(proposed)* mirrors the root. |

### `ToolCall.Body`

One `<div>` (top border, padded). Default content: `Input` → `Output` → `Error`. **Renders `null` while the disclosure is collapsed** — safe to include unconditionally.

**Layout:** in-flow block below the trigger; mounted/unmounted by open state (no height animation today).

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` | | Own the node; children replace the default `Input`/`Output`/`Error` stack. |

### `ToolCall.Input`

The "Parameters" block: a muted `Parameters` heading + the tool input as syntax-highlighted JSON (keys green, strings amber, numbers blue, booleans purple; HTML-escaped first) on a secondary surface. **Renders `null` when `part.input === undefined`.** While `data-state="input-streaming"`, the input is the partial object streamed so far.

**Layout:** in-flow block inside `.Body` (`space-y-2 overflow-hidden`); the JSON `<pre>` wraps (`whitespace-pre-wrap`) rather than scrolling.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replaces the rendered value (the heading and surface stay). |
| `asChild` + native + `ref` | | Own the node. |

**Proposed:** the JSON rendering moves onto `RichCodeBlock`, so it falls under the markdown exception — the `Markdown` `components={{ code, … }}` override map reaches it. Today it is a bespoke `<pre>` with regex highlighting.

### `ToolCall.Output`

The "Result" block: a muted `Result` heading + the output. Default rendering: an array of uniform objects becomes an auto `<table>` (title-cased column headers from the first row's keys); anything else renders as syntax-highlighted JSON. **Renders `null` when `part.output` is `undefined` or `null`.**

**Layout:** in-flow block with its own top border; the value surface is `overflow-x-auto`, so wide tables scroll horizontally instead of stretching the card.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replaces the rendered value (heading and surface stay). |
| `asChild` + native + `ref` | | Own the node. |

**Proposed:** `Markdown`/`RichCodeBlock`-backed, same markdown exception as `.Input` — every emitted element stays replaceable via the `components` map.

### `ToolCall.Error`

One `<div>` wrapping an error-variant `Alert` (X-circle icon + `part.errorText`). **Renders `null` unless the part carries `errorText`.**

**Layout:** in-flow block with its own top border, last in the default `.Body` stack.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` | | Own the node. |

### Compact variant

With `variant="compact"` (the default for skill tools), the root renders a single-line row instead of the card: pulsing sparkles icon + shimmering `Loading skill: <name>` while running, then a check + `Loaded skill: <name>` on `output-available`. Pass children to `ToolCall.Root` to replace the row entirely — the context still provides the part.

**Layout:** one in-flow flex row (`min-w-0 gap-2`); icon `shrink-0`, label truncates. No border, no disclosure — nothing expands.

## Context (what the parts read)

`useToolCall<TTools>(part?)` — part explicit at L3, from context at L2; throws outside a `ToolCall` when no part is passed:

```ts
{
  part: ToolPart            // narrowed per tool name via TTools
  state: ToolState          // drives data-state
  input: unknown            // partial while streaming
  output: unknown
  error: string | undefined
  isOpen: boolean
  toggle: () => void
  getTriggerProps: () => ButtonProps
  getBodyProps: () => DivProps
}
```

*Grounding:* today's context is `{ tool, isExpanded, toggle, hasOutput, hasError }`; the RFC adds the prop getters, per-tool type narrowing, and the explicit-part L3 form.

## Rendering resolution

"Render *this* tool my way" never forces ejecting the tree. Resolution order:

1. **Inline render fn** — `<Message.Parts>{(part) => …}</Message.Parts>`
2. **Tools registry by name** — `<Chat tools={{ web_search: MyToolCard }} />` or `<ChatMessageList tools={…}>`. Registry values are components receiving the typed part; the registry is typed against `TTools`, so a wrong renderer signature is a compile error.
3. **Default renderer** — this component.

## Examples

### Default

Register a custom renderer for one tool; everything else keeps the default.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" tools={{ web_search: MyToolCard }} />
```

### Composed (L2)

At L2 the part comes from context inside `Message.Parts`, or explicitly via the `part` prop.

```tsx
<Message.Parts>
  {(part) =>
    isToolPart(part) ? (
      <ToolCall.Root part={part} className="my-tool">
        <ToolCall.Trigger className="my-tool-trigger" />
        <ToolCall.Body>
          <ToolCall.Input className="my-tool-input" />
          <ToolCall.Output className="my-tool-output" />
          <ToolCall.Error className="my-tool-error" />
        </ToolCall.Body>
      </ToolCall.Root>
    ) : (
      <Message.Text part={part} />
    )}
</Message.Parts>
```

Compact variant (the retired `SkillTool`):

```tsx
<ToolCall.Root part={part} variant="compact" />
```

### Headless (L3)

Pass the part explicitly; the hook returns state and prop getters, and you render every node.

```tsx
function MyToolCard({ part }: { part: MyToolPart }) {
  const tool = useToolCall<MyTools>(part)
  return (
    <div data-state={tool.state} className="anything">
      <button {...tool.getTriggerProps()} className="anything">
        {part.type}
      </button>
      {tool.isOpen && (
        <div {...tool.getBodyProps()}>
          <pre>{JSON.stringify(tool.input, null, 2)}</pre>   {/* partial while streaming */}
          {tool.output && <div>{/* render output your way */}</div>}
          {tool.error && <div role="alert">{String(tool.error)}</div>}
        </div>
      )}
    </div>
  )
}
```

## Customization (eject path)

1. **L1:** `tools={{ name: Component }}` on `<Chat>` — replace one tool's card, nothing else moves.
2. **L2:** paste the default `ToolCall` composition inside your `Message.Parts` render fn and restyle each part; swap any part's element via `asChild`.
3. **L3:** `useToolCall(part)` and render every node yourself with the getters.

## Related

- [`useToolCall`](../hooks/use-tool-call.md) — state, getters, per-tool type narrowing
- [`useMessageParts`](../hooks/use-message-parts.md) — typed part iteration
- [Message](./message.md) — the row that hosts tool parts
