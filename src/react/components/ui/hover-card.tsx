/**
 * HoverCard — a non-modal preview surface that opens when the user hovers or
 * focuses a trigger and closes when they leave or blur it. Built on the same
 * `Floating` portal + positioning machinery as Popover (anchored below the
 * trigger, portalled into the nearest `[data-vf-ui]`/`[data-vf-chat]` token
 * scope, dismisses on outside-click / `Escape`), but opens on hover intent
 * instead of click. Ideal for rich previews — a user card on a `@mention`, a
 * repo card on a link. Skinned entirely with veryfront theme tokens.
 *
 * `openDelay` / `closeDelay` gate the hover transitions so brief pointer passes
 * don't flicker the card, and moving the pointer from the trigger onto the card
 * keeps it open. Keyboard users get the card immediately on focus, and it
 * closes on blur.
 *
 * @example
 * ```tsx
 * <HoverCard>
 *   <HoverCardTrigger asChild>
 *     <a href="/users/koji">@koji</a>
 *   </HoverCardTrigger>
 *   <HoverCardContent>
 *     <div className="flex flex-col gap-1">
 *       <span className="font-semibold">Koji</span>
 *       <span className="text-[var(--muted-foreground)]">Design systems</span>
 *     </div>
 *   </HoverCardContent>
 * </HoverCard>
 * ```
 *
 * @module react/components/ui/hover-card
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { composeRefs, Slot } from "./slot.tsx";
import { Floating } from "./floating.tsx";
import { useDisclosure } from "./disclosure.ts";

/** Behavioural state shared between the HoverCard root and its parts. */
interface HoverCardContextValue {
  /** Whether the card is currently open. */
  open: boolean;
  /** Positioning anchor — the trigger element the card is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Arm the open timer (after `openDelay`); cancels any pending close. */
  scheduleOpen: () => void;
  /** Arm the close timer (after `closeDelay`); cancels any pending open. */
  scheduleClose: () => void;
  /** Cancel any armed open/close timer (used when the pointer enters the card). */
  cancelPending: () => void;
  /** Open immediately, cancelling timers (keyboard focus). */
  openNow: () => void;
  /** Close immediately, cancelling timers (blur, outside-click, `Escape`). */
  closeNow: () => void;
}

const HoverCardContext = React.createContext<HoverCardContextValue | null>(null);

/** Props accepted by `<HoverCard>`. */
export interface HoverCardProps {
  /** The trigger and content parts to compose. */
  children: React.ReactNode;
  /** Controlled open state (pair with `onOpenChange`). */
  open?: boolean;
  /** Initial open state when uncontrolled. @default false */
  defaultOpen?: boolean;
  /** Fires when the open state changes (hover/focus in, leave/blur out). */
  onOpenChange?: (open: boolean) => void;
  /** Delay in ms before the card opens after pointer enter. @default 700 */
  openDelay?: number;
  /** Delay in ms before the card closes after pointer leave. @default 300 */
  closeDelay?: number;
}

/**
 * HoverCard root — owns open state and the hover/focus timers. Renders no node
 * of its own; the positioning anchor is the trigger element, carried on context.
 */
