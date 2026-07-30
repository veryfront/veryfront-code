# RFC 0001 — UI primitive adapters: implementation spec

**Layer definition of done for `veryfront/ui`.** Distilled from the approved plan
(`snappy-wibbling-quokka.md`) — sections "Quality gates", "Default engine decision",
and "Phase 2". This is the source of truth for when a `veryfront/ui` primitive (and the
adapter layer around it) is "done". Do not add requirements beyond what the RFC and plan
state.

## The thesis (why adapters at all)

Each behavioural `veryfront/ui` primitive splits into a **Skin** (Tailwind / `cva` /
token vars) + **Mechanics** (a swappable **adapter**: builtin / Base UI / Radix /
React Aria). Today's primitives are self-labelled "BASIC fork of `@radix-ui/*`" carrying a
standing `TODO(a11y)` list (focus trap, roving focus, typeahead, `aria-activedescendant`,
scroll-lock). That TODO list **is** the substrate gap. Per issue #220, accessible
interaction is a large, moving standard we should not hand-roll permanently — so the adapter
conformance suite is written as **differential tests against a real engine oracle**, and a
real engine is the direction of travel while the zero-dep builtin is a _fallback_, not a
forever-default.

## Per-primitive adapter contract

New tree: `src/react/components/ui/adapter/`.

- **`contract.ts`** — types only: `UIAdapter`, the parts bundles
  `PopoverParts` / `DialogParts` / `MenuParts` / `TooltipParts` / `SelectParts`, and the
  normalized `DisclosureProps`.
- **`context.tsx`** — `UIAdapterProvider` merges a **partial** map over `BuiltinAdapter`;
  `useAdapter()` **never returns null**, so the no-provider and provider paths are one code
  path. The map merges **per-key**, so an app can run every primitive on one engine while
  overriding single primitives with specialists.
- **`token-scope.tsx`** — `useTokenScopeRef()`: factor the existing
  `closest(UI_SCOPE_SELECTOR)` logic out of `floating.tsx` / `tooltip.tsx` into one hook.
- **`builtin/*`** — wraps today's machinery (`disclosure.ts`, `anchored-surface.tsx`,
  `modal-surface.tsx`, `floating.tsx`, `slot.tsx`) behind the contract.
- **`conformance.tsx`** — exports `runAdapterConformance(adapter)` so vendored adapters can
  diff their own engine against the oracle.

**Skin refactor pattern (per primitive, exports/signatures unchanged):** delete the
module-scope `createAnchoredSurfaceParts()` call; resolve parts per-render via `useAdapter()`.
`haspopup` moves from the skin into `builtinPopover.Trigger` / `builtinMenu.Trigger`.
Purely-visual sub-parts (`PopoverTitle`/`Header`/…) don't change.

**Behaviour-preserving extraction, proven by characterization (Phase 0, #220 differential
spirit):** there are **no** existing Tier-1 behaviour tests, so _first_ write characterization
tests against `popover.tsx` on `main` (open/dismiss / `role="dialog"` / portal-in-`[data-vf-ui]`
/ `align="end"` / controlled round-trip) using the `color-mode.test.tsx` jsdom harness, run
green, **then** extract, **then** rerun unchanged — that's the proof. The frozen sorted
`index.test.ts` export array is a no-leak signal (only `UIAdapterProvider` / `useAdapter` get
added, deliberately).

**The `<span>` positioning anchor is retired structurally, not by editing it:** once the skin
talks to `popover.Root` (a contract slot) instead of `AnchoredRoot`, the
`<span className="relative inline-block">` lives entirely inside `builtinPopover` and is absent
under parts-based engines (Base UI anchors on `Trigger`). The contract never promises a
wrapper, so nothing can depend on it — this is the resolution the chat RFC's
"positioning-anchor exception" was waiting on.

## The 6 gate columns (definition of done)

A primitive is "done" only when **every** column is checked.

| Col          | Meaning                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Spec**     | Ticket written; API shape locked to the #3090 doc page                                                           |
| **Built**    | Worked-through: single-node, `asChild`, `{...props}`, `data-*`, hook-driven — matches doc                        |
| **Story**    | Storybook stories cover documented states (the `data-*` / open / positioning vocabulary drives the story matrix) |
| **Test**     | Adapter-conformance registration green (both builtin and Base UI)                                                |
| **Styled**   | Default-render parity — identical DOM / classes as today (or badged `changed`)                                   |
| **Verified** | Green end-to-end in the validation loop / example repo                                                           |

