/**
 * Base UI adapter for `veryfront/ui` — REFERENCE TEMPLATE.
 *
 * `npx veryfront generate adapter base-ui` copies this file into YOUR repo
 * (e.g. `./ui-adapters/base-ui.tsx`). You own it from then on. `@base-ui/react`
 * is YOUR dependency, bumped on YOUR schedule; `veryfront/ui` core depends on no
 * engine (enforced by a CI guard). Wire it up once:
 *
 * ```tsx
 * import { UIAdapterProvider } from "veryfront/ui";
 * import { baseUiAdapter } from "./ui-adapters/base-ui.tsx";
 *
 * <UIAdapterProvider adapter={baseUiAdapter}>{app}</UIAdapterProvider>;
 * ```
 *
 * The provider merges a PARTIAL map over the builtin, so you can adopt Base UI
 * for just some parts and leave the rest zero-dependency. This template covers
 * `popover` / `dialog` / `menu` / `tooltip`; `select` / `combobox` / `toast`
 * stay builtin.
 *
 * Three normalizations the contract forces (the fault lines from RFC 0001 §13.2):
 *   1. Drop Base UI's 2nd `onOpenChange(open, eventDetails)` arg — our contract
 *      is single-arg `(open) => void`.
 *   2. Positioning anatomy splits: `Positioner` takes `align`/`sideOffset`; our
 *      classes + `data-vf-state` land on `Popup` (Radix's one `Content` ≈ Base
 *      UI's `Positioner` + `Popup`).
 *   3. Portal `container` keeps the surface inside the `[data-vf-ui]` token scope
 *      (via `useTokenScope`) — otherwise every `var(--…)` resolves to nothing.
 *
 * @module ui-adapters/base-ui
 */
import * as React from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
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

// ---------------------------------------------------------------------------
// Popover (parts archetype)
// ---------------------------------------------------------------------------
export const baseUiPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => (
    <BasePopover.Root
      open={open}
      defaultOpen={defaultOpen}
      // (1) drop the 2nd `eventDetails` arg.
      onOpenChange={(next: boolean) => onOpenChange?.(next)}
    >
      {children}
    </BasePopover.Root>
  ),
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <BasePopover.Trigger render={children as React.ReactElement} {...rest} />
      : <BasePopover.Trigger {...rest}>{children}</BasePopover.Trigger>,
  Content: ({ align = "end", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (3) portal into the token scope.
        <BasePopover.Portal container={container}>
          {/* (2) positioning on Positioner, classes + normalized state on Popup. */}
          <BasePopover.Positioner align={align} sideOffset={4}>
            <BasePopover.Popup
              className={className}
              data-vf-state="open"
              {...rest}
            >
              {children}
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      )}
    </ScopedPortal>
  ),
};

// ---------------------------------------------------------------------------
// Dialog (modal archetype)
// ---------------------------------------------------------------------------
const DialogStateContext = React.createContext<ModalState | null>(null);

export const baseUiDialog: DialogParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    // Base UI owns the real open state; mirror it so skin parts (DialogCancel)
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
        <BaseDialog.Root open={isOpen} onOpenChange={(next: boolean) => setOpen(next)}>
          {children}
        </BaseDialog.Root>
      </DialogStateContext.Provider>
    );
  },
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <BaseDialog.Trigger render={children as React.ReactElement} {...rest} />
      : <BaseDialog.Trigger {...rest}>{children}</BaseDialog.Trigger>,
  Content: ({ className, children, lead, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        <BaseDialog.Portal container={container}>
          <BaseDialog.Backdrop />
          <BaseDialog.Popup className={className} data-vf-state="open" {...rest}>
            {lead}
            {children}
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      )}
    </ScopedPortal>
  ),
  Close: ({ asChild, children, ...rest }) =>
    asChild
      ? <BaseDialog.Close render={children as React.ReactElement} {...rest} />
      : <BaseDialog.Close {...rest}>{children}</BaseDialog.Close>,
  useDialog: () => {
    const ctx = React.useContext(DialogStateContext);
    if (!ctx) throw new Error("Dialog parts must be used within <Dialog>");
    return ctx;
  },
};

// ---------------------------------------------------------------------------
// Menu (parts archetype — Base UI's Menu owns open state)
// ---------------------------------------------------------------------------
const MenuStateContext = React.createContext<ModalState | null>(null);

export const baseUiMenu: MenuParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    // Base UI's Menu owns the real open state; mirror it into a ModalState so a
    // skin Item can `ctx?.setOpen(false)` to close through the same contract.
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
        <BaseMenu.Root
          open={isOpen}
          defaultOpen={defaultOpen}
          // (1) drop the 2nd `eventDetails` arg.
          onOpenChange={(next: boolean) => setOpen(next)}
        >
          {children}
        </BaseMenu.Root>
      </MenuStateContext.Provider>
    );
  },
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <BaseMenu.Trigger render={children as React.ReactElement} {...rest} />
      : <BaseMenu.Trigger {...rest}>{children}</BaseMenu.Trigger>,
  Content: ({ align = "start", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (3) portal into the token scope.
        <BaseMenu.Portal container={container}>
          {/* (2) positioning on Positioner, classes + normalized state on Popup. */}
          <BaseMenu.Positioner align={align} sideOffset={4}>
            <BaseMenu.Popup
              className={className}
              data-vf-state="open"
              {...rest}
            >
              {children}
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      )}
    </ScopedPortal>
  ),
  // Tolerant: returns the mirrored ModalState from Root so a skin Item can
  // `ctx?.setOpen(false)`, or null when used outside a menu — never throws.
  useMenu: () => React.useContext(MenuStateContext),
};

// ---------------------------------------------------------------------------
// Tooltip (parts archetype)
// ---------------------------------------------------------------------------
export const baseUiTooltip: TooltipParts = {
  // Base UI groups delay via its Provider; map our `delayDuration` → `delay`.
  Provider: ({ children, delayDuration }) => (
    <BaseTooltip.Provider delay={delayDuration}>{children}</BaseTooltip.Provider>
  ),
  Root: ({ children }) => <BaseTooltip.Root>{children}</BaseTooltip.Root>,
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <BaseTooltip.Trigger render={children as React.ReactElement} {...rest} />
      : <BaseTooltip.Trigger {...rest}>{children}</BaseTooltip.Trigger>,
  Content: ({ side = "top", sideOffset = 4, className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (3) portal into the token scope.
        <BaseTooltip.Portal container={container}>
          {/* (2) positioning on Positioner, classes + normalized state on Popup. */}
          <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
            <BaseTooltip.Popup
              className={className}
              data-vf-state="open"
              {...rest}
            >
              {children}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      )}
    </ScopedPortal>
  ),
};

/**
 * Partial adapter map — adopt Base UI for popover + dialog + menu + tooltip,
 * keep select / combobox / toast zero-dependency (builtin). Extend as you
 * vendor more parts.
 */
export const baseUiAdapter: Partial<UIAdapter> & { name: string } = {
  name: "base-ui",
  popover: baseUiPopover,
  dialog: baseUiDialog,
  menu: baseUiMenu,
  tooltip: baseUiTooltip,
};
