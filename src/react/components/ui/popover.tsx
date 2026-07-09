/**
 * Popover — BASIC fork of @radix-ui/react-popover with the same API shape
 * (Root / Trigger / Content + Title / Body / Footer / Actions section parts).
 * Classes are ported 1:1 from Studio's `Popover` (tokens remapped to
 * veryfront's `[var(--token)]` vocabulary). Anchored below the trigger;
 * dismisses on outside-click and `Escape`.
 *
 * TODO(a11y): focus trap + restore, portal + collision-aware positioning
 * (flip/shift), `aria-controls`/`aria-expanded` wiring on the trigger,
 * `side`/`align` offset variants. Private to the chat module.
 *
 * @module react/components/ui/popover
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { Slot } from "./slot.tsx";
import { Floating } from "./floating.tsx";

const PopoverContext = React.createContext<
  {
    open: boolean;
    setOpen: (open: boolean) => void;
    anchorRef: React.RefObject<HTMLElement | null>;
  } | null
>(null);

/** Props accepted by `<Popover>`. */
export interface PopoverProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Popover root — owns open state and the positioning anchor. */
export function Popover({
  children,
  open,
  defaultOpen,
  onOpenChange,
}: PopoverProps): React.ReactElement {
  const [internal, setInternal] = React.useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internal;
  const setOpen = React.useCallback((next: boolean) => {
    if (!isControlled) setInternal(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);
  const anchorRef = React.useRef<HTMLElement | null>(null);
  return (
    <span ref={anchorRef} className="relative inline-block">
      <PopoverContext.Provider value={{ open: isOpen, setOpen, anchorRef }}>
        {children}
      </PopoverContext.Provider>
    </span>
  );
}

/** Trigger — toggles the popover. `asChild` merges onto the child element. */
export function PopoverTrigger({
  children,
  asChild,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }): React.ReactElement {
  const ctx = React.useContext(PopoverContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      aria-haspopup="dialog"
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

/** Props accepted by `<PopoverContent>`. */
export interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment relative to the trigger. */
  align?: "start" | "end";
}

/** Popover surface — rendered below the trigger while open. */
export function PopoverContent({
  children,
  className,
  align = "end",
  ...props
}: PopoverContentProps): React.ReactElement | null {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) return null;
  return (
    <Floating
      anchorRef={ctx.anchorRef}
      open={ctx.open}
      align={align}
      onDismiss={() => ctx.setOpen(false)}
      role="dialog"
      className={cn(
        "z-50 min-w-[220px] overflow-hidden rounded-lg bg-[var(--popover)] text-[var(--foreground)] shadow-sm outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </Floating>
  );
}

/** Primary heading slot at the top of a popover (Studio: Heading level 4). */
export function PopoverTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h4
      className={cn(
        "px-5 pt-5 pb-3 text-base font-semibold text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </h4>
  );
}

/** Small section label inside a popover (Studio: Heading level 5). */
export function PopoverHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h5
      className={cn(
        "p-5 pb-2 text-sm font-medium text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </h5>
  );
}

/** Body content region (Studio: `px-5 last:pb-5 flex flex-col gap-4`). */
export function PopoverBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn("px-5 last:pb-5 flex flex-col gap-4", className)}
      {...props}
    />
  );
}

/** Footer region; pass `bordered` for a top divider (Studio). */
export function PopoverFooter({
  className,
  bordered,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { bordered?: boolean }): React.ReactElement {
  return (
    <div
      className={cn(
        "p-5",
        bordered && "mt-5 border-t border-[var(--separator)]",
        className,
      )}
      {...props}
    />
  );
}

/** Right-aligned button row, for use inside a footer. */
export function PopoverActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn("flex gap-2.5 justify-end items-center", className)}
      {...props}
    />
  );
}