## Two mandatory conformance tests (named, from the RFC)

The conformance suite is built **first** and gates every enabling ticket. Two named tests are
mandatory, run for **every primitive × every adapter**:

1. **Token-scope portal** — `content.closest("[data-vf-ui],[data-vf-chat]")` is the scope
   node, **not** `document.body`, for every primitive under every adapter. (This is the
   invariant that already bit chat attachments.)
2. **`data-vf-state` normalization** — the surface carries
   `data-vf-state="open" | "closed"` so skin classes bind regardless of the engine's native
   attribute.

Builtin's missing focus-trap / scroll-lock become **tracked xfails** — converting the
`TODO(a11y)` prose into line items.

## Default engine decision

**DECIDED: Base UI is the default engine; builtin stays as the zero-dep fallback.** It is the
Pareto pick — 2nd-fewest deps (single `@base-ui/react`) _and_ 2nd-most components (~35, covers
everything chat needs), best SSR / RSC / Deno fit (self-declares `"use client"`, no provider,
React 17–19), real a11y that retires the builtin's `TODO(a11y)` gap, and shadcn's 2026 default
(serves the "better shadcn" north star). Base UI is Phase 2's flagship adapter and the engine
the conformance suite diff-tests against.

- **Ariakit** — strictly lighter, but solo-maintained 0.x (#220 fragile-substrate risk).
- **Radix** — good opt-in adapter (ecosystem familiarity); omits `"use client"` (loader
  friction).
- **React Aria** — most components / strictest a11y, but heaviest deps + mandatory
  `I18nProvider`; too heavy to default.
- **builtin fork** — 0 deps, native SSR; kept as zero-dep fallback, not forever-default.

### Specialist (best-of-breed) adapters — per-primitive, not one monolith

Because the context map merges per-key, an app can run
`popover`/`dialog`/`menu`/`select`/`tooltip` on Base UI while overriding single primitives with
specialists (the concrete "better shadcn" move; shadcn does exactly this):

- **Drawer → Vaul** (Tier-1.5) — Base UI / Radix have no drag-to-dismiss bottom-sheet
  physics; Vaul does, is single-pkg / MIT / lightweight, and is **skinnable**. Candidate
  **default Drawer** adapter over the builtin `modal-surface` drawer.
- **Toast → Base UI Toast OR Sonner** (Tier-2) — Base UI Toast (~v1.6) is contract-conforming
  (fully skinnable). Sonner is the ecosystem default but **owns its own rendering** — expose it
  as a _render-owning_ adapter themed via token vars, not a fully-skinned part. Pick per whether
  full skin control or ecosystem-familiarity wins.
- Same door opens for `cmdk` (Command) and `react-day-picker` (Calendar) later
  (Tier-2/3) — none block the Tier-1 Popover tracer.

## "Engine off core" CI guard

The `baseUiPopover` reference adapter lives as a CLI template
`cli/templates/ui-adapters/base-ui.tsx` (copied into the consumer's repo by
`veryfront generate adapter base-ui`), imports `@base-ui/react` + `veryfront/ui/adapter` only,
and is **never imported by core**. Enforced by a **CI guard test** asserting **no**
`@base-ui | react-aria | @radix-ui | @ariakit` import anywhere under
`src/react/components/ui/**`.

Base UI normalizations the reference adapter must perform: drop Base UI's 2nd `onOpenChange`
arg; split `Positioner` (position) / `Popup` (classes); `Portal container={useTokenScopeRef()}`;
re-emit `data-vf-state`.

## Build order

**Popover (tracer)** → Dialog (`modal-surface`; unlocks Drawer as a skin over `DialogParts`)
→ DropdownMenu → Tooltip → Select (dual state, hardest). Cross-cutting: add `"use client"` to
every Tier-1 file (currently absent), the `ui.adapter` config schema field, and the
`veryfront generate adapter` scaffold type.

## Layer sign-off (from "Verification")

- `deno task test:unit` green.
- Adapter conformance suite green for **both** builtin and Base UI.
- Token-scope portal test passes in **both** engines.
