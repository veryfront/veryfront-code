---
title: "UI components"
description: "Use veryfront/ui - accessible, themeable primitives with a bring-your-own-engine adapter system."
order: 49
---

# UI components

`veryfront/ui` is Veryfront's component library: themeable, accessible primitives
you compose into your own UI. Every behavioural primitive splits into a **Skin**
(the Tailwind classes and design tokens you see) and **Mechanics** (focus,
dismiss, positioning, keyboard, ARIA) provided by a swappable **adapter** - so you
can keep the look while choosing the engine that powers it.

## Quick start

```tsx
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger } from "veryfront/ui";

export function Example() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Hello</DialogTitle>
      </DialogContent>
    </Dialog>
  );
}
```

No provider, no configuration, no extra dependency - it works out of the box on
the built-in engine. See [Adapters](#adapters) to swap in Base UI or another
engine.

## The primitives

Every primitive is **documented where it lives** - each has a Storybook page
(props, variants, and live examples) and JSDoc on its source. This guide stays a
thin overview; it deliberately does not re-list every component or variant.

**→ Browse the full catalog in the [Storybook UI workbench](./storybook-ui-workbench.md)**
(`deno task storybook`) - the Overview page links to a docs page for every
primitive, grouped by Layout, Form, Overlay, Structure, and Theming.

Compounds (e.g. `Dialog`) expose their parts as named exports **and** as a
namespace (`DialogTrigger` ≡ `Dialog.Trigger`) so both import styles work and the
parts tree-shake.

## Composition rules

Every primitive follows the same contract, so customising is predictable:

- **One node per part.** A part renders exactly one element (or zero + context) -
  there is never a hidden wrapper you can't reach. You compose structure from
  parts plus your own elements.
- **`className` targets that node.** Your classes merge onto the part's node
  (consumer classes appended last). No `xxxClassName` bags.
- **`{...props}` spread through.** Any `data-*`, `aria-*`, `id`, `onClick`, etc.
  you pass reaches the node.
- **`ref` reaches the node** (React 19 ref-as-prop) - including portalled surfaces
  like `PopoverContent`.
- **`asChild` merges behaviour onto your element.** Any behavioural part can graft
  its behaviour + a11y onto _your_ element, so you pick the tag and own all classes:

  ```tsx
  <PopoverTrigger asChild>
    <MyButton>Filters</MyButton>
  </PopoverTrigger>;
  ```

- **State is exposed as `data-*`, not boolean styling props.** Style with CSS/
  Tailwind variants (`data-[state=open]:…`, `data-active`, `data-disabled`).

## Theming

Colors, radii, and spacing are CSS custom properties scoped to `[data-vf-ui]`
(with `[data-vf-chat]` as a compat alias). Wrap your app once and every primitive
picks up the tokens - including surfaces portalled to the body, which stay inside
the token scope:

```tsx
import { DesignTokenStyle } from "veryfront/ui";

<div data-vf-ui>
  <DesignTokenStyle />
  {/* app */}
</div>;
```

Override a token by setting the CSS variable (e.g. `--primary`, `--foreground`,
`--separator`) on any ancestor.

## Adapters

Behavioural primitives get their mechanics from an **adapter**. This is opt-in
and layered. Today the swappable primitives are Dialog, Drawer, Tabs, Popover,
Combobox, Collapsible/Accordion (`disclosure`), ToggleGroup, Toolbar, and Toast;
DropdownMenu, Tooltip, and Select run on the builtin, with their swap seam
landing alongside the prebuilt engine adapters.

### The default: builtin (zero dependency)

With no provider, primitives run on the **builtin** adapter - a zero-dependency
engine bundled with `veryfront/ui`. Nothing to install; nothing changes for
no-dependency users.

The builtin covers the basics (roles, `aria-expanded`/`aria-haspopup`, Escape and
outside-click dismiss, portalling into the token scope). For richer accessibility
(focus trap, roving focus, typeahead, `aria-activedescendant`, scroll-lock) -
adopt a mature engine via an adapter.

### Opting into an engine

Wrap a subtree (or your whole app) in `UIAdapterProvider` with an adapter map. The
**call-site and skins never change** - only the engine does:

```tsx
import { UIAdapterProvider } from "veryfront/ui";
import { baseUiAdapter } from "./ui-adapters/base-ui.tsx";

<UIAdapterProvider adapter={baseUiAdapter}>
  {/* every Popover / Dialog below now runs on Base UI's mechanics */}
</UIAdapterProvider>;
```

The map is **partial and per-primitive** - override just what you want and leave
the rest on the builtin:

```tsx
// popover + dialog on Base UI; menu/tooltip/select stay on the builtin
<UIAdapterProvider adapter={{ popover: baseUiPopover, dialog: baseUiDialog }}>
```

### Getting an adapter

Adapters are **vendored** - the file lives in _your_ repo and you own it, so the
engine (e.g. `@base-ui/react`) is _your_ dependency, on _your_ version. Core
publishes no adapter package.

Today you **write the adapter yourself** against the exported contract (see
below) - it's a small, typed file whose only imports are the engine package and
`veryfront/ui` plus `veryfront/ui/adapter`. Prebuilt reference adapters for Base
UI / Radix / React Aria / Ariakit (and a `veryfront generate adapter <engine>`
command that vendors one for you) are in progress and ship alongside the
remaining swappable primitives.

### Writing your own adapter

An adapter satisfies a typed contract - role-tagged component slots plus
normalized `{ open, setOpen }` state. Import the runtime helper from
`veryfront/ui` and the contract types from `veryfront/ui/adapter`:

```tsx
import { useTokenScope } from "veryfront/ui";
import type { PopoverParts } from "veryfront/ui/adapter";

export const myPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => /* … */,
  Trigger: (props) => /* … */,
  Content: (props) => /* … portal into useTokenScope() … */,
};
```

`useAdapter()` reads the active adapter (defaulting to builtin) - the skins use it
internally, so you rarely call it directly.

## Verify it worked

- `import { Button, UIAdapterProvider, useAdapter } from "veryfront/ui"` resolves - the primitives and the adapter provider are public exports.
- With no `UIAdapterProvider`, `useAdapter().name` is `"builtin"`; wrapping a subtree in `<UIAdapterProvider adapter={{ name: "x" }}>` changes it - the swap seam resolves.
- `deno task storybook` renders a docs page for every primitive; `deno task storybook:check` passes.
- The swappable primitives (`dialog`, `drawer`, `tabs`, `popover`, `combobox`, `disclosure`, `toggleGroup`, `toolbar`, `toast`) resolve their mechanics through `useAdapter()`, so a partial `UIAdapterProvider` map re-routes just those - the rest stay on the builtin.

## See also

- [UI + chat overview](./chat-ui.md) - the chat surface built on these primitives.
- [Storybook UI workbench](./storybook-ui-workbench.md) - every primitive's states.
