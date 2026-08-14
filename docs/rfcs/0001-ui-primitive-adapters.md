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
- **Base UI**, **Radix UI**, **Ariakit**, **React Aria** — reference adapters that
  delegate Mechanics to a best-in-class accessible engine, selected via a
  per-component map (§6.5) and *vendored* into the app, not published as packages
  we version (§6.6). The engine is the developer's own dependency.

shadcn is deliberately **not** on that list: it is not an engine but a
styled-surface + distribution layer that *wraps* an engine — a sibling of
`veryfront/ui` itself, one axis up from the adapters. It is a different concern
and out of scope here (§9).

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
DropdownMenu, Tooltip, Select. These map onto the shared machinery modules and
are where our forks are weakest. Drawer is a **skin over the Dialog contract**
(§6.10), not a separate contract — so there are **five** adapter interfaces, not
six.

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

**Primary mechanism: a per-component adapter map, injected via context.** The
`UIAdapter` interface from §6.3 *is* the map (`{ popover, dialog, menu, … }`). A
developer passes a **partial** map; it merges over `BuiltinAdapter`:

```tsx
import { UIAdapterProvider } from "veryfront/ui";
import { baseUiPopover, baseUiDialog } from "./ui-adapters/base-ui.tsx"; // vendored — see §6.6

// Override just these two; everything else stays on the zero-dep builtin.
<UIAdapterProvider adapter={{ popover: baseUiPopover, dialog: baseUiDialog }}>
  {app}
</UIAdapterProvider>;
```

- **Partial + per-component.** Unmapped primitives fall back to `BuiltinAdapter`,
  so adoption is incremental — put Base UI behind Popover, leave the rest alone.
- **No build integration required.** Identical in a Veryfront app, a Vite app, or
  a Next app. With no provider at all, everything is builtin — zero setup.
- **One API, not two.** Every primitive resolves its parts through `useAdapter()`,
  which reads this context (or the builtin default). There is no second code path.

Optional optimisation (Veryfront apps only): because we own the module resolver
(`src/modules/import-map/`), a `ui.adapter` config field can statically bind the
map at build time so the context read is elided and only the chosen adapter is
bundled. This is a perf layer over the *same* contract, not a different mechanism:

```ts
// veryfront.config.ts — optional; the context map is the source of truth
import { defineConfig } from "veryfront/config";
export default defineConfig({ ui: { adapter: "base-ui" } });
```

### 6.6 Packaging — and why drift is not our problem

The maintenance objection is the real one: *"when a new engine version ships, do
we have to bump and align a bunch of packages? Drift is highly likely."* The
design answers it by **publishing no adapter packages and depending on no
engine.**

- **Core (`veryfront/ui`) ships exactly three things** beyond the skins: the
  `UIAdapter` contract (types), `BuiltinAdapter`, and `UIAdapterProvider`. It has
  **zero engine dependencies** — nothing for *us* to bump when Base UI or React
  Aria releases. Core's version is decoupled from every engine's version. This is
  the opposite of the `@veryfront/ui-adapter-*`-package model, which would put us
  on the hook to re-release and re-align on every engine bump — rejected for
  exactly the drift reason.
- **The engine is the developer's dependency.** They already have `@base-ui/react`
  in their app and bump it on their own schedule. We never pin, track, or chase
  an engine version.
- **Reference adapters are vendored, not versioned (the shadcn model).** We ship
  Base UI / Radix / React Aria adapter *source* that the developer copies into
  their repo (see "Distribution" below). They own it; we don't publish or semver
  it. There is no adapter release train to keep in lockstep, so there is nothing
  to drift *from*.
- **Drift is detected, not prevented — by the conformance suite (§6.7).** The
  contract is a small, stable, versioned interface. If an engine's new version
  changes an API an adapter uses, the shared conformance test **fails loudly**
  against that engine version and names what broke. The fix is a one-line edit in
  one vendored file the developer owns — not a coordinated multi-package release
  on our side.

Net: our surface stays tiny and version-independent. The only party who bumps an
engine is the developer who chose it; the only thing that can drift is a single
file they own, guarded by a test we ship.

**Distribution — decided: CLI-vendored, docs-mirrored.** How the developer *gets*
the vendored file:

