/**
 * Shared behavioral machinery for Popover and DropdownMenu.
 * TODO(a11y): focus trap, portal + collision-aware positioning (flip/shift),
 * aria-controls, side/align offsets.
 * DropdownMenu: roving focus, typeahead, Tab, aria-activedescendant, sub menus.
 * @module react/components/ui/anchored-surface
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { composeRefs, Slot } from "./slot.tsx";
import { Floating } from "./floating.tsx";
import { type DisclosureOptions, useDisclosure } from "./disclosure.ts";

/** Context value shared between an anchored skin's Root and its parts. */
export interface AnchoredState {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

/** Props for `AnchoredTrigger` (returned by the factory). */
export interface AnchoredTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  /** Composed with the internal positioning-anchor ref. */
  ref?: React.Ref<HTMLButtonElement>;
  /** `aria-haspopup` value -- `"dialog"` for Popover, `"menu"` for DropdownMenu. */
  haspopup: NonNullable<React.AriaAttributes["aria-haspopup"]>;
}

/** Props for `AnchoredContent` (returned by the factory). */
export interface AnchoredContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
}

/**
 * Creates a fresh context instance plus the AnchoredRoot, AnchoredTrigger, and
 * AnchoredContent parts -- all bound to that context.
 *
 * Each skin (Popover, DropdownMenu) calls this ONCE at module scope so their
 * contexts are distinct objects. This prevents cross-binding when one skin is
 * nested inside the other or inside a modal skin: a DropdownMenuItem close
 * call only affects the DropdownMenu whose context is in scope, never a
 * Popover above it in the tree.
 */
export function createAnchoredSurfaceParts() {
  const Context = React.createContext<AnchoredState | null>(null);

  /**
   * Disclosure state + context provider. Renders no node of its own - the
   * positioning anchor for `Floating` is the trigger element itself, carried
   * on context as `anchorRef` and attached by `AnchoredTrigger`.
   */
  function AnchoredRoot(
    { children, open, defaultOpen, onOpenChange }: DisclosureOptions & {
      children: React.ReactNode;
    },
  ): React.ReactElement {
    const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
    const anchorRef = React.useRef<HTMLElement | null>(null);
    const ctx = React.useMemo(() => ({ open: isOpen, setOpen, anchorRef }), [isOpen, setOpen]);
    return (
      <Context.Provider value={ctx}>
        {children}
      </Context.Provider>
    );
  }

  /**
   * Toggle trigger. Sets `aria-haspopup` and `aria-expanded`; toggles open on
   * click; carries the positioning-anchor ref (composed with any consumer
   * `ref`, including through `asChild`). Skins differ only in the `haspopup`
   * value they supply.
   *
   * `asChild` contract: the child must forward `ref` to its DOM node (every
   * `ui` component does; refs pass as regular props on function components in
   * React 19). A child that drops `ref` leaves the surface unanchored —
   * `Floating` warns in that case instead of silently rendering nothing.
   */
  function AnchoredTrigger(
    { children, asChild, onClick, haspopup, ref, ...props }: AnchoredTriggerProps,
  ): React.ReactElement {
    const ctx = React.useContext(Context);
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        {...(asChild ? {} : { type: "button" as const })}
        aria-haspopup={haspopup}
        aria-expanded={ctx?.open}
        ref={composeRefs<HTMLButtonElement>(
          ctx?.anchorRef as React.Ref<HTMLButtonElement> | undefined,
          ref,
        )}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(e);
          // Guard ctx before reading ctx.open (trigger may render outside a Root).
          if (ctx) ctx.setOpen(!ctx.open);
        }}
        {...props}
      >
        {children}
      </Comp>
    );
  }

  /** `Floating` wrapper with base classes. Skins extend via `className` and `role`. */
  function AnchoredContent(
    { children, className, align, ...props }: AnchoredContentProps,
  ): React.ReactElement | null {
    const ctx = React.useContext(Context);
    if (!ctx) return null;
    return (
      <Floating
        anchorRef={ctx.anchorRef}
        open={ctx.open}
        align={align}
        onDismiss={() => ctx.setOpen(false)}
        className={cn(
          "z-50 overflow-hidden rounded-lg bg-[var(--popover)] text-[var(--foreground)] shadow-sm outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </Floating>
    );
  }

  return { Context, AnchoredRoot, AnchoredTrigger, AnchoredContent };
}
