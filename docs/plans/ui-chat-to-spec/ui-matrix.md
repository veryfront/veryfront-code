# RFC 0001 — UI primitive adapters: tracking matrix

Master dashboard for the `veryfront/ui` layer. A row is **done** only when every gate box
is checked. Boxes start unchecked. Legend: `☐` = todo · `☑` = done · `n/a` = not applicable.

Gate columns (see `spec.md`): **Spec · Built · Story · Test · Styled · Verified**.

## Tier-1 primitives (+ Drawer / Toast)

Build order: Popover (tracer) → Dialog → DropdownMenu → Tooltip → Select. Drawer unlocks as a
skin over `DialogParts`; Toast is Tier-2.

| Primitive    | Tier                    | Engine notes                                                   | Spec | Built | Story | Test | Styled | Verified |
| ------------ | ----------------------- | -------------------------------------------------------------- | :--: | :---: | :---: | :--: | :----: | :------: |
| Popover      | 1 (tracer)              | builtin default; Base UI adapter                               |  ☑   |   ☑   |  ☑¹   |  ☑   |   ☑    |    ☑     |
| Dialog       | 1                       | builtin `modal-surface`; Base UI                               |  ☑   |   ☑   |  ☑¹   |  ☑   |   ☑    |    ☑     |
| DropdownMenu | 1                       | builtin; Base UI                                               |  ☑   |   ☑   |  ☑¹   |  ☑   |   ☑    |    ☑     |
| Select       | 1 (dual state, hardest) | builtin; Base UI                                               |  ☑   |   ☑   |  ☑¹   |  ☑   |   ☑    |    ☑     |
| Tooltip      | 1                       | builtin; Base UI                                               |  ☑   |   ☑   |  ☑¹   |  ☑   |   ☑    |    ☑     |
| Drawer       | 1.5                     | **Vaul** candidate default over builtin `modal-surface` drawer |  ☐   |   ☐   |   ☐   |  ☐   |   ☐    |    ☐     |
| Toast        | 2                       | **Base UI Toast** (skinnable) OR **Sonner** (render-owning)    |  ☐   |   ☐   |   ☐   |  ☐   |   ☐    |    ☐     |

¹ Story = the pre-existing `storybook/stories/ui/{Popover,Dialog,DropdownMenu,Tooltip,Select}.stories.tsx`
(still render unchanged post-extraction — the skins' public APIs are untouched). `data-vf-state`
normalization is deferred until animation classes need it (builtin renders no closed node).

² The Base UI template is a **vendored** file (`@base-ui/react` is the consumer's dep, not
core's), so it isn't unit-tested inside core — it can't import an engine core doesn't depend
on. It's validated in the Phase-4 `chat-full-custom` example app, and the shared
`runPopoverConformance` suite is authored so the app can run it against the real engine.

## Cross-cutting items

Infrastructure that the primitives depend on. Story / Styled are `n/a` for non-visual
infrastructure.

| Item                               | What it is                                                                                                             | Spec | Built | Story | Test | Styled | Verified |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | :--: | :---: | :---: | :--: | :----: | :------: |
| `UIAdapterProvider` / `useAdapter` | `context.tsx` — partial map merged over `BuiltinAdapter`; never returns null                                           |  ☑   |   ☑   |  n/a  |  ☑   |  n/a   |    ☑     |
| Conformance harness                | `runPopoverConformance` in `adapter/popover.conformance.test.tsx`; token-scope portal test ☑, `data-vf-state` deferred |  ☑   |   ☑   |  n/a  |  ☑   |  n/a   |    ☑     |
| `useTokenScope`                    | `adapter/token-scope.tsx` — nearest `[data-vf-ui]`/`[data-vf-chat]` container resolver; exported from barrel           |  ☑   |   ☑   |  n/a  |  ☑   |  n/a   |    ☑     |
| Base UI reference adapter          | `cli/templates/ui-adapters/base-ui.tsx` — vendored template, popover + dialog, all 3 normalizations                    |  ☑   |   ☑   |  n/a  | n/a² |  n/a   |    ☑     |
| `"use client"` boundaries          | add to every Tier-1 file (currently absent)                                                                            |  ☐   |   ☐   |  n/a  |  ☐   |  n/a   |    ☐     |
| Engine-import CI guard             | `boundary.test.ts` — asserts no engine specifier under `ui/**` (adapters are vendored templates)                       |  ☑   |   ☑   |  n/a  |  ☑   |  n/a   |    ☑     |
| `veryfront generate adapter`       | CLI scaffold type; copies `cli/templates/ui-adapters/base-ui.tsx`                                                      |  ☐   |   ☐   |  n/a  |  ☐   |  n/a   |    ☐     |
| `ui.adapter` config                | config schema field                                                                                                    |  ☐   |   ☐   |  n/a  |  ☐   |  n/a   |    ☐     |
