/**
 * Radix UI adapter for veryfront/ui — REFERENCE TEMPLATE.
 *
 * `npx veryfront generate adapter radix` copies this file into YOUR repo
 * (e.g. `./ui-adapters/radix.tsx`). You own it from then on. The
 * `@radix-ui/react-*` packages are YOUR dependencies, bumped on YOUR schedule;
 * `veryfront/ui` core depends on no engine (enforced by a CI guard). Wire it up
 * once:
 *
 * ```tsx
 * import { UIAdapterProvider } from "veryfront/ui";
 * import { radixAdapter } from "./ui-adapters/radix.tsx";
 *
 * <UIAdapterProvider adapter={radixAdapter}>{app}</UIAdapterProvider>;
 * ```
 *
 * The provider merges a PARTIAL map over the builtin, so this adapter adopts
 * Radix for the four floating overlays (popover / dialog / menu / tooltip) and
 * leaves select / combobox / toast zero-dependency (builtin). Extend the map as
 * you vendor more parts.
 *
 * How Radix maps onto the contract (the fault lines from RFC 0001 §13.2):
 *   1. `onOpenChange` is ALREADY single-arg `(open: boolean) => void` in Radix —
 *      no normalization needed (Base UI's 2nd `eventDetails` arg does not exist
 *      here). We still keep the contract's `DisclosureProps` shape.
 *   2. No positioner/surface split: Radix's ONE `Content` element takes the
 *      positioning props (`align` / `side` / `sideOffset`) directly AND carries
 *      our `className` + `data-vf-state="open"`.
 *   3. Portal `container` keeps the surface inside the `[data-vf-ui]` token scope
 *      (via `useTokenScope`) — otherwise every `var(--…)` resolves to nothing.
 *   4. `asChild` is native Radix: pass `asChild` and Radix merges its behaviour
 *      onto the single child element.
 *
 * @module ui-adapters/radix
 */
import * as React from "react";
// verify these entry points vs your installed @radix-ui/react-* versions.
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useTokenScope } from "veryfront/ui";
import type {
  DialogParts,
  MenuParts,
  ModalState,
  PopoverParts,
  TooltipParts,
  TooltipSide,
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

// ---------------------------------------------------------------------------
// Popover (parts archetype)
// ---------------------------------------------------------------------------
export const radixPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => (
    // (1) Radix `onOpenChange` is already single-arg — pass straight through.
    <Popover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </Popover.Root>
  ),
  // (4) `asChild` is native Radix — merges behaviour onto the single child.
  Trigger: ({ asChild, children, ...rest }) => (
    <Popover.Trigger asChild={asChild} {...rest}>{children}</Popover.Trigger>
  ),
  Content: ({ align = "end", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (3) portal into the token scope.
        <Popover.Portal container={container}>
          {/* (2) one Content: positioning props + classes + normalized state. */}
          <Popover.Content
            align={align}
            sideOffset={4}
            className={className}
            data-vf-state="open"
            {...rest}
          >
            {children}
          </Popover.Content>
        </Popover.Portal>
      )}
    </ScopedPortal>
  ),
};

// ---------------------------------------------------------------------------
// Dialog (modal archetype)
// ---------------------------------------------------------------------------
const DialogStateContext = React.createContext<ModalState | null>(null);

