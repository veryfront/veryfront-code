/**
 * Alert — soft-fill status callout, forked dependency-light from Veryfront
 * Studio's `Alert`. Studio uses `--alert-{variant}-bg` + `--alert-{variant}-border`
 * tokens; we only ship the `-bg` tokens, so the 1px border is derived from the
 * fill via `color-mix` (no new tokens needed). The fill is a mode-invariant light
 * pastel, so text stays dark in both themes (`dark:text-[var(--background)]`).
 *
 * @module react/components/ui/alert
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";

const alertVariants = {
  default: "bg-[var(--alert-info-bg)] border-[color-mix(in_oklch,var(--alert-info-bg),black_10%)]",
  warning:
    "bg-[var(--alert-warning-bg)] border-[color-mix(in_oklch,var(--alert-warning-bg),black_10%)]",
  error: "bg-[var(--alert-error-bg)] border-[color-mix(in_oklch,var(--alert-error-bg),black_10%)]",
  success:
    "bg-[var(--alert-success-bg)] border-[color-mix(in_oklch,var(--alert-success-bg),black_10%)]",
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
        "flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm text-[var(--foreground)] dark:text-[var(--background)]",
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
        "shrink-0 text-[var(--foreground)] dark:text-[var(--background)]",
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
        "flex-1 text-sm text-[var(--foreground)] dark:text-[var(--background)]",
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