- **Primary: `veryfront generate adapter <name>`.** This matches the CLI's
  existing scaffolding family (`veryfront generate type`, `generate app-router`,
  `generate pages-router`) — not a new shadcn-style `add` verb. The command copies
  `ui-adapters/<name>.tsx` into the app, adds the engine to the project's
  dependencies, and prints the one-line `UIAdapterProvider` wiring (or patches
  `veryfront.config.ts` when the optional build-time bind is used). One command,
  discoverable via `veryfront generate --help`, consistent with how everything
  else in the framework is scaffolded.
- **Mirror: a docs "reference adapters" page** renders the *same* templates the
  CLI copies, for readers who want to eyeball or hand-paste. Critically, the CLI
  template is the **single source of truth** and the docs page is generated from
  it — so there is no copy that can drift from the other. (This is the "both"
  option, made safe by one canonical source.)
- **Not chosen: a hosted JSON registry** à la shadcn's `registry:` endpoint. It
  buys remote/third-party registries we do not need for first-party adapters and
  adds hosting + versioning surface — the exact overhead this design avoids.
  Left as a future extension point if a community-adapter ecosystem emerges.

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

Every Tier-1 primitive must become an explicit client boundary before adapter
mechanics ship. The current `src/react/components/ui/` files are React components
with client-only behaviour, but they do not consistently declare `"use client"`.
The migration must add top-level client boundaries, or `.client.` entry modules
where that better fits the RSC classifier, before an adapter can safely wrap
client-only engines.

Adapters (and the engines they wrap) must:

- import cleanly under the Deno + `esm.sh` loader. The import-rewriter and HTTP
  cache suites already cover generic `esm.sh` and scoped package URL handling,
  including `@radix-ui/react-slot`; adapter-specific smoke tests still need to
  prove each selected engine under the same loader;
- be SSR-safe (no `document` at import; stable `useId`);
- carry any required provider (e.g. React Aria historically wants an
  `I18nProvider`/SSR context) internally, so the Skin's SSR contract is uniform.

The appendix records the per-engine SSR specifics that this rule has to absorb.

### 6.9 Worked example — one Popover, three engines

This is the whole proposal in code. The consumer call-site and the Skin are
written **once**; the same `PopoverParts` contract is satisfied by the builtin,
Base UI (parts archetype), and React Aria (hook archetype) adapters. Nothing in
the first two blocks changes when the engine changes.

**The consumer call-site — never changes, whatever engine is selected:**

```tsx
import { Popover, PopoverTrigger, PopoverContent, Button } from "veryfront/ui";

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Filters</Button>
  </PopoverTrigger>
  <PopoverContent align="end">…</PopoverContent>
</Popover>;
```

**The Skin (`src/react/components/ui/popover.tsx`) — one engine-agnostic file.**
It owns only classes + variants; it resolves the active adapter and forwards:

```tsx
import * as React from "react";
import { cva, cx } from "./cva.ts";
import { useAdapter } from "./adapter/context.ts";
import type { PopoverContentProps, PopoverTriggerProps } from "./adapter/contract.ts";

const contentVariants = cva(
  "z-50 rounded-md border border-[var(--border)] bg-[var(--popover)] p-4 " +
    "text-[var(--popover-foreground)] shadow-md outline-none " +
    // state classes key off the adapter-NORMALISED attribute, never the engine's:
    "data-[vf-state=open]:animate-in data-[vf-state=closed]:animate-out",
);

export function Popover(props: React.ComponentProps<typeof PopoverRoot>) {
  const { popover } = useAdapter();
  return <popover.Root {...props} />;
}

export function PopoverTrigger({ className, asChild, ...props }: PopoverTriggerProps) {
  const { popover } = useAdapter();
  return <popover.Trigger asChild={asChild} className={cx(className)} {...props} />;
}

export function PopoverContent({ className, align = "start", ...props }: PopoverContentProps) {
  const { popover } = useAdapter();
  return (
    <popover.Content align={align} className={cx(contentVariants(), className)} {...props} />
  );
}
```

**Adapter A — builtin (default, zero-dep).** Pure wrapper over today's machinery,
so behaviour on `main` is unchanged:

```tsx
// src/react/components/ui/adapter/builtin/popover.tsx
import { createAnchoredSurfaceParts } from "../../anchored-surface.tsx";
import type { PopoverParts } from "../contract.ts";

const parts = createAnchoredSurfaceParts(); // existing hand-rolled Root/Trigger/Content

export const builtinPopover: PopoverParts = {
  Root: parts.AnchoredRoot,
  Trigger: (p) => <parts.AnchoredTrigger haspopup="dialog" {...p} />,
  Content: parts.AnchoredContent, // already portals via Floating + UI_SCOPE_SELECTOR
};
```

