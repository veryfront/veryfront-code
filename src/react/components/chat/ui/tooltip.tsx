/**
 * Tooltip — API-compatible with Studio's (Radix-shaped: `TooltipProvider` /
 * `Tooltip` / `TooltipTrigger` / `TooltipContent`). Hover/focus opens it.
 *
 * Content is PORTALLED to `document.body` and positioned with `getBounding
 * ClientRect`, so it escapes the Storybook iframe / any `overflow:hidden`
 * ancestor (the recurring clip bug). Positioning is collision-aware: the
 * requested `side` flips to its opposite when it would overflow the viewport,
 * and the cross-axis is clamped to stay on-screen.
 *
 * TODO(a11y): `aria-describedby` wiring, open/close delay grouping, `Escape`
 * dismissal. Private to the chat module.
 *
 * @module react/components/chat/ui/tooltip
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../theme.ts";
import { Slot } from "./slot.tsx";

type Side = "top" | "bottom" | "left" | "right";

const TooltipContext = React.createContext<
  { open: boolean; anchorRef: React.RefObject<HTMLSpanElement | null> } | null
>(null);

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
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <TooltipContext.Provider value={{ open, anchorRef }}>
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

/** Which viewport edge each side would collide with, and its opposite. */
const opposite: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** Compute a fixed-position rect for `side`, flipping on collision. */
function place(
  anchor: DOMRect,
  cw: number,
  ch: number,
  side: Side,
  offset: number,
): { top: number; left: number; side: Side } {
  const vw = globalThis.innerWidth;
  const vh = globalThis.innerHeight;
  const pad = 8;

  const fits = (s: Side): boolean => {
    if (s === "top") return anchor.top - offset - ch >= pad;
    if (s === "bottom") return anchor.bottom + offset + ch <= vh - pad;
    if (s === "left") return anchor.left - offset - cw >= pad;
    return anchor.right + offset + cw <= vw - pad;
  };

  const chosen = fits(side) || !fits(opposite[side]) ? side : opposite[side];

  let top: number;
  let left: number;
  if (chosen === "top") {
    top = anchor.top - offset - ch;
    left = anchor.left + anchor.width / 2 - cw / 2;
  } else if (chosen === "bottom") {
    top = anchor.bottom + offset;
    left = anchor.left + anchor.width / 2 - cw / 2;
  } else if (chosen === "left") {
    top = anchor.top + anchor.height / 2 - ch / 2;
    left = anchor.left - offset - cw;
  } else {
    top = anchor.top + anchor.height / 2 - ch / 2;
    left = anchor.right + offset;
  }

  left = Math.max(pad, Math.min(left, vw - cw - pad));
  top = Math.max(pad, Math.min(top, vh - ch - pad));
  return { top, left, side: chosen };
}

// A rotated square centred on the trigger-facing edge — half straddles the
// bubble so the outer half reads as a triangle pointing at the trigger.
const arrowClasses: Record<Side, string> = {
  top: "top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
  bottom: "bottom-full left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45",
  left: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
  right: "right-full top-1/2 translate-x-1/2 -translate-y-1/2 rotate-45",
};

/** Props accepted by `<TooltipContent>`. */
export interface TooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: Side;
  sideOffset?: number;
}

/** Tooltip content — portalled + positioned while hovered/focused. */
export function TooltipContent(
  { side = "top", sideOffset = 6, className, children, style, ...props }: TooltipContentProps,
): React.ReactElement | null {
  const ctx = React.useContext(TooltipContext);
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<
    { top: number; left: number; side: Side; visible: boolean }
  >({ top: 0, left: 0, side, visible: false });

  const open = ctx?.open ?? false;
  const anchorRef = ctx?.anchorRef;

  React.useLayoutEffect(() => {
    if (!open || !anchorRef) return;
    const update = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const c = ref.current;
      if (!a || !c) return;
      const next = place(a, c.offsetWidth, c.offsetHeight, side, sideOffset);
      setPos({ ...next, visible: true });
    };
    update();
    globalThis.addEventListener("scroll", update, true);
    globalThis.addEventListener("resize", update);
    return () => {
      globalThis.removeEventListener("scroll", update, true);
      globalThis.removeEventListener("resize", update);
    };
  }, [open, side, sideOffset, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={cn(
        "fixed z-[60] w-max max-w-xs whitespace-nowrap rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--secondary)] shadow-sm pointer-events-none",
        "dark:bg-[var(--secondary)] dark:text-[var(--foreground)]",
        className,
      )}
      style={{
        top: pos.top,
        left: pos.left,
        visibility: pos.visible ? "visible" : "hidden",
        ...style,
      }}
      {...props}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "absolute size-2 bg-[var(--primary)] dark:bg-[var(--secondary)]",
          arrowClasses[pos.side],
        )}
      />
    </div>,
    document.body,
  );
}
