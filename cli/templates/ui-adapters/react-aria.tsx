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
 * Aria for just some parts and leave the rest zero-dependency. This template is
 * **full coverage — 11/11**: `popover` / `dialog` / `menu` / `tooltip` /
 * `disclosure` / `toggleGroup` / `toolbar` / `select` / `combobox` / `tabs` /
 * `toast`, all mapped onto `react-aria-components`. No slot falls back to the
 * builtin. `tabs` maps onto RAC's `Tabs` / `TabList` / `Tab` panel-less (the skin
 * renders content by value), bridging `selectedKey` + setting `data-state`
 * explicitly.
 * `toggleGroup` maps onto RAC's `ToggleButtonGroup` / `ToggleButton` (bridging the
 * contract's `type`/string `value` onto RAC's `selectionMode`/`Set` selection).
 * `toolbar` maps onto RAC's inline `Toolbar`, which roves its own focusable
 * children (`role="toolbar"`, arrow-key nav, one tab stop). `disclosure`
 * is
 * RAC's inline `Disclosure`/`DisclosurePanel` (the overlay disclosure minus the
 * portal). `combobox` (and, for the same reason, `select`) is a
 * *contract-faithful hand-rolled* mapping — see reconciliation (5) below and the
 * per-slot docstrings for why RAC's collection primitives can't drive it.
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
 *   5. Collection-vs-registry (select + combobox): RAC's `Select` / `ListBox` /
 *      `ComboBox` are COLLECTION components — they own their trigger (`Button` /
 *      `Input`) and their items (`ListBoxItem`), filter internally, and surface
 *      selection through `onSelectionChange` over that collection. The veryfront
 *      contract inverts this: the skin renders its OWN `role="option"` items that
 *      register into an adapter-owned registry (`registerOption` / `matches` /
 *      `activeId`) and drive state through `useSelect()` / `useCombobox()`. RAC's
 *      collection model does NOT invert onto that, so — per the engine-adapter
 *      spec's combobox note — both slots own their state here (mirroring the
 *      builtin) and use the one RAC mechanic that *does* invert: the standalone
 *      `Popover` (`triggerRef` + controlled `isOpen`) for positioning / portal /
 *      dismiss. A bare `Popover` (no `Dialog` child) doesn't steal focus, so the
 *      combobox's `aria-activedescendant` nav stays in the input. Still a valid,
 *      swappable engine slot.
 *   6. Toast is imperative in RAC too — a `ToastQueue` you `.add()`/`.close()`
 *      plus a `ToastRegion` — so it maps directly onto the `{ toast, dismiss }`
 *      contract with no hand-rolled queue. RAC's toast API is newer/unstable
 *      (`UNSTABLE_`-prefixed): verify the exports vs your installed version.
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
  // `Disclosure` / `DisclosurePanel` are a newer RAC addition — verify these
  // names (and the `isExpanded`/`onExpandedChange` prop shape) vs your installed
  // react-aria-components version.
  Disclosure,
  DisclosurePanel,
  Focusable,
  Menu,
  MenuTrigger,
  Modal,
  Popover,
  Pressable,
  // `Tabs` / `TabList` / `Tab` are RAC's tablist primitives — verify these names
  // (and `selectedKey`/`onSelectionChange`) vs your react-aria-components version.
  Tab,
  TabList,
  Tabs,
  Text,
  // `ToggleButtonGroup` / `ToggleButton` are a newer RAC addition — verify these
  // names (and `selectionMode`/`selectedKeys`/`onSelectionChange`) vs your
  // installed react-aria-components version.
  ToggleButton,
  ToggleButtonGroup,
  // `Toolbar` owns roving-tabindex focus (`role="toolbar"`, arrow-key nav, one
  // shared tab stop) over its focusable children — verify the name (and the
  // `orientation` prop) vs your react-aria-components version.
  Toolbar,
  Tooltip,
  TooltipTrigger,
  // RAC's toast primitives are newer/unstable and ship `UNSTABLE_`-prefixed —
  // verify these names (and the queue/region API shape) vs your installed
  // react-aria-components version.
  UNSTABLE_Toast as RACToast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from "react-aria-components";