**Adapter B — Base UI (parts archetype).** Note the three normalisations the
contract demands: `onOpenChange` drops Base UI's 2nd arg; positioning goes to
`Positioner` while our classes land on `Popup`; the portal `container` keeps the
surface inside the token scope; and we re-emit `data-vf-state`:

```tsx
// ./ui-adapters/base-ui.tsx — vendored into YOUR repo (npx veryfront@latest add adapter base-ui)
import * as React from "react";
import { Popover as Base } from "@base-ui/react/popover"; // YOUR dependency, YOUR version
import { useTokenScopeRef, type PopoverParts } from "veryfront/ui/adapter";

export const baseUiPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => (
    <Base.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => onOpenChange?.(next)} // drop eventDetails → contract vocab
    >
      {children}
    </Base.Root>
  ),

  Trigger: ({ asChild, children, ...props }) =>
    asChild
      ? <Base.Trigger render={children as React.ReactElement} {...props} />
      : <Base.Trigger {...props}>{children}</Base.Trigger>,

  Content: ({ align = "start", sideOffset = 4, className, children, ...props }) => {
    const scopeRef = useTokenScopeRef(); // node carrying [data-vf-ui]
    return (
      <Base.Portal container={scopeRef}>
        {/* Positioner takes the position props … */}
        <Base.Positioner align={align} sideOffset={sideOffset}>
          {/* … Popup takes our styled surface + the normalised state attr */}
          <Base.Popup
            className={className}
            data-vf-state={/* mirror Base UI's data-[open]/[closed] */ "open"}
            {...props}
          >
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    );
  },
};
```

**Adapter C — React Aria (hook archetype).** The hardest shape: no compound
parts, so the adapter *owns the DOM* and spreads prop-getters, absorbs the
`isOpen` naming and the two-step `useOverlayTrigger → useButton` trigger:

```tsx
// ./ui-adapters/react-aria.tsx — vendored into YOUR repo (npx veryfront@latest add adapter react-aria)
import * as React from "react";
import { DismissButton, Overlay, useButton, useOverlayTrigger, usePopover } from "react-aria";
import { useOverlayTriggerState } from "react-stately";
import { useTokenScopeRef, type PopoverParts } from "veryfront/ui/adapter";

const Ctx = React.createContext<any>(null);

export const reactAriaPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    const state = useOverlayTriggerState({ isOpen: open, defaultOpen, onOpenChange });
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const { triggerProps, overlayProps } = useOverlayTrigger({ type: "dialog" }, state, triggerRef);
    return (
      <Ctx.Provider value={{ state, triggerRef, triggerProps, overlayProps }}>
        {children}
      </Ctx.Provider>
    );
  },

  Trigger: ({ children, className, ...props }) => {
    const { triggerRef, triggerProps } = React.useContext(Ctx);
    const { buttonProps } = useButton(triggerProps, triggerRef); // the RA two-step
    return (
      <button ref={triggerRef} className={className} {...buttonProps} {...props}>
        {children}
      </button>
    );
  },

  Content: ({ align = "start", className, children }) => {
    const { state, triggerRef, overlayProps } = React.useContext(Ctx);
    const popoverRef = React.useRef<HTMLDivElement>(null);
    const scopeRef = useTokenScopeRef();
    const { popoverProps } = usePopover(
      { triggerRef, popoverRef, placement: align === "end" ? "bottom end" : "bottom start" },
      state,
    );
    if (!state.isOpen) return null;
    return (
      <Overlay portalContainer={scopeRef.current ?? undefined}>
        <div
          ref={popoverRef}
          className={className}
          data-vf-state={state.isOpen ? "open" : "closed"}
          {...popoverProps}
          {...overlayProps}
        >
          <DismissButton onDismiss={state.close} />
          {children}
          <DismissButton onDismiss={state.close} />
        </div>
      </Overlay>
    );
  },
};
```

**Selecting the adapter — the per-component map via context (primary; §6.5).**
The map is *partial* and *vendored* — no `@veryfront/ui-adapter-*` package, no
version to align. Override only what you want; the rest stays builtin:

