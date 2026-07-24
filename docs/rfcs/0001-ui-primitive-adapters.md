# RFC 0001 — Bring-your-own UI primitive adapters

| Field       | Value                                                        |
| ----------- | ------------------------------------------------------------ |
| Status      | Draft — request for comment                                  |
| Author      | Matt Boon                                                    |
| Created     | 2026-07-25                                                   |
| Branch      | `rfc/ui-adapter-architecture`                                |
| Affects     | `veryfront/ui`, `veryfront/chat`, `src/modules/import-map/`, `defineConfig` |
| Supersedes  | The "zero external packages" charter of `veryfront/ui` (relaxed, not removed) |

## 1. Summary

`veryfront/ui` today hand-rolls every behavioural primitive (Dialog, Popover,
Menu, Select, Tooltip, …). Each file is honest about it — they are labelled
"BASIC fork of @radix-ui/\*" and carry a standing `TODO(a11y)` list (focus trap,
roving focus, typeahead, scroll-lock, `aria-activedescendant`, portal-scope).
That is a real accessibility and credibility gap, and it is the wrong gap to be
spending our own maintenance budget closing.

This RFC proposes splitting each primitive into two layers — a **Skin** (our
Tailwind classes, `cva` variants, and token vocabulary) and **Mechanics** (focus
management, dismissable layers, positioning, ARIA wiring, keyboard nav) — and
letting the Mechanics come from a **swappable adapter**. A developer building on
Veryfront can then choose the engine behind our components:

- **Built-in** (default) — our current zero-dependency fork. Nothing changes for
  people who want no extra deps.
- **Base UI**, **Radix UI**, **Ariakit**, **React Aria** — first-party adapter
  packages that delegate Mechanics to a best-in-class accessible engine.
- **shadcn-compatible** — not a separate engine (see §9); a documented mode where
  our tokens and class conventions line up with a shadcn/Radix project.

The strategic point is adoption. Developers are fickle and the first question a
serious team asks is "does it use *X*?" Today we have one answer. With adapters
the answer becomes "**yes — or bring your own.**"

## 2. Motivation

### 2.1 The adoption objection

We want teams to build on Veryfront. Those teams have existing opinions and
existing design systems. "Does it use Radix?" / "We're standardised on React
Aria" / "We only ship Base UI now" are conversation-enders when the answer is
"no, we wrote our own." An adapter layer converts a hard *no* into a *yes, and
here's the config line*. It also lets us ride the credibility of engines that
have solved accessibility properly, instead of asking teams to trust our
`TODO(a11y)` forks.

### 2.2 The current reality

The primitives are deliberately partial. Verbatim from the source:

- `modal-surface.tsx` — `TODO(a11y): focus trap, aria-labelledby, scroll-lock, portal, animation.` The modal is not portalled and has no focus trap.
- `anchored-surface.tsx` — `TODO(a11y): focus trap, … roving focus, typeahead, Tab, aria-activedescendant, sub menus.` DropdownMenu has no submenu primitive.
- `select.tsx` — `TODO(a11y): roving focus + arrow/typeahead keyboard nav, aria-activedescendant.` Keyboard nav is not implemented.
- `command.tsx` — case-insensitive substring filter only; `TODO(a11y): arrow-key navigation + aria-activedescendant, fuzzy ranking.`
- `tooltip.tsx` — `TODO(a11y): aria-describedby wiring, open/close delay grouping, Escape dismissal.`

Every one of these is a solved problem in Radix / Base UI / Ariakit / React Aria.
We are re-solving it, worse, and carrying the maintenance.

### 2.3 Why adapters (and not "just adopt Radix")

Picking a single engine trades one lock-in for another and re-opens the same
adoption objection from the other side (the "we don't want Radix" teams). It
also breaks the current zero-dependency promise, which is genuinely valued by a
segment of users and is load-bearing for `veryfront/chat` shipping to npm. An
adapter layer keeps the zero-dep default *and* offers the popular engines *and*
future-proofs us against the churn in this space (Radix's maintenance wobble,
Base UI's rise, React Aria's growth). It is more work up front and less work
forever after.

## 3. Goals and non-goals

### Goals

1. A developer selects the primitive engine behind `veryfront/ui` with **one
   config line** (or one provider), without touching component call-sites.
2. The **default stays zero-dependency** — `veryfront/ui` and `veryfront/chat`
   still work with no external UI packages installed.
3. Our **visual identity is unchanged** across adapters — same tokens, same
   `cva` variants, same look. The adapter changes behaviour, not appearance.
