/**
 * Separator - a thin divider rule. Pure-visual/CSS primitive (no engine needed):
 * decorative by default (`role="none"`, hidden from a11y); pass `decorative={false}`
 * for a semantic `role="separator"` with `aria-orientation`.
 *
 * @module react/components/ui/separator
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

/** Props accepted by `<Separator>`. */
export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rule direction. @default "horizontal" */
  orientation?: "horizontal" | "vertical";
  /** Decorative (hidden from a11y). Set `false` for a semantic `role="separator"`. @default true */
  decorative?: boolean;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** A horizontal (default) or vertical divider rule. */
export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ref,
  ...props
}: SeparatorProps): React.ReactElement {
  return (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      data-orientation={orientation}
      className={cn(
        "shrink-0 bg-[var(--separator)]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px self-stretch",
        className,
      )}
      {...props}
    />
  );
}
