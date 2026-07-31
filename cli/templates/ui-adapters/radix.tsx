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
 * Radix for seven slots — the four floating overlays (popover / dialog / menu /
 * tooltip) plus select, toast, and the inline disclosure. Coverage: 7/8
 * (popover / dialog / menu / tooltip / select / toast / disclosure; combobox
 * stays builtin — Radix has NO combobox primitive, so there is nothing to map
 * it onto). Extend the map as you vendor more parts.
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
 *   5. Select: `SelectParts` exposes ONLY `Root` / `Content` / `useSelect` — no
 *      Trigger slot — because the SKIN renders the visible `role="combobox"`
 *      trigger and the `role="option"` items itself and drives them through
 *      `useSelect()`. So we use `Select.Root` as the CONTROLLED value+open state
 *      owner, bridge that state into a context (like Dialog/Menu do with
 *      `ModalState`), and let `Content` render Radix's `Portal` / `Content` /
 *      `Viewport` as the floating listbox. Selection flows skin → `setValue`
 *      (not through Radix's own `Select.Item`, which the skin supersedes).
 *   6. Toast: Radix Toast is RENDER-BASED (no imperative `toast()` — you mount
 *      one `<Toast.Root>` per notification), but the contract's `useToast()`
 *      returns an imperative `{ toast, dismiss }`. So the `Provider` holds a tiny
 *      queue (like the builtin), mounts `<Toast.Provider>` + `<Toast.Viewport>`,
 *      renders one `<Toast.Root>` per queued item, and exposes `{ toast, dismiss }`
 *      via context. Auto-dismiss rides Radix's per-root `duration` →
 *      `onOpenChange(false)` → `dismiss(id)`. The Viewport renders IN PLACE (Radix
 *      does not portal it to `document.body`), so it stays inside the token scope
 *      without a `ScopedPortal` — unlike the overlays above.
 *
 * Combobox is intentionally LEFT ON THE BUILTIN: Radix ships no combobox
 * primitive to invert onto `ComboboxParts` (query + substring filter + option
 * registry + `aria-activedescendant`), so there is nothing to adapt — the
 * zero-dependency builtin combobox remains in force via the partial-map merge.
 *
 * @module ui-adapters/radix
 */
import * as React from "react";
// verify these entry points vs your installed @radix-ui/react-* versions.
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Select from "@radix-ui/react-select";
import * as Toast from "@radix-ui/react-toast";
import * as Collapsible from "@radix-ui/react-collapsible";
import { cx, useTokenScope } from "veryfront/ui";
import type {
  DialogParts,
  DisclosureParts,
  MenuParts,
  ModalState,
  PopoverParts,
  SelectParts,
  SelectState,
  ToastFn,
  ToastOptions,
  ToastParts,
  ToastState,
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
    <Popover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
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
    const state = React.useMemo<ModalState>(() => ({ open: isOpen, setOpen }), [
      isOpen,
      setOpen,
    ]);
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
    const state = React.useMemo<ModalState>(() => ({ open: isOpen, setOpen }), [
      isOpen,
      setOpen,
    ]);
    return (
      <MenuStateContext.Provider value={state}>
        <DropdownMenu.Root open={isOpen} onOpenChange={setOpen}>
          {children}
        </DropdownMenu.Root>
      </MenuStateContext.Provider>
    );
  },
  Trigger: ({ asChild, children, ...rest }) => (
    <DropdownMenu.Trigger asChild={asChild} {...rest}>
      {children}
    </DropdownMenu.Trigger>
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
    <Tooltip.Provider delayDuration={delayDuration}>
      {children}
    </Tooltip.Provider>
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

// ---------------------------------------------------------------------------
// Disclosure (collapsible archetype — inline open/close, NO portal)
// ---------------------------------------------------------------------------
export const radixDisclosure: DisclosureParts = {
  // Radix Collapsible already wires Trigger/Content to Root through its OWN
  // internal context, and `onOpenChange` is single-arg — so Root just forwards
  // the disclosure props + wrapper `div` attributes; no state bridge is needed
  // (unlike Dialog/Menu, whose skin parts read a `useDialog()`/`useMenu()` hook).
  // Inline region, so no `ScopedPortal` — the content renders in the token scope
  // in place.
  Root: (
    { open, defaultOpen, onOpenChange, disabled, children, ...rest },
  ) => (
    <Collapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      {...rest}
    >
      {children}
    </Collapsible.Root>
  ),
  // (4) `asChild` is native Radix — merges toggle behaviour + `aria-expanded`
  // onto the single child element.
  Trigger: ({ asChild, children, ...rest }) => (
    <Collapsible.Trigger asChild={asChild} {...rest}>
      {children}
    </Collapsible.Trigger>
  ),
  // Radix unmounts Content when closed (present only while open) — no forceMount.
  Content: ({ className, children, ...rest }) => (
    <Collapsible.Content className={className} data-vf-state="open" {...rest}>
      {children}
    </Collapsible.Content>
  ),
};

// ---------------------------------------------------------------------------
// Select (dual-state listbox: value + open + a skin-supplied labels map)
// ---------------------------------------------------------------------------
const SelectStateContext = React.createContext<SelectState | null>(null);

export const radixSelect: SelectParts = {
  // Radix `Select.Root` owns the controlled value + open state; we mirror it into
  // a context so the skin's Trigger/Value/Item read `useSelect()`. The skin owns
  // item rendering (plain `role="option"` divs) and collected the `labels` map,
  // so this Root only needs the value/open machine + Radix as the state carrier.
  Root: (
    {
      children,
      value,
      defaultValue,
      onValueChange,
      open,
      defaultOpen,
      onOpenChange,
      labels,
    },
  ) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue);
    const [internalOpen, setInternalOpen] = React.useState(
      defaultOpen ?? false,
    );
    const isValueControlled = value !== undefined;
    const isOpenControlled = open !== undefined;
    const currentValue = isValueControlled ? value : internalValue;
    const isOpen = isOpenControlled ? open : internalOpen;

    const setValue = React.useCallback((next: string) => {
      if (!isValueControlled) setInternalValue(next);
      onValueChange?.(next);
    }, [isValueControlled, onValueChange]);

    const setOpen = React.useCallback((next: boolean) => {
      if (!isOpenControlled) setInternalOpen(next);
      onOpenChange?.(next);
    }, [isOpenControlled, onOpenChange]);

    const state = React.useMemo<SelectState>(
      () => ({ value: currentValue, setValue, open: isOpen, setOpen, labels }),
      [currentValue, setValue, isOpen, setOpen, labels],
    );

    return (
      <SelectStateContext.Provider value={state}>
        {/* Radix reflects OUR state; selection is driven by the skin via setValue. */}
        <Select.Root
          value={currentValue}
          onValueChange={setValue}
          open={isOpen}
          onOpenChange={setOpen}
        >
          {children}
        </Select.Root>
      </SelectStateContext.Provider>
    );
  },
  Content: ({ className, children, ...rest }) => (
    <ScopedPortal>
      {(container) => (
        // (3) portal into the token scope; one popper Content carries classes + state.
        <Select.Portal container={container}>
          <Select.Content
            position="popper"
            sideOffset={4}
            className={className}
            data-vf-state="open"
            {...rest}
          >
            <Select.Viewport>{children}</Select.Viewport>
          </Select.Content>
        </Select.Portal>
      )}
    </ScopedPortal>
  ),
  useSelect: () => {
    const ctx = React.useContext(SelectStateContext);
    if (!ctx) throw new Error("Select parts must be used within <Select>");
    return ctx;
  },
};

