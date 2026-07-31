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
 * for just some parts and leave the rest zero-dependency. This template maps ALL
 * 8/8 parts: `popover` / `dialog` / `menu` / `tooltip` / `select` / `combobox` /
 * `toast` / `disclosure`. Seven wrap real Base UI primitives; `combobox` is a contract-faithful,
 * React-only hand-roll — Base UI's `Autocomplete` is data-driven (owns its own
 * `items` + filtering) and does NOT invert onto our `register`/`matches`/
 * `activeId` option registry, so that one slot owns query + filter + active-
 * descendant itself (mirroring the builtin). Drop any key to fall back to builtin.
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
import { createPortal } from "react-dom";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Toast as BaseToast } from "@base-ui/react/toast";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { useTokenScope } from "veryfront/ui";
import type {
  ComboboxParts,
  ComboboxState,
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

/** Tiny className joiner (drops falsey parts) — no `cva`/`clsx` dependency. */
const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

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

// ---------------------------------------------------------------------------
// Select (dual state — value + open — with the skin's `labels` map)
// ---------------------------------------------------------------------------
/** Context payload: the public `SelectState` plus the anchor the Positioner uses. */
interface SelectStateInternal extends SelectState {
  anchorRef: React.RefObject<HTMLSpanElement | null>;
}
const SelectStateContext = React.createContext<SelectStateInternal | null>(null);
function useSelectState(): SelectStateInternal {
  const ctx = React.useContext(SelectStateContext);
  if (!ctx) throw new Error("Select parts must be used within <Select>");
  return ctx;
}

export const baseUiSelect: SelectParts = {
  Root: (
    { children, value, defaultValue, onValueChange, open, defaultOpen, onOpenChange, labels },
  ) => {
    // Base UI's Select owns value+open, but our contract's Select has NO Trigger
    // slot — the SKIN renders its own trigger/items (plain elements reading
    // `useSelect()`). So we mirror value+open into a context the skin reads, and
    // anchor the Positioner to the wrapper span below instead of a Base UI
    // Select.Trigger (which never exists here). Base UI's own item typeahead /
    // roving focus don't engage — the skin drives selection through `setValue`.
    const [internalValue, setInternalValue] = React.useState<string | undefined>(defaultValue);
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
    const anchorRef = React.useRef<HTMLSpanElement | null>(null);
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
    const state = React.useMemo<SelectStateInternal>(() => ({
      value: currentValue,
      setValue,
      open: isOpen,
      setOpen,
      labels,
      anchorRef,
    }), [currentValue, setValue, isOpen, setOpen, labels]);
    return (
      <SelectStateContext.Provider value={state}>
        <BaseSelect.Root
          value={currentValue ?? null}
          // (1) drop Base UI's 2nd `eventDetails` arg on both callbacks.
          onValueChange={(next: string) => setValue(next)}
          open={isOpen}
          onOpenChange={(next: boolean) => setOpen(next)}
        >
          {
            /* The Positioner anchors to this span (the skin's trigger isn't a
              Base UI Select.Trigger). Content portals away, so the span's box
              tracks the trigger. */
          }
          <span ref={anchorRef} className="relative inline-block w-full">
            {children}
          </span>
        </BaseSelect.Root>
      </SelectStateContext.Provider>
    );
  },
  Content: ({ className, children, ...rest }) => {
    const ctx = useSelectState();
    return (
      <ScopedPortal>
        {(container) => (
          // (3) portal into the token scope.
          <BaseSelect.Portal container={container}>
            {
              /* (2) positioning on Positioner (anchored to the Root span);
                classes + normalized state on Popup. */
            }
            <BaseSelect.Positioner
              anchor={ctx.anchorRef}
              align="start"
              sideOffset={4}
              alignItemWithTrigger={false}
            >
              <BaseSelect.Popup className={className} data-vf-state="open" {...rest}>
                <BaseSelect.List>{children}</BaseSelect.List>
              </BaseSelect.Popup>
            </BaseSelect.Positioner>
          </BaseSelect.Portal>
        )}
      </ScopedPortal>
    );
  },
  // Returns the richer internal state (skin ignores `anchorRef`); throws outside.
  useSelect: () => useSelectState(),
};

// ---------------------------------------------------------------------------
// Combobox (RICH slot — contract-faithful HAND-ROLLED state machine)
// ---------------------------------------------------------------------------
// Base UI's `Autocomplete` is data-driven: it owns its own `items` array and
// filters them internally, exposing matches through its own render slots. Our
// `ComboboxState` contract INVERTS that — the skin's items self-register via
// `registerOption(id,value,text)` and read `matches(text)`/`activeId`, so the
// ADAPTER must own query + substring filter + active-descendant over the
// *filtered* set. Base UI's Autocomplete cannot cleanly expose that registry
// model, so (per the engine-slots addendum) this slot is a React-only hand-roll
// mirroring the builtin — still a valid, swappable engine slot. Only the
// floating surface differs: with no `Floating` export available to a consumer
// template, the listbox portals into the token scope and positions itself under
// the input (fixed, collision-naive) with outside-click / repositioning wired.
interface ComboboxOption {
  id: string;
  value: string;
  text: string;
}
interface ComboboxStateInternal extends ComboboxState {
  anchorRef: React.RefObject<HTMLInputElement | null>;
}
const ComboboxStateContext = React.createContext<ComboboxStateInternal | null>(null);
function useComboboxState(): ComboboxStateInternal {
  const ctx = React.useContext(ComboboxStateContext);
  if (!ctx) throw new Error("Combobox parts must be used within <Combobox>");
  return ctx;
}

function ComboboxRoot({
  children,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  defaultInputValue,
  onInputValueChange,
}: {
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultInputValue?: string;
  onInputValueChange?: (value: string) => void;
}): React.ReactElement {
  const listboxId = React.useId();
  const anchorRef = React.useRef<HTMLInputElement | null>(null);
  const optionsRef = React.useRef<ComboboxOption[]>([]);

  const [query, setQueryState] = React.useState(defaultInputValue ?? "");
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const [activeId, setActiveId] = React.useState<string | undefined>(undefined);

  const isValueControlled = value !== undefined;
  const isOpenControlled = open !== undefined;
  const currentValue = isValueControlled ? value : internalValue;
  const isOpen = isOpenControlled ? open : internalOpen;

  const matches = React.useCallback(
    (text: string) => !query || text.toLowerCase().includes(query.toLowerCase()),
    [query],
  );

  const setOpen = React.useCallback((next: boolean) => {
    if (!isOpenControlled) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) setActiveId(undefined);
  }, [isOpenControlled, onOpenChange]);

  const setQuery = React.useCallback((next: string) => {
    setQueryState(next);
    onInputValueChange?.(next);
    setActiveId(undefined);
    if (!isOpenControlled) setInternalOpen(true);
    onOpenChange?.(true);
  }, [isOpenControlled, onOpenChange, onInputValueChange]);

  const select = React.useCallback((nextValue: string, text: string) => {
    if (!isValueControlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    setQueryState(text);
    onInputValueChange?.(text);
    setActiveId(undefined);
    if (!isOpenControlled) setInternalOpen(false);
    onOpenChange?.(false);
  }, [isValueControlled, onValueChange, isOpenControlled, onOpenChange, onInputValueChange]);

  const registerOption = React.useCallback((id: string, optValue: string, text: string) => {
    const existing = optionsRef.current.find((o) => o.id === id);
    if (existing) {
      existing.value = optValue;
      existing.text = text;
    } else {
      optionsRef.current.push({ id, value: optValue, text });
    }
  }, []);
  const unregisterOption = React.useCallback((id: string) => {
    optionsRef.current = optionsRef.current.filter((o) => o.id !== id);
  }, []);

  const onInputKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    const visible = optionsRef.current.filter((o) => matches(o.text));
    const currentIndex = visible.findIndex((o) => o.id === activeId);
    const move = (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(visible.length - 1, nextIndex));
      setActiveId(visible[clamped]?.id);
    };
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!isOpen) setOpen(true);
        else move(currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!isOpen) setOpen(true);
        else move(currentIndex <= 0 ? 0 : currentIndex - 1);
        break;
      case "Home":
        if (isOpen && visible.length) {
          event.preventDefault();
          move(0);
        }
        break;
      case "End":
        if (isOpen && visible.length) {
          event.preventDefault();
          move(visible.length - 1);
        }
        break;
      case "Enter": {
        const active = visible.find((o) => o.id === activeId);
        if (isOpen && active) {
          event.preventDefault();
          select(active.value, active.text);
        }
        break;
      }
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          setOpen(false);
        }
        break;
    }
  }, [matches, activeId, isOpen, setOpen, select]);

  const ctx = React.useMemo<ComboboxStateInternal>(() => ({
    query,
    setQuery,
    open: isOpen,
    setOpen,
    value: currentValue,
    select,
    activeId,
    matches,
    listboxId,
    registerOption,
    unregisterOption,
    onInputKeyDown,
    anchorRef,
  }), [
    query,
    setQuery,
    isOpen,
    setOpen,
    currentValue,
    select,
    activeId,
    matches,
    listboxId,
    registerOption,
    unregisterOption,
    onInputKeyDown,
  ]);

  return <ComboboxStateContext.Provider value={ctx}>{children}</ComboboxStateContext.Provider>;
}

