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
 * for just some parts and leave the rest zero-dependency. Slot coverage: 9/11 —
 * `popover` / `dialog` / `menu` / `tooltip` / `select` / `combobox` /
 * `disclosure` / `toolbar` / `tabs` map to Ariakit; `toast` and `toggleGroup`
 * STAY builtin because Ariakit ships NO toast primitive (no toast store /
 * region / queue) and no dedicated toggle-group primitive. Don't hand-roll them
 * here —
 * the zero-dependency builtins already satisfy `ToastParts` / `ToggleGroupParts`,
 * so leaving those unset lets the provider fall back to them.
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
 * Two of the added slots need extra reconciliation notes:
 *   - **select**: `useSelectStore` owns value + open faithfully, and we bridge
 *     both into a `SelectState` context so the skin's Trigger/Value/Item read
 *     `useSelect()`. Ariakit's `SelectPopover` normally anchors to Ariakit's own
 *     `<Select>` button, but our skin renders the Trigger itself, so we anchor the
 *     popover to `Root`'s wrapper span via `getAnchorRect` (mirrors the builtin's
 *     `anchorRef` span) instead of an Ariakit disclosure.
 *   - **combobox**: Ariakit's combobox is store-based and drives filtering + the
 *     active-descendant over its OWN `ComboboxItem` registry. The contract instead
 *     makes the ADAPTER own a skin-provided option registry (`registerOption` /
 *     substring `matches` / `activeId` / `onInputKeyDown`). That model does NOT
 *     cleanly invert onto Ariakit's item registry, so — per the engine-adapter
 *     note — the registry + substring filter + active-descendant keyboard machine
 *     is HAND-ROLLED here (React-only, mirroring `builtin/combobox.tsx`), while
 *     the Ariakit combobox store still provides the real engine surface: the
 *     `role="combobox"` input anchor, open state, and the portalled, positioned,
 *     dismiss-managed `ComboboxPopover`. Still a valid, swappable engine slot.
 *
 * @module ui-adapters/ariakit
 */
import * as React from "react";
import * as Ariakit from "@ariakit/react";
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
  TabsParts,
  ToolbarParts,
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

// ---------------------------------------------------------------------------
// Select (dual state — value + open — via Ariakit's select store)
// ---------------------------------------------------------------------------
// The skin renders Trigger/Value/Item and reads them all through `useSelect()`,
// so we bridge Ariakit's store value/open into one `SelectState` context. The
// skin also owns item rendering and hands us the collected `labels` map — the
// adapter just supplies value/open state + the portalled listbox surface.
const SelectStateContext = React.createContext<SelectState | null>(null);

export const ariakitSelect: SelectParts = {
  Root: (
    { children, value, defaultValue, onValueChange, open, defaultOpen, onOpenChange, labels },
  ) => {
    // Ariakit's select store owns value + open; both setters are single-arg,
    // matching our `onValueChange` / `onOpenChange` (no `eventDetails` to drop).
    const store = Ariakit.useSelectStore({
      value,
      defaultValue,
      setValue: (next) => onValueChange?.(next as string),
      open,
      defaultOpen,
      setOpen: onOpenChange,
    });
    const currentValue = store.useState("value") as string | undefined;
    const isOpen = store.useState("open");
    // Skin renders its own Trigger, so anchor the popover to this wrapper span
    // (via `getAnchorRect` below) rather than to an Ariakit `<Select>` button.
    const anchorRef = React.useRef<HTMLSpanElement | null>(null);

    const state = React.useMemo<SelectState & { anchorRef: typeof anchorRef }>(() => ({
      value: currentValue,
      setValue: (next: string) => store.setValue(next),
      open: isOpen,
      setOpen: (next: boolean) => store.setOpen(next),
      labels,
      anchorRef,
    }), [currentValue, isOpen, labels, store]);

    return (
      <span ref={anchorRef} className="relative inline-block w-full">
        <SelectStateContext.Provider value={state}>
          <Ariakit.SelectProvider store={store}>{children}</Ariakit.SelectProvider>
        </SelectStateContext.Provider>
      </span>
    );
  },
  Content: ({ className, children, ...rest }) => {
    const state = React.useContext(SelectStateContext) as
      | (SelectState & { anchorRef: React.RefObject<HTMLSpanElement | null> })
      | null;
    return (
      <ScopedPortal>
        {(container) => (
          <Ariakit.SelectPopover
            portal
            portalElement={container}
            // Anchor to the skin's trigger wrapper, since we don't render
            // Ariakit's own `<Select>` disclosure. `sameWidth` matches the
            // builtin's `matchTriggerWidth`; verify prop names vs your version.
            getAnchorRect={() => state?.anchorRef.current?.getBoundingClientRect() ?? null}
            sameWidth
            gutter={4}
            role="listbox"
            className={className}
            data-vf-state="open"
            {...rest}
          >
            {children}
          </Ariakit.SelectPopover>
        )}
      </ScopedPortal>
    );
  },
  // Bridge Ariakit's store value/open into the contract's SelectState; throws
  // outside <Select> so the skin's Trigger/Value/Item fail loudly if misused.
  useSelect: (): SelectState => {
    const state = React.useContext(SelectStateContext);
    if (!state) throw new Error("Select parts must be used within <Select>");
    return state;
  },
};

