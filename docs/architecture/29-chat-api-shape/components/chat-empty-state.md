# ChatEmptyState

The zero-messages view: hero agent avatar, heading, and a wrapping row of typed prompt-suggestion chips.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatEmptyState, getAgentPromptSuggestionItems } from 'veryfront/chat'
```

## Parts index

- [`.Root`](#chatemptystateroot--kept) — `kept`
- [`.Avatar`](#chatemptystateavatar--changed) — `changed`: `isCreating` styling boolean → `data-creating` candidate (TBD)
- [`.Heading`](#chatemptystateheading--changed) — `changed?`: keep-or-drop of `level` under `asChild` is TBD
- [`.Suggestions`](#chatemptystatesuggestions--changed) — `changed`: `data-empty` state attribute added
- [`.Suggestion`](#chatemptystatesuggestion--kept) — `kept`

## Anatomy

```tsx
<ChatEmptyState.Root>                       {/* centered flex column */}
  <ChatEmptyState.Avatar />                 {/* 64px agent avatar (image or initial) */}
  <ChatEmptyState.Heading />                {/* balanced, centered <h2> */}
  <ChatEmptyState.Suggestions>              {/* wrapping, centered chip row */}
    <ChatEmptyState.Suggestion />           {/* one prompt chip (a `ui` Button) */}
  </ChatEmptyState.Suggestions>
</ChatEmptyState.Root>
```

Unlike `ToolCall`/`AgentPicker`, this compound is **composition-only today — there is no childless preset**: each part is a small piece you arrange yourself (the `<Chat />` L1 preset does this arranging for `Chat.Empty`). Whether a data-driven childless render (`agent` in → default anatomy out) should exist is **TBD** in the RFC.

## Default DOM (childless render)

The canonical composition above renders this DOM today (classes abbreviated to layout-relevant ones):

```html
<div class="flex flex-1 flex-col items-center justify-center gap-3.5 px-4">  <!-- .Root — vertical flex column, centered
                                                                                  both axes; flex-1 assumes a flex parent
                                                                                  (fills the transcript viewport) -->
  <div class="size-16 shrink-0 rounded-full overflow-hidden flex items-center justify-center">  <!-- .Avatar (ui Avatar, muted) -->
    <img class="w-full h-full rounded-full object-cover" />       <!-- when src resolves… -->
    <span class="w-full h-full flex items-center justify-center"> <!-- …else one initial, container-query scaled
                                                                       (text-[length:44cqw]) to fill the circle -->
      S
    </span>
  </div>
  <h2 class="text-[1.375rem] font-semibold text-center text-balance leading-[1.2]">  <!-- .Heading -->
    Support Agent
  </h2>
  <div role="group" class="mt-4 flex flex-wrap justify-center gap-2">  <!-- .Suggestions — wrapping centered row;
                                                                            chips reflow to multiple lines -->
    <button class="h-9 rounded-md px-3.5">Create a plan</button>        <!-- .Suggestion (ui Button, tertiary/sm) -->
    <button class="h-9 rounded-md px-3.5">Summarize this doc</button>
  </div>
</div>
```

Conditional presence: the `<img>`/initial swap on `.Avatar` is runtime (image load failure falls back to the initial); with `isCreating` the avatar pulses. Nothing here is absolutely positioned or hover-revealed — the whole view is an in-flow flex column.

## Parts

### `ChatEmptyState.Root` — `kept`

The container — one `<div>`. Already on the node contract today: `extends React.HTMLAttributes<HTMLDivElement>`, spreads `{...props}`, `ref` prop, `className` merges. **Layout: in-flow vertical flex column (`flex flex-1 flex-col`), children centered on both axes with `gap-3.5`; `flex-1` makes it fill a flex parent (the transcript area).**

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | The parts, in your order |
| `asChild` *(proposed)* + native + `ref` | `HTMLAttributes<HTMLDivElement>` | Native spread and `ref` exist today; `asChild` is the proposed addition |

### `ChatEmptyState.Avatar` — `changed`

*Changed: the `isCreating` styling boolean is proposed to become `data-creating` (TBD in the RFC); everything else is as today.*

The hero avatar — renders the shared `ui` `Avatar` (one `<div>` circle containing either the image or a single-initial `<span>`), sized 64px in `muted` tone. **Layout: in-flow `shrink-0` circle (`size-16`), a flex child of the Root column.** Default content: the agent's image when `src` resolves, otherwise the first initial of `alt` (container-query scaled to fill). Never null-renders — no `src` just means the initial.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `src` | `string` | — | Avatar image URL (`agent.avatarUrl`); load failure falls back to the initial |
| `alt` | `string` | `"Veryfront Agent"` | Accessible name + initial source |
| `isCreating` | `boolean` | — | Pulses the avatar while the agent is being provisioned. *Proposed:* a styling boolean — candidate for `data-*` under rule 7 (`data-creating`), **TBD** in the RFC |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` (no `children`) | | Spread onto the Avatar node today; `asChild` proposed |