function ComboboxInputPart({
  className,
  onChange,
  onKeyDown,
  onFocus,
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  ref?: React.Ref<HTMLInputElement>;
}): React.ReactElement {
  const ctx = useComboboxState();
  const setRef = React.useCallback((node: HTMLInputElement | null) => {
    ctx.anchorRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref != null) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  }, [ctx.anchorRef, ref]);

  return (
    <input
      ref={setRef}
      role="combobox"
      aria-expanded={ctx.open}
      aria-controls={ctx.listboxId}
      aria-activedescendant={ctx.activeId}
      aria-autocomplete="list"
      autoComplete="off"
      value={ctx.query}
      className={className}
      onChange={(event) => {
        onChange?.(event);
        ctx.setQuery(event.target.value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) ctx.onInputKeyDown(event);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!ctx.open) ctx.setOpen(true);
      }}
      {...props}
    />
  );
}

function ComboboxContentPart({
  className,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }):
  | React.ReactElement
  | null {
  const ctx = useComboboxState();
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = React.useState<{ top: number; left: number; width: number } | null>(null);

  // Track the input box and keep the portalled listbox pinned beneath it.
  React.useLayoutEffect(() => {
    if (!ctx.open) {
      setRect(null);
      return;
    }
    const anchor = ctx.anchorRef.current;
    if (!anchor) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    globalThis.addEventListener("scroll", update, true);
    globalThis.addEventListener("resize", update);
    return () => {
      globalThis.removeEventListener("scroll", update, true);
      globalThis.removeEventListener("resize", update);
    };
  }, [ctx.open, ctx.anchorRef]);

  // Dismiss on outside pointerdown (Escape is handled by `onInputKeyDown`).
  React.useEffect(() => {
    if (!ctx.open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ctx.anchorRef.current?.contains(target)) return;
      if (surfaceRef.current?.contains(target)) return;
      ctx.setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ctx.open, ctx.anchorRef, ctx.setOpen]);

  if (!ctx.open || !rect) return null;

  const setSurfaceRef = (node: HTMLDivElement | null) => {
    surfaceRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref != null) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  return (
    <ScopedPortal>
      {(container) =>
        createPortal(
          <div
            ref={setSurfaceRef}
            role="listbox"
            id={ctx.listboxId}
            data-vf-state="open"
            className={className}
            style={{ position: "fixed", top: rect.top, left: rect.left, minWidth: rect.width }}
            {...props}
          >
            {children}
          </div>,
          container,
        )}
    </ScopedPortal>
  );
}