// ---------------------------------------------------------------------------
// Combobox (registry + filter HAND-ROLLED; Ariakit store owns the surface)
// ---------------------------------------------------------------------------
// See the module docstring: Ariakit's combobox drives filtering + the active-
// descendant over its OWN `ComboboxItem` registry, which does not invert onto
// the contract's skin-provided `registerOption`/`matches`/`activeId` registry.
// So we hand-roll that state machine (mirroring `builtin/combobox.tsx`) and use
// the Ariakit combobox store ONLY for the real engine surface: the input anchor,
// open state, and the portalled, positioned `ComboboxPopover`. `store.value`
// (Ariakit's input text) IS the contract's `query`; the committed `value` is
// separate (Ariakit conflates them), so we track that by hand.
interface ComboboxOption {
  id: string;
  value: string;
  text: string;
}

const ComboboxStateContext = React.createContext<
  (ComboboxState & { store: Ariakit.ComboboxStore }) | null
>(null);

function useAriakitCombobox(): ComboboxState & { store: Ariakit.ComboboxStore } {
  const ctx = React.useContext(ComboboxStateContext);
  if (!ctx) throw new Error("Combobox parts must be used within <Combobox>");
  return ctx;
}

const AriakitComboboxRoot: ComboboxParts["Root"] = ({
  children,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  defaultInputValue,
  onInputValueChange,
}) => {
  const listboxId = React.useId();
  const optionsRef = React.useRef<ComboboxOption[]>([]);
  const [activeId, setActiveId] = React.useState<string | undefined>(undefined);

  // Ariakit combobox store: its `value` is the INPUT TEXT (our `query`); it also
  // owns open + provides the popover surface + input anchor. Its `setValue`
  // single-arg matches our `onInputValueChange` (text changed).
  const store = Ariakit.useComboboxStore({
    defaultValue: defaultInputValue,
    setValue: (next) => onInputValueChange?.(next as string),
    open,
    defaultOpen,
    setOpen: onOpenChange,
  });
  const query = store.useState("value") as string;
  const isOpen = store.useState("open");

  // Committed selection value is separate from the input text in our contract,
  // but Ariakit conflates them — so track the committed value by hand.
  const isValueControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const currentValue = isValueControlled ? value : internalValue;

  const matches = React.useCallback(
    (text: string) => !query || text.toLowerCase().includes(query.toLowerCase()),
    [query],
  );

  const setOpen = React.useCallback((next: boolean) => {
    store.setOpen(next);
    if (!next) setActiveId(undefined);
  }, [store]);

  const setQuery = React.useCallback((next: string) => {
    store.setValue(next); // fires the store's setValue → onInputValueChange
    setActiveId(undefined);
    store.setOpen(true);
  }, [store]);

  const select = React.useCallback((nextValue: string, text: string) => {
    if (!isValueControlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    store.setValue(text);
    setActiveId(undefined);
    store.setOpen(false);
  }, [isValueControlled, onValueChange, store]);

  const registerOption = React.useCallback((id: string, value: string, text: string) => {
    const existing = optionsRef.current.find((o) => o.id === id);
    if (existing) {
      existing.value = value;
      existing.text = text;
    } else {
      optionsRef.current.push({ id, value, text });
    }
  }, []);
  const unregisterOption = React.useCallback((id: string) => {
    optionsRef.current = optionsRef.current.filter((o) => o.id !== id);
  }, []);

  // Keyboard nav walks the *filtered* option set (active-descendant), exactly
  // like the builtin — Ariakit's own composite nav is inert here (no
  // `ComboboxItem`s registered), so `preventDefault` hands control to us.
  const onInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
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
    },
    [matches, activeId, isOpen, setOpen, select],
  );

  const ctx = React.useMemo(() => ({
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
    store,
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
    store,
  ]);

  return (
    <ComboboxStateContext.Provider value={ctx}>
      <Ariakit.ComboboxProvider store={store}>{children}</Ariakit.ComboboxProvider>
    </ComboboxStateContext.Provider>
  );
};