### `ChatEmptyState.Heading` — `changed?`

*Changed?: whether `asChild` replaces the `level` prop (keep or drop) is TBD in the RFC; otherwise as today.*

The title — one heading element, `<h2>` by default. **Layout: in-flow centered text block (`text-center text-balance`), a flex child of the Root column.** Default content: none — children are the text (typically the agent name).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `level` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | `2` | Renders `<h{level}>` — the one sanctioned tag-choosing prop here today; under the proposal `asChild` covers it (keep or drop `level` is **TBD**) |
| `children` | `ReactNode` | — | The heading text |
| + native + `ref` | `HTMLAttributes<HTMLHeadingElement>` | | Spread today; `asChild` proposed |

### `ChatEmptyState.Suggestions` — `changed`

*Changed: a `data-empty` state attribute is added (proposed); today emptiness is just rendering no children.*

The chip container — one `<div role="group">`. **Layout: in-flow wrapping row (`flex flex-wrap justify-center gap-2`), pushed off the heading with `mt-4`; chips reflow onto multiple centered lines.** Default content: none — you map suggestion items onto `.Suggestion` children.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `role` | `string` | `"group"` | Overridable via native spread |
| `children` | `ReactNode` | — | The `.Suggestion` chips |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | | Spread today; `asChild` proposed |

**State attributes (proposed):** `data-empty` — zero suggestion items (global list-container vocabulary). Today emptiness is simply "you rendered no children".

### `ChatEmptyState.Suggestion` — `kept`

One prompt chip — one `<button>` (a `ui` Button, locked to `variant="tertiary"`, `size="sm"`, `h-9 px-3.5`). **Layout: in-flow flex-row chip inside the wrapping Suggestions row.** Default content: none — children are the label. Click behavior is yours (`onClick` → send the item's `prompt`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `ButtonProps['size']` | `"sm"` | Any Button prop except `variant` passes through today (`Omit<ButtonProps, 'variant'>`) |
| `children` | `ReactNode` | — | The chip label |
| + native + `ref` | `ButtonHTMLAttributes<HTMLButtonElement>` | | Spread today (via Button); `asChild` proposed |

## Context (what the parts read)

**None.** `ChatEmptyState` is purely presentational — the parts share no context and there is no `useChatEmptyState()`. Data enters through props/children, and the suggestion data is a pure helper:

### Typed suggestions

```ts
getAgentPromptSuggestionItems(agent) // → { label: string; prompt: string }[]
```

Made public in the proposal (issue #2978). You map the items onto `.Suggestion` yourself, so **selection hands the item back** — `{ label, prompt }` is in hand in your `onClick`; no `.find` massaging to recover the prompt from a clicked label. (The lossy `getAgentPromptSuggestions(agent) → string[]` remains only for compatibility.)

## State attributes

| Attribute | On | Meaning | Status |
| --- | --- | --- | --- |
| `data-empty` | `.Suggestions` | Zero suggestion items | proposed |

## Examples

### Default

Rendered inside the `<Chat />` preset (as `Chat.Empty`) when the transcript has no messages.

### Composed

Map the typed items onto `.Suggestion` — the item is in hand at click time:

```tsx
function EmptyState({ agent }: { agent: Agent }) {
  const chat = useChatContext()
  const items = getAgentPromptSuggestionItems(agent)
  return (
    <ChatEmptyState.Root className="my-empty">
      <ChatEmptyState.Avatar src={agent.avatarUrl} alt={agent.name} />
      <ChatEmptyState.Heading>{agent.name}</ChatEmptyState.Heading>
      <ChatEmptyState.Suggestions className="my-grid">
        {items.map((item) => (
          <ChatEmptyState.Suggestion key={item.label}
            onClick={() => chat.sendMessage(item.prompt)}>
            {item.label}
          </ChatEmptyState.Suggestion>
        ))}
      </ChatEmptyState.Suggestions>
    </ChatEmptyState.Root>
  )
}
```

### Headless

The suggestion data is a pure helper — no hook required. Render anything:

```tsx
const items = getAgentPromptSuggestionItems(agent)

<div className="anything">
  {items.map((item) => (
    <button key={item.label} onClick={() => chat.sendMessage(item.prompt)}>
      {item.label}
    </button>
  ))}
</div>
```

## Customization (eject path)

1. **L1** — the default empty state inside `<Chat />`.
2. **L2** — paste the composition (printed under *Anatomy*); every part is a single node (`asChild`, `className`, `data-*`) and the layout between them is yours.
3. **L3** — `getAgentPromptSuggestionItems(agent)` + your own markup; nothing else is needed.

## Related

- `Chat` — the L1 preset (`Chat.Empty`)
- [`useAgentMetadata`](../hooks/use-agent-metadata.md) — source of the `agent` passed to the helper
- `getAgentPromptSuggestionItems` / `getAgentPromptSuggestions` — helpers