```tsx
import { UIAdapterProvider } from "veryfront/ui";
import { baseUiPopover } from "./ui-adapters/base-ui.tsx";       // you own these files
import { reactAriaPopover } from "./ui-adapters/react-aria.tsx"; // (pick one per primitive)

export default function App({ children }: { children: React.ReactNode }) {
  return (
    <UIAdapterProvider adapter={{ popover: baseUiPopover /*, dialog: …, menu: … */ }}>
      {children}
    </UIAdapterProvider>
  );
}
```

With no provider at all, `useAdapter()` falls back to `BuiltinAdapter` — the
out-of-the-box experience needs no setup. A Veryfront app may *optionally* hoist
this selection into `veryfront.config.ts` (`ui: { adapter: "base-ui" }`) so the
resolver binds it statically and elides the context read (§6.5) — same map, one
fewer runtime lookup.

> These blocks are illustrative (final types live in code), but they are complete
> enough to show the load-bearing claim: **one Skin, one call-site, three engines,
> zero call-site changes.**

### 6.10 Per-primitive walkthrough — every Tier-1 seam

Popover (§6.9) is the anchored archetype. Here is each remaining Tier-1 primitive:
its **contract parts**, the **builtin machinery** it wraps + the `TODO(a11y)` gap
the adapters close, and the **specific per-engine normalization** the contract has
to absorb. This is what "going through each" surfaces — the seams are not uniform.

#### Dialog (modal archetype)

- **Contract parts:** `Root(open, defaultOpen, onOpenChange, modal?)`, `Trigger`,
  `Content` (portalled, focus-trapped, scroll-locked), `Title`, `Description`,
  `Close`.
- **Builtin wraps** `createModalSurfaceParts("Dialog")`. Gap it closes: today's
  modal is **not portalled, has no focus trap, no scroll-lock, no
  `aria-labelledby`** (`modal-surface.tsx` TODO). Every engine provides all four.
- **Per-engine:** Radix `Root/Trigger/Portal/Overlay/Content/Title/Description/Close`
  — near 1:1. Base UI renames `Overlay → Backdrop`, splits positioning, and its
  `modal` accepts `'trap-focus'` (map our `modal:true`). React Aria:
  `useOverlayTriggerState` + `useDialog` — the adapter must wire `titleProps` to
  our `Title` for `aria-labelledby`, and `isOpen ⇄ open`.

#### Drawer / Sheet — a *skin over the Dialog contract*, not its own contract

- **Key simplification:** no engine ships a true drawer. So `Drawer` is our
  **skin** (slide-from-`side` classes) over the **same `DialogParts`** contract,
  with a `side: "left"|"right"|"top"|"bottom"` prop on `Content`. This drops the
  Tier-1 contract count from 6 to 5.
- **Builtin wraps** `createModalSurfaceParts("Drawer")` + the drag-handle `lead`.
- **Intersection note (rule 6):** drag-to-dismiss / snap points (Vaul-style) are
  **builtin-only** — no Radix/Base UI/React Aria equivalent — so they are *not* in
  the contract. Under a third-party adapter, Drawer is a slide-animated modal
  without drag. Documented, not silently dropped.

#### DropdownMenu (anchored + roving focus + typeahead)

- **Contract parts:** `Root`, `Trigger(haspopup="menu")`, `Content`, `Item`,
  `Separator`, `Label`. (Submenu deferred to Tier-2 — builtin has none.)
- **Builtin wraps** `createAnchoredSurfaceParts()` + `Floating`. Gap it closes:
  **no roving focus, no typeahead, no `aria-activedescendant`, no submenus**
  (`anchored-surface.tsx` TODO) — all free from the engines.
- **Per-engine + the sharp constraint:** Radix `DropdownMenu.*`, Base UI `Menu.*`
  (Positioner/Popup split). **React Aria menus reject arbitrary children** — only
  `MenuItem`/`Section`/`Header` — so our `Item` maps to a role-tagged slot and
  free-form content inside a menu is *out of the contract intersection*. Selection
  normalizes to an `onSelect`/`onAction` per `Item`.

#### Tooltip

- **Contract parts:** `Root(delay?)`, `Trigger`, `Content`.
- **Builtin wraps** `tooltip.tsx` (own portal + positioning). Gap it closes:
  **`aria-describedby` wiring, open/close delay grouping, Escape dismissal**
  (`tooltip.tsx` TODO).