// ---------------------------------------------------------------------------
// Toast (imperative queue over Radix's render-based Toast)
// ---------------------------------------------------------------------------
const ToastStateContext = React.createContext<ToastState | null>(null);

/** One queued notification — structured `ToastOptions`, or a `toast.custom` node. */
interface RadixToastRecord extends ToastOptions {
  /** Stable id used as the React key and dismiss handle. */
  id: string;
  /** When set (via `toast.custom`), renders this node instead of the built-in surface. */
  render?: (id: string) => React.ReactNode;
}

export const radixToast: ToastParts = {
  // Radix Toast is render-based (no imperative add), so hold a queue like the
  // builtin, mount <Toast.Provider> + <Toast.Viewport>, and render one
  // <Toast.Root> per queued item. Expose the imperative { toast, dismiss }.
  Provider: ({ children, duration = 5000 }) => {
    const [toasts, setToasts] = React.useState<RadixToastRecord[]>([]);
    const idRef = React.useRef(0);

    const dismiss = React.useCallback((id: string) => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, []);

    const enqueue = React.useCallback(
      (record: Omit<RadixToastRecord, "id">) => {
        const id = `toast-${idRef.current++}`;
        setToasts((list) => [...list, { duration, ...record, id }]);
        return id;
      },
      [duration],
    );

    const toast = React.useMemo<ToastFn>(() => {
      const fn = ((options: ToastOptions) => enqueue(options)) as ToastFn;
      fn.custom = (render: (id: string) => React.ReactNode) =>
        enqueue({ render });
      return fn;
    }, [enqueue]);

    const value = React.useMemo<ToastState>(() => ({ toast, dismiss }), [
      toast,
      dismiss,
    ]);

    return (
      <ToastStateContext.Provider value={value}>
        <Toast.Provider duration={duration}>
          {children}
          {toasts.map((t) => (
            <RadixToastItem
              key={t.id}
              record={t}
              onDismiss={() => dismiss(t.id)}
            />
          ))}
          {
            /* Radix renders the Viewport in place (no body portal), so it stays in
              the token scope without a ScopedPortal — unlike the overlays. */
          }
          <Toast.Viewport className="pointer-events-none fixed bottom-0 right-0 z-[100] m-0 flex w-full max-w-full list-none flex-col-reverse gap-2 p-4 outline-none sm:max-w-sm" />
        </Toast.Provider>
      </ToastStateContext.Provider>
    );
  },
  useToast: () => {
    const ctx = React.useContext(ToastStateContext);
    if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
    return ctx;
  },
};