export const ariakitCombobox: ComboboxParts = {
  Root: AriakitComboboxRoot,
  // Render Ariakit's `Combobox` for the input so the store gets its anchor
  // element (positions the popover) — but our hand-rolled state owns value,
  // active-descendant, and keydown. `role`/`aria-controls`/`aria-activedescendant`
  // are set explicitly; verify Ariakit doesn't re-own `aria-activedescendant`
  // in your version (it stays undefined here since no `ComboboxItem`s register).
  Input: ({ className, onChange, onKeyDown, ref, ...props }) => {
    const ctx = useAriakitCombobox();
    return (
      <Ariakit.Combobox
        ref={ref}
        role="combobox"
        aria-controls={ctx.listboxId}
        aria-activedescendant={ctx.activeId}
        aria-autocomplete="list"
        autoComplete="off"
        className={className}
        onChange={(event) => {
          onChange?.(event);
          // Ariakit's store already captured the text; re-run `setQuery` with it
          // to reset the active-descendant + keep the list open (idempotent on
          // the store's value, so no double text write of consequence).
          ctx.setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented) ctx.onInputKeyDown(event);
        }}
        {...props}
      />
    );
  },
  Content: ({ className, children, ...rest }) => {
    const ctx = useAriakitCombobox();
    return (
      <ScopedPortal>
        {(container) => (
          <Ariakit.ComboboxPopover
            store={ctx.store}
            portal
            portalElement={container}
            sameWidth
            gutter={4}
            role="listbox"
            id={ctx.listboxId}
            className={className}
            data-vf-state="open"
            {...rest}
          >
            {children}
          </Ariakit.ComboboxPopover>
        )}
      </ScopedPortal>
    );
  },
  useCombobox: useAriakitCombobox as () => ComboboxState,
};

// ---------------------------------------------------------------------------
// Disclosure (collapsible archetype — Ariakit's disclosure store owns open state)
// ---------------------------------------------------------------------------
// The Collapsible archetype is the overlay disclosure MINUS the portal: a trigger
// toggles an INLINE region present only while open (no `ScopedPortal` here).
// Ariakit's `useDisclosureStore` owns the open state; `Disclosure` is the toggle
// button and `DisclosureContent` the region. We share the store (+ Root's
// `disabled`) via context so Trigger/Content self-wire — mirroring how the menu
// bridges its store — and so Content can mount only while open, matching the
// contract (and `builtin/disclosure.tsx`).
const DisclosureStoreContext = React.createContext<
  { store: Ariakit.DisclosureStore; disabled?: boolean } | null
>(null);

