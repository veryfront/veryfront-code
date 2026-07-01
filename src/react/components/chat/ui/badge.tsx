/**
 * Badge — ported 1:1 from Veryfront Studio, semantic classes remapped to
 * veryfront's `[var(--token)]` vocabulary. The status fill tokens
 * (`--alert-*-bg`) and `--status-*` text tokens are defined in `theme.ts`, so
 * every variant renders with its proper fill. Private to the chat module.
 *
 * @module react/components/chat/ui/badge
 */
import * as React from "react";
import { cn } from "../theme.ts";
import { cva, type VariantProps } from "./cva.ts";

const badgeVariants = cva(
  "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full",
  {
    variants: {
      variant: {
        default: "bg-[var(--foreground)] text-[var(--background)]",
        success: "bg-[var(--alert-success-bg)] text-[var(--status-success)]",
        warning: "bg-[var(--alert-warning-bg)] text-[var(--status-warning)]",
        destructive: "bg-[var(--alert-error-bg)] text-[var(--status-error)]",
        outline: "border border-[var(--outline-border)] text-[var(--foreground)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/** Props accepted by `<Badge>`. */
export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  children?: React.ReactNode;
}

/** Render a badge. */
export function Badge(
  { className, variant, ...props }: BadgeProps,
): React.ReactElement {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
