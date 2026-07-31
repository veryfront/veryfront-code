/**
 * UI primitive-adapter contract (RFC 0001 — bring-your-own UI primitive
 * adapters). A behavioural primitive is split into a **Skin** (our Tailwind /
 * `cva` / `[var(--token)]` classes, authored once) and **Mechanics** (focus,
 * dismiss, positioning, ARIA, keyboard) supplied by a swappable **adapter**.
 *
 * The contract is **role-tagged component slots + normalized `{open,setOpen}`
 * disclosure state** — deliberately NOT prop-getters (those only fit React
 * Aria's hooks; Base UI / Ariakit invert composition via `render`). Every
 * adapter — the zero-dependency `builtin` and any third-party engine (Base UI,
 * Radix, React Aria) — satisfies these exact shapes, so one set of skin classes
 * works everywhere.
 *
 * Types only. No runtime, no engine imports — this file is safe to pull into
 * `veryfront/ui/adapter` from a consumer-authored adapter.
 *
 * @module react/components/ui/adapter/contract
 */
import type * as React from "react";
import type { ToastFn } from "../toast-parts.tsx";

/**
 * Normalized disclosure state shared by every overlay primitive. Matches
 * `useDisclosure` exactly; adapters drop any engine-specific extras (e.g. Base
 * UI's 2nd `eventDetails` arg on `onOpenChange`).
 */
export interface DisclosureProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Role-tagged slots an adapter provides for the Popover primitive. */
export interface PopoverParts {
  /** Owns open state + the positioning anchor; renders no public node of its own. */
  Root: React.FC<DisclosureProps & { children: React.ReactNode }>;
  /** Toggles the surface; `asChild` merges behaviour onto the consumer's element. */
  Trigger: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
  /** The floating surface, portalled into the token scope while open. */
  Content: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & { align?: "start" | "end"; ref?: React.Ref<HTMLDivElement> }
  >;
}

/**
 * Role-tagged slots an adapter provides for a single open/close **disclosure**
 * (the Collapsible primitive; Accordion composes one disclosure per item). The
 * archetype is the overlay disclosure minus the portal/positioning: a trigger
 * toggles a region that is present only while open. Parts self-wire through the
 * adapter's own internal context, so the skin just renders `Root` > `Trigger` /
 * `Content` (no hook needed), exactly like the Popover skin.
 */
export interface DisclosureParts {
  /** Owns open state; renders the wrapper node + provides disclosure context. */
  Root: React.FC<
    & DisclosureProps
    & React.HTMLAttributes<HTMLDivElement>
    & { disabled?: boolean; children: React.ReactNode; ref?: React.Ref<HTMLDivElement> }
  >;
  /** Toggles the region; `asChild` merges onto the consumer's element. */
  Trigger: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
  /** The collapsible region, present (mounted) only while open. */
  Content: React.FC<
    React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }
  >;
}

/**
 * Role-tagged slots an adapter provides for the ToggleGroup primitive — a set of
 * pressable items with shared `single` / `multiple` selection. The Root owns the
 * selection state machine; the Item self-wires through the adapter's internal
 * context (reads its pressed state, toggles on click). The skin keeps only the
 * visual classes; `data-state="on"|"off"` on each Item is the styling hook.
 */
