/**
 * UI primitive-adapter contract (RFC 0001: bring-your-own UI primitive
 * adapters). A behavioural primitive is split into a **Skin** (Tailwind /
 * `cva` / `[var(--token)]` classes, authored once) and **Mechanics** (focus,
 * dismiss, positioning, ARIA, keyboard) supplied by a swappable **adapter**.
 *
 * The contract is **role-tagged component slots + normalized controlled or
 * uncontrolled disclosure props** (`open`, `defaultOpen`, `onOpenChange`):
 * deliberately NOT prop-getters (those only fit React Aria's hooks; Base UI /
 * Ariakit invert composition via `render`). Every adapter: the zero-dependency
 * `builtin` and any third-party engine (Base UI, Radix, React Aria): satisfies
 * these exact shapes, so one set of skin classes works everywhere.
 *
 * Types only. No runtime, no engine imports: this file is safe to pull into
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

/**
 * Role-tagged slots an adapter provides for a single open/close **disclosure**
 * (the Collapsible primitive; Accordion composes one disclosure per item). The
 * archetype is the overlay disclosure minus the portal/positioning: one or more
 * triggers toggle a region whose node remains mounted and is hidden while
 * closed. Public Collapsible parts coordinate their realized IDs without
 * inspecting the consumer's React tree, then pass synchronized `aria-controls`
 * and `aria-labelledby` props through these slots. Adapters must preserve those
 * explicit relationships while supplying their own defaults for direct slot
 * use.
 */
export interface DisclosureParts {
  /** Owns open state; renders the wrapper node + provides disclosure context. */
  Root: React.FC<
    & DisclosureProps
    & React.HTMLAttributes<HTMLDivElement>
    & {
      disabled?: boolean;
      /** Synchronous id owned by the root and referenced by Content. */
      triggerId?: string;
      /** Synchronous id owned by the root and referenced by Trigger. */
      contentId?: string;
      children: React.ReactNode;
      ref?: React.Ref<HTMLDivElement>;
    }
  >;
  /**
   * Toggles the region; `asChild` merges onto the consumer's element. An
   * effectively disabled composed trigger must prevent activation and suppress
   * both wrapper and child click handlers. It must publish the effective state
   * as `data-state="open" | "closed"` so public skins remain adapter-independent.
   */
  Trigger: React.FC<
    & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-controls">
    & {
      asChild?: boolean;
      /** `null` explicitly suppresses an adapter fallback before public parts register. */
      "aria-controls"?: string | null;
      ref?: React.Ref<HTMLButtonElement>;
    }
  >;
  /** The collapsible region, retained while closed with the native `hidden` attribute. */
  Content: React.FC<
    & Omit<React.HTMLAttributes<HTMLDivElement>, "aria-labelledby">
    & {
      /** `null` explicitly suppresses an adapter fallback before public parts register. */
      "aria-labelledby"?: string | null;
      ref?: React.Ref<HTMLDivElement>;
    }
  >;
}

/**
 * Role-tagged slots an adapter provides for the ToggleGroup primitive: a set of
 * pressable items with shared `single` / `multiple` selection. The Root owns the
 * selection state machine; the Item self-wires through the adapter's internal
 * context (reads its pressed state, toggles on click). The skin keeps only the
 * visual classes; `data-state="on"|"off"` on each Item is the styling hook.
 */
export interface ToggleGroupParts {
  /** Owns the selection state machine + provides context. */
  Root: React.FC<ToggleGroupRootProps>;
  /**
   * A pressable item; sets `aria-pressed` / `data-state`, toggles on click. An
   * effectively disabled composed item must prevent activation and suppress
   * both wrapper and child click handlers.
   */
  Item: React.FC<
    & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">
    & { value: string; asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
}

interface ToggleGroupRootBase
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  disabled?: boolean;
  children: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
}

