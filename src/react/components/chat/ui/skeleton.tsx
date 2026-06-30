/**
 * Skeleton — ported 1:1 from Veryfront Studio. Animated placeholder bar; size
 * it with `w-*` / `h-*` utilities. Private to the chat module.
 *
 * @module react/components/chat/ui/skeleton
 */
import * as React from "react";
import { cn } from "../theme.ts";

/** Props accepted by `<Skeleton>`. */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

/** Render an animated placeholder bar. */
export function Skeleton(
  { className, ref, ...props }: SkeletonProps,
): React.ReactElement {
  return (
    <div
      ref={ref}
      className={cn(
        "h-4 w-full animate-pulse rounded-md bg-[var(--accent)]",
        className,
      )}
      {...props}
    />
  );
}
