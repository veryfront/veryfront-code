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

/**
 * Role-tagged slots an adapter provides for a single open/close **disclosure**
 * (the Collapsible primitive; Accordion composes one disclosure per item). The
 * archetype is the overlay disclosure minus the portal/positioning: a trigger
 * toggles a region whose node remains mounted and is hidden while closed. Parts self-wire through the
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
  /** The collapsible region, retained while closed with the native `hidden` attribute. */
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
  Provider: React.FC<{
    children: React.ReactNode;
    duration?: number;
    maxToasts?: number;
  }>;
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
  toast: ToastParts;
  disclosure: DisclosureParts;
  toggleGroup: ToggleGroupParts;
  toolbar: ToolbarParts;
}

/**
 * A partial adapter map: unspecified keys fall back to `builtin`, so a consumer
 * can override one primitive and leave the rest
 * zero-dependency. This is what `UIAdapterProvider` accepts.
 */
export type PartialUIAdapter =
  & { name?: string }
  & Partial<Omit<UIAdapter, "name">>;