export interface ToggleGroupParts {
  /** Owns the selection state machine + provides context. */
  Root: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & {
      type?: "single" | "multiple";
      value?: string | string[];
      defaultValue?: string | string[];
      onValueChange?: (value: string | string[]) => void;
      disabled?: boolean;
      children: React.ReactNode;
      ref?: React.Ref<HTMLDivElement>;
    }
  >;
  /** A pressable item; sets `aria-pressed` / `data-state`, toggles on click. */
  Item: React.FC<
    & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">
    & { value: string; asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
}

/**
 * Role-tagged slots an adapter provides for the Toolbar primitive — a
 * `role="toolbar"` container sharing one tab stop, with roving-tabindex arrow-key
 * navigation over its items. The Root owns the roving mechanics; each Item
 * registers as a roving stop (engines rove their own item components, so the skin
 * routes its buttons/links through `Item`). Separators stay pure skin.
 */
export interface ToolbarParts {
  /** Owns roving focus + `role="toolbar"`; renders the wrapper node. */
  Root: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & {
      orientation?: "horizontal" | "vertical";
      children: React.ReactNode;
      ref?: React.Ref<HTMLDivElement>;
    }
  >;
  /** A roving-focus stop (a button, or the consumer's element via `asChild`). */
  Item: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
}

/**
 * Role-tagged slots an adapter provides for the Tabs primitive — a single-select
 * `role="tablist"` of tabs (panel-less: the consumer renders content keyed by the
 * active value). The Root owns the selected value; each Tab self-wires through the
 * adapter's internal context (sets `role="tab"` + `aria-selected` + `data-state`,
 * selects on click). The skin keeps the visual classes; `data-state="active"` is
 * the styling hook.
 */
export interface TabsParts {
  /** Owns the selected value + provides context; renders the `role="tablist"` node. */
  Root: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
      ref?: React.Ref<HTMLDivElement>;
    }
  >;
  /** A tab; sets `aria-selected` / `data-state`, selects its value on click. */
  Tab: React.FC<
    & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">
    & { value: string; asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
}

/**
 * Role-tagged slots an adapter provides for the Drawer primitive — a modal that
 * slides from an edge. Its OWN slot (not `dialog`) so a drag-physics specialist
 * like **Vaul** can power it (drag-to-dismiss, snap points, velocity) behind the
 * same Root/Trigger/Content/Close, while the builtin is a static bottom sheet.
 * The 4 general engines have no drag-drawer primitive → they fall back to builtin
 * (use the `vaul` specialist adapter for the real thing). `direction` lets a
 * skin/engine pick the edge; `lead` is the drag-handle node before children.
 */
export interface DrawerParts {
  /** Owns open state; renders no public node of its own. */
  Root: React.FC<
    & DisclosureProps
    & { direction?: "top" | "bottom" | "left" | "right"; children: React.ReactNode }
  >;
  /** Opens the drawer; `asChild` merges onto the consumer's element. */
  Trigger: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
  /** Overlay + sliding sheet; `lead` is an optional node before children (drag handle). */
  Content: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & { lead?: React.ReactNode; ref?: React.Ref<HTMLDivElement> }
  >;
  /** Closes the drawer; `asChild` merges onto the consumer's element. */
  Close: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
}

/** Open/close state a modal skin part (e.g. a Cancel button) can read. */
export interface ModalState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Role-tagged slots an adapter provides for the Dialog primitive (Drawer is a skin over this). */
export interface DialogParts {
  /** Owns open state; renders no public node of its own. */
  Root: React.FC<DisclosureProps & { children: React.ReactNode }>;
  /** Opens the dialog; `asChild` merges onto the consumer's element. */
  Trigger: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
  /** Overlay + panel; `lead` is an optional node before children (Drawer's drag handle). */
  Content: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & { lead?: React.ReactNode; ref?: React.Ref<HTMLDivElement> }
  >;
  /** Closes the dialog; `asChild` merges onto the consumer's element. */
  Close: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
  /** Hook for skin parts that must close programmatically (e.g. `DialogCancel`). */
  useDialog: () => ModalState;
}

/** Role-tagged slots an adapter provides for the DropdownMenu primitive. */
export interface MenuParts {
  /** Owns open state + the positioning anchor; renders no public node of its own. */
  Root: React.FC<DisclosureProps & { children: React.ReactNode }>;
  /** Toggles the menu; `asChild` merges onto the consumer's element. */
  Trigger: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
  /** The floating menu surface, portalled into the token scope while open. */
  Content: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & { align?: "start" | "end"; ref?: React.Ref<HTMLDivElement> }
  >;
  /**
   * Read menu open-state from a menu part (e.g. an Item that closes the menu on
   * select). Returns null when used outside a menu, matching the item's
   * tolerant `ctx?.setOpen(false)` behaviour.
   */
  useMenu: () => ModalState | null;
}

/** Which edge a tooltip prefers (flips to the opposite on collision). */
export type TooltipSide = "top" | "bottom" | "left" | "right";

/** Role-tagged slots an adapter provides for the Tooltip primitive. */
export interface TooltipParts {
  /** Shared tooltip config (delay grouping); a passthrough in the builtin. */
  Provider: React.FC<{ children: React.ReactNode; delayDuration?: number }>;
  /** Owns hover/focus open state + the positioning anchor. */
  Root: React.FC<{ children: React.ReactNode }>;
  /** The hover/focus target; `asChild` merges onto the consumer's element. */
  Trigger: React.FC<
    & React.HTMLAttributes<HTMLElement>
    & { children: React.ReactNode; asChild?: boolean }
  >;
  /** The floating bubble, portalled into the token scope while open. */
  Content: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & { side?: TooltipSide; sideOffset?: number; ref?: React.Ref<HTMLDivElement> }
  >;
}

/** Selection + open state a Select skin part reads (value, open, label registry). */
export interface SelectState {
  value: string | undefined;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** value → label node, so the trigger shows the selected label immediately. */
  labels: Map<string, React.ReactNode>;
}

/** Role-tagged slots an adapter provides for the Select primitive (dual state). */
export interface SelectParts {
  /**
   * Owns value + open state and the positioning anchor. The skin passes the
   * `labels` map it collected from its own items, keeping the adapter decoupled
   * from the skin's item identity.
   */
  Root: React.FC<{
    children: React.ReactNode;
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    labels: Map<string, React.ReactNode>;
  }>;
  /** The floating listbox surface, portalled into the token scope while open. */
  Content: React.FC<
    React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }
  >;
  /** Read select state from a skin part (Trigger/Value/Item). Throws outside a Select. */
  useSelect: () => SelectState;
}