/** Renders one queued toast as a Radix `Toast.Root` — a custom node, or the surface. */
function RadixToastItem(
  { record, onDismiss }: { record: RadixToastRecord; onDismiss: () => void },
): React.ReactElement {
  // Radix auto-dismisses after `duration`, then fires onOpenChange(false).
  const onOpenChange = (open: boolean) => {
    if (!open) onDismiss();
  };
  if (record.render) {
    return (
      <Toast.Root
        duration={record.duration}
        onOpenChange={onOpenChange}
        asChild
      >
        {record.render(record.id)}
      </Toast.Root>
    );
  }
  const { icon, title, description, action, cancel, variant, duration } =
    record;
  return (
    <Toast.Root
      duration={duration}
      onOpenChange={onOpenChange}
      data-variant={variant ?? "default"}
      data-vf-state="open"
      className={cx(
        "pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border border-[var(--edge)] bg-[var(--popover)] p-4 pr-8 text-sm text-[var(--foreground)] shadow-lg",
        variant === "success" && "border-l-4 border-l-[var(--status-success)]",
        variant === "destructive" &&
          "border-l-4 border-l-[var(--status-error)]",
      )}
    >
      {icon
        ? (
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[var(--foreground)] [&_svg]:size-5"
          >
            {icon}
          </span>
        )
        : null}
      <div className="flex-1 space-y-1">
        {title
          ? (
            <Toast.Title className="text-sm font-medium text-[var(--foreground)]">
              {title}
            </Toast.Title>
          )
          : null}
        {description
          ? (
            <Toast.Description className="text-sm text-[var(--muted-foreground)]">
              {description}
            </Toast.Description>
          )
          : null}
        {action || cancel
          ? (
            <div className="mt-2 flex gap-2">
              {cancel
                ? (
                  // `Toast.Close` dismisses; run the caller's onClick first.
                  <Toast.Close asChild>
                    <button
                      type="button"
                      onClick={() => cancel.onClick?.()}
                      className="rounded-md px-2 py-1 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                    >
                      {cancel.label}
                    </button>
                  </Toast.Close>
                )
                : null}
              {action
                ? (
                  // `Toast.Action` needs `altText` for the screen-reader summary.
                  <Toast.Action
                    altText={typeof action.label === "string"
                      ? action.label
                      : "Action"}
                    asChild
                  >
                    <button
                      type="button"
                      onClick={() => action.onClick()}
                      className="rounded-md bg-[var(--primary)] px-2 py-1 text-sm font-medium text-[var(--secondary)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                    >
                      {action.label}
                    </button>
                  </Toast.Action>
                )
                : null}
            </div>
          )
          : null}
      </div>
      <Toast.Close
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
      >
        <svg
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </Toast.Close>
    </Toast.Root>
  );
}

/**
 * Partial adapter map — adopt Radix for seven slots (four floating overlays +
 * select + toast + the inline disclosure). Combobox is deliberately ABSENT:
 * Radix has no combobox primitive, so that key falls through to the
 * zero-dependency builtin via the partial-map merge. Extend as you vendor more
 * parts.
 */
export const radixAdapter: Partial<UIAdapter> & { name: string } = {
  name: "radix",
  popover: radixPopover,
  dialog: radixDialog,
  menu: radixMenu,
  tooltip: radixTooltip,
  select: radixSelect,
  toast: radixToast,
  disclosure: radixDisclosure,
  // combobox: intentionally omitted — Radix ships no combobox primitive; the
  // builtin combobox stays in force through the partial-map merge.
};