export const baseUiCombobox: ComboboxParts = {
  Root: ComboboxRoot,
  Input: ComboboxInputPart,
  Content: ComboboxContentPart,
  // Returns the richer internal state (skin ignores `anchorRef`); throws outside.
  useCombobox: () => useComboboxState(),
};

// ---------------------------------------------------------------------------
// Toast (imperative — Base UI's toast manager: `Provider` + `useToastManager`)
// ---------------------------------------------------------------------------
/** Our rich options carried on Base UI's per-toast `data`; `render` = `toast.custom`. */
interface BaseUiToastRecord extends ToastOptions {
  render?: (id: string) => React.ReactNode;
}
const ToastStateContext = React.createContext<ToastState | null>(null);

/** Inside the Base UI provider: maps our imperative `{ toast, dismiss }` onto the manager. */
function BaseUiToastBridge({ children }: { children: React.ReactNode }): React.ReactElement {
  const manager = BaseToast.useToastManager();
  const value = React.useMemo<ToastState>(() => {
    // toast(options) → manager.add; the rich options ride on `data`, rendered by
    // the viewport below. Base UI owns the queue + auto-dismiss (its `timeout`).
    const toast = ((options: ToastOptions) =>
      String(
        manager.add({ timeout: options.duration, data: options as BaseUiToastRecord }),
      )) as ToastFn;
    toast.custom = (render: (id: string) => React.ReactNode) =>
      String(manager.add({ data: { render } as BaseUiToastRecord }));
    const dismiss = (id: string) => manager.close(id);
    return { toast, dismiss };
  }, [manager]);
  return <ToastStateContext.Provider value={value}>{children}</ToastStateContext.Provider>;
}