export const radixDialog: DialogParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    // Radix owns the real open state; mirror it so skin parts (DialogCancel)
    // can read `useDialog()` through the same contract shape.
    const [internal, setInternal] = React.useState(defaultOpen ?? false);
    const isControlled = open !== undefined;
    const isOpen = isControlled ? open : internal;
    const setOpen = React.useCallback((next: boolean) => {
      if (!isControlled) setInternal(next);
      onOpenChange?.(next);
    }, [isControlled, onOpenChange]);
    const state = React.useMemo<ModalState>(() => ({ open: isOpen, setOpen }), [isOpen, setOpen]);
    return (
      <DialogStateContext.Provider value={state}>
        <Dialog.Root open={isOpen} onOpenChange={setOpen}>
          {children}
        </Dialog.Root>
      </DialogStateContext.Provider>
    );
  },
  Trigger: ({ asChild, children, ...rest }) => (
    <Dialog.Trigger asChild={asChild} {...rest}>{children}</Dialog.Trigger>
  ),
  Content: ({ className, children, lead, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        <Dialog.Portal container={container}>
          <Dialog.Overlay />
          <Dialog.Content className={className} data-vf-state="open" {...rest}>
            {lead}
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </ScopedPortal>
  ),
  Close: ({ asChild, children, ...rest }) => (
    <Dialog.Close asChild={asChild} {...rest}>{children}</Dialog.Close>
  ),
  useDialog: () => {
    const ctx = React.useContext(DialogStateContext);
    if (!ctx) throw new Error("Dialog parts must be used within <Dialog>");
    return ctx;
  },
};

// ---------------------------------------------------------------------------
// Menu (dropdown archetype)
// ---------------------------------------------------------------------------
const MenuStateContext = React.createContext<ModalState | null>(null);

export const radixMenu: MenuParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    // Radix owns the real open state; mirror it so a menu Item can close the
    // menu on select via the tolerant `useMenu()?.setOpen(false)`.
    const [internal, setInternal] = React.useState(defaultOpen ?? false);
    const isControlled = open !== undefined;
    const isOpen = isControlled ? open : internal;
    const setOpen = React.useCallback((next: boolean) => {
      if (!isControlled) setInternal(next);
      onOpenChange?.(next);
    }, [isControlled, onOpenChange]);
    const state = React.useMemo<ModalState>(() => ({ open: isOpen, setOpen }), [isOpen, setOpen]);
    return (
      <MenuStateContext.Provider value={state}>
        <DropdownMenu.Root open={isOpen} onOpenChange={setOpen}>
          {children}
        </DropdownMenu.Root>
      </MenuStateContext.Provider>
    );
  },
  Trigger: ({ asChild, children, ...rest }) => (
    <DropdownMenu.Trigger asChild={asChild} {...rest}>{children}</DropdownMenu.Trigger>
  ),
  Content: ({ align = "start", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        <DropdownMenu.Portal container={container}>
          <DropdownMenu.Content
            align={align}
            sideOffset={4}
            className={className}
            data-vf-state="open"
            {...rest}
          >
            {children}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      )}
    </ScopedPortal>
  ),
  // Tolerant: returns null outside a menu (contract's `ctx?.setOpen(false)`).
  useMenu: () => React.useContext(MenuStateContext),
};

// ---------------------------------------------------------------------------
// Tooltip (hover/focus archetype)
// ---------------------------------------------------------------------------
export const radixTooltip: TooltipParts = {
  // Radix groups delay at the Provider level — map `delayDuration` onto it.
  Provider: ({ children, delayDuration }) => (
    <Tooltip.Provider delayDuration={delayDuration}>{children}</Tooltip.Provider>
  ),
  Root: ({ children }) => <Tooltip.Root>{children}</Tooltip.Root>,
  Trigger: ({ asChild, children, ...rest }) => (
    <Tooltip.Trigger asChild={asChild} {...rest}>{children}</Tooltip.Trigger>
  ),
  Content: ({ side = "top", sideOffset = 4, className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        <Tooltip.Portal container={container}>
          <Tooltip.Content
            side={side}
            sideOffset={sideOffset}
            className={className}
            data-vf-state="open"
            {...rest}
          >
            {children}
          </Tooltip.Content>
        </Tooltip.Portal>
      )}
    </ScopedPortal>
  ),
};

/**
 * Partial adapter map — adopt Radix for the four floating overlays and keep
 * select / combobox / toast zero-dependency (builtin). Extend as you vendor
 * more parts.
 */
export const radixAdapter: Partial<UIAdapter> & { name: string } = {
  name: "radix",
  popover: radixPopover,
  dialog: radixDialog,
  menu: radixMenu,
  tooltip: radixTooltip,
};
