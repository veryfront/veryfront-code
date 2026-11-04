---
title: "UI components"
description: "Use veryfront/ui - accessible, themeable primitives with a bring-your-own-engine adapter system."
order: 260
---

# UI components

`veryfront/ui` provides components for building application interfaces. Each
behavioural primitive separates its styles and tokens from focus, keyboard,
positioning and ARIA behaviour. An adapter supplies that behaviour.

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

The built-in engine needs no provider or extra dependency. Use an
[adapter](#adapters) to replace it.

## The primitives

Browse props, variants and examples in the
[Storybook UI workbench](./storybook-ui-workbench.md) (`deno task storybook`).
Its Overview groups components by Layout, Form, Overlay, Structure and Theming.

Compounds (e.g. `Dialog`) expose their parts as named exports, such as `Dialog`,
`DialogTrigger`, and `DialogContent`, so each part tree-shakes independently.

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

Adapters can replace the behaviour of Dialog, Drawer, Tabs, Popover, Combobox,
Collapsible/Accordion (`disclosure`), ToggleGroup, Toolbar and Toast.
DropdownMenu, Tooltip and Select currently use the builtin engine only.

### The default: builtin (zero dependency)

Without a provider, primitives use the **builtin** adapter bundled with
`veryfront/ui`.

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

Write an adapter against the exported contract below and keep it in your
repository. Import your chosen engine, `veryfront/ui` and
`veryfront/ui/adapter`. You own the engine dependency and version; core does
not currently publish prebuilt adapters or an adapter generator.

### Writing your own adapter

An adapter satisfies a typed contract - role-tagged component slots plus
normalized `{ open, setOpen }` state. Import the runtime helper from
`veryfront/ui` and the contract types from `veryfront/ui/adapter`:

```tsx
import * as React from "react";
import { createPortal } from "react-dom";
import { useTokenScope } from "veryfront/ui";
import type { PopoverParts } from "veryfront/ui/adapter";

const PopoverContext = React.createContext<
  {
    open: boolean;
    setOpen: (open: boolean) => void;
    getContainer: () => HTMLElement;
  } | null
>(null);

export const myPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    const { ref, getContainer } = useTokenScope();
    const controlled = open !== undefined;
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
    const currentOpen = controlled ? open : internalOpen;
    const setOpen = React.useCallback((next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    }, [controlled, onOpenChange]);

    return (
      <span ref={ref}>
        <PopoverContext.Provider value={{ open: currentOpen, setOpen, getContainer }}>
          {children}
        </PopoverContext.Provider>
      </span>
    );
  },
  Trigger: ({ asChild, children, onClick, ...props }) => {
    const ctx = React.useContext(PopoverContext);
    const triggerProps = {
      ...props,
      "aria-haspopup": "dialog" as const,
      "aria-expanded": ctx?.open ?? false,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) ctx?.setOpen(!(ctx.open));
      },
    };
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, triggerProps);
    }
    return <button type="button" {...triggerProps}>{children}</button>;
  },
  Content: ({ align: _align, initialFocus: _initialFocus, children, ...props }) => {
    const ctx = React.useContext(PopoverContext);
    if (!ctx?.open) return null;
    return createPortal(<div {...props}>{children}</div>, ctx.getContainer());
  },
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
