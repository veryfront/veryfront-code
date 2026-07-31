/**
 * Ariakit adapter for veryfront/ui — REFERENCE TEMPLATE.
 *
 * `npx veryfront generate adapter ariakit` copies this file into YOUR repo
 * (e.g. `./ui-adapters/ariakit.tsx`). You own it from then on. `@ariakit/react`
 * is YOUR dependency, bumped on YOUR schedule; `veryfront/ui` core depends on no
 * engine (enforced by a CI guard). Wire it up once:
 *
 * ```tsx
 * import { UIAdapterProvider } from "veryfront/ui";
 * import { ariakitAdapter } from "./ui-adapters/ariakit.tsx";
 *
 * <UIAdapterProvider adapter={ariakitAdapter}>{app}</UIAdapterProvider>;
 * ```
 *
 * The provider merges a PARTIAL map over the builtin, so you can adopt Ariakit
 * for just some parts and leave the rest zero-dependency. This template covers
 * `popover` / `dialog` / `menu` / `tooltip`; `select` / `combobox` / `toast`
 * stay builtin.
 *
 * Ariakit is STORE-based: each primitive is `useXStore(...)` → an imperative
 * store shared via `<XProvider store={store}>`, with role components (`Popover`,
 * `PopoverDisclosure`, …) reading it from context. We BRIDGE that store model
 * onto veryfront's render-slot contract:
 *   1. `Root` builds the store from `DisclosureProps` — Ariakit's store option is
 *      `setOpen: (open: boolean) => void`, which already matches our single-arg
 *      `onOpenChange` (no `eventDetails` to drop), plus `open` / `defaultOpen`.
 *   2. Positioning splits from the surface: Ariakit folds `side` + `align` into
 *      one `placement` and takes the offset as `gutter`; our classes +
 *      `data-vf-state` land on the role component (`Popover` / `Menu` / …).
 *   3. Ariakit surfaces portal by default — we point `portalElement` at the
 *      `[data-vf-ui]` token scope (via `useTokenScope`) so every `var(--…)`
 *      resolves. `asChild` maps to Ariakit's polymorphic `render={children}`.
 *
 * @module ui-adapters/ariakit
 */
import * as React from "react";
import * as Ariakit from "@ariakit/react";
import { useTokenScope } from "veryfront/ui";
import type {
  DialogParts,
  MenuParts,
  ModalState,
  PopoverParts,
  TooltipParts,
  UIAdapter,
} from "veryfront/ui";

/** Resolve the veryfront token-scope element to portal a floating surface into. */
function useScopedContainer(): {
  ref: React.Ref<HTMLElement>;
  container: HTMLElement | null;
} {
  const { ref, getContainer } = useTokenScope();
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => setContainer(getContainer()), [getContainer]);
  return { ref, container };
}

/** Render a portalled surface inside the veryfront token scope. */
function ScopedPortal(
  { children }: { children: (container: HTMLElement) => React.ReactNode },
): React.ReactElement {
  const { ref, container } = useScopedContainer();
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
export const ariakitPopover: PopoverParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    // Ariakit's `setOpen` store option IS our single-arg `onOpenChange`.
    const store = Ariakit.usePopoverStore({
      open,
      defaultOpen,
      setOpen: onOpenChange,
    });
    return <Ariakit.PopoverProvider store={store}>{children}</Ariakit.PopoverProvider>;
  },
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <Ariakit.PopoverDisclosure render={children as React.ReactElement} {...rest} />
      : <Ariakit.PopoverDisclosure {...rest}>{children}</Ariakit.PopoverDisclosure>,
  Content: ({ align = "end", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // Ariakit's `Popover` portals by default; pin it to the token scope.
        <Ariakit.Popover
          portal
          portalElement={container}
          // Ariakit folds side + align into one `placement`; `gutter` is the
          // offset. `placement` is often a store option in older releases —
          // verify vs your @ariakit/react version (else pass it to usePopoverStore).
          placement={align === "start" ? "bottom-start" : "bottom-end"}
          gutter={4}
          className={className}
          data-vf-state="open"
          {...rest}
        >
          {children}
        </Ariakit.Popover>
      )}
    </ScopedPortal>
  ),
};

// ---------------------------------------------------------------------------
// Dialog (modal archetype)
// ---------------------------------------------------------------------------
const DialogStoreContext = React.createContext<Ariakit.DialogStore | null>(null);