export function HoverCard({
  children,
  open,
  defaultOpen,
  onOpenChange,
  openDelay = 700,
  closeDelay = 300,
}: HoverCardProps): React.ReactElement {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep `setOpen` reachable from timer callbacks without re-arming timers when
  // a parent re-render swaps the callback identity.
  const setOpenRef = React.useRef(setOpen);
  setOpenRef.current = setOpen;

  const cancelPending = React.useCallback(() => {
    if (openTimer.current != null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = React.useCallback(() => {
    cancelPending();
    if (openDelay <= 0) {
      setOpenRef.current(true);
      return;
    }
    openTimer.current = setTimeout(() => setOpenRef.current(true), openDelay);
  }, [openDelay, cancelPending]);

  const scheduleClose = React.useCallback(() => {
    cancelPending();
    if (closeDelay <= 0) {
      setOpenRef.current(false);
      return;
    }
    closeTimer.current = setTimeout(() => setOpenRef.current(false), closeDelay);
  }, [closeDelay, cancelPending]);

  const openNow = React.useCallback(() => {
    cancelPending();
    setOpenRef.current(true);
  }, [cancelPending]);

  const closeNow = React.useCallback(() => {
    cancelPending();
    setOpenRef.current(false);
  }, [cancelPending]);

  // Clear any dangling timer on unmount so a delayed open/close can't fire into
  // an unmounted tree.
  React.useEffect(() => cancelPending, [cancelPending]);

  const ctx = React.useMemo<HoverCardContextValue>(
    () => ({
      open: isOpen,
      anchorRef,
      scheduleOpen,
      scheduleClose,
      cancelPending,
      openNow,
      closeNow,
    }),
    [isOpen, scheduleOpen, scheduleClose, cancelPending, openNow, closeNow],
  );

  return <HoverCardContext.Provider value={ctx}>{children}</HoverCardContext.Provider>;
}

/** Props accepted by `<HoverCardTrigger>`. */
export interface HoverCardTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Render as a Slot, merging the trigger behaviour onto the child element. */
  asChild?: boolean;
  /** React 19: ref is a regular prop; forwarded to the anchor node. */
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * Trigger — carries the positioning-anchor ref and the hover/focus intent.
 * Opens the card on pointer enter (after `openDelay`) or immediately on focus;
 * closes it on pointer leave (after `closeDelay`) or on blur. `asChild` merges
 * the behaviour onto the child element, which must forward `ref` to its DOM node
 * (a child that drops `ref` leaves the card unanchored — `Floating` warns).
 */
export function HoverCardTrigger({
  children,
  asChild,
  ref,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: HoverCardTriggerProps): React.ReactElement {
  const ctx = React.useContext(HoverCardContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      ref={composeRefs<HTMLButtonElement>(
        ctx?.anchorRef as React.Ref<HTMLButtonElement> | undefined,
        ref,
      )}
      data-state={ctx?.open ? "open" : "closed"}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        onMouseEnter?.(e);
        ctx?.scheduleOpen();
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        onMouseLeave?.(e);
        ctx?.scheduleClose();
      }}
      onFocus={(e: React.FocusEvent<HTMLButtonElement>) => {
        onFocus?.(e);
        ctx?.openNow();
      }}
      onBlur={(e: React.FocusEvent<HTMLButtonElement>) => {
        onBlur?.(e);
        ctx?.closeNow();
      }}
      {...props}
    >
      {children}
    </Comp>
  );
}

/** Props accepted by `<HoverCardContent>`. */
export interface HoverCardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment relative to the trigger. @default "start" */
  align?: "start" | "end";
  /** Consumer ref for the surface node (forwarded through `Floating`). */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * HoverCard surface — the portalled floating card, rendered while open. Non-modal
 * (no `role="dialog"`, no focus trap): it's a supplementary preview, so the
 * trigger keeps focus. Keeps itself open while the pointer is over it and closes
 * shortly after the pointer leaves. Base classes mirror Popover's surface.
 */
export function HoverCardContent({
  children,
  className,
  align = "start",
  ref,
  onMouseEnter,
  onMouseLeave,
  ...props
}: HoverCardContentProps): React.ReactElement | null {
  const ctx = React.useContext(HoverCardContext);
  if (!ctx) return null;
  return (
    <Floating
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      align={align}
      onDismiss={ctx.closeNow}
      contentRef={ref}
      data-state={ctx.open ? "open" : "closed"}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
        onMouseEnter?.(e);
        ctx.cancelPending();
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
        onMouseLeave?.(e);
        ctx.scheduleClose();
      }}
      className={cn(
        "z-50 w-64 overflow-hidden rounded-lg border border-[var(--separator)]",
        "bg-[var(--popover)] p-4 text-sm text-[var(--popover-foreground)] shadow-sm outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </Floating>
  );
}