/** Single-selection adapter root. */
export interface SingleToggleGroupRootProps extends ToggleGroupRootBase {
  type?: "single";
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

/** Multiple-selection adapter root. */
export interface MultipleToggleGroupRootProps extends ToggleGroupRootBase {
  type: "multiple";
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}

/** Discriminated selection contract implemented by every ToggleGroup adapter. */
export type ToggleGroupRootProps =
  | SingleToggleGroupRootProps
  | MultipleToggleGroupRootProps;

/**
 * Role-tagged slots an adapter provides for the Toolbar primitive: a
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
  /**
   * A roving-focus stop. It must render with `tabIndex={-1}` until the Root
   * assigns ownership. When disabled, native items must be inert and composed
   * (`asChild`) items must expose `aria-disabled`, leave sequential focus,
   * remove navigation targets, and suppress primary, auxiliary, and keyboard
   * activation before consumer or child handlers run. Public toolbar skins rely
   * on that boundary remaining intact when adapters are swapped.
   */
  Item: React.FC<
    & React.ButtonHTMLAttributes<HTMLButtonElement>
    & { asChild?: boolean; ref?: React.Ref<HTMLButtonElement> }
  >;
}

/** The imperative Toast API a skin part reads from inside a `ToastProvider`. */
export interface ToastState {
  /** Enqueue a structured toast, or a custom node via `toast.custom`. */
  toast: ToastFn;
  /** Remove a toast early by its id. */
  dismiss: (id: string) => void;
}

/** Normalized queue and viewport options every toast adapter provider accepts. */
export interface ToastProviderProps {
  /** Subtree that can enqueue toasts through the adapter hook. */
  children: React.ReactNode;
  /** Default milliseconds before auto-dismiss, unless the call overrides it. @default 5000 */
  duration?: number;
  /** Maximum queued notifications; oldest entries are evicted first. @default 5 */
  maxToasts?: number;
  /** Whether the adapter owns a portal/inline viewport or the caller renders it. @default "portal" */
  viewport?: "portal" | "inline" | "manual";
}

/** Normalized props for an adapter-owned manual toast viewport. */
export interface ToastViewportProps extends React.HTMLAttributes<HTMLOListElement> {
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLOListElement>;
}

/**
 * Toast is imperative (a queue + hook), not a floating surface, so its adapter
 * slot is `Provider` + `useToast` rather than role-tagged render slots. The
 * builtin holds a queue and mounts a viewport; a Sonner adapter would mount
 * `<Toaster/>` and map `useToast().toast` onto Sonner's `toast()`.
 */
export interface ToastParts {
  /** Owns the toast queue and mounts its viewport. */
  Provider: React.FC<ToastProviderProps>;
  /** Renders the active adapter's viewport when Provider uses manual ownership. */
  Viewport: React.FC<ToastViewportProps>;
  /** Read the imperative `{ toast, dismiss }` API. Throws outside a `ToastProvider`. */
  useToast: () => ToastState;
}

/** Normalized open state a modal skin part reads from its adapter (Dialog / Drawer). */
export interface ModalState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * Role-tagged slots an adapter provides for the Dialog primitive (Drawer is a
 * skin over the same modal mechanics via its own instance). The builtin wraps
 * `createModalSurfaceParts` (overlay + centered panel, Escape / overlay-click
 * dismiss, focus containment + restoration); a Base UI / Radix engine maps these
 * onto its own Dialog parts.
 */
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

/**
 * Role-tagged slots an adapter provides for the Drawer primitive: the same modal
 * mechanics as Dialog on a distinct instance, plus an edge `direction`. The
 * builtin renders a static edge sheet (the skin positions it); a Vaul specialist
 * adapter drives real drag-to-dismiss / snap points off the same slots.
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

/**
 * The adapter surface. Each new primitive must also be added to the explicit
 * composition in `context.tsx`, which prevents `undefined` overrides from
 * erasing inherited or builtin slots.
 */
export interface UIAdapter {
  /** Adapter identity (e.g. `"builtin"`, `"base-ui"`). */
  name: string;
  toast: ToastParts;
  disclosure: DisclosureParts;
  toggleGroup: ToggleGroupParts;
  toolbar: ToolbarParts;
  dialog: DialogParts;
  drawer: DrawerParts;
}

/**
 * A partial adapter map: unspecified keys fall back to `builtin`, so a consumer
 * can override one primitive and leave the rest
 * zero-dependency. This is what `UIAdapterProvider` accepts.
 */
export type PartialUIAdapter =
  & { name?: string }
  & Partial<Omit<UIAdapter, "name">>;
