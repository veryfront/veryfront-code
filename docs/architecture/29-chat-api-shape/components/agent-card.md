# AgentCard

A status card for one running agent: identity header, live status, reasoning, tool calls, and streamed output — render it whole, or compose the parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { AgentCard } from 'veryfront/chat'
```

## Anatomy

```tsx
<AgentCard.Root status="thinking" name="Support Agent">
  <AgentCard.Header />     {/* Avatar · name · status dot */}
  <AgentCard.Reasoning />  {/* <Reasoning> block, only while thinking text exists */}
  <AgentCard.Tools />      {/* one <ToolCall> card per tool call */}
  <AgentCard.Body />       {/* each message rendered as <Markdown> */}
</AgentCard.Root>
```

`<AgentCard.Root>` with **no children renders exactly this default anatomy** (render-or-compose, like `ToolCall`). Pass children to recompose, reorder, or omit parts.

## Default DOM (childless render)

Everything is an in-flow flex child — a vertical stack of rows. Nothing is
floated or absolutely positioned:

```html
<div class="flex flex-col gap-3 …card outline surface, md padding"
     data-agent-status="thinking">                     <!-- .Root — vertical stack -->
  <div class="flex items-center gap-2">                <!-- .Header — one horizontal row -->
    <span class="size-8 …">…</span>                    <!--   avatar: fixed square, first in row -->
    <span class="min-w-0 truncate font-medium">…</span><!--   name: truncates when narrow -->
    <span class="ml-auto …">● Thinking</span>          <!--   status: ml-auto pushes it to the row end -->
  </div>
  <div>…</div>                                         <!-- .Reasoning — only when `thinking` present -->
  <div class="flex flex-col gap-2">                    <!-- .Tools — vertical list, only when toolCalls.length > 0 -->
    <div>…ToolCall card…</div>                         <!--   one per tool call, full row width -->
  </div>
  <div class="flex flex-col gap-2">                    <!-- .Body — vertical list, only when messages exist -->
    <div class="text-[15px] leading-7">…markdown…</div><!--   one Markdown block per message -->
  </div>
</div>
```

**Layout model:** `.Root` = column with `gap-3`; `.Header` = the only horizontal
row (avatar → name → status, status right-aligned via `ml-auto`, not absolute);
`.Reasoning`/`.Tools`/`.Body` stack full-width beneath it and disappear entirely
(render `null`) when their data is absent.

## Parts

### `AgentCard.Root`

The card container (one `<div>`, `ui` Card surface) + the compound's scoped context. All agent data enters here; sub-parts read it from context.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `status` *(required)* | `'idle' \| 'thinking' \| 'tool_execution' \| 'streaming' \| 'completed' \| 'error'` | — | Drives the header status dot/label and `data-agent-status` |
| `name` | `string` | `"Agent"` | Display name shown by `.Header` |
| `avatarUrl` | `string` | — | Avatar image; falls back to the name's initial |
| `messages` | `AgentMessage[]` | — | Streamed output; `.Body` renders each as Markdown |
| `toolCalls` | `ToolCall[]` | `[]` | `.Tools` renders each through the `ToolCall` card |
| `thinking` | `string` | — | Reasoning text; `.Reasoning` renders only when present |
| `asChild` | `boolean` | `false` | Merge onto your own element |
| + native | `React.HTMLAttributes<HTMLDivElement>` · `ref` | — | Spread onto the single node; `className` merges |

**State attributes (proposed):** `data-agent-status="idle|thinking|tool_execution|streaming|completed|error"` — today status is presented only visually (dot color + pulse); the RFC surfaces it as `data-*` so you can style any part off `[data-agent-status="error"]`.

### `AgentCard.Header`

One `<div>` row. Default content: `Avatar` (image or initial) → agent name (`truncate`) → `Status` dot + label pushed right (`Thinking`/`Running tools`/`Responding`/`Completed`/`Error`/`Idle`, pulsing while active). Mirrors `Message.Header`.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes<HTMLDivElement>`, `ref`) | | Own the node; children replace the default Avatar/name/Status content |

### `AgentCard.Reasoning`

Renders the shared [`Reasoning`](./reasoning.md) block with the card's `thinking` text. **Renders `null` when `thinking` is empty** — safe to include unconditionally.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` | | Applied to the `Reasoning` root; all `Reasoning` behavior (auto-open while streaming, `data-open`) applies |

### `AgentCard.Tools`

One `<div>` list. Default content: one [`ToolCall`](./tool-call.md) card per entry in `toolCalls` (agent tool statuses map onto the standard tool lifecycle: `pending → input-available`, `executing → input-streaming`, `completed → output-available`, `error → output-error`). **Renders `null` when there are no tool calls.**

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` | | Own the list node; children replace the default `ToolCall` mapping (use `useAgentCard().toolCalls`) |

### `AgentCard.Body`

One `<div>` column. Default content: each message's text rendered as [`Markdown`](./markdown.md) (mirroring `Message.Content`). **Renders `null` when there are no messages.**

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` | | Own the node; children replace the default Markdown mapping (use `useAgentCard().messages`) |

## Context (what the parts read)

`useAgentCard()` — throws outside `AgentCard.Root`:

```ts
{
  name: string
  avatarUrl?: string
  status: AgentStatus
  thinking?: string
  messages?: AgentMessage[]
  toolCalls: ToolCall[]
  presentation: { color: StatusColor; label: string; pulse: boolean }
}
```

## Examples

### Default

```tsx
<AgentCard status={agent.status} name={agent.name} avatarUrl={agent.avatarUrl}
  messages={agent.messages} toolCalls={agent.toolCalls} thinking={agent.thinking} />
```

### Composed — reorder, restyle, keep behavior

```tsx
<AgentCard.Root status={agent.status} name={agent.name} toolCalls={agent.toolCalls}>
  <AgentCard.Header className="border-b pb-2" />
  <div className="grid grid-cols-2 gap-3">   {/* YOUR div */}
    <AgentCard.Tools />
    <AgentCard.Body />
  </div>
  {/* Reasoning deliberately omitted */}
</AgentCard.Root>
```

### Headless — your card, library data

```tsx
function MyAgentRow() {
  const { name, status, toolCalls, presentation } = useAgentCard()
  return (
    <li data-agent-status={status} className="anything">
      {name} — {presentation.label} ({toolCalls.length} tools)
    </li>
  )
}
```

## Customization (eject path)

1. **L1** — `<AgentCard {...data} />`, default anatomy.
2. **L2** — pass children: the printed default anatomy above *is* the starting point; every part is one node (`asChild`, your classes), every layout div between them is yours.
3. **L3** — [`useAgentCard()`](../hooks/use-agent-card.md) inside the Root, or skip the compound entirely and build from [`useAgentMetadata`](../hooks/use-agent-metadata.md) / [`useAgents`](../hooks/use-agents.md).

## Related

- [`useAgentCard`](../hooks/use-agent-card.md) · [`useAgentMetadata`](../hooks/use-agent-metadata.md) · [`useAgents`](../hooks/use-agents.md)
- [`ToolCall`](./tool-call.md) · [`Reasoning`](./reasoning.md) · [`Markdown`](./markdown.md) · [`AgentPicker`](./agent-picker.md)
