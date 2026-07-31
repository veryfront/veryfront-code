/**
 * React Aria adapter for `veryfront/ui` — REFERENCE TEMPLATE.
 *
 * `npx veryfront generate adapter react-aria` copies this file into YOUR repo
 * (e.g. `./ui-adapters/react-aria.tsx`). You own it from then on.
 * `react-aria-components` is YOUR dependency, bumped on YOUR schedule;
 * `veryfront/ui` core depends on no engine (enforced by a CI guard). Wire it up
 * once:
 *
 * ```tsx
 * import { UIAdapterProvider } from "veryfront/ui";
 * import { reactAriaAdapter } from "./ui-adapters/react-aria.tsx";
 *
 * <UIAdapterProvider adapter={reactAriaAdapter}>{app}</UIAdapterProvider>;
 * ```
 *
 * The provider merges a PARTIAL map over the builtin, so you can adopt React
 * Aria for just some parts and leave the rest zero-dependency. This template
 * covers `popover` / `dialog` / `menu` / `tooltip`; `select` / `combobox` /
 * `toast` stay builtin.
 *
 * ## Component layer, not hooks (contract reconciliation)
 * We build against **`react-aria-components`** (the high-level component layer:
 * `DialogTrigger`, `Popover`, `Menu`, `Tooltip`, …) — NOT the low-level
 * `react-aria` / `react-stately` hooks. The veryfront contract is **role-tagged
 * render slots** (`Root`/`Trigger`/`Content`) plus a normalized `{open,setOpen}`
 * disclosure, deliberately NOT the prop-getters that React Aria's hooks return.
 * The component layer already packages those hooks behind composition
 * primitives, so it maps cleanly onto our slots; the hook layer would force us to
 * reinvent that packaging. RAC's component model (its `*Trigger` components own
 * open/hover state and portal their surfaces) is therefore *bridged* onto the
 * render-slot contract below.
 *
 * Reconciliations the contract forces (cf. Base UI's three, RFC 0001 §13.2):
 *   1. `onOpenChange` needs NO normalization — RAC's is already single-arg
 *      `(isOpen: boolean) => void`, exactly the contract shape (Base UI, by
 *      contrast, has a 2nd `eventDetails` arg to drop).
 *   2. Positioning-vs-surface split: RAC's `Popover` / `Modal` / `Tooltip` are
 *      the positioner + portal; our classes + `data-vf-state="open"` land on the
 *      surface element (`Popover` itself / `Dialog` / `Menu` / `Tooltip`).
 *      `align`→`placement` (`"bottom start"` / `"bottom end"`), `side`→
 *      `placement`, `sideOffset`→`offset`.
 *   3. Portal container: RAC portals overlays to `document.body` by default, so
 *      every surface takes `UNSTABLE_portalContainer` (or wrap the tree in
 *      `UNSTABLE_PortalProvider`) to stay inside the `[data-vf-ui]` token scope
 *      via `useTokenScope` — otherwise every `var(--…)` resolves to nothing.
 *   4. `asChild` composes through RAC's `Pressable` (triggers) / `Focusable`
 *      (tooltip target) rather than a Radix-style Slot merge: React Aria owns the
 *      press/hover wiring on its own trigger, so the consumer's element is
 *      rendered *inside* that wrapper. Minor semantic difference — the child
 *      still receives the interaction, but through RAC's press abstraction.
 *
 * @module ui-adapters/react-aria
 */
import * as React from "react";
// `Pressable` / `Focusable` were `UNSTABLE_`-prefixed in older releases and the
// `UNSTABLE_portalContainer` prop name is still evolving — verify vs your
// installed react-aria-components version.
import {
  Button,
  Dialog,
  DialogTrigger,
  Focusable,
  Menu,
  MenuTrigger,
  Modal,
  Popover,
  Pressable,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { useTokenScope } from "veryfront/ui";
import type {
  DialogParts,
  MenuParts,
  ModalState,
  PopoverParts,
  TooltipParts,
  UIAdapter,
} from "veryfront/ui";

/** Render a portalled surface inside the veryfront token scope. */
function ScopedPortal(
  { children }: { children: (container: HTMLElement) => React.ReactNode },
): React.ReactElement {
  const { ref, getContainer } = useTokenScope();
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => setContainer(getContainer()), [getContainer]);
  return (
    <>
      <span ref={ref} hidden aria-hidden="true" />
      {container ? children(container) : null}
    </>
  );
}