// `Key` / `Selection` are RAC's collection key + selection types
// (`Selection = Set<Key> | "all"`) — verify vs your react-aria-components version.
import type { Key, Selection } from "react-aria-components";
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
  ToastFn,
  ToastOptions,
  ToastParts,
  ToastState,
  ToggleGroupParts,
  ToolbarParts,
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

// ---------------------------------------------------------------------------
// Disclosure (collapsible archetype — the overlay disclosure MINUS the portal)
// ---------------------------------------------------------------------------
// An inline open/close region (Collapsible; Accordion composes one per item).
// RAC's `Disclosure` owns the expand state AND provides its own context, so the
// skin's Trigger (`<Button slot="trigger">`) and Content (`<DisclosurePanel>`)
// self-wire simply by nesting inside it — no bridge context (unlike dialog/menu,
// whose engine state we mirror for skin parts) and no ScopedPortal (the panel
// renders inline, not as an anchored overlay). Prop mapping: `open`→`isExpanded`,
// `defaultOpen`→`defaultExpanded`, `onOpenChange`→`onExpandedChange` (already
// single-arg, cf. reconciliation (1)), `disabled`→`isDisabled`. RAC mounts the
// panel only while expanded, matching the contract's "present only while open".
export const reactAriaDisclosure: DisclosureParts = {
  Root: ({ open, defaultOpen, onOpenChange, disabled, children, ref, ...rest }) => (
    // verify `isExpanded`/`defaultExpanded`/`onExpandedChange` vs your RAC version.
    <Disclosure
      isExpanded={open}
      defaultExpanded={defaultOpen}
      onExpandedChange={onOpenChange}
      isDisabled={disabled}
      ref={ref}
      {...rest}
    >
      {children}
    </Disclosure>
  ),
  // `slot="trigger"` is what binds the Button to the enclosing Disclosure's
  // expand state (RAC wires `aria-expanded` + toggle from its own context).
  // `asChild` renders the consumer's element inside RAC's `Pressable` (carrying
  // the slot), cf. reconciliation (4).
  Trigger: ({ asChild, children, ...rest }) =>
    asChild
      ? (
        <Pressable slot="trigger">
          {React.cloneElement(children as React.ReactElement, rest)}
        </Pressable>
      )
      : (
        <Button slot="trigger" {...rest}>
          {children}
        </Button>
      ),
  Content: ({ className, children, ref, ...rest }) => (
    <DisclosurePanel ref={ref} className={className} data-vf-state="open" {...rest}>
      {children}
    </DisclosurePanel>
  ),
};

// ---------------------------------------------------------------------------
// ToggleGroup (shared single/multiple selection — RAC ToggleButtonGroup)
// ---------------------------------------------------------------------------
// RAC's `ToggleButtonGroup` owns the shared-selection state machine (roving
// focus, arrow-key nav, `role`), and each `ToggleButton` is a member keyed by
// `id`. It speaks RAC's `Selection` vocabulary — `selectionMode`
// ("single"|"multiple"), a `selectedKeys: Set<Key>`, and `onSelectionChange(Set)`
// — which we BRIDGE onto the contract's `type` + string(|[]) `value`:
//   • `type`            → `selectionMode`
//   • `value`/`default` → a `selectedKeys` Set (single `""` → empty set)
//   • `onValueChange`   ← the emitted Set, collapsed back to a string (single)
//                         or string[] (multiple)
//   • `disabled`        → `isDisabled`
// We own the selection (controlled/uncontrolled) here so the value we feed RAC is
// authoritative, then publish the selected Set through a context the `Item` reads
// to set `data-state="on"|"off"` explicitly (RAC's own `isSelected` surfaces as
// `data-selected`, but the skin styles off `data-state`). RAC's `ToggleButton`
// already emits `aria-pressed`; we add `data-state`. This is an inline primitive,
// so there is no ScopedPortal (nothing is portalled).
const ToggleGroupSelectionContext = React.createContext<Set<string>>(new Set());