/** The portalled region (bottom-right) that renders each queued toast, themed with tokens. */
function BaseUiToastViewport(): React.ReactElement {
  const manager = BaseToast.useToastManager();
  return (
    <ScopedPortal>
      {(container) =>
        createPortal(
          <BaseToast.Viewport className="pointer-events-none fixed bottom-0 right-0 z-[100] flex w-full max-w-full flex-col-reverse gap-2 p-4 sm:max-w-sm">
            {manager.toasts.map((toast) => {
              const data = (toast.data ?? {}) as BaseUiToastRecord;
              const close = () => manager.close(toast.id);
              if (data.render) {
                return (
                  <BaseToast.Root key={toast.id} toast={toast} className="pointer-events-auto">
                    {data.render(String(toast.id))}
                  </BaseToast.Root>
                );
              }
              return (
                <BaseToast.Root
                  key={toast.id}
                  toast={toast}
                  data-vf-state="open"
                  className={cx(
                    "pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border border-[var(--edge)] bg-[var(--popover)] p-4 pr-8 text-sm text-[var(--foreground)] shadow-lg",
                    data.variant === "success" && "border-l-4 border-l-[var(--status-success)]",
                    data.variant === "destructive" && "border-l-4 border-l-[var(--status-error)]",
                  )}
                >
                  {data.icon
                    ? (
                      <span
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-[var(--foreground)] [&_svg]:size-5"
                      >
                        {data.icon}
                      </span>
                    )
                    : null}
                  <div className="flex-1 space-y-1">
                    {data.title
                      ? (
                        <BaseToast.Title className="text-sm font-medium text-[var(--foreground)]">
                          {data.title}
                        </BaseToast.Title>
                      )
                      : null}
                    {data.description
                      ? (
                        <BaseToast.Description className="text-sm text-[var(--muted-foreground)]">
                          {data.description}
                        </BaseToast.Description>
                      )
                      : null}
                    {data.action || data.cancel
                      ? (
                        <div className="mt-2 flex gap-2">
                          {data.cancel
                            ? (
                              <button
                                type="button"
                                onClick={() => {
                                  data.cancel?.onClick?.();
                                  close();
                                }}
                                className="rounded-md px-2 py-1 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                              >
                                {data.cancel.label}
                              </button>
                            )
                            : null}
                          {data.action
                            ? (
                              <button
                                type="button"
                                onClick={() => {
                                  data.action?.onClick();
                                  close();
                                }}
                                className="rounded-md bg-[var(--primary)] px-2 py-1 text-sm font-medium text-[var(--secondary)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                              >
                                {data.action.label}
                              </button>
                            )
                            : null}
                        </div>
                      )
                      : null}
                  </div>
                  {/* Base UI's Close closes the toast for us. */}
                  <BaseToast.Close
                    aria-label="Dismiss notification"
                    className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                  >
                    ✕
                  </BaseToast.Close>
                </BaseToast.Root>
              );
            })}
          </BaseToast.Viewport>,
          container,
        )}
    </ScopedPortal>
  );
}