/**
 * Mirror RAC's engine-owned open state into a contract `{open,setOpen}` so skin
 * parts (`DialogCancel`, a menu `Item`) can read + drive it through the same
 * shape everywhere. `setOpen` flows back into the RAC `*Trigger`'s `onOpenChange`.
 */
function useMirroredState(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
): ModalState {
  const [internal, setInternal] = React.useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internal;
  const setOpen = React.useCallback((next: boolean) => {
    if (!isControlled) setInternal(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);
  return React.useMemo<ModalState>(() => ({ open: isOpen, setOpen }), [isOpen, setOpen]);
}

/**
 * Shared button trigger. `asChild` renders the consumer's element inside RAC's
 * `Pressable` (React Aria owns the press wiring); otherwise a RAC `Button`.
 */
function TriggerButton(
  { asChild, children, ...rest }:
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> },
): React.ReactElement {
  return asChild
    ? <Pressable>{React.cloneElement(children as React.ReactElement, rest)}</Pressable>
    : <Button {...rest}>{children}</Button>;
}

// ---------------------------------------------------------------------------
// Popover (parts archetype — DialogTrigger owns open state, Popover portals)
// ---------------------------------------------------------------------------
export const reactAriaPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => (
    // (1) onOpenChange passes straight through — already `(isOpen) => void`.
    <DialogTrigger isOpen={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </DialogTrigger>
  ),
  Trigger: (props) => <TriggerButton {...props} />,
  Content: ({ align = "end", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (2) `align`→`placement`, (3) portal into the token scope. Classes +
        // normalized state land on the Popover surface itself.
        <Popover
          placement={`bottom ${align}`}
          offset={4}
          UNSTABLE_portalContainer={container}
          className={className}
          data-vf-state="open"
          {...rest}
        >
          {children}
        </Popover>
      )}
    </ScopedPortal>
  ),
};

// ---------------------------------------------------------------------------
// Dialog (modal archetype — DialogTrigger + Modal + Dialog)
// ---------------------------------------------------------------------------
const DialogStateContext = React.createContext<ModalState | null>(null);

export const reactAriaDialog: DialogParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    // RAC owns the real open state; mirror it so skin parts (DialogCancel) can
    // read `useDialog()` through the same contract shape.
    const state = useMirroredState(open, defaultOpen, onOpenChange);
    return (
      <DialogStateContext.Provider value={state}>
        <DialogTrigger isOpen={state.open} onOpenChange={state.setOpen}>
          {children}
        </DialogTrigger>
      </DialogStateContext.Provider>
    );
  },
  Trigger: (props) => <TriggerButton {...props} />,
  Content: ({ className, children, lead, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (3) Modal renders the overlay + portals; the Dialog panel carries the
        // skin classes + normalized state.
        <Modal UNSTABLE_portalContainer={container}>
          <Dialog className={className} data-vf-state="open" {...rest}>
            {lead}
            {children}
          </Dialog>
        </Modal>
      )}
    </ScopedPortal>
  ),
  Close: ({ asChild, children, onClick, ...rest }) => {
    // We control open via context, so closing = `setOpen(false)`; that unwinds
    // through DialogTrigger's `isOpen` and dismisses the Modal.
    const ctx = React.useContext(DialogStateContext);
    const close = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      ctx?.setOpen(false);
    };
    return asChild
      ? React.cloneElement(children as React.ReactElement, { ...rest, onClick: close })
      : (
        <button type="button" onClick={close} {...rest}>
          {children}
        </button>
      );
  },
  useDialog: () => {
    const ctx = React.useContext(DialogStateContext);
    if (!ctx) throw new Error("Dialog parts must be used within <Dialog>");
    return ctx;
  },
};

