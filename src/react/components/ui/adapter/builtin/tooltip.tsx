/**
 * Builtin Tooltip adapter — the existing self-contained tooltip machinery
 * (hover/focus open state, collision-aware positioning, portal into the token
 * scope, arrow) assembled as `TooltipParts`. Behaviour-preserving move out of
 * `tooltip.tsx`; the default surface classes live here (as Popover's base
 * classes live in `anchored-surface`), and the skin merges consumer overrides.
 *
 * @module react/components/ui/adapter/builtin/tooltip
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { cx as cn } from "../../cva.ts";
import { Slot } from "../../slot.tsx";
import { UI_SCOPE_SELECTOR } from "../../design-tokens.ts";
import type { TooltipParts, TooltipSide } from "../contract.ts";

const TooltipContext = React.createContext<
  { open: boolean; anchorRef: React.RefObject<HTMLSpanElement | null> } | null
>(null);

function TooltipProvider(
  { children }: { children: React.ReactNode; delayDuration?: number },
): React.ReactElement {
  return <>{children}</>;
}

function Tooltip({ children }: { children: React.ReactNode }): React.ReactElement {
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

function TooltipTrigger(
  { children, asChild, ...props }:
    & React.HTMLAttributes<HTMLElement>
    & { children: React.ReactNode; asChild?: boolean },
): React.ReactElement {
  const Comp = asChild ? Slot : "span";
  return <Comp {...props}>{children}</Comp>;
}

const opposite: Record<TooltipSide, TooltipSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function place(
  anchor: DOMRect,
  cw: number,
  ch: number,
  side: TooltipSide,
  offset: number,
): { top: number; left: number; side: TooltipSide } {
  const vw = globalThis.innerWidth;
  const vh = globalThis.innerHeight;
  const pad = 8;
  const fits = (s: TooltipSide): boolean => {
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

const arrowClasses: Record<TooltipSide, string> = {
  top: "top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
  bottom: "bottom-full left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45",
  left: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
  right: "right-full top-1/2 translate-x-1/2 -translate-y-1/2 rotate-45",
};

function assignRef<T>(r: React.Ref<T> | undefined, value: T | null): void {
  if (typeof r === "function") r(value);
  else if (r && typeof r === "object") {
    (r as React.MutableRefObject<T | null>).current = value;
  }
}

function TooltipContent(
  { side = "top", sideOffset = 6, className, children, style, ref: consumerRef, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { side?: TooltipSide; sideOffset?: number; ref?: React.Ref<HTMLDivElement> },
): React.ReactElement | null {
  const ctx = React.useContext(TooltipContext);
  const ref = React.useRef<HTMLDivElement>(null);
  const setNode = React.useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    assignRef(consumerRef, node);
  }, [consumerRef]);
  const [pos, setPos] = React.useState<
    { top: number; left: number; side: TooltipSide; visible: boolean }
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

  const container = anchorRef?.current?.closest<HTMLElement>(UI_SCOPE_SELECTOR) ??
    document.body;

  return createPortal(
    <div
      ref={setNode}
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
    container,
  );
}

export const builtinTooltip: TooltipParts = {
  Provider: TooltipProvider,
  Root: Tooltip,
  Trigger: TooltipTrigger,
  Content: TooltipContent,
};