/**
 * Combobox state a skin part reads. Deliberately RICHER than {@link SelectState}
 * — a Combobox is a text `role="combobox"` input filtering a `role="listbox"`,
 * so the adapter owns the typed `query`, the substring `matches` filter, the
 * option registry, and the `activeId` (`aria-activedescendant`) that keyboard
 * navigation walks. Filtering lives in the ADAPTER, not the skin, because
 * active-descendant nav must move over the *filtered* set — the two are one
 * state machine. The skin's items register `(id,value,text)` and read
 * `matches`/`activeId` to hide/highlight; the skin never owns the filter logic.
 */
export interface ComboboxState {
  /** Current input text. */
  query: string;
  /** Set the input text (typically re-opens the list). */
  setQuery: (query: string) => void;
  /** Whether the listbox is open. */
  open: boolean;
  /** Open/close the listbox. */
  setOpen: (open: boolean) => void;
  /** The selected option value, if any. */
  value: string | undefined;
  /** Commit a selection (value + display text); closes the list. */
  select: (value: string, text: string) => void;
  /** `id` of the active option for `aria-activedescendant`, or `undefined`. */
  activeId: string | undefined;
  /** Substring filter — an option's text is visible when this returns true. */
  matches: (text: string) => boolean;
  /** DOM id of the listbox, for the input's `aria-controls`. */
  listboxId: string;
  /** Register an option so the adapter can drive filtering + keyboard nav. */
  registerOption: (id: string, value: string, text: string) => void;
  /** Remove a previously-registered option. */
  unregisterOption: (id: string) => void;
  /** Wire onto the input's `onKeyDown`: ArrowUp/Down/Home/End/Enter/Escape nav. */
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** Role-tagged slots an adapter provides for the Combobox primitive. */
export interface ComboboxParts {
  /** Owns query/open/value + option registry + the positioning anchor. */
  Root: React.FC<{
    children: React.ReactNode;
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultInputValue?: string;
    /** Fires whenever the input text changes — typing OR filling from a selection.
     * Autocomplete reads this to treat the free-typed text as the value. */
    onInputValueChange?: (value: string) => void;
  }>;
  /** The `role="combobox"` text input; `aria-activedescendant`/`-controls` wired. */
  Input: React.FC<
    React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }
  >;
  /** The floating `role="listbox"` surface, portalled into the token scope while open. */
  Content: React.FC<
    React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }
  >;
  /** Read combobox state from a skin part (Input/Item/Empty). Throws outside a Combobox. */
  useCombobox: () => ComboboxState;
}

/** The imperative Toast API a skin part reads from inside a `ToastProvider`. */
export interface ToastState {
  /** Enqueue a structured toast, or a custom node via `toast.custom`. */
  toast: ToastFn;
  /** Remove a toast early by its id. */
  dismiss: (id: string) => void;
}

/**
 * Toast is imperative (a queue + hook), not a floating surface, so its adapter
 * slot is `Provider` + `useToast` rather than role-tagged render slots. The
 * builtin holds a queue and mounts a viewport; a Sonner adapter would mount
 * `<Toaster/>` and map `useToast().toast` onto Sonner's `toast()`.
 */
export interface ToastParts {
  /** Owns the toast queue and mounts its viewport. */
  Provider: React.FC<{ children: React.ReactNode; duration?: number }>;
  /** Read the imperative `{ toast, dismiss }` API. Throws outside a `ToastProvider`. */
  useToast: () => ToastState;
}

/**
 * The adapter surface. New primitives slot in as keys — the merge machinery in
 * `context.tsx` is agnostic to which keys exist.
 */
export interface UIAdapter {
  /** Adapter identity (e.g. `"builtin"`, `"base-ui"`). */
  name: string;
  popover: PopoverParts;
  dialog: DialogParts;
  menu: MenuParts;
  tooltip: TooltipParts;
  select: SelectParts;
  combobox: ComboboxParts;
  toast: ToastParts;
  disclosure: DisclosureParts;
  toggleGroup: ToggleGroupParts;
  toolbar: ToolbarParts;
  tabs: TabsParts;
  drawer: DrawerParts;
}

/**
 * A partial adapter map: unspecified keys fall back to `builtin`, so a consumer
 * can override just `popover` (or `popover` + `dialog`) and leave the rest
 * zero-dependency. This is what `UIAdapterProvider` accepts.
 */
export type PartialUIAdapter =
  & { name?: string }
  & Partial<Omit<UIAdapter, "name">>;