- **Per-engine:** Radix and Base UI need a **Provider** for cross-tooltip delay
  grouping — the adapter mounts it internally so the Skin never sees it. **React
  Aria tooltips attach only to focusable triggers** (intersection constraint) — the
  adapter requires the `Trigger` child be focusable, matching our `asChild` button.

#### Select (two state axes: open **and** value)

- **Contract parts:** `Root(value, defaultValue, onValueChange, open?,
  onOpenChange?)`, `Trigger`, `Value`, `Content`, `Item`, `ItemText`, `Group`,
  `Label`, `Separator`. Note this is the one primitive with **selection state on
  top of disclosure state** — the contract carries both.
- **Builtin wraps** `select.tsx` (uses `Floating`). Gap it closes: **roving focus,
  arrow/typeahead keyboard nav, `aria-activedescendant`** (`select.tsx` TODO).
- **Per-engine:** Radix `Select.*` with a `Viewport` scroll container; Base UI
  `Select.*` with Positioner/Popup. **React Aria is collection-based** —
  `useSelectState` + `ListBox`/`ListBoxItem` — so our `Item` maps to a collection
  item and the adapter bridges `value/onValueChange ⇄ selectedKey/onSelectionChange`.
  Native `<form>` submission differs per engine; the adapter renders a hidden input
  where the engine doesn't.

**What the walkthrough proves:** the contract is not one-size — each primitive has
a distinct seam (Dialog's `titleProps`, Menu's child-type restriction, Tooltip's
delay Provider, Select's dual state, Drawer's non-portable drag). The `UIAdapter`
interface is the sum of these per-primitive parts, and §6.3 rules 1–7 are exactly
the tools each seam needs. It also shows the payoff concretely: **five of these
list a builtin `TODO(a11y)` gap that a mature engine closes for free.**

### 6.11 Engine coverage gaps — decided: builtin fallback + dev warning + matrix

Not every engine ships every primitive (survey §13.3): Ariakit has no Slider,
Table, or DatePicker; Radix has no Number Field; etc. What happens when the
selected adapter lacks a primitive the app uses?

- **Tier-1 has no gaps.** All four engines cover Dialog, Popover, Menu, Tooltip,
  and Select, and Drawer is a skin over Dialog (§6.10). So this question is
  entirely a **Tier-2** concern (Slider, and the like) — Tier-1 selection is
  always complete.
- **Default behaviour: per-primitive fallback to builtin.** The per-component map
  (§6.5) already merges over `BuiltinAdapter`, so an unmapped/missing primitive
  transparently uses the zero-dep builtin. The app never breaks because an engine
  is missing one component.
- **But not *silently*.** Silent fallback would hide a real quality gap — a team
  that picked "Ariakit" for its a11y would get a builtin Slider without knowing.
  So a missing primitive emits a **dev-mode warning** (`[veryfront/ui] Ariakit has
  no Slider; falling back to the builtin Slider`) and is documented in a
  **coverage matrix** (engine × primitive) in the docs, derived from the survey.
  Production builds do not warn.
- **Opt-in strictness for teams that want the gap to block.** A
  `ui: { adapter: "ariakit", strict: true }` flag turns a missing-primitive
  fallback into a **build-time error**, for teams that would rather fail the build
  than ship a mixed-engine surface. Off by default (graceful > strict).

This follows the project's "no silent caps" principle: fall back so nothing
breaks, but surface exactly what was substituted so it is never a surprise.

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

### 7.3 shadcn: no separate recommendation — it is a different axis (§9)

shadcn is not an engine, so there is no shadcn adapter to recommend. Shipping the
Base UI + Radix adapters (§7.1–7.2) already puts us on the same primitives shadcn
sits on — the only interop this RFC owes. Token-name aliasing and shadcn-registry
distribution are on the separate distribution axis and are deferred (§9). One
useful fact that *does* land here: shadcn defaulting to Base UI in 2026 is
independent evidence that Base UI is the right flagship (§7.1).

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

## 9. Why shadcn is out of scope — it is a different layer, not a different engine

The instinct to add a "shadcn adapter" is a category error, and worth naming
explicitly because reviewers will ask. There are **two orthogonal axes**:

