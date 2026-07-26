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
    React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
  >;
  /** The floating surface, portalled into the token scope while open. */
  Content: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & { align?: "start" | "end"; ref?: React.Ref<HTMLDivElement> }
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
    React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
  >;
  /** Overlay + panel; `lead` is an optional node before children (Drawer's drag handle). */
  Content: React.FC<
    & React.HTMLAttributes<HTMLDivElement>
    & { lead?: React.ReactNode; ref?: React.Ref<HTMLDivElement> }
  >;
  /** Closes the dialog; `asChild` merges onto the consumer's element. */
  Close: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
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
    React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
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
}

/**
 * A partial adapter map: unspecified keys fall back to `builtin`, so a consumer
 * can override just `popover` (or `popover` + `dialog`) and leave the rest
 * zero-dependency. This is what `UIAdapterProvider` accepts.
 */
export type PartialUIAdapter =
  & { name?: string }
  & Partial<Omit<UIAdapter, "name">>;