const AriakitDisclosureRoot: DisclosureParts["Root"] = (
  { open, defaultOpen, onOpenChange, disabled, children, ref, ...rest },
) => {
  // Ariakit's `setOpen` store option IS our single-arg `onOpenChange` (no
  // `eventDetails` to drop), plus `open` / `defaultOpen`.
  const store = Ariakit.useDisclosureStore({
    open,
    defaultOpen,
    setOpen: onOpenChange,
  });
  const isOpen = store.useState("open");
  const ctx = React.useMemo(() => ({ store, disabled }), [store, disabled]);
  return (
    <div ref={ref} data-vf-state={isOpen ? "open" : "closed"} {...rest}>
      <DisclosureStoreContext.Provider value={ctx}>
        <Ariakit.DisclosureProvider store={store}>{children}</Ariakit.DisclosureProvider>
      </DisclosureStoreContext.Provider>
    </div>
  );
};

export const ariakitDisclosure: DisclosureParts = {
  Root: AriakitDisclosureRoot,
  // Ariakit's `Disclosure` is the toggle button — it reads the store from
  // `DisclosureProvider` and sets `aria-expanded` itself. Root's `disabled`
  // rides down through context. `asChild` maps to polymorphic `render={children}`.
  Trigger: ({ asChild, children, ...rest }) => {
    const ctx = React.useContext(DisclosureStoreContext);
    const disabled = rest.disabled ?? ctx?.disabled;
    return asChild
      ? (
        <Ariakit.Disclosure
          render={children as React.ReactElement}
          {...rest}
          disabled={disabled}
        />
      )
      : (
        <Ariakit.Disclosure {...rest} disabled={disabled}>
          {children}
        </Ariakit.Disclosure>
      );
  },
  // Inline (NOT portalled) region. Ariakit's `DisclosureContent` stays
  // mounted+hidden by default, so gate on store open-state to mount only while
  // open — matching the contract and the builtin.
  Content: ({ className, children, ...rest }) => {
    const ctx = React.useContext(DisclosureStoreContext);
    const isOpen = ctx?.store.useState("open") ?? false;
    if (!isOpen) return null;
    return (
      <Ariakit.DisclosureContent className={className} data-vf-state="open" {...rest}>
        {children}
      </Ariakit.DisclosureContent>
    );
  },
};

// ---------------------------------------------------------------------------
// Toolbar (roving-tabindex composite — Ariakit's toolbar store owns the roving)
// ---------------------------------------------------------------------------
// Ariakit's `useToolbarStore` owns the roving-tabindex composite (one shared tab
// stop, arrow-key nav, Home/End) and `Toolbar` renders the `role="toolbar"`
// wrapper; each `ToolbarItem` registers itself as a roving stop with the store
// it reads from context. This maps cleanly onto the contract: Root builds the
// store (mapping `orientation`) + renders `Toolbar`; Item is a `ToolbarItem`
// whose polymorphic `render` handles `asChild`. Inline, NOT portalled — no
// `ScopedPortal`. `className` + the rest of the skin's props ride through
// `...rest`; separators stay pure skin (not routed through `Item`).
export const ariakitToolbar: ToolbarParts = {
  Root: ({ orientation = "horizontal", children, ref, ...rest }) => {
    // `orientation` is a toolbar store option; verify vs your @ariakit/react
    // version (in some releases it's instead a prop on <Toolbar>).
    const store = Ariakit.useToolbarStore({ orientation });
    return (
      <Ariakit.Toolbar ref={ref} store={store} {...rest}>
        {children}
      </Ariakit.Toolbar>
    );
  },
  // `ToolbarItem` registers as a roving stop with the toolbar store from
  // context (the engine's roving governs it). `asChild` maps to Ariakit's
  // polymorphic `render={children}` (used by ToolbarLink → <a>); otherwise it
  // renders a button. No visual classes — those arrive via `...rest`.
  Item: ({ asChild, children, ref, ...rest }) =>
    asChild
      ? <Ariakit.ToolbarItem ref={ref} render={children as React.ReactElement} {...rest} />
      : <Ariakit.ToolbarItem ref={ref} {...rest}>{children}</Ariakit.ToolbarItem>,
};

