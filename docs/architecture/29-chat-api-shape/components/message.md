# Message

One message row: a single `<article>` plus scoped context, with composable parts for content, actions, and metadata.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { Message } from 'veryfront/chat'
```

## Anatomy

`Message.Root` renders exactly **one `<article>`** and provides scoped context (`MessageContextProvider`) to its children. There is no other node — every layout element between the parts is yours.

```tsx
<Message.Root message={message}>
  <Message.Avatar />
  <Message.Header>
    <Message.Name />
    <Message.Timestamp />
  </Message.Header>
  <Message.Content>
    <Message.Parts>
      {(part) =>
        isToolPart(part)      ? <ToolCall.Root part={part} /> :
        isReasoningPart(part) ? <Message.Reasoning part={part} /> :
                                <Message.Text part={part} />}
    </Message.Parts>
    <Message.Sources />
  </Message.Content>
  <Message.Actions>
    <Message.CopyAction />
    <Message.RegenerateAction />
    <Message.EditAction />
  </Message.Actions>
  <Message.BranchPicker />
  <Message.Tokens />
  <Message.Continuing />
</Message.Root>
```

Every part renders one node, `extends` the native attributes of that node, spreads `{...props}` onto it, and takes `asChild`.

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `Message.Root` | `<article>` | `data-role` `data-agent-id` `data-streaming` `data-editing` `data-error` | The single message node + scoped context. |
| `Message.Avatar` | `<div>` | — | Author avatar; derives from **message** metadata (multi-agent ready), never from conversation-level agent config. |
| `Message.Header` | `<header>` | — | Header container. |
| `Message.Name` | `<span>` | — | Author name; derives from the message's metadata. |
| `Message.Timestamp` | `<time>` | — | Message timestamp. |
| `Message.Content` | `<div>` | — | Content container. |
| `Message.Parts` | *(no node)* | — | Render-fn iterator over the message's parts: `{(part) => …}`. Typed and registry-aware. |
| `Message.Text` | per type | `data-streaming` | Text part leaf (Markdown-backed — see the markdown exception). |
| `Message.Reasoning` | per type | — | Reasoning part leaf (see [Reasoning](./reasoning.md)). |
| `Message.Source` | per type | — | Source part leaf. |
| `Message.File` | per type | — | File part leaf — sent and received attachments are renderable parts. |
| `Message.Image` | per type | — | Image part leaf. |
| `Message.Sources` | `<section>` | `data-empty` | Citation list for the message (see [Sources](./sources.md)). |
| `Message.Actions` | `<div>` | `data-floating` | Action bar container. Hidden-but-animatable — never unmounted to hide. |
| `Message.CopyAction` | `<button>` | `data-copied` | Copies the message text; `data-copied` is the transient copied feedback. |
| `Message.RegenerateAction` | `<button>` | — | Regenerates the message. |
| `Message.EditAction` | `<button>` | — | Enters edit mode. |
| `Message.BranchPicker` | `<div>` | `data-active` | Branch navigation (see [BranchPicker](./branch-picker.md)). |
| `Message.Tokens` | `<span>` | — | Renders the message's `ChatMessageMetadataUsage`. |
| `Message.Continuing` | `<span>` | — | Continuation indicator. |

There is no `Message.Feedback` in v1 — it is cut (no backend endpoint) and returns additively later.

## Props (`Message.Root`)

| Prop | Type | Description |
| --- | --- | --- |
| `message` | `ChatMessage<TMetadata, TDataParts, TTools>` | The message to render. Generics flow through `Message.Parts`' render prop, `useMessageParts`, and the part leaves. |
| `asChild` | `boolean` | Merge the single node onto your own element. |
| …rest | `React.HTMLAttributes<HTMLElement>` | Spread onto the `<article>` — `className`, `style`, `data-*`, `aria-*`, handlers, `ref`. |

Session callbacks (`editMessage`, `reload`) come from the nearest `ChatRoot` context — they are **never re-threaded per message**.

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-role` | `user \| assistant \| system` | Author role. |
| `data-agent-id` | `<id>` | Producing agent — per-message, for per-agent styling in multi-agent conversations. |
| `data-streaming` | present | This message is streaming now (also on `Message.Text`). |
| `data-editing` | present | The edit composer is active. |
| `data-error` | present | The message errored. |
| `data-empty` | present | On `Message.Sources` when there are no sources. |
| `data-floating` | present | On `Message.Actions` — hidden-but-animatable. |
| `data-copied` | present | On `Message.CopyAction` — transient copied feedback. |
| `data-active` | present | On `Message.BranchPicker` — selected branch. |

```css
/* style state with CSS, not boolean props */
[data-role='user'] { justify-self: end; }
[data-streaming] .cursor { display: inline-block; }
[data-agent-id='researcher'] { --accent: var(--purple-9); }
```

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

A `ChatInput` rendered *inside* the message **is** the edit form — nearest provider wins, no separate edit-form family. `Message.Root` carries `data-editing` while active.

```tsx
<Message.Root message={m}>
  {/* when isEditing, render the composer in place */}
  <ChatInput>
    <ChatInput.Field />
    <ChatInput.Submit />
  </ChatInput>
</Message.Root>
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
