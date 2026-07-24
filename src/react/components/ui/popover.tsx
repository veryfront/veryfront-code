/**
 * Popover — BASIC fork of @radix-ui/react-popover with the same API shape
 * (Root / Trigger / Content + Title / Body / Footer / Actions section parts).
 * Classes are ported 1:1 from Studio's `Popover` (tokens remapped to
 * veryfront's `[var(--token)]` vocabulary). Anchored below the trigger;
 * dismisses on outside-click and `Escape`. A11y work tracked in
 * anchored-surface.tsx.
 *
 * @module react/components/ui/popover
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { AnchoredContent, AnchoredRoot, AnchoredTrigger } from "./anchored-surface.tsx";

/** Props accepted by `<Popover>`. */
export interface PopoverProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Popover root — owns open state and the positioning anchor. */
export function Popover(props: PopoverProps): React.ReactElement {
  return <AnchoredRoot {...props} />;
}

/** Trigger — toggles the popover. `asChild` merges onto the child element. */
export function PopoverTrigger(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean },
): React.ReactElement {
  return <AnchoredTrigger {...props} haspopup="dialog" />;
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
  return (
    <AnchoredContent
      role="dialog"
      align={align}
      className={cn("min-w-[220px]", className)}
      {...props}
    >
      {children}
    </AnchoredContent>
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