4. Swapping an adapter is **type-safe and conformance-tested** — a shared test
   suite proves any adapter satisfies the contract.
5. Portalled surfaces stay inside the `[data-vf-ui]` / `[data-vf-chat]` token
   scope under **every** adapter.
6. SSR / RSC / Deno-loader safe under every adapter.

### Non-goals

- Not abstracting *every* component. Purely-visual primitives (Button, Card,
  Badge, Skeleton, Input) have no behaviour to delegate and stay as-is. Only the
  behaviour-heavy overlay/nav primitives get an adapter seam (§6.2).
- Not shipping every engine in one bundle. An app links **one** adapter.
- Not a universal cross-framework abstraction (Vue/Solid). React only.
- Not letting an adapter change our public component API. Call-sites are stable;
  adapters are invisible to them.

## 4. Background — how `veryfront/ui` is built today

Findings from the current tree (`src/react/components/ui/`):

- The library is the public `veryfront/ui` entrypoint (`deno.json` maps
  `veryfront/ui`, `veryfront/components/ui`, `veryfront/react/components/ui` all
  to `src/react/components/ui/index.ts`).
- Charter, from `index.ts`: *"Dependency-light forks … cva/Slot inlined … zero
  external packages."* `chat` depends on `ui`, never the reverse.
- `cva` is inlined (`cva.ts`, used by 31 files); `clsx` is a clean-room rewrite
  (`src/utils/clsx.ts`); `Slot`/`asChild` is inlined (`slot.tsx`, used by 11
  files).

Crucially, **the seams already exist.** The behaviour-heavy primitives do not
each reimplement their mechanics; they route through a small shared machinery
layer:

| Machinery module            | Exports                          | Consumed by            |
| --------------------------- | -------------------------------- | ---------------------- |
| `disclosure.ts`             | `useDisclosure({open,defaultOpen,onOpenChange}) → {open,setOpen}` | every overlay |
| `anchored-surface.tsx`      | `createAnchoredSurfaceParts()` → Root/Trigger/Content | Popover, DropdownMenu |
| `modal-surface.tsx`         | `createModalSurfaceParts(name)` → Root/Trigger/Close/Content + `useModal` | Dialog, Drawer |
| `floating.tsx`              | `<Floating anchorRef open onDismiss …>` (Portal + positioning) | Popover, DropdownMenu, Select |
| `slot.tsx`                  | `<Slot>` / `asChild`             | 11 components          |

This is the adapter boundary, already carved. An adapter replaces the contents
of these modules; the skins (`popover.tsx`, `dialog.tsx`, `select.tsx`, …) keep
their `cva` variants and `[var(--token)]` classes untouched.

## 5. The core difficulty

The reason this is a *considered* design and not a weekend refactor: **the
candidate engines do not share an API.** There are three incompatible shapes.

1. **Compound / parts, render-controlled** — Radix, Base UI, Ariakit. The engine
   owns the DOM tree (`Root`/`Trigger`/`Portal`/`Positioner`/`Popup`) and you
   inject your styled node through a composition prop (`asChild` in Radix,
   `render` in Base UI and Ariakit).
2. **Hook / prop-getter** — React Aria's low-level hooks (`useButton`,
   `useDialog`, `useOverlayTrigger`). The engine owns *no* DOM; it returns prop
   objects you spread onto your own elements. Maximum control, maximum wiring.
3. **State-machine + connect** — Zag.js / Ark UI. A framework-agnostic state
   machine whose `connect()` returns prop-getters per part. (Prior art for
   exactly this problem — see the appendix.)

A naïve "lowest common denominator = prop-getters" fails, because the
parts-based engines *insist on rendering structure* (their Portal, their
Positioner, their focus scope) and cannot be reduced to bare prop objects around
our nodes. So the contract cannot be "just prop getters." It has to let an
adapter **render wrapper structure** around our styled leaf nodes, while still
normalising state and composition. §6 is the contract that does that.

The full per-engine survey (exact prop names, anatomies, licensing, SSR notes)
is in the **appendix**, and drives the recommendation in §7.

## 6. Design

### 6.1 Principle — Skin over Mechanics

Every behaviour-heavy primitive is expressed as:

```
Skin (ours, stable)                 Mechanics (adapter, swappable)
─────────────────────               ──────────────────────────────
cva variants + token classes   ×    focus trap / dismiss / positioning
our public prop API                  ARIA roles + keyboard nav
our anatomy (what parts exist)       portal + scroll-lock
```