/** contract `value` (string | string[] | undefined) → RAC `selectedKeys` Set. */
function toKeySet(value: string | string[] | undefined): Set<string> {
  if (value == null) return new Set();
  if (Array.isArray(value)) return new Set(value);
  return value ? new Set([value]) : new Set(); // single `""` → no selection
}

export const reactAriaToggleGroup: ToggleGroupParts = {
  Root: (
    { type = "single", value, defaultValue, onValueChange, disabled, children, ref, ...rest },
  ) => {
    const isControlled = value !== undefined;
    const [internal, setInternal] = React.useState<Set<string>>(() => toKeySet(defaultValue));
    const selected = isControlled ? toKeySet(value) : internal;

    const onSelectionChange = React.useCallback((keys: Selection) => {
      // A ToggleButtonGroup never emits the `"all"` sentinel; normalize to strings.
      const next = keys === "all" ? new Set<string>() : new Set(Array.from(keys, String));
      if (!isControlled) setInternal(next);
      const arr = Array.from(next);
      // Collapse the Set back to the contract shape: single → one value or `""`.
      onValueChange?.(type === "single" ? (arr[0] ?? "") : arr);
    }, [isControlled, onValueChange, type]);

    return (
      <ToggleGroupSelectionContext.Provider value={selected}>
        {
          /* verify `selectionMode`/`selectedKeys`/`onSelectionChange`/`isDisabled`
            vs your react-aria-components version. */
        }
        <ToggleButtonGroup
          ref={ref}
          selectionMode={type}
          selectedKeys={selected}
          onSelectionChange={onSelectionChange}
          isDisabled={disabled}
          {...rest}
        >
          {children}
        </ToggleButtonGroup>
      </ToggleGroupSelectionContext.Provider>
    );
  },
  // `asChild` has no RAC analogue here — the ToggleButton must itself be the keyed
  // group member — so it is dropped (not spread onto the DOM). The skin's
  // `className` + rest props flow straight onto the ToggleButton.
  Item: ({ value, asChild: _asChild, disabled, children, className, ref, ...rest }) => {
    const selected = React.useContext(ToggleGroupSelectionContext);
    const isOn = selected.has(value);
    return (
      // `id={value}` keys the member; RAC emits `aria-pressed`, we add `data-state`
      // (the skin's styling hook) from our authoritative selection.
      <ToggleButton
        ref={ref}
        id={value as Key}
        isDisabled={disabled}
        data-state={isOn ? "on" : "off"}
        className={className}
        {...rest}
      >
        {children}
      </ToggleButton>
    );
  },
};

// ---------------------------------------------------------------------------
// Toolbar (roving-tabindex — one tab stop, arrow-key nav over its items)
// ---------------------------------------------------------------------------
// RAC's `Toolbar` owns the roving-tabindex mechanics (`role="toolbar"`,
// arrow-key navigation, Home/End, one shared tab stop) over its focusable
// children, so the skin just routes its buttons/links through `Item` and RAC
// roves them. A Toolbar is inline (no anchored surface), so there is NO
// `ScopedPortal` here. Two mappings the contract forces:
//   1. `orientation` maps straight through to `Toolbar`; our `className` arrives
//      via `...rest` (the adapter adds no visual classes).
//   2. `asChild` renders the consumer's element inside RAC's `Pressable` (React
//      Aria owns the press/focus wiring, cf. reconciliation (4)), so RAC roves
//      the consumer's node — the path ToolbarLink → `<a>` takes. Otherwise a RAC
//      `Button` is the roving stop.
export const reactAriaToolbar: ToolbarParts = {
  // verify the `orientation` prop vs your react-aria-components version.
  Root: ({ orientation = "horizontal", children, ...rest }) => (
    <Toolbar orientation={orientation} {...rest}>
      {children}
    </Toolbar>
  ),
  Item: ({ asChild, children, ...rest }) =>
    asChild
      ? <Pressable>{React.cloneElement(children as React.ReactElement, rest)}</Pressable>
      : <Button {...rest}>{children}</Button>,
};