// ---------------------------------------------------------------------------
// Tabs (single-select tablist — Ariakit's tab store owns the selected value)
// ---------------------------------------------------------------------------
// Panel-less: the consumer renders content keyed by the active value, so we map
// only the tablist + tabs (NO `TabPanel`). Ariakit's `useTabStore` owns the
// selected tab id; `TabList` renders the `role="tablist"` wrapper and each `Tab`
// registers with the store it reads from context. We bridge the store's
// `setSelectedId` onto our single-arg `onValueChange`, and expose the store via
// context so each Tab can set `data-state="active"|"inactive"` EXPLICITLY from
// `store.useState("selectedId") === value` — Ariakit's `Tab` emits `role="tab"`
// + `aria-selected` + `data-active` itself, but NOT the `data-state` our skin
// styles off of (`data-[state=active]:…`), so we always set it here.
const TabStoreContext = React.createContext<Ariakit.TabStore | null>(null);

const AriakitTabsRoot: TabsParts["Root"] = ({ value, onValueChange, children, ref, ...rest }) => {
  // Ariakit's `setSelectedId` receives the id (nullable when nothing is
  // selected); normalize to "" to match our non-null `onValueChange` contract.
  const store = Ariakit.useTabStore({
    selectedId: value,
    setSelectedId: (id) => onValueChange(id ?? ""),
  });
  return (
    <TabStoreContext.Provider value={store}>
      <Ariakit.TabProvider store={store}>
        <Ariakit.TabList ref={ref} store={store} {...rest}>{children}</Ariakit.TabList>
      </Ariakit.TabProvider>
    </TabStoreContext.Provider>
  );
};

export const ariakitTabs: TabsParts = {
  Root: AriakitTabsRoot,
  // `Tab id={value}` self-wires selection through the store from context (selects
  // on click, sets `role="tab"` + `aria-selected`). We add `data-state` EXPLICITLY
  // from the store's selected id so the skin's `data-[state=active]:…` classes land.
  // `asChild` maps to Ariakit's polymorphic `render={children}`. No visual classes —
  // those arrive via `...rest`.
  Tab: ({ value, asChild, children, ref, ...rest }) => {
    const store = React.useContext(TabStoreContext);
    const selectedId = store?.useState("selectedId");
    const isActive = selectedId === value;
    const dataState = isActive ? "active" : "inactive";
    return asChild
      ? (
        <Ariakit.Tab
          ref={ref}
          id={value}
          render={children as React.ReactElement}
          data-state={dataState}
          {...rest}
        />
      )
      : (
        <Ariakit.Tab ref={ref} id={value} data-state={dataState} {...rest}>
          {children}
        </Ariakit.Tab>
      );
  },
};

/**
 * Partial adapter map — adopt Ariakit for popover + dialog + menu + tooltip +
 * select + combobox + disclosure + toolbar + tabs (9/11). `toast` and
 * `toggleGroup` are intentionally ABSENT: Ariakit ships no toast primitive and
 * no dedicated toggle-group primitive, so both fall back to the zero-dependency
 * builtin. Extend as you vendor more parts.
 */
export const ariakitAdapter: Partial<UIAdapter> & { name: string } = {
  name: "ariakit",
  popover: ariakitPopover,
  dialog: ariakitDialog,
  menu: ariakitMenu,
  tooltip: ariakitTooltip,
  select: ariakitSelect,
  combobox: ariakitCombobox,
  disclosure: ariakitDisclosure,
  toolbar: ariakitToolbar,
  tabs: ariakitTabs,
  // toast: intentionally omitted — Ariakit has no toast primitive; falls back
  // to builtin toast.
  // toggleGroup: intentionally omitted — Ariakit has no dedicated toggle-group
  // primitive; falls back to builtin toggleGroup.
};