The Skin is authored once. The Mechanics are provided by whichever adapter is
linked. The Skin talks to the Mechanics through a **per-primitive contract**, not
through any specific engine's API.

### 6.2 Scope — which primitives get an adapter seam

Tiered by how much behaviour (and how much of our `TODO(a11y)` debt) is at stake.

**Tier 1 — adapter-backed (this RFC):** Dialog, Drawer/Sheet, Popover,
DropdownMenu, Tooltip, Select. These map 1:1 onto the shared machinery modules
and are where our forks are weakest.

**Tier 2 — adapter-backed (follow-up):** Combobox/Command, Tabs, Accordion,
Collapsible, Switch, Checkbox, Radio, Slider. Behaviour exists but is lower risk;
some engines lack some of these (survey flags gaps).

**Never adaptered:** Button, Card, Badge, Pill, Tag, Status, Label, Skeleton,
Shimmer, ProgressBar, Input, Textarea, Avatar, List, AppShell. No delegable
behaviour. They stay exactly as they are.

### 6.3 The adapter contract

An adapter is an object implementing one interface per Tier-1/2 primitive.
Illustrative shape for the two archetypes (final types live in code, not here):

```ts
// src/react/components/ui/adapter/contract.ts  (proposed)

/** A styled leaf the Skin hands to the adapter; the adapter must render it
 *  as the real interactive node (trigger/content/item), forwarding ref+props. */
export interface SkinNode {
  className?: string;
  children?: React.ReactNode;
  // …the resolved cva/token classes + our data-attributes live here
}

export interface UIAdapter {
  /** Human name, surfaced in errors/devtools. */
  name: string;

  dialog: DialogParts;
  popover: PopoverParts;
  menu: MenuParts;
  tooltip: TooltipParts;
  select: SelectParts;
  // …tier 2 later
}

/** Parts model for an overlay-with-anchor primitive (Popover/Menu). The adapter
 *  owns disclosure state, dismissal, positioning, portal, focus, ARIA. The Skin
 *  owns classes and which parts exist. */
export interface PopoverParts {
  Root: React.FC<{
    open?: boolean; defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }>;
  Trigger: React.FC<SkinNode & { asChild?: boolean }>;
  /** Content is portalled BY THE ADAPTER, but must land inside the token scope. */
  Content: React.FC<SkinNode & { align?: "start" | "end"; sideOffset?: number }>;
}
```