// ---------------------------------------------------------------------------
// Select (dual state — value + open; the skin drives selection via setValue)
// ---------------------------------------------------------------------------
// See reconciliation (5): RAC's `Select`/`ListBox` are collection components that
// own their trigger (`Button`) + items (`ListBoxItem`) and surface selection via
// `onSelectionChange`. The veryfront skin renders its OWN `role="combobox"`
// trigger and `role="option"` items and drives state through `useSelect()`
// (`setOpen`/`setValue`), so RAC's Select collection does NOT invert onto this
// contract. We therefore own the dual value+open state here (mirroring the
// builtin) and use the RAC mechanic that *does* invert — the standalone
// `Popover` (`triggerRef` + `isOpen`/`onOpenChange`) — for positioning, portal,
// and outside-click/Escape dismiss. Selection flows through the skin's `Item` →
// `setValue` (the contract's selection path); there is no RAC collection for an
// `onSelectionChange` to fire from.
interface SelectStateInternal extends SelectState {
  /** The Root's wrapper element — the Popover's positioning anchor. */
  anchorRef: React.RefObject<HTMLElement | null>;
}

const SelectContext = React.createContext<SelectStateInternal | null>(null);

function useSelectState(): SelectStateInternal {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("Select parts must be used within <Select>");
  return ctx;
}

export const reactAriaSelect: SelectParts = {
  Root: (
    { children, value, defaultValue, onValueChange, open, defaultOpen, onOpenChange, labels },
  ) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue);
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
    const anchorRef = React.useRef<HTMLElement | null>(null);

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

    const ctx = React.useMemo<SelectStateInternal>(() => ({
      value: currentValue,
      setValue,
      open: isOpen,
      setOpen,
      labels,
      anchorRef,
    }), [currentValue, setValue, isOpen, setOpen, labels]);

    return (
      <SelectContext.Provider value={ctx}>
        {/* The anchor the standalone Popover positions against + matches width to. */}
        <span ref={anchorRef} className="relative inline-block w-full">{children}</span>
      </SelectContext.Provider>
    );
  },
  Content: ({ className, children, ref, ...rest }) => {
    const ctx = useSelectState();
    return (
      <ScopedPortal>
        {(container) => (
          // Standalone Popover (triggerRef + controlled isOpen) supplies the real
          // RAC positioning/portal/dismiss; the skin classes + normalized state +
          // listbox role land on the surface div.
          <Popover
            triggerRef={ctx.anchorRef}
            isOpen={ctx.open}
            onOpenChange={ctx.setOpen}
            placement="bottom start"
            offset={4}
            UNSTABLE_portalContainer={container}
          >
            <div
              ref={ref}
              role="listbox"
              className={className}
              data-vf-state="open"
              // RAC exposes the trigger's width as `--trigger-width` on the Popover
              // (inherited here) — mirrors the builtin's `matchTriggerWidth`.
              // verify the var name vs your react-aria-components version.
              style={{ minWidth: "var(--trigger-width)" }}
              {...rest}
            >
              {children}
            </div>
          </Popover>
        )}
      </ScopedPortal>
    );
  },
  // Exposed to skin parts; returns the richer internal state (skin ignores anchorRef).
  useSelect: useSelectState as () => SelectState,
};

