/**
 * Popover - BASIC fork of @radix-ui/react-popover with the same API shape
 * (Root / Trigger / Content + Title / Body / Footer / Actions section parts).
 * Classes are ported 1:1 from Studio's `Popover` (tokens remapped to
 * veryfront's `[var(--token)]` vocabulary). Anchored below the trigger;
 * dismisses on outside-click and `Escape`. A11y work tracked in
 * anchored-surface.tsx.
 *
 * @example
 * ```tsx
 * import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "veryfront/ui";
 *
 * <Popover>
 *   <PopoverTrigger asChild><Button>Filters</Button></PopoverTrigger>
 *   <PopoverContent><PopoverTitle>Filters</PopoverTitle></PopoverContent>
 * </Popover>;
 * ```
 *
 * @module react/components/ui/popover
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useAdapter } from "./adapter/context.tsx";

// The Popover's behavioural mechanics (open state, positioning anchor, dismiss)
// are resolved per-render from the active UI adapter. With no adapter provider
// this is the zero-dependency `builtinPopover`, so behaviour is unchanged; an
// app may swap in Base UI / Radix / React Aria without touching this skin or any
// call-site.

/** Props accepted by `<Popover>`. */
export interface PopoverProps {
  /** The trigger and content parts to compose. */
  children: React.ReactNode;
  /** Controlled open state (pair with `onOpenChange`). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Fires when the open state changes. */
  onOpenChange?: (open: boolean) => void;
}

/** Popover root - owns open state and the positioning anchor. */
export function Popover(props: PopoverProps): React.ReactElement {
  const { popover } = useAdapter();
  return <popover.Root {...props} />;
}

/** Props accepted by `<PopoverTrigger>`. */
export interface PopoverTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Merge trigger behaviour onto the child element instead of a `<button>`. @default false */
  asChild?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * Literal slotted trigger contract with an element-specific `ref` - for
 * `asChild` triggers whose child is not a `<button>` (e.g. an `<a>`), so the
 * consumer's ref keeps its precise element type.
 */
export type PopoverSlottedTriggerProps<T extends HTMLElement = HTMLElement> =
  & Omit<PopoverTriggerProps, "ref">
  & { ref?: React.Ref<T> };

/**
 * Trigger - toggles the popover; the positioning anchor. `asChild` merges onto
 * the child element, which must forward `ref` to its DOM node. The generic
 * overload lets an `asChild` trigger carry an element-specific ref (e.g. an
 * `<a>`); `aria-haspopup` is supplied by the adapter's trigger.
 */
export function PopoverTrigger<T extends HTMLElement = HTMLElement>(
  props: PopoverSlottedTriggerProps<T>,
): React.ReactElement;
export function PopoverTrigger(props: PopoverTriggerProps): React.ReactElement;
export function PopoverTrigger(
  props: PopoverTriggerProps | PopoverSlottedTriggerProps<HTMLElement>,
): React.ReactElement {
  const { popover } = useAdapter();
  return <popover.Trigger {...(props as PopoverTriggerProps)} />;
}

/** Props accepted by `<PopoverContent>`. */
export interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment relative to the trigger. */
  align?: "start" | "end";
  /** Consumer ref for the surface node (forwarded through the adapter). */
  ref?: React.Ref<HTMLDivElement>;
}

/** Popover surface - rendered below the trigger while open. */
export function PopoverContent({
  children,
  className,
  align = "end",
  ...props
}: PopoverContentProps): React.ReactElement | null {
  const { popover } = useAdapter();
  return (
    <popover.Content
      role="dialog"
      align={align}
      className={cn("min-w-[220px]", className)}
      {...props}
    >
      {children}
    </popover.Content>
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
