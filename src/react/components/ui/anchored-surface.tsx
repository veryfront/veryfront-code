/**
 * Shared behavioral machinery for Popover and DropdownMenu.
 * TODO(a11y): focus trap, portal + collision-aware positioning (flip/shift),
 * aria-controls/aria-expanded, side/align offsets.
 * DropdownMenu: roving focus, typeahead, Tab, aria-activedescendant, sub menus.
 * @module react/components/ui/anchored-surface
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";
import { Floating } from "./floating.tsx";
import { type DisclosureOptions, useDisclosure } from "./disclosure.ts";

/** Context value shared between an anchored skin's Root and its parts. */
export interface AnchoredState {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

/** Context for Popover and DropdownMenu skins. */
export const AnchoredContext = React.createContext<AnchoredState | null>(null);

/**
 * Anchor `<span>` + disclosure state + context provider.
 * Both `<Popover>` and `<DropdownMenu>` delegate here — the span is the
 * positioning anchor for `Floating`.
 */
export function AnchoredRoot(
  { children, open, defaultOpen, onOpenChange }: DisclosureOptions & { children: React.ReactNode },
): React.ReactElement {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const ctx = React.useMemo(() => ({ open: isOpen, setOpen, anchorRef }), [isOpen, setOpen]);
  return (
    <span ref={anchorRef} className="relative inline-block">
      <AnchoredContext.Provider value={ctx}>
        {children}
      </AnchoredContext.Provider>
    </span>
  );
}

/** Props for `AnchoredTrigger`. */
export interface AnchoredTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  /** `aria-haspopup` value — `"dialog"` for Popover, `"menu"` for DropdownMenu. */
  haspopup: NonNullable<React.AriaAttributes["aria-haspopup"]>;
}

/**
 * Toggle trigger for anchored surfaces. Sets `aria-haspopup`/`aria-expanded`;
 * skins differ only in the `haspopup` value they pass.
 */
export function AnchoredTrigger(
  { children, asChild, onClick, haspopup, ...props }: AnchoredTriggerProps,
): React.ReactElement {
  const ctx = React.useContext(AnchoredContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      aria-haspopup={haspopup}
      aria-expanded={ctx?.open}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        ctx?.setOpen(!ctx.open);
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

/** Props for `AnchoredContent`. */
export interface AnchoredContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
}

/**
 * `Floating` wrapper with base anchored-surface classes.
 * Skins extend via `className` (min-width, padding) and `role`.
 */
export function AnchoredContent(
  { children, className, align, ...props }: AnchoredContentProps,
): React.ReactElement | null {
  const ctx = React.useContext(AnchoredContext);
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