// ---------------------------------------------------------------------------
// Combobox (contract-faithful hand-rolled state machine + RAC Popover surface)
// ---------------------------------------------------------------------------
// See reconciliation (5): RAC's `ComboBox` OWNS its collection + filtering (it
// renders `ListBoxItem`s and filters them internally) and does NOT invert onto
// this contract's skin-driven registry, where the skin's `Item`s call
// `registerOption`/`matches`/`activeId` and the ADAPTER owns `query`, the
// substring filter, and the `aria-activedescendant` walk over the *filtered*
// set. Per the engine-adapter spec's combobox note, forcing RAC's ComboBox onto
// that model would be a broken mapping, so this slot uses a contract-faithful
// HAND-ROLLED state machine (mirrors the builtin combobox) — still a valid,
// swappable engine slot. The one part that DOES invert — the floating surface —
// uses RAC's real standalone `Popover` (a bare Popover with no `Dialog` child
// does not steal focus, so `aria-activedescendant` nav stays in the input).
interface ComboboxStateInternal extends ComboboxState {
  anchorRef: React.RefObject<HTMLInputElement | null>;
}

const ComboboxContext = React.createContext<ComboboxStateInternal | null>(null);

function useComboboxState(): ComboboxStateInternal {
  const ctx = React.useContext(ComboboxContext);
  if (!ctx) throw new Error("Combobox parts must be used within <Combobox>");
  return ctx;
}

interface ComboboxOption {
  id: string;
  value: string;
  text: string;
}

export const reactAriaCombobox: ComboboxParts = {
  Root: (
    {
      children,
      value,
      defaultValue,
      onValueChange,
      open,
      defaultOpen,
      onOpenChange,
      defaultInputValue,
      onInputValueChange,
    },
  ) => {
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

    return <ComboboxContext.Provider value={ctx}>{children}</ComboboxContext.Provider>;
  },
  Input: ({ className, onChange, onKeyDown, onFocus, ref, ...props }) => {
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
  },
  Content: ({ className, children, ref, ...rest }) => {
    const ctx = useComboboxState();
    return (
      <ScopedPortal>
        {(container) => (
          // Bare standalone Popover: real RAC positioning/portal/dismiss without a
          // Dialog child, so focus is NOT pulled out of the input — the
          // aria-activedescendant pattern keeps working.
          <Popover
            triggerRef={ctx.anchorRef}
            isOpen={ctx.open}
            onOpenChange={ctx.setOpen}
            placement="bottom start"
            offset={4}
            UNSTABLE_portalContainer={container}
          >
            <div
              ref={ref}
              role="listbox"
              id={ctx.listboxId}
              className={className}
              data-vf-state="open"
              // verify `--trigger-width` vs your react-aria-components version.
              style={{ minWidth: "var(--trigger-width)" }}
              {...rest}
            >
              {children}
            </div>
          </Popover>
        )}
      </ScopedPortal>
    );
  },
  useCombobox: useComboboxState as () => ComboboxState,
};

// ---------------------------------------------------------------------------
// Tabs (single-select tablist — RAC Tabs/TabList/Tab, PANEL-LESS)
// ---------------------------------------------------------------------------
// RAC's `Tabs` owns the selected key + roving focus; `TabList` renders the
// `role="tablist"` and each `Tab` a `role="tab"`. Our skin is PANEL-LESS (the
// consumer renders content by value), so we map Root→`Tabs`+`TabList` and
// Tab→`Tab` and DROP RAC's `TabPanel`s entirely. Two mappings the contract
// forces:
//   1. `value`→`selectedKey`; `onValueChange`←`onSelectionChange` (RAC emits a
//      `Key`, so `String()`-narrow it back to the contract's string — already
//      single-arg, cf. reconciliation (1)). An inline primitive, so there is NO
//      ScopedPortal here.
//   2. RAC's `Tab` emits `data-selected` (its own selected-state attribute), NOT
//      the `data-state="active"|"inactive"` the skin styles off. So we publish
//      the selected `value` through a context the `Tab` reads to set `data-state`
//      explicitly. RAC's Tab already emits `role="tab"` + `aria-selected` and
//      selects on press; we add the `data-state` styling hook.
const TabsSelectionContext = React.createContext<string | undefined>(undefined);