// ---------------------------------------------------------------------------
// Menu (parts archetype — MenuTrigger owns open state, Menu inside a Popover)
// ---------------------------------------------------------------------------
const MenuStateContext = React.createContext<ModalState | null>(null);

export const reactAriaMenu: MenuParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    // Mirror the engine's open state so a skin `Item` can call
    // `useMenu()?.setOpen(false)`; RAC also auto-closes on select.
    const state = useMirroredState(open, defaultOpen, onOpenChange);
    return (
      <MenuStateContext.Provider value={state}>
        {
          /* MenuTrigger's controlled `isOpen`/`onOpenChange` props are
            version-sensitive — verify vs your react-aria-components version. */
        }
        <MenuTrigger isOpen={state.open} onOpenChange={state.setOpen}>
          {children}
        </MenuTrigger>
      </MenuStateContext.Provider>
    );
  },
  Trigger: (props) => <TriggerButton {...props} />,
  Content: ({ align = "start", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (2) `align`→`placement`, (3) Popover positions + portals; the Menu
        // surface carries the skin classes + normalized state.
        <Popover
          placement={`bottom ${align}`}
          offset={4}
          UNSTABLE_portalContainer={container}
        >
          <Menu className={className} data-vf-state="open" {...rest}>
            {children}
          </Menu>
        </Popover>
      )}
    </ScopedPortal>
  ),
  // Tolerant: returns the mirrored ModalState inside a menu, null outside —
  // never throws (matches the item's `ctx?.setOpen(false)` call).
  useMenu: () => React.useContext(MenuStateContext),
};

// ---------------------------------------------------------------------------
// Tooltip (parts archetype — no separate Provider in React Aria)
// ---------------------------------------------------------------------------
// RAC has no Tooltip provider component; `delay` lives on each TooltipTrigger.
// The passthrough `Provider` just carries `delayDuration` down via context so
// `Root`'s TooltipTrigger can read it (delayDuration → TooltipTrigger `delay`).
const TooltipDelayContext = React.createContext<number | undefined>(undefined);

export const reactAriaTooltip: TooltipParts = {
  Provider: ({ children, delayDuration }) => (
    <TooltipDelayContext.Provider value={delayDuration}>
      {children}
    </TooltipDelayContext.Provider>
  ),
  Root: ({ children }) => {
    const delay = React.useContext(TooltipDelayContext);
    // TooltipTrigger owns hover/focus open state; its children are the focusable
    // Trigger followed by the Tooltip surface (our Content).
    return <TooltipTrigger delay={delay}>{children}</TooltipTrigger>;
  },
  Trigger: ({ asChild, children, ...rest }) =>
    // TooltipTrigger's target must be focusable; `Focusable` makes any single
    // child focusable + hoverable. `asChild` renders the consumer's element.
    asChild
      ? <Focusable>{React.cloneElement(children as React.ReactElement, rest)}</Focusable>
      : (
        <Focusable>
          <button type="button" {...rest}>{children}</button>
        </Focusable>
      ),
  Content: ({ side = "top", sideOffset = 4, className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (2) `side`→`placement`, `sideOffset`→`offset`; (3) portal into scope.
        <Tooltip
          placement={side}
          offset={sideOffset}
          UNSTABLE_portalContainer={container}
          className={className}
          data-vf-state="open"
          {...rest}
        >
          {children}
        </Tooltip>
      )}
    </ScopedPortal>
  ),
};

/**
 * Partial adapter map — adopt React Aria for popover + dialog + menu + tooltip,
 * keep select / combobox / toast zero-dependency (builtin). Extend as you vendor
 * more parts.
 */
export const reactAriaAdapter: Partial<UIAdapter> & { name: string } = {
  name: "react-aria",
  popover: reactAriaPopover,
  dialog: reactAriaDialog,
  menu: reactAriaMenu,
  tooltip: reactAriaTooltip,
};