The right level for the contract is the key finding of the survey. A
prop-getter contract (`getTriggerProps()`, à la Zag.js/React-Aria-hooks) fits
React Aria's hook layer perfectly but **has no Ariakit equivalent** — Ariakit
never hands you spreadable prop bags; it inverts composition (`render={<myNode/>}`
merges *your* node into *its* component). So the cross-engine common denominator
is **higher up**: a set of **role-tagged component slots** (Root / Trigger /
Content / Item / …) plus a **normalized controlled-state object**. All three
archetypes happen to converge on the same open/close state shape
(`{ open, setOpen }` ≈ React Aria's `{ isOpen, open, close, toggle, setOpen }` ≈
Ariakit's store) — that convergence is what makes the contract feasible.

Key contract rules, derived from §5's difficulty and the prior art (shadcn's
stable-import seam; Zag.js/Ark's normalized-state idea, lifted to the slot level):

1. **State is normalised to our vocabulary.** The contract always speaks
   `open` / `defaultOpen` / `onOpenChange` — matching today's `useDisclosure`.
   Each adapter maps that onto its engine. Radix and Base UI already match
   (Base UI's `onOpenChange(open, eventDetails)` is wrapped to drop the 2nd arg);
   React Aria uses `isOpen` + `useOverlayTriggerState` and is wrapped; Ariakit's
   store is wrapped. This is a real fault line: React Aria systematically prefixes
   booleans (`isOpen`, `isDisabled`) — the adapter absorbs it so skins never see it.
2. **The adapter may render wrapper structure.** `Content` is a *component*, not
   a bare prop-getter, precisely so a parts-based engine can render its
   Portal/Positioner around our node. This also resolves the biggest structural
   divergence found in the survey: **Radix collapses positioning into one
   `Content` node, Base UI splits it into `Positioner` (position props) +
   `Popup` (your styled surface)**. Our `Content` maps to `Radix.Content` ≈
   `BaseUI.Popup`, and routes `align`/`sideOffset` to `Radix.Content` ≈
   `BaseUI.Positioner`. A hook-based adapter (React Aria) implements the same
   `Content` component by spreading its prop-getters onto a `<div>` it renders
   itself. One contract, all three archetypes satisfy it.
3. **Composition is normalised to `asChild`.** The Skin always passes styling via
   our existing `asChild` convention. The adapter translates to each engine's
   idiom: Radix → `asChild`, Base UI / Ariakit → `render` (element form; the
   function-with-state form is Base-only and is not in the contract), React Aria
   → merge props onto our element.
4. **The adapter emits our own stable `data-*` state attributes.** Skins style
   open/closed/active state with Tailwind selectors, but the engines disagree
   (`data-[state=open]` in Radix vs `data-[open]`/`data-[closed]` in Base UI). To
   keep one set of skin classes working under every adapter, the adapter
   **re-emits normalised attributes** (e.g. `data-vf-state="open"`) on the parts,
   and skins key off those — never off the backend's native attribute.
5. **Portalled content MUST re-apply the token scope.** Every adapter's `Content`
   must keep the surface inside the `[data-vf-ui]` / `[data-vf-chat]` token scope
   — both Radix and Base UI portals accept a `container` prop for exactly this
   (Base UI additionally accepts a ref/callback), so the adapter points it at a
   scope-carrying node, or stamps the scope attribute on the portalled root. This
   is the invariant most likely to regress (it already bit us — see the
   `veryfront-chat-attachments` note) and is a required conformance test (§6.7).
6. **The contract is the intersection, not the union.** React Aria enforces
   stricter ARIA than the others (tooltips only on focusable elements; menus
   reject arbitrary children). The contract exposes only behaviour every target
   adapter can satisfy; engine-specific superpowers are out of scope by design.
   This is the price of portability and is stated up front, not discovered late.
7. **No adapter may change our public prop API or anatomy.** `<Popover>`,
   `<PopoverTrigger>`, `<PopoverContent align="end">` are identical to consumers
   regardless of adapter — the shadcn lesson: the public import path is stable;
   the engine lives entirely behind it.

### 6.4 The built-in (default) adapter

The current machinery (`disclosure.ts`, `anchored-surface.tsx`,
`modal-surface.tsx`, `floating.tsx`, `slot.tsx`) is repackaged **unchanged in
behaviour** as `BuiltinAdapter`. This guarantees:

- Zero behaviour change on day one — the refactor is a pure extraction.
- The zero-dependency promise holds; `veryfront/chat` still ships to npm with no
  UI peer deps.
- A working reference implementation of every contract part, which the
  third-party adapters are measured against.

### 6.5 Binding — how a developer "brings their own"

Two mechanisms, because Veryfront is consumed two ways.

**(a) Build-time, for Veryfront apps (primary).** Veryfront owns its module
resolver and import map (`src/modules/import-map/`, `deno.json`). We add a config
field resolved at build/dev time:

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront/config";

export default defineConfig({
  ui: { adapter: "base-ui" }, // "builtin" (default) | "base-ui" | "radix" | "ariakit" | "react-aria"
});
```

The resolver aliases the internal `veryfront/ui/adapter` specifier to the chosen
adapter package (e.g. `@veryfront/ui-adapter-base-ui`). Only the selected adapter
and its engine are bundled — clean tree-shaking, zero runtime cost, no context
reads. This is a genuine Veryfront advantage: because we control the loader, the
swap is a resolution detail, invisible to component code.

**(b) Runtime provider, for non-Veryfront consumers (fallback).** Someone
importing `veryfront/ui` into a plain Vite/Next app has no Veryfront resolver.
For them, an optional provider supplies the adapter via context:

```tsx
import { UIAdapterProvider } from "veryfront/ui";
import { radixAdapter } from "@veryfront/ui-adapter-radix";

<UIAdapterProvider adapter={radixAdapter}>{app}</UIAdapterProvider>;
```

With no provider and no build alias, components resolve `BuiltinAdapter` — so the
out-of-the-box experience needs no setup at all.

> Design note: (a) is preferred because it avoids bundling unused adapters and
> avoids a context read in every overlay. (b) exists so `veryfront/ui` remains a
> useful standalone package. The contract is identical for both; only resolution
> differs.

### 6.6 Packaging

- `veryfront/ui` — skins + contract + `BuiltinAdapter` + `UIAdapterProvider`.
  Still zero-dependency.
- `@veryfront/ui-adapter-base-ui`, `-radix`, `-ariakit`, `-react-aria` —
  thin packages, each declaring its engine as a **peer dependency** so the app
  controls the engine version. Each is only ~one small module per primitive.

### 6.7 Conformance — proving an adapter is correct

A single shared suite (`adapter/conformance.test.tsx`) runs against *every*
adapter, asserting behaviour the Skin relies on. Minimum bar per primitive:

- opens/closes via controlled + uncontrolled paths (`open` / `defaultOpen`);
- `onOpenChange` fires with the right value;
- Escape and outside-click dismiss;
- focus moves into the surface on open and restores to the trigger on close;
- correct roles/ARIA (`role="dialog"`, `aria-haspopup`, `aria-expanded`,
  `aria-controls`);
- **portalled content carries the token-scope attribute** (§6.3 rule 4);
- SSR render produces no hydration mismatch.

`BuiltinAdapter` is held to the same suite — which will surface exactly the
`TODO(a11y)` gaps we have today, turning them into tracked, tested line items
rather than comments.

### 6.8 SSR / RSC / Deno constraints

Every Tier-1 primitive is a client component (`"use client"`), consistent with
today. Adapter packages must:

- import cleanly under the Deno + `esm.sh` loader (already proven: the sample app
  loads Radix via `esm.sh` today — `projects/veryfront/shared/ui/*`);
- be SSR-safe (no `document` at import; stable `useId`);
- carry any required provider (e.g. React Aria historically wants an
  `I18nProvider`/SSR context) internally, so the Skin's SSR contract is uniform.

The appendix records the per-engine SSR specifics that this rule has to absorb.

## 7. Recommendation

The survey (§13) drives four concrete calls.

### 7.1 Flagship third-party adapter: **Base UI**

Base UI is the strongest first non-builtin adapter to ship:

- **Stable and permissive.** v1.0 landed 2025-12-11, now v1.6 (mid-2026), MIT.
  It is no longer beta. Package: `@base-ui/react` (note the rename from the old
  `@base-ui-components/react`).
- **Best pedigree for our exact need.** Built by the people behind Radix
  (Colm Tuite), Floating UI (positioning), and MUI — i.e. the team that already
  solved these primitives once.
- **Cleanest SSR/RSC story.** It self-declares `"use client"` on its parts (Radix
  historically does not), needs no root provider, and supports React 17–19. Best
  out-of-the-box behaviour under our Deno + `esm.sh` loader.
- **It is where the ecosystem is moving** (see 7.3): making Base UI our reference
  adapter aligns us with shadcn's new default and de-risks the "does it use X?"
  conversation for the largest emerging cohort.

### 7.2 Rollout order

1. **`BuiltinAdapter`** — extraction only, zero behaviour change (Phase 0).
2. **Base UI adapter** — the reference third-party adapter; proves the contract
   against a *parts-based* engine (Trigger/Positioner/Popup).
3. **React Aria adapter** — proves the contract against the *hook* archetype (the
   hardest shape: prop-getters, `isOpen`, two-step trigger, `I18nProvider`). If
   the contract survives Base UI **and** React Aria, it survives anything. This
   also wins the accessibility-maximalist and Adobe-shop cohorts.
4. **Radix adapter** — small, given Base UI's near-identical `open/onOpenChange`
   state model; primarily an ecosystem-familiarity and shadcn-`-b radix` play.
5. **Ariakit adapter** — community-driven / lower priority. It is MIT and
   ergonomic, but **perennially 0.x** (pre-1.0 after ~4 years) and effectively
   single-maintainer — an acceptable *opt-in* backend, a poor thing to pin the
   core to.

Building the two archetype extremes first (Base UI = parts, React Aria = hooks)
is deliberate: it validates that the §6.3 contract genuinely spans the API-shape
fault line, before we invest in the easy third and fourth adapters.

### 7.3 shadcn posture: compatible via Base UI + CSS-variable tokens

The single most important 2026 fact: **shadcn now defaults to Base UI**
(`npx shadcn init`), with Radix as an opt-in (`-b radix`); it ships the same
styled component over either. shadcn is, in effect, the proof that "swap the
engine, keep one styled surface" works at scale — and its seam is a **stable
import path**, exactly our §6.3 rule 7.

Therefore we make Veryfront **shadcn-compatible, not shadcn-powered**:

- Adopt shadcn's **CSS-custom-property token conventions** (`--background`,
  `--primary`, `--radius`, `.dark` variable block) so a shadcn project themes our
  components with its existing variables.
- Ship the **Base UI adapter** so "is it Base UI underneath?" — increasingly the
  shadcn default — is a *yes*.
- Optionally publish our skins as a **shadcn registry** (installable via
  `npx shadcn add <url>`), so shadcn users can vendor Veryfront components the way
  they already vendor everything else. (Follow-up, not this RFC.)

### 7.4 Consider Zag.js/Ark as a *future* built-in engine (not now)

Zag.js (framework-agnostic state machines) + Ark UI is the most principled
"one behaviour spec" system and could one day *replace* our hand-rolled
`BuiltinAdapter` internals — giving the zero-dep default a rigorous state-machine
core instead of our forks. It is **out of scope here** (it is still a
single-engine bet and does not answer "does it use Radix/React Aria?"), but it is
the natural candidate to harden the default later. Noted so we do not rebuild the
builtin twice.

## 8. Migration and backwards compatibility

- **Phase 0 is behaviour-preserving.** Extracting the machinery into
  `BuiltinAdapter` changes no output. Existing call-sites, `veryfront/chat`, and
  the npm build are untouched.
- Public exports (`Popover`, `Dialog`, `Select`, …) keep identical signatures.
- The "zero external packages" charter in `index.ts` is **amended**, not deleted:
  zero-dependency remains the *default*; adapters are opt-in.
- `veryfront/chat` continues to depend only on `veryfront/ui`; it inherits
  whatever adapter the app selected, for free.

## 9. The shadcn question

shadcn/ui is **not an engine** — it is a copy-paste distribution model
(components pasted into your repo via a CLI/registry) built on Radix + Tailwind +
CSS variables, with the `cn()` = `clsx`+`tailwind-merge` helper. So "does it use
shadcn?" is really two questions:

- *"Is it Radix underneath?"* → yes, via the Radix adapter.
- *"Will it drop into my shadcn theme / Tailwind tokens?"* → this is a
  **compatibility** posture, not an adapter: align our token names and class
  conventions so a shadcn project can theme our components with its existing CSS
  variables.

Two 2026 facts sharpen this (both in §13):

- **shadcn now defaults to Base UI** (`npx shadcn init`; Radix via `-b radix`),
  and ships the same styled component over either backend. So being *Base UI-
  backed* (§7.1) makes us shadcn-default-aligned, and having a Radix adapter
  covers `-b radix` projects.
- shadcn's whole model is the stable-import seam we adopt in §6.3 rule 7 — it is
  existence proof that this works at ecosystem scale.

We should say "shadcn-compatible," not "shadcn-powered," and mean it precisely
(§7.3).

## 10. Risks and trade-offs

| Risk | Mitigation |
| ---- | ---------- |
| Contract can't express an engine's quirk (e.g. Base UI `Positioner` vs Radix `Content`) | Contract renders *components*, not prop-getters, so each adapter absorbs its own structure (§6.3 rule 2). Prototype two archetype adapters (parts-based + hook-based) before locking the contract. |
| Combinatorial test surface (N primitives × M adapters) | One shared conformance suite (§6.7); adapters are thin. |
| Styling seam differences (`asChild`/`render`/prop-getters) leak into skins | Normalised to our `asChild` at the contract; adapters translate (§6.3 rule 3). |
| Portal escapes token scope under a third-party portal | Mandatory scope-attribute conformance test (§6.7). |
| Bundle bloat if adapters aren't tree-shaken | Build-time binding (6.5a) bundles exactly one adapter; engines are peer deps. |
| Maintenance of 4+ adapter packages | Start with **one** flagship third-party adapter (§7); add others on demand/community. |
| Engine churn (Radix maintenance, Base UI beta) | The abstraction is the hedge — we can retarget an adapter without touching skins. |

## 11. Alternatives considered

1. **Adopt a single engine (e.g. Radix) outright.** Simplest, but re-opens the
   adoption objection from the other side, kills the zero-dep default, and bets
   the whole library on one project's health. Rejected.
2. **Finish the hand-rolled a11y ourselves.** Large, perpetual maintenance for a
   worse result than mature engines already provide, and answers no "does it use
   X?" question. Rejected.
3. **Adopt Zag.js/Ark as the single engine.** Attractive (one framework-agnostic
   spec), but still a single-engine bet and still answers "no" to "does it use
   Radix/React Aria?" Considered as a *possible built-in replacement* in the
   appendix, not as the adapter strategy.
4. **Do nothing.** Keep shipping `TODO(a11y)` forks. Rejected — it is an active
   adoption and accessibility liability.

## 12. Open questions

1. Build-time alias vs runtime provider as the *documented default* — do we
   push (6.5a) for Veryfront apps and treat (6.5b) as advanced, or expose both
   equally?
2. Do Tier-2 primitives ship in this RFC's milestone or a follow-up?
3. Which engine is the flagship third-party adapter (§7, pending survey)?
4. Do we publish adapters under `@veryfront/*` or fold them into the main package
   behind subpath exports?
5. How do adapters that lack a primitive (survey gaps) degrade — fall back to
   `BuiltinAdapter` per-primitive, or hard-error at config time?

## 13. Appendix — engine survey

Current as of mid-2026. Version/rename facts move fast — re-verify the
load-bearing ones (marked ⚠) before hard-coding.

### 13.1 At a glance

| Engine | API shape | Composition | State props | License / maintainer | Status | Package |
| ------ | --------- | ----------- | ----------- | -------------------- | ------ | ------- |
| **Base UI** | Parts (compound) | `render` prop (element or fn+state) | `open`/`onOpenChange(open, eventDetails)`/`defaultOpen`/`modal:boolean\|'trap-focus'` | MIT · MUI org (ex-Radix/Floating UI/MUI) | ⚠ **Stable v1.0 (2025-12-11), now v1.6** | `@base-ui/react` ⚠ (renamed from `@base-ui-components/react`) |
| **Radix** | Parts (compound) | `asChild` + `Slot` | `open`/`onOpenChange(open)`/`defaultOpen`/`modal` | MIT · ⚠ **WorkOS** (ex-Modulz) | Stable, mature | `radix-ui` (single) or `@radix-ui/react-*` |
| **React Aria** | **Two APIs**: low-level hooks *and* RAC components | hooks: you own DOM; RAC: `className`/`style` render-fn + `slot`s + `data-*` | `isOpen`/`onOpenChange`/`defaultOpen`; state via `useOverlayTriggerState` | **Apache-2.0** · Adobe | RAC 1.x stable (`react-aria-components@1.19`) | `react-aria` + `react-stately`, `react-aria-components` |
| **Ariakit** | One component API + store | `render` prop (no `as`, no prop-getters) | store: `useDialogStore({open,setOpen,defaultOpen})` | MIT · Diego Haz (solo) | ⚠ **still 0.x** (`@ariakit/react@0.4.x`) | `@ariakit/react` (single) |
| **shadcn/ui** | *Not an engine* — CLI/registry vendoring | copies source into your repo; `cn()`=clsx+tailwind-merge; CSS-var tokens | inherits its backend's | MIT | ⚠ **defaults to Base UI (Jul 2026)**; Radix via `-b radix` | `npx shadcn add` |
| **Zag.js / Ark** | State machine + `connect()` → prop-getters | Ark wraps getters into compound parts | machine context; `open`/`defaultOpen` | MIT · Chakra/Segun Adebayo | Zag v1 stable; Ark stable | `@zag-js/*` + `@ark-ui/react` |

### 13.2 The fault lines an adapter must absorb

- **Composition direction inverts.** Radix `asChild` and React-Aria-hooks let you
  own/merge onto *your* node. Base UI / Ariakit `render` merges *your* node into
  *their* component. RAC styles *its* node via `className` render-fn. Four idioms
  for "use my element"; the contract normalises to our `asChild` (§6.3 rule 3).
- **Positioning anatomy splits.** Radix: one `Content` node carries both
  positioning props (`side`/`align`/`sideOffset`) and the styled surface.
  Base UI: `Positioner` (position) + `Popup` (surface) + optional `Viewport`.
  React Aria: `usePopover` returns `popoverProps`/`arrowProps`/`placement`. Our
  `Content` maps `Radix.Content ≈ BaseUI.Popup`, routing position props to
  `Radix.Content ≈ BaseUI.Positioner` (§6.3 rule 2).
- **Part naming differs.** Overlay: `Radix.Overlay` = `BaseUI.Backdrop`. Surface:
  `Radix.Content` = `BaseUI.Popup`. Mount: Radix `forceMount` = Base UI
  `keepMounted`.
- **State-attribute selectors differ.** Radix `data-[state=open]` vs Base UI
  `data-[open]`/`data-[closed]` vs RAC `data-[entering]`/`data-[pressed]`. → we
  emit our own `data-vf-state` (§6.3 rule 4) so skin classes are stable.
- **Boolean prop naming.** React Aria prefixes with `is` (`isOpen`, `isDisabled`);
  others don't. Base UI's `onOpenChange` has a 2nd `eventDetails` arg to drop.
- **The two-step trigger (React Aria hooks only).** `useOverlayTrigger` returns
  `triggerProps` typed as `AriaButtonProps` that must pass **through `useButton`**
  before hitting the DOM — no analog elsewhere; the React Aria adapter hides it.
- **ARIA strictness / feature intersection.** React Aria *rejects* patterns the
  others allow (tooltips only on focusable elements; menus reject arbitrary
  children). → contract exposes the **intersection** only (§6.3 rule 6).
- **Portal + focus ownership.** All portal; all accept a `container` (Base UI also
  a ref/callback) — our hook for keeping surfaces in the token scope (§6.3
  rule 5). Each engine assumes it owns the overlay lifecycle (focus trap,
  scroll-lock), so the adapter cedes that to the engine wholesale rather than
  interleaving.

### 13.3 Primitive coverage (Tier-1/2 relevant)

- **Base UI** (~35, one package): Dialog, Popover, Menu, Menubar, Select,
  Combobox + Autocomplete, Tooltip, Tabs, Accordion, Collapsible, Switch,
  Checkbox(+Group), Radio, Slider, Toast, plus rich form primitives
  (Field/Fieldset/Number Field). No Hover Card→"Preview Card"; no Aspect Ratio.
- **Radix**: the classic set incl. Dialog/Popover/DropdownMenu/Select/Tooltip/
  Tabs/Accordion/Collapsible/Switch/Checkbox/Radio/Slider; **Combobox recently
  added**; has Hover Card, Aspect Ratio, Avatar, Accessible Icon. No Number Field.
- **React Aria** (50+): broadest — everything above **plus** Table, Tree,
  Calendar/DatePicker family, Color pickers, Virtualizer. If we ever need dates/
  tables/color, **only React Aria has them**.
- **Ariakit** (25): Dialog/Popover/Menu/Combobox/Select/Tooltip/Tab/Disclosure/
  Form/Toolbar etc. **No** Table/Tree/DatePicker/Slider/Toast/color.

### 13.4 SSR / RSC / Deno notes per engine

- **Base UI** — self-declares `"use client"`; no provider; `useId`; React 17–19.
  Positioning via Floating UI (ensure single copy under `esm.sh`).
- **Radix** — SSR-safe, no provider; historically **omits `"use client"`** so you
  add the boundary; recent React 19 `Slot` fixes landed.
- **React Aria** — client-only; `SSRProvider` no longer needed (uses `useId`) but
  **`I18nProvider` required** to pin locale for hydration-stable markup;
  `RouterProvider` optional; heaviest transitive graph (`@internationalized/*`).
- **Ariakit** — client-only; SSR-safe; no mandatory providers; tiny dep graph
  (lightest `esm.sh` resolution).
- **All React client libs**: under Deno + `esm.sh` the real risk is **duplicate
  React copies** — pin one `react`/`react-dom` via the import map. The sample app
  already loads Radix via `esm.sh` (`projects/veryfront/shared/ui/*`), so the path
  is proven.

### 13.5 Prior art for "one surface, many engines"

- **shadcn/ui** — the real-world proof; swaps backend at **generate/init time**
  behind a stable import path (not a runtime provider). Now dual-backend
  (Base UI default / Radix opt-in).
- **Zag.js + Ark UI** — one framework-agnostic state machine, `connect(service,
  normalizeProps)` → prop-getters; `normalizeProps` is itself the per-framework
  adapter seam. Solves the *cross-framework* version; single owned engine.
- **MUI `slots` / `slotProps`** — swaps the *rendered element per slot*, not the
  behaviour engine. Borrow the naming ergonomics for per-part overrides; it does
  not solve backend swapping.
- **Verdict:** a live runtime multi-foreign-backend adapter is essentially
  unshipped in the wild — because of exactly the fault lines in §13.2. The
  pragmatic, proven shape is **build/resolve-time selection + stable import path**
  (our §6.5a), which is why that is the primary mechanism.

### 13.6 Key sources

Base UI: base-ui.com (composition, dialog, popover, releases/v1-0-0), github.com/mui/base-ui.
Radix: radix-ui.com/primitives (composition, slot, dialog, popover), github.com/radix-ui/primitives.
React Aria: react-aria.adobe.com (useButton, useDialog, usePopover, useOverlayTrigger, frameworks, styling).
Ariakit: ariakit.com (components, dialog, guide/composition, use-dialog-store).
shadcn: ui.shadcn.com/docs/changelog (2026-07-base-ui-default, 2026-02-radix-ui).
Zag/Ark: zagjs.com, ark-ui.com. Migration pitfalls: dev.to/gregberge Radix→React Aria at Argos.
