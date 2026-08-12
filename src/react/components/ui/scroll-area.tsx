/**
 * ScrollArea — a styled native-overflow scroll container. The builtin engine uses
 * the platform's own scrolling (no custom scrollbar JS): a single `<div>` that
 * clips and scrolls its `children`, dressed with a tasteful thin scrollbar drawn
 * from the veryfront theme tokens. Pick the scroll axis with `orientation`.
 *
 * @example
 * <ScrollArea orientation="vertical" className="h-48 w-64">
 *   <p>…a lot of tall content…</p>
 * </ScrollArea>
 *
 * @module react/components/ui/scroll-area
 */
import * as React from "react";
import { cva, type VariantProps } from "./cva.ts";
import { cx as cn } from "./cva.ts";

const scrollAreaVariants = cva(
  // Thin, unobtrusive scrollbar drawn with theme tokens; native overflow does the work.
  cn(
    "relative rounded-md [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]",
    "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2",
    "[&::-webkit-scrollbar-track]:bg-transparent",
    "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--border)]",
    "[&::-webkit-scrollbar-thumb:hover]:bg-[var(--muted-foreground)]",
  ),
  {
    variants: {
      orientation: {
        vertical: "overflow-y-auto overflow-x-hidden",
        horizontal: "overflow-x-auto overflow-y-hidden",
        both: "overflow-auto",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  },
);

/** Props accepted by `<ScrollArea>`. */
export interface ScrollAreaProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof scrollAreaVariants> {
  /**
   * Which axis scrolls: `vertical` clips the x-axis and scrolls y, `horizontal`
   * clips y and scrolls x, `both` scrolls either way.
   * @default "vertical"
   */
  orientation?: "vertical" | "horizontal" | "both";
  /** The scrollable content. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A styled, native-overflow scroll container. */
export function ScrollArea({
  orientation = "vertical",
  className,
  children,
  ref,
  ...props
}: ScrollAreaProps): React.ReactElement {
  return (
    <div
      ref={ref}
      data-orientation={orientation}
      className={cn(scrollAreaVariants({ orientation }), className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { scrollAreaVariants };