export const baseUiToast: ToastParts = {
  // Base UI's Provider owns the imperative manager; `timeout` = our default duration.
  Provider: ({ children, duration = 5000 }) => (
    <BaseToast.Provider timeout={duration}>
      <BaseUiToastBridge>{children}</BaseUiToastBridge>
      <BaseUiToastViewport />
    </BaseToast.Provider>
  ),
  useToast: () => {
    const ctx = React.useContext(ToastStateContext);
    if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
    return ctx;
  },
};

// ---------------------------------------------------------------------------
// Disclosure (collapsible archetype — the overlay disclosure MINUS the portal)
// ---------------------------------------------------------------------------
// Base UI's Collapsible owns open state and shares it with its own Trigger/Panel
// through its internal context, so — exactly like the Popover parts — our slots
// just wrap the Base UI parts directly; no separate state bridge is needed. The
// only normalization is (1): drop Base UI's 2nd `onOpenChange(open, eventDetails)`
// arg down to our single-arg `(open) => void`. A disclosure is inline (no portal
// / positioning), so there is NO `ScopedPortal` here — `Root` renders the wrapper
// node, `Panel` is the collapsible region mounted only while open.
export const baseUiDisclosure: DisclosureParts = {
  Root: ({ open, defaultOpen, onOpenChange, disabled, children, ...rest }) => (
    <BaseCollapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      disabled={disabled}
      // (1) drop the 2nd `eventDetails` arg.
      onOpenChange={(next: boolean) => onOpenChange?.(next)}
      {...rest}
    >
      {children}
    </BaseCollapsible.Root>
  ),
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? <BaseCollapsible.Trigger render={children as React.ReactElement} {...rest} />
      : <BaseCollapsible.Trigger {...rest}>{children}</BaseCollapsible.Trigger>,
  Content: ({ className, children, ...rest }) => (
    <BaseCollapsible.Panel className={className} data-vf-state="open" {...rest}>
      {children}
    </BaseCollapsible.Panel>
  ),
};

/**
 * Partial adapter map — Base UI covers ALL 8/8 parts: popover + dialog + menu +
 * tooltip + select + combobox + toast + disclosure. `combobox` is a contract-
 * faithful, React-only hand-roll (Base UI's data-driven `Autocomplete` doesn't
 * invert onto our `register`/`matches`/`activeId` registry — see the Combobox
 * section); the rest wrap real Base UI primitives. Drop any key to fall back to
 * the builtin.
 */
export const baseUiAdapter: Partial<UIAdapter> & { name: string } = {
  name: "base-ui",
  popover: baseUiPopover,
  dialog: baseUiDialog,
  menu: baseUiMenu,
  tooltip: baseUiTooltip,
  select: baseUiSelect,
  combobox: baseUiCombobox,
  toast: baseUiToast,
  disclosure: baseUiDisclosure,
};
