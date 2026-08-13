/**
 * Alert — soft-fill status callout, forked dependency-light from Veryfront
 * Studio's `Alert`. Matches Studio's `--alert-{variant}-bg` fill +
 * `--alert-{variant}-border` border token pair, so the callout carries the same
 * saturated 1px edge as Studio rather than a washed-out fill-derived hairline.
 * Each color mode provides its own token pair, so content can consistently use
 * the theme foreground.
 *
 * @module react/components/ui/alert
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

const alertVariants = {
  default: "bg-[var(--alert-info-bg)] border-[var(--alert-info-border)]",
  warning: "bg-[var(--alert-warning-bg)] border-[var(--alert-warning-border)]",
  error: "bg-[var(--alert-error-bg)] border-[var(--alert-error-border)]",
  success: "bg-[var(--alert-success-bg)] border-[var(--alert-success-border)]",
} as const;

/** Props accepted by `<Alert>`. */
export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Colour scheme. @default "default" */
  variant?: keyof typeof alertVariants;
}

export function Alert({
  children,
  className,
  variant = "default",
  ...props
}: AlertProps): React.ReactElement {
  return (
    <div
      className={cn(
        // 14px: Inter renders larger than Studio's Söhne, so `vf-type-base`
        // (16px) reads too big here — step down to `text-sm`.
        "flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm text-[var(--foreground)]",
        alertVariants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Leading icon slot for `<Alert>` (size-4 recommended). */
export function AlertIcon({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        "shrink-0 text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Message body for `<Alert>`. */
export function AlertContent({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  return (
    <p
      className={cn(
        "flex-1 text-sm text-[var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}

/** Trailing action slot for `<Alert>` (button or link). */
export function AlertAction({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn("-my-1 -mr-1 flex shrink-0 items-center", className)}
      {...props}
    >
      {children}
    </div>
  );
}