| Axis | Members | What the axis decides |
| ---- | ------- | --------------------- |
| **Engine / Mechanics** | Base UI, Radix, Ariakit, React Aria | focus/dismiss/positioning/ARIA — *this is what adapters swap* |
| **Styled surface + distribution** | **shadcn/ui**, **`veryfront/ui` itself** | the look, the tokens, and how the component source is delivered |

shadcn lives on the **second** axis. It is a copy-paste distribution model
(components vendored into your repo via a CLI/registry) that **wraps an engine** —
Base UI by default since mid-2026, Radix on `-b radix`, and third-party registries
wrap Ariakit and others. That makes shadcn a **sibling of `veryfront/ui`** — a
peer styled surface — not something that sits *below* us as an engine we adapt to.

Consequences:

- **There is no shadcn adapter, and we build none.** You cannot "use shadcn" as a
  dependency the way you use Base UI; you vendor its components. A team already on
  shadcn has its own styled `Dialog`; they would not route it through
  `veryfront/ui`.
- **The only interop the adapters give us is free and already covered:** shipping
  the Base UI and Radix adapters makes `veryfront/ui` sit on the *same primitives*
  shadcn sits on. That is the entire substantive answer to "is it the same stuff
  shadcn uses?" — and it falls out of §7.1–7.2 at no extra cost.
- **Everything else labelled "shadcn" is on the distribution axis and is deferred**
  (not rejected), out of this RFC:
  - *token-name aliasing* (`--background`/`--primary`/`.dark`) so a shadcn theme
    can style our components — optional, and in tension with our own token
    vocabulary; do it only on real demand;
  - *publishing our skins as a shadcn registry* (`npx shadcn add <url>`) so shadcn
    users can vendor Veryfront components — a distribution decision, orthogonal to
    adapters.

Bottom line: **shadcn is a different concern.** The adapter RFC's job is the
engine axis; being Base-UI/Radix-backed is all the shadcn story this RFC owes.

## 10. Risks and trade-offs

| Risk | Mitigation |
| ---- | ---------- |
| Contract can't express an engine's quirk (e.g. Base UI `Positioner` vs Radix `Content`) | Contract renders *components*, not prop-getters, so each adapter absorbs its own structure (§6.3 rule 2). Prototype two archetype adapters (parts-based + hook-based) before locking the contract. |
| Combinatorial test surface (N primitives × M adapters) | One shared conformance suite (§6.7); adapters are thin. |
| Styling seam differences (`asChild`/`render`/prop-getters) leak into skins | Normalised to our `asChild` at the contract; adapters translate (§6.3 rule 3). |
| Portal escapes token scope under a third-party portal | Mandatory scope-attribute conformance test (§6.7). |
| Bundle bloat if adapters aren't tree-shaken | Partial per-component map: unmapped primitives are builtin; optional build-time bind (§6.5) statically includes only the chosen adapter. Engines are the developer's own dep. |
| Version drift / "bump and align" burden on us | **Core depends on no engine and publishes no adapter package** (§6.6). Reference adapters are vendored (shadcn model); the developer owns the file and bumps their own engine; the conformance suite (§6.7) detects breakage. Nothing on our side to align. |
| Engine churn (Radix maintenance, Base UI major) | The abstraction is the hedge — retarget a vendored adapter file without touching skins. |

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

### Decided in this RFC

- **Distribution of reference adapters → `veryfront generate adapter <name>`,
  docs-mirrored from the same template; no hosted registry (§6.6).** Context map +
  vendored source means core publishes no `@veryfront/ui-adapter-*` package and
  depends on no engine.
- **Engine coverage gaps → per-primitive builtin fallback + dev-mode warning +
  coverage matrix, with opt-in `strict: true` to hard-error (§6.11).** Tier-1 has
  no gaps; this is a Tier-2-only concern.

### Still open

1. Do Tier-2 primitives ship in this RFC's milestone or a follow-up?
2. Confirm **Base UI** as the flagship reference adapter (§7.1) and the Base-UI +
   React-Aria "two archetypes first" rollout order (§7.2).
3. Is the optional build-time bind (§6.5) worth the module-resolver work in v1, or
   is the context map alone enough until profiling shows the read matters?

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
  React copies** — pin one `react`/`react-dom` via the import map. Repo tests
  already exercise `esm.sh` URL normalization and scoped package handling, but
  each adapter still needs a loader smoke test against its real engine package
  before this RFC can treat engine loading as proven.

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
