# ToolCall

A disclosure for one tool invocation — input, output, and the full lifecycle including human-in-the-loop approval.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ToolCall } from 'veryfront/chat'
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`. You supply any layout divs in between.

```tsx
<ToolCall.Root part={part}>
  <ToolCall.Trigger />
  <ToolCall.Body>
    <ToolCall.Input />
    <ToolCall.Output />
    <ToolCall.Error />
  </ToolCall.Body>
</ToolCall.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ToolCall.Root` | `<div>` | `data-state` `data-open` | Disclosure root + context. `data-open` auto-opens on completion. |
| `ToolCall.Trigger` | `<button>` | `data-open` | Toggles the body. |
| `ToolCall.Body` | `<div>` | — | Collapsible content container. |
| `ToolCall.Input` | `<pre>` | — | Tool input — `RichCodeBlock`/`Markdown`-backed; input is partial while streaming. |
| `ToolCall.Output` | `<div>` | — | Tool output — `Markdown`-backed. |
| `ToolCall.Error` | `<div>` | — | Tool error. |

`ToolCall.Input` and `ToolCall.Output` are covered by the markdown exception: the `Markdown` `components={{ code, a, img, … }}` override map reaches them, so every emitted element is still replaceable.

## Props (`ToolCall.Root`)

| Prop | Type | Description |
| --- | --- | --- |
| `part` | typed tool part | The tool part to render. `useToolCall<TTools>` narrows the type per tool name (`part.type === 'tool-…'`). |
| `variant` | `'compact'` | Compact rendering — replaces the retired `SkillTool`. |
| `asChild` | `boolean` | Merge the root node onto your own element. |
| …rest | native `<div>` attributes | Spread onto the root — `className`, `data-*`, `aria-*`, handlers, `ref`. |

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-state` | `input-streaming \| input-available \| output-available \| output-error \| approval-requested \| approval-responded \| output-denied` | Full tool lifecycle, including human-in-the-loop approval. |
| `data-open` | present | Expanded. Auto-opens on completion. |

```css
[data-state='input-streaming'] { opacity: 0.7; }
[data-state='approval-requested'] { border-color: var(--warning); }
[data-state='output-error'] { border-color: var(--danger); }
```

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

`useToolCall<TTools>(part?)` returns `{ part, state, input, output, error, isOpen, toggle, getTriggerProps, getBodyProps }` — part explicit at L3, from context at L2.

## Customization (eject path)

1. **L1:** `tools={{ name: Component }}` on `<Chat>` — replace one tool's card, nothing else moves.
2. **L2:** paste the default `ToolCall` composition inside your `Message.Parts` render fn and restyle each part; swap any part's element via `asChild`.
3. **L3:** `useToolCall(part)` and render every node yourself with the getters.

## Related

- [`useToolCall`](../hooks/use-tool-call.md) — state, getters, per-tool type narrowing
- [`useMessageParts`](../hooks/use-message-parts.md) — typed part iteration
- [Message](./message.md) — the row that hosts tool parts
