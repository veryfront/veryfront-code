# K0 — Collections house rule (the 4-tier pattern)

Spec for epic **E6** (§K). Every `veryfront/chat` collection — a component that
renders *N* of something (parts, attachments, transcript messages,
conversations, sources, agents, suggestions, steps, branches, models) — ships
the **same four access points off one implementation**. Codify it once here;
applying it per list is then mechanical.

Reference implementation:
[`src/react/components/chat/chat/components/sources.tsx`](../../src/react/components/chat/chat/components/sources.tsx)
(`Sources`). `ToolCall` and `Reasoning` follow the same render-or-compose shape
for single items; this generalises it to lists.

## The four tiers

For a collection `X` over item type `Item`:

| Tier | Export | Role |
| --- | --- | --- |
| 1. Data hook | `useX(): XContextValue` | Headless. Returns `{ items, ...actions }`. Throws (via `COMPONENT_ERROR`) outside an `X.Root`. The **only** place list state is read. |
| 2. Leaf | `<X.Item item={item} index={i} />` | One row. A dumb consumer — presentation + a single root `className`, no fetching/effects. Individually replaceable. |
| 3. List primitive | `<X.List>` | The container. `children ?? items.map(item => <X.Item …/>)` — function-as-default: **no children → default anatomy; children → you compose**. |
| 4. Batteries | `<X>` = `X.Root` | Context provider + default layout. `<X items={…} />` renders tiers 3+2 with zero config. `Object.assign(XRoot, { Root, List, Item })`. |

```tsx
// Tier 4 — batteries (zero config)
<Sources sources={sources} />

// Tiers 4+3+2 — compose the row, keep default pills
<Sources.Root sources={sources}>
  <Sources.List />
</Sources.Root>

// Full recompose — your own pills, each still reading useSources()
<Sources.Root sources={sources}>
  <Sources.List>
    {sources.map((s, i) => <Sources.Pill key={s.title + i} source={s} index={i} />)}
  </Sources.List>
</Sources.Root>

// Tier 1 — a hand-written leaf loses no behaviour
function MyPill({ source, index }: { source: Source; index: number }) {
  const { onSourceClick } = useSources();
  return <button onClick={() => onSourceClick?.(source, index)}>{source.title}</button>;
}
```

## Rules (each is a gate, not a guideline)

1. **One implementation.** Tiers 4→3→2 delegate; the default anatomy of tier 4
   *is* `<X.List>`, whose default *is* mapping `<X.Item>`. No parallel code path
   for "batteries" vs "composed".
2. **Context is the seam.** Every tier below `Root` reads state via `useX()`,
   never props drilled from the parent. That is what lets a swapped leaf keep
   sibling behaviour (the acid test).
3. **`children ?? default`.** Passing children *replaces* the default anatomy at
   that tier; omitting them renders it. Never a `show*`/`render*` boolean to pick
   between them (composition-patterns §1.1/§3.2).
4. **One root `className` per tier.** No `itemClassName` / `listClassName`
   passthrough bags on the parent — style the tier you mean by composing it (see
   `ban-chat-antipatterns` passthrough ratchet).
5. **Stable keys.** Key rows by a stable item identity, never the array index,
   on any list that can insert/delete/reorder (parts, attachments,
   conversations, transcript). See finding F-6.
6. **`renderItem` only for data lists, shaped `({ item, index }) => …`.** Static
   structure uses children, not render props (composition-patterns §3.2). Legacy
   `render*` props stay `@deprecated` until the E8–E10 breaking batch.

## Conformance (E6 acceptance)

Each collection gets a **collection-conformance contract test** asserting all
four tiers render off the one implementation and a swapped `<X.Item>` keeps
sibling behaviour. Heterogeneous lists (parts, attachments) get the full test;
homogeneous lists (sources, models, …) get the lighter variant. The exemplars —
**parts + attachments + transcript** — ship first; the rest follow by convention.

## Naming

`X` (batteries) · `X.Root` · `X.List` · `X.Item` · `useX()`. Item-level leaves
that predate this rule may keep their name (`Sources.Pill`, `Message.Part`) but
must still satisfy tiers 1–4. The list render prop, where one is unavoidable on a
data list, is `renderItem` (not `renderRow`/`renderPill`/`renderCard`).