export const reactAriaTabs: TabsParts = {
  Root: ({ value, onValueChange, children, ref, ...rest }) => (
    <TabsSelectionContext.Provider value={value}>
      {/* verify `selectedKey`/`onSelectionChange` vs your react-aria-components version. */}
      <Tabs
        selectedKey={value}
        onSelectionChange={(key) =>
          onValueChange(String(key))}
      >
        <TabList ref={ref} {...rest}>
          {children}
        </TabList>
      </Tabs>
    </TabsSelectionContext.Provider>
  ),
  // `id={value}` keys the tab as the `selectedKey` target. `asChild` has no RAC
  // analogue here — the `Tab` must itself be the keyed list member — so it is
  // dropped (not spread onto the DOM). The skin's `className` + rest props flow
  // straight onto the RAC `Tab`.
  Tab: ({ value, asChild: _asChild, children, ref, ...rest }) => {
    const selected = React.useContext(TabsSelectionContext);
    const isActive = selected === value;
    return (
      // RAC emits `role="tab"` + `aria-selected` + selects on press; we add
      // `data-state` (the skin's styling hook) from our authoritative selection.
      <Tab ref={ref} id={value as Key} data-state={isActive ? "active" : "inactive"} {...rest}>
        {children}
      </Tab>
    );
  },
};

// ---------------------------------------------------------------------------
// Toast (imperative — RAC's ToastQueue + ToastRegion behind {toast, dismiss})
// ---------------------------------------------------------------------------
// See reconciliation (6): RAC's toast IS imperative — a `ToastQueue` you
// `.add()`/`.close()` plus a `ToastRegion` that renders the live region + the
// visible toasts. We hold one queue in the Provider, mount its ToastRegion, and
// expose `{ toast, dismiss }` via context so `useToast()` returns the imperative
// API: `toast(options)` / `toast.custom(render)` map onto `queue.add`,
// `dismiss(id)` onto `queue.close`. No hand-rolled queue needed (unlike a
// render-only engine). The RAC toast API is `UNSTABLE_`-prefixed — verify names.
type ReactAriaToastContent =
  | ({ kind: "structured" } & ToastOptions)
  | { kind: "custom"; render: (id: string) => React.ReactNode };

const ToastContext = React.createContext<ToastState | null>(null);