export const ariakitDialog: DialogParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    const store = Ariakit.useDialogStore({
      open,
      defaultOpen,
      setOpen: onOpenChange,
    });
    // Share the store so `Close` can `store.hide()` and `useDialog()` can bridge
    // Ariakit's open-state into the contract's ModalState (see below).
    return (
      <DialogStoreContext.Provider value={store}>
        <Ariakit.DialogProvider store={store}>{children}</Ariakit.DialogProvider>
      </DialogStoreContext.Provider>
    );
  },
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <Ariakit.DialogDisclosure render={children as React.ReactElement} {...rest} />
      : <Ariakit.DialogDisclosure {...rest}>{children}</Ariakit.DialogDisclosure>,
  Content: ({ className, children, lead, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // Ariakit's `Dialog` portals + renders its own backdrop; pin it to scope.
        <Ariakit.Dialog
          portalElement={container}
          backdrop
          className={className}
          data-vf-state="open"
          {...rest}
        >
          {lead}
          {children}
        </Ariakit.Dialog>
      )}
    </ScopedPortal>
  ),
  Close: ({ asChild, children, ...rest }) => {
    const store = React.useContext(DialogStoreContext);
    const close = () => store?.hide();
    return asChild
      ? (
        <Ariakit.Role.button
          render={children as React.ReactElement}
          onClick={close}
          {...rest}
        />
      )
      : (
        <button type="button" onClick={close} {...rest}>
          {children}
        </button>
      );
  },
  // Bridge Ariakit's store open-state into the contract's ModalState so skin
  // parts (e.g. DialogCancel) read it through one shape; throws outside <Dialog>.
  useDialog: (): ModalState => {
    const store = React.useContext(DialogStoreContext);
    if (!store) throw new Error("Dialog parts must be used within <Dialog>");
    const open = store.useState("open");
    return { open, setOpen: (next: boolean) => store.setOpen(next) };
  },
};

// ---------------------------------------------------------------------------
// Menu (parts archetype — Ariakit's Menu store owns open state)
// ---------------------------------------------------------------------------
const MenuStateContext = React.createContext<ModalState | null>(null);

export const ariakitMenu: MenuParts = {
  Root: ({ open, defaultOpen, onOpenChange, children }) => {
    const store = Ariakit.useMenuStore({
      open,
      defaultOpen,
      setOpen: onOpenChange,
    });
    return <Ariakit.MenuProvider store={store}>{children}</Ariakit.MenuProvider>;
  },
  // Ariakit's `MenuButton` is the disclosure for the menu.
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <Ariakit.MenuButton render={children as React.ReactElement} {...rest} />
      : <Ariakit.MenuButton {...rest}>{children}</Ariakit.MenuButton>,
  Content: ({ align = "start", className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        <Ariakit.Menu
          portal
          portalElement={container}
          // side + align folded into one `placement`; verify vs your
          // @ariakit/react version (may belong on useMenuStore in older releases).
          placement={align === "start" ? "bottom-start" : "bottom-end"}
          gutter={4}
          className={className}
          data-vf-state="open"
          {...rest}
        >
          {children}
        </Ariakit.Menu>
      )}
    </ScopedPortal>
  ),
  // Tolerant: Ariakit's Menu store owns open state, so there's no separate
  // context to mirror; a skin Item calls `ctx?.setOpen(false)`. Returns null
  // outside a menu — never throws.
  useMenu: () => React.useContext(MenuStateContext),
};

// ---------------------------------------------------------------------------
// Tooltip (parts archetype)
// ---------------------------------------------------------------------------
// Ariakit has no cross-tooltip delay group (its timing lives on each tooltip's
// store), so `Provider` just threads `delayDuration` down for `Root` to apply.
const TooltipDelayContext = React.createContext<number | undefined>(undefined);

export const ariakitTooltip: TooltipParts = {
  Provider: ({ children, delayDuration }) => (
    <TooltipDelayContext.Provider value={delayDuration}>
      {children}
    </TooltipDelayContext.Provider>
  ),
  Root: ({ children }) => {
    const delay = React.useContext(TooltipDelayContext);
    // Map our `delayDuration` → Ariakit store `timeout` / `showTimeout`.
    const store = Ariakit.useTooltipStore({
      timeout: delay,
      showTimeout: delay,
    });
    return <Ariakit.TooltipProvider store={store}>{children}</Ariakit.TooltipProvider>;
  },
  // Ariakit's `TooltipAnchor` is the hover/focus target.
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <Ariakit.TooltipAnchor render={children as React.ReactElement} {...rest} />
      : <Ariakit.TooltipAnchor {...rest}>{children}</Ariakit.TooltipAnchor>,
  Content: ({ side = "top", sideOffset = 4, className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        <Ariakit.Tooltip
          portal
          portalElement={container}
          // `side` maps straight to Ariakit `placement`; `gutter` is the offset.
          // verify vs your @ariakit/react version (placement may belong on the
          // store, and the offset prop name can differ across releases).
          placement={side}
          gutter={sideOffset}
          className={className}
          data-vf-state="open"
          {...rest}
        >
          {children}
        </Ariakit.Tooltip>
      )}
    </ScopedPortal>
  ),
};

/**
 * Partial adapter map — adopt Ariakit for popover + dialog + menu + tooltip,
 * keep select / combobox / toast zero-dependency (builtin). Extend as you
 * vendor more parts.
 */
export const ariakitAdapter: Partial<UIAdapter> & { name: string } = {
  name: "ariakit",
  popover: ariakitPopover,
  dialog: ariakitDialog,
  menu: ariakitMenu,
  tooltip: ariakitTooltip,
};
