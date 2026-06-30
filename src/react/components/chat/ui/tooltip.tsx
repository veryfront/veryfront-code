/**
 * Tooltip — BASIC implementation with the same API surface as Studio's
 * (Radix-shaped: `TooltipProvider` / `Tooltip` / `TooltipTrigger` /
 * `TooltipContent`). Hover/focus opens it; positioning is CSS-only by `side`.
 *
 * TODO(a11y): this is intentionally minimal so the chat composition can be
 * built against the final API now. Still owed before production:
 *   - `aria-describedby` wiring trigger ↔ content, `role="tooltip"` id
 *   - open/close delay + provider-level delay grouping
 *   - `Escape` to dismiss, pointer-down dismissal
 *   - collision-aware positioning (flip/shift) + portal to escape overflow
 *
 * Private to the chat module.
 *
 * @module react/components/chat/ui/tooltip
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { Slot } from "./slot.tsx";

const TooltipContext = React.createContext<{ open: boolean } | null>(null);

/** Provider for shared tooltip config. Basic: a passthrough for API parity. */
export function TooltipProvider(
  { children }: { children: React.ReactNode; delayDuration?: number },
): React.ReactElement {
  return <>{children}</>;
}

/** Tooltip root — owns open state and the positioning anchor. */
export function Tooltip(
  { children }: { children: React.ReactNode },
): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <TooltipContext.Provider value={{ open }}>
        {children}
      </TooltipContext.Provider>
    </span>
  );
}

/** Tooltip trigger. `asChild` merges onto the child element (e.g. a Button). */
export function TooltipTrigger(
  { children, asChild }: { children: React.ReactNode; asChild?: boolean },
): React.ReactElement {
  const Comp = asChild ? Slot : "span";
  return <Comp>{children}</Comp>;
}

const sideClasses: Record<string, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
};

/** Props accepted by `<TooltipContent>`. */
export interface TooltipContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
}

/** Tooltip content — shown while the trigger is hovered/focused. */
export function TooltipContent(
  { side = "top", className, children, ...props }: TooltipContentProps,
): React.ReactElement | null {
  const ctx = React.useContext(TooltipContext);
  if (!ctx?.open) return null;
  return (
    <div
      role="tooltip"
      className={cn(
        "absolute z-50 whitespace-nowrap rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--secondary)] shadow-sm pointer-events-none",
        "dark:bg-[var(--secondary)] dark:text-[var(--foreground)]",
        sideClasses[side],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