function ReactAriaToastProvider(
  { children, duration = 5000 }: { children: React.ReactNode; duration?: number },
): React.ReactElement {
  // One stable queue for the Provider's lifetime.
  const [queue] = React.useState(
    () => new ToastQueue<ReactAriaToastContent>({ maxVisibleToasts: 5 }),
  );

  const api = React.useMemo<ToastState>(() => {
    const enqueue = (content: ReactAriaToastContent, ms: number | undefined) => {
      const timeout = ms ?? duration;
      // RAC auto-dismisses on a finite timeout (and pauses on hover/focus);
      // Infinity → omit `timeout` to persist. verify vs your RAC version (RAC
      // warns on timeouts under 5000ms).
      return queue.add(content, timeout === Infinity ? undefined : { timeout });
    };
    const toast = ((options: ToastOptions) =>
      enqueue({ kind: "structured", ...options }, options.duration)) as ToastFn;
    toast.custom = (render: (id: string) => React.ReactNode) =>
      enqueue({ kind: "custom", render }, undefined);
    return {
      toast,
      dismiss: (id: string) =>
        queue.close(id),
    };
  }, [queue, duration]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {
        /* ToastRegion stays in the app subtree (inside the token scope) so
          `var(--…)` resolves — it is fixed-positioned, not an anchored overlay,
          so it needs no ScopedPortal. */
      }
      <ToastRegion
        queue={queue}
        className="pointer-events-none fixed bottom-0 right-0 z-[100] flex w-full max-w-full flex-col-reverse gap-2 p-4 sm:max-w-sm"
      >
        {({ toast }) => {
          const content = toast.content;
          if (content.kind === "custom") {
            return (
              <RACToast toast={toast} className="pointer-events-auto">
                {content.render(toast.key)}
              </RACToast>
            );
          }
          const { icon, title, description, action, cancel, variant } = content;
          return (
            <RACToast
              toast={toast}
              data-variant={variant ?? "default"}
              data-vf-state="open"
              className="pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border border-[var(--edge)] bg-[var(--popover)] p-4 pr-8 text-sm text-[var(--foreground)] shadow-lg"
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
              <ToastContent className="flex-1 space-y-1">
                {title
                  ? (
                    <Text slot="title" className="text-sm font-medium text-[var(--foreground)]">
                      {title}
                    </Text>
                  )
                  : null}
                {description
                  ? (
                    <Text slot="description" className="text-sm text-[var(--muted-foreground)]">
                      {description}
                    </Text>
                  )
                  : null}
                {action || cancel
                  ? (
                    <div className="mt-2 flex gap-2">
                      {cancel
                        ? (
                          // `slot="close"` lets RAC dismiss the toast; `onPress`
                          // adds the consumer's side effect.
                          <Button
                            slot="close"
                            onPress={() => cancel.onClick?.()}
                            className="rounded-md px-2 py-1 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                          >
                            {cancel.label}
                          </Button>
                        )
                        : null}
                      {action
                        ? (
                          <Button
                            slot="close"
                            onPress={() => action.onClick()}
                            className="rounded-md bg-[var(--primary)] px-2 py-1 text-sm font-medium text-[var(--secondary)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]"
                          >
                            {action.label}
                          </Button>
                        )
                        : null}
                    </div>
                  )
                  : null}
              </ToastContent>
              <Button
                slot="close"
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
              </Button>
            </RACToast>
          );
        }}
      </ToastRegion>
    </ToastContext.Provider>
  );
}
ReactAriaToastProvider.displayName = "ReactAriaToastProvider";

export const reactAriaToast: ToastParts = {
  Provider: ReactAriaToastProvider,
  // Throws outside a <ToastProvider>, matching the contract.
  useToast: () => {
    const ctx = React.useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
    return ctx;
  },
};

/**
 * FULL adapter map — React Aria for all 11 primitives: popover + dialog + menu +
 * tooltip + disclosure + toggleGroup + toolbar + select + combobox + tabs +
 * toast. No slot falls back to the builtin. `disclosure` maps onto RAC's inline
 * `Disclosure`/`DisclosurePanel` (no portal); `toggleGroup` bridges the contract's
 * `type`/string `value` onto RAC's `ToggleButtonGroup` `selectionMode`/`Set`
 * selection; `toolbar` maps onto RAC's inline `Toolbar` (it roves its own
 * focusable children); `select` + `combobox` bridge their state locally (RAC's
 * collection primitives don't invert onto the skin-driven registry —
 * reconciliation (5)); `tabs` maps onto RAC's `Tabs`/`TabList`/`Tab` panel-less,
 * bridging `selectedKey` + setting `data-state` explicitly (RAC's Tab emits
 * `data-selected`, not the skin's `data-state`); `toast` maps straight onto RAC's
 * imperative `ToastQueue` (reconciliation (6)).
 */
export const reactAriaAdapter: Partial<UIAdapter> & { name: string } = {
  name: "react-aria",
  popover: reactAriaPopover,
  dialog: reactAriaDialog,
  menu: reactAriaMenu,
  tooltip: reactAriaTooltip,
  disclosure: reactAriaDisclosure,
  toggleGroup: reactAriaToggleGroup,
  toolbar: reactAriaToolbar,
  select: reactAriaSelect,
  combobox: reactAriaCombobox,
  tabs: reactAriaTabs,
  toast: reactAriaToast,
};
